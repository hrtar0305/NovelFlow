import boto3
import csv
import io
import os
import json
import re
import logging
import tag_stats
from decimal import Decimal
from ast import literal_eval
from boto3.dynamodb.conditions import Key

# Configure logging
logger = logging.getLogger()
logger.setLevel(logging.INFO)

# Initialize Boto3 clients
s3_client = boto3.client('s3')
dynamodb = boto3.resource('dynamodb')

# Get table name from environment variable
TABLE_NAME = os.environ.get('DYNAMODB_TABLE_NAME', 'NovelRanks')
table = dynamodb.Table(TABLE_NAME)

# 크롤러 placeholder 행(접근 불가·재시도 실패·파싱 실패)의 제목 접두사.
# crawler/consolidate_data.py 의 PLACEHOLDER_TITLE_PREFIX 와 같은 값이어야 한다.
PLACEHOLDER_TITLE_PREFIX = "N/A ("

# 같은 날짜를 다시 적재할 때 지우는 잔존 행이 새 파일 행 수의 이 비율을 넘으면 지우지 않는다.
# 정상적인 재실행(한두 시간 뒤·자정 넘김)은 순위 경계에서 수십 편이 바뀌는 정도라, 이보다 많으면
# 일부만 담긴 파일을 올린 것으로 보고 사람이 보게 한다.
MAX_STALE_RATIO = 0.2


def _is_placeholder(item):
    return str(item.get('Title', '')).startswith(PLACEHOLDER_TITLE_PREFIX)

def lambda_handler(event, context):
    """
    Main handler function triggered by S3 CSV file uploads to store data in DynamoDB.
    """
    logger.info(f"Received event: {json.dumps(event)}")

    # Extract bucket name and file key (path) from S3 event
    bucket_name = event['Records'][0]['s3']['bucket']['name']
    file_key = event['Records'][0]['s3']['object']['key']

    # 원본 HTML(raw/ 접두)은 이 Lambda 가 다루지 않는다 — 같은 버킷을 쓰면 트리거가 걸린다.
    if file_key.startswith('raw/'):
        logger.info(f"Raw HTML object ({file_key}) — not an ingestion input. Skipping.")
        return {'statusCode': 200, 'body': 'Raw object.'}

    if not file_key.endswith(('.csv', '.jsonl')):
        logger.info(f"Unsupported file ({file_key}) triggered the event. Skipping.")
        return {'statusCode': 200, 'body': 'Unsupported file type.'}

    try:
        response = s3_client.get_object(Bucket=bucket_name, Key=file_key)
        content = response['Body'].read().decode('utf-8')

        # NDJSON 과 CSV 를 모두 받는다. 전환 기간에는 두 형식이 섞이고, 과거 파일을
        # 다시 적재해야 할 때도 옛 CSV 를 그대로 읽을 수 있어야 한다.
        if file_key.endswith('.jsonl'):
            items = [json.loads(line) for line in content.splitlines() if line.strip()]
        else:
            items = list(csv.DictReader(io.StringIO(content)))

        if not items:
            logger.warning(f"{file_key} is empty.")
            return {'statusCode': 400, 'body': 'Input file is empty.'}

        processed_items = []
        with table.batch_writer() as batch:
            for item_dict in items:
                processed_item = process_row(item_dict)
                final_item = {k: v for k, v in processed_item.items() if v != "" and v != -1}
                batch.put_item(Item=final_item)
                processed_items.append(processed_item)
        
        logger.info(f"Successfully processed and stored {len(items)} items from {file_key}.")

        # 아래 부가 단계들은 하나가 실패해도 나머지를 마저 시도하고, 끝에서 모아 예외를 올린다.
        # 삼키면 Lambda 가 성공으로 끝나 S3 비동기 재시도가 일어나지 않고, 날짜 목록·태그 랭킹에서
        # 그날이 조용히 빠진다. 모든 쓰기가 (ID, Date) 키 덮어쓰기라 재시도해도 중복은 생기지 않는다
        # (DECISIONS 「전달 보장」).
        failures = []

        # Analyze and store tag trends using the successfully processed items
        _run_step(failures, 'tag trends', calculate_and_store_tag_trends, processed_items)

        # 파일명에서 날짜를 뽑는다 ('2025-08-19.jsonl' -> '2025-08-19').
        #
        # **날짜 형태가 아니면 여기서 멈춘다.** 이 버킷의 S3 트리거에는 접미사 필터가
        # 없어서 아무 `.csv`/`.jsonl` 을 올려도 이 함수가 깨어난다. 예전에는 그 파일명이
        # 그대로 `AVAILABLE_DATES` 에 들어가(`notes.csv` → 'notes') 화면의 날짜 목록을
        # 오염시켰다. 항목 적재까지는 이미 끝난 상태이므로 예외를 던지지 않고 반환한다.
        date_from_file = file_key.split('/')[-1].rsplit('.', 1)[0]
        if not re.fullmatch(r'\d{4}-\d{2}-\d{2}', date_from_file):
            logger.warning(
                f"파일명이 날짜 형식(YYYY-MM-DD)이 아니다: {file_key} — "
                "날짜별 집계와 AVAILABLE_DATES 갱신을 건너뛴다."
            )
            _raise_if_failed(failures, file_key)
            return {
                'statusCode': 200,
                'body': json.dumps(f'Stored {len(items)} items from {file_key}; date-scoped steps skipped.')
            }

        # 같은 날짜를 다시 적재했다면 이전 실행에만 있던 작품 행을 지운다
        _run_step(failures, 'stale rows', delete_stale_rows, date_from_file, processed_items)

        # Update AVAILABLE_DATES item in DynamoDB
        _run_step(failures, 'AVAILABLE_DATES', update_available_dates, date_from_file)

        # 데이터 분석 리포트용 압축 스냅샷
        _run_step(failures, 'RSNAP', store_ranking_snapshot, date_from_file, processed_items)

        _raise_if_failed(failures, file_key)

        return {
            'statusCode': 200,
            'body': json.dumps(f'Successfully processed {file_key} and stored {len(items)} items.')
        }

    except Exception as e:
        logger.error(f"Error processing file {file_key} from bucket {bucket_name}: {e}")
        raise e


def _run_step(failures, name, fn, *args):
    """부가 단계 하나를 돌리고, 실패하면 로그를 남긴 뒤 `failures` 에 모은다."""
    try:
        fn(*args)
    except Exception as e:
        logger.error(f"Step '{name}' failed: {e}")
        failures.append(f"{name}: {e}")


def _raise_if_failed(failures, file_key):
    if failures:
        raise RuntimeError(f"{file_key}: 부가 단계 {len(failures)}개 실패 — " + '; '.join(failures))


def process_row(item):
    """레코드 하나를 DynamoDB 항목 형태로 맞춘다.

    CSV 는 모든 값을 문자열로 실어 오므로 형 변환이 필요하고, NDJSON 은 이미 제 형을
    갖고 있다. 두 경우를 같은 함수가 처리한다 — 이미 int/bool/list 인 값은 그대로 둔다.
    **여기 나열되지 않은 키도 그대로 통과시킨다.** 예전 CSV 스키마처럼 아는 필드만
    남기면 새로 추가된 값이 다시 조용히 사라진다.
    """
    # Convert numeric fields
    for key in ['Ranking', 'Score', 'View', 'Like', 'Fav', 'Alr', 'Eps',
                'FirstEpView', 'FirstEpNum', 'Ep30View', 'Ep30Num',
                'RecentBaseView', 'RecentBaseNum', 'TargetLatestEpView', 'TargetLatestEpNum']:
        v = item.get(key)
        if v is None or v == "":
            continue
        if isinstance(v, bool):
            continue
        try:
            item[key] = int(v)
        except (ValueError, TypeError) as e:
            logger.error(f"Could not convert {key} to int for value {v}.")
            raise e
    
    # CSV는 bool을 "True"/"False" 문자열로 실어 오므로 되돌린다.
    # 값이 없으면(구 CSV) 키를 만들지 않아 DynamoDB 항목에도 넣지 않는다.
    if item.get('IsAdult') not in (None, ''):
        if not isinstance(item['IsAdult'], bool):
            item['IsAdult'] = str(item['IsAdult']).strip().lower() in ('true', '1', 'yes')

    # Keep ID and AuthorID as strings
    item['ID'] = str(item['ID'])
    if item.get('AuthorID'):
        item['AuthorID'] = str(item['AuthorID'])

    # Parse Tags field (string list -> actual list)
    if item.get('Tags'):
        try:
            # NDJSON 은 이미 리스트다. CSV 만 문자열로 실어 온다.
            tags_list = item['Tags'] if isinstance(item['Tags'], list) else literal_eval(item['Tags'])

            if not isinstance(tags_list, list):
                raise ValueError(f"Tags field is not a list: {item['Tags']}")
            
            seen_tags = set()
            ordered_unique_tags = []
            for tag in tags_list:
                stripped_tag = tag.strip()
                if stripped_tag and stripped_tag not in seen_tags:
                    ordered_unique_tags.append(stripped_tag)
                    seen_tags.add(stripped_tag)
            item['Tags'] = ordered_unique_tags
            
        except (ValueError, SyntaxError) as e:
            logger.error(f"Could not process Tags field: {item.get('Tags')}. Error: {e}")
            raise e
    
    return item

def calculate_and_store_tag_trends(items):
    """
    Calculates tag trends based on all items and stores them in DynamoDB (STATS#{date}).
    계산은 `tag_stats.daily_tag_stats` 한 곳(소급 스크립트와 공유). 필드:
    - TagCounts / TagCountsTop100: 작품 수, 100위 안 작품 수
    - TagScoreSum / ScoreTotal / RankedTotal: 태그별 랭킹 점수 합, 그날 전체 합, 순위 작품 수 — 인기 점수(점유율)의 재료(2026-10-06)
    - TagWeightedScoresLogarithmic: 구 인기 점수 Σ1/ln(rank+1) — 기간 페이지 호환으로 남긴다
    """
    if not items:
        return

    stats = tag_stats.daily_tag_stats(items)

    # Get date from the first item
    date = items[0]['Date']

    # Create stats data item to store
    stats_item = {
        'ID': f'STATS#{date}',
        'Date': date,
        'DataType': 'TAG_TRENDS',
        'TagCounts': stats['TagCounts'],
        'TagCountsTop100': stats['TagCountsTop100'],
        'TagWeightedScoresLogarithmic': {k: Decimal(str(v)) for k, v in stats['TagWeightedScoresLogarithmic'].items()},
        'TagScoreSum': stats['TagScoreSum'],
        'ScoreTotal': stats['ScoreTotal'],
        'RankedTotal': stats['RankedTotal'],
    }

    try:
        table.put_item(Item=stats_item)
        logger.info(f"Successfully calculated and stored tag trends for {date}.")
    except Exception as e:
        logger.error(f"Failed to store tag trends for {date}. Error: {e}")
        raise

def store_ranking_snapshot(date, items):
    """데이터 분석 리포트가 읽을 날짜별 압축 스냅샷(`RSNAP#<date>`)을 쓴다.

    **왜 필요한가.** 분석 리포트는 기간 전체(최대 90일)를 봐야 하는데, 날짜당 랭킹은
    364행 340KB이고 `DateRankIndex` 조회가 웜 0.37초·콜드 30초다. 90일을 요청 시점에
    모으면 API Gateway 29초 제한을 넘고 브라우저 페이로드도 30MB가 된다.
    여기서 날짜당 16KB로 줄여 두면 백엔드가 `batch_get_item` 한 번(100키)으로 다 읽는다.

    **키를 반복하지 않고 병렬 배열로 담는다.** 행마다 `{"id":..,"rank":..}` 를 쓰면
    같은 키 이름이 364번 들어가 항목이 몇 배로 커진다. 태그 시계열에서 쓴 방식과 같다.

    **성인작을 여기서 걸러내지 않는다.** `IsAdult` 를 그대로 실어 보내고 판정은
    백엔드의 `_is_adult_item()` 한 곳에서만 한다 — 차단 목록(`ADULT_BLOCKLIST`)은
    과거 전 기간을 덮고 언제든 갱신되므로, 적재 시점에 굳혀 버리면 나중에 추가된
    작품이 리포트에 남는다. 판정 로직을 두 군데 두지 않는 것이 이 설계의 핵심이다.

    제목·작가·태그는 담지 않는다. 화면에 글자가 필요한 날짜는 기간의 마지막 날뿐이고,
    그건 백엔드가 기존 조회로 가져온다.

    **placeholder 행은 수치를 0(Eps·View·Like 모두)으로 싣는다.** 제목이 없는 RSNAP 에서
    리포트(`analysis_report.per_work`)는 `View == 0 and Eps == 0` 을 자리표시로 보고 기간 증감
    계산에서 건너뛴다. 크롤러 placeholder 도 0 이고 `scripts/backfill_ranking_snapshots.py` 도
    0 을 쓰므로, 다른 표식(-1 등)을 쓰면 RSNAP 에 두 규칙이 섞이고 리포트가 그 값을 실측으로
    센다. 여기서는 placeholder 를 제목으로 확인해 0 을 강제할 뿐이다. 행 자체는 남긴다 — 빼면
    그날 순위 이탈·재진입으로 잡혀 순위 변동 집계가 오염된다. 순위와 성인 여부는 그대로 있다.
    """
    try:
        ids, rank, eps, view, like, adult = [], [], [], [], [], []
        for it in items:
            if not it.get('ID'):
                continue
            ids.append(str(it['ID']))
            rank.append(int(it.get('Ranking') or 0))
            if _is_placeholder(it):
                eps.append(0)
                view.append(0)
                like.append(0)
            else:
                eps.append(int(it.get('Eps') or 0))
                view.append(int(it.get('View') or 0))
                like.append(int(it.get('Like') or 0))
            adult.append(bool(it.get('IsAdult')))

        table.put_item(Item={
            'ID': f'RSNAP#{date}',
            'Date': date,
            'ids': ids, 'rank': rank, 'eps': eps,
            'view': view, 'like': like, 'adult': adult,
        })
        logger.info(f"Stored ranking snapshot RSNAP#{date} with {len(ids)} rows.")

    except Exception as e:
        # 예외를 올려 S3 비동기 재시도를 받는다. 재시도는 같은 키를 덮어써 중복이 생기지 않는다.
        logger.error(f"Failed to store ranking snapshot for {date}. Error: {e}")
        raise


def delete_stale_rows(date, items):
    """그 날짜의 작품 행 중 이번 파일에 없는 것을 지운다.

    **왜 필요한가.** 적재는 파일에 있는 행을 (ID, Date) 키로 덮어쓸 뿐이다. 같은 날짜로 두 번
    수집되면(실패 뒤 재실행, 자정 넘긴 재실행이 다음 날 정기 실행과 겹침) 첫 실행에만 있던 작품
    행이 옛 순위 그대로 남아, 그날 목록이 500건을 넘고 순위 번호가 겹친다. STATS·RSNAP 은 파일
    행만으로 만들므로 DynamoDB 행과도 어긋난다. 파일이 그날의 기준이다.

    **좁게 지운다.**
    - 이 함수까지 왔다는 것은 파일 전 행이 변환·적재를 통과했다는 뜻이다(consolidate 의 수량·품질
      검증을 통과해 커밋된 파일). 그래도 파일이 '그 날짜의 순위표'처럼 보이지 않으면(날짜가 섞였거나
      순위 없는 행이 있으면) 지우지 않는다.
    - 후보는 `DateRankIndex`(Date + Ranking)에서만 찾는다. STATS#·RSNAP#·AVAILABLE_DATES·
      ADULT_BLOCKLIST·RUN_LOCK# 같은 특수 항목은 Ranking 이 없어 이 색인에 잡히지 않고, 혹시 몰라
      숫자 ID(작품 번호)만 지운다.
    - 지울 행이 새 파일 행 수의 MAX_STALE_RATIO 를 넘으면 지우지 않고 예외를 올린다 — 일부만
      담긴 파일을 올렸을 가능성이 커서, 그날 행을 대량으로 지우기 전에 사람이 봐야 한다.

    색인은 최종 일관성이지만 안전하다: 이번 파일에 있는 ID 는 절대 지우지 않고, 지울 후보는 이전
    실행이 오래전에 쓴 행이다.
    """
    new_ids = {str(it['ID']) for it in items if it.get('ID')}
    if not new_ids:
        return
    if any(it.get('Date') != date for it in items):
        logger.warning(f"{date}: 파일에 다른 날짜 행이 섞여 있다 — 잔존 행 정리를 건너뛴다.")
        return
    if any(not isinstance(it.get('Ranking'), int) or it.get('Ranking') <= 0 for it in items):
        logger.warning(f"{date}: 순위 없는 행이 있다(순위표 파일이 아님) — 잔존 행 정리를 건너뛴다.")
        return

    stale = set()
    query_kwargs = {
        'IndexName': 'DateRankIndex',
        'KeyConditionExpression': Key('Date').eq(date),
        'ProjectionExpression': 'ID',
    }
    while True:
        resp = table.query(**query_kwargs)
        for row in resp.get('Items', []):
            row_id = str(row.get('ID', ''))
            if row_id.isdigit() and row_id not in new_ids:
                stale.add(row_id)
        if 'LastEvaluatedKey' not in resp:
            break
        query_kwargs['ExclusiveStartKey'] = resp['LastEvaluatedKey']

    if not stale:
        return
    if len(stale) > len(new_ids) * MAX_STALE_RATIO:
        raise RuntimeError(
            f"{date}: 이번 파일({len(new_ids)}행)에 없는 기존 행이 {len(stale)}개라 지우지 않는다 — "
            "일부만 담긴 파일인지 확인할 것."
        )

    with table.batch_writer() as batch:
        for row_id in sorted(stale):
            batch.delete_item(Key={'ID': row_id, 'Date': date})
    logger.warning(
        f"{date}: 이전 실행에만 있던 작품 행 {len(stale)}개를 지웠다 "
        f"(예: {', '.join(sorted(stale)[:10])})."
    )


def update_available_dates(date_from_file):
    """
    Updates the AVAILABLE_DATES item in DynamoDB with the new date.
    """
    try:
        # Get the current list of dates to avoid duplicates
        response = table.get_item(
            Key={'ID': 'AVAILABLE_DATES', 'Date': 'ALL_DATES'},
            ProjectionExpression="dates"
        )
        
        # Safely get the list of dates, default to an empty list if not found
        current_dates_set = set(response.get('Item', {}).get('dates', []))

        # Add the new date. A set automatically handles duplicates.
        current_dates_set.add(date_from_file)

        # Convert back to a list and sort it for consistent ordering
        sorted_dates = sorted(list(current_dates_set), reverse=True)

        # Update the entire item with the new list of dates
        table.put_item(
            Item={
                'ID': 'AVAILABLE_DATES',
                'Date': 'ALL_DATES',
                'dates': sorted_dates
            }
        )
        logger.info(f"Successfully updated AVAILABLE_DATES with {date_from_file}.")

    except Exception as e:
        logger.error(f"Failed to update AVAILABLE_DATES with {date_from_file}. Error: {e}")
        raise
