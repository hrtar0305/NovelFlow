import json
import boto3
from boto3.dynamodb.conditions import Key
import logging
import os
import time
from decimal import Decimal
import math

# --- Basic Setup ---
logger = logging.getLogger()
logger.setLevel(logging.INFO)

# --- Centralized Configuration ---
class Config:
    """Houses all configuration variables for the consolidation script."""
    DYNAMODB_TABLE_NAME = os.environ.get('DYNAMODB_TABLE_NAME')
    # 작가 다른 작품 색인(ID 수집기가 유지). 비우면 붙이지 않는다.
    STATE_BUCKET = os.environ.get('STATE_BUCKET')
    AUTHOR_INDEX_KEY = 'state/author_works.json'
    SQS_RESULT_QUEUE_URL = os.environ.get('SQS_RESULT_QUEUE_URL')
    LOOP_TIMEOUT_SECONDS = 480  # Lambda 제한(600초)보다 짧게 — 루프가 먼저 끝나야 원인이 로그에 남는다

if not Config.DYNAMODB_TABLE_NAME or not Config.SQS_RESULT_QUEUE_URL:
    raise ValueError("DYNAMODB_TABLE_NAME and SQS_RESULT_QUEUE_URL env vars must be set.")

# --- Logging Helper ---
def _log(level, execution_id, message, **kwargs):
    """Creates a structured log message."""
    log_data = {"execution_id": execution_id, "message": message, **kwargs}
    logger.log(level, json.dumps(log_data, ensure_ascii=False))

# --- Helper Functions ---
def _collect_all_messages(sqs_client, execution_id):
    """Collects all available messages from the SQS queue until empty or timeout."""
    all_messages = []
    receipt_handles_to_delete = []
    loop_start_time = time.time()

    _log(logging.INFO, execution_id, "Starting to collect all messages from SQS.")

    while time.time() - loop_start_time < Config.LOOP_TIMEOUT_SECONDS:
        response = sqs_client.receive_message(
            QueueUrl=Config.SQS_RESULT_QUEUE_URL,
            MaxNumberOfMessages=10,
            WaitTimeSeconds=5,
            AttributeNames=['SentTimestamp']
        )
        messages = response.get('Messages', [])
        if not messages:
            _log(logging.INFO, execution_id, f"Queue is empty. Collected {len(all_messages)} messages in total.")
            break

        for message in messages:
            all_messages.append(message)
            receipt_handles_to_delete.append({'Id': message['MessageId'], 'ReceiptHandle': message['ReceiptHandle']})
    else:
        raise TimeoutError(f"Consolidation loop timed out after {Config.LOOP_TIMEOUT_SECONDS} seconds.")
    
    return all_messages, receipt_handles_to_delete

def _deduplicate_items(messages, execution_id):
    """Deduplicates items based on 'ID', keeping the one with the earliest SentTimestamp."""
    if not messages:
        return []
    _log(logging.INFO, execution_id, f"Deduplicating {len(messages)} messages based on earliest timestamp...")
    
    # novel_id -> (item_data, sent_timestamp)
    unique_items_map = {}

    for msg in messages:
        try:
            item = json.loads(msg['Body'])
            novel_id = item.get('ID')
            sent_timestamp = int(msg['Attributes']['SentTimestamp'])

            if not novel_id:
                _log(logging.WARNING, execution_id, "Message found without a novel ID.", body=msg['Body'])
                continue

            # 새로운 아이템이거나, 기존 아이템보다 더 먼저 보내진 경우에만 저장/덮어쓰기
            if novel_id not in unique_items_map or sent_timestamp < unique_items_map[novel_id][1]:
                unique_items_map[novel_id] = (item, sent_timestamp)
        except (json.JSONDecodeError, KeyError, ValueError) as e:
            _log(logging.ERROR, execution_id, f"Failed to process a message during deduplication: {e}", body=msg.get('Body'))

    final_items = [data for data, ts in unique_items_map.values()]
    _log(logging.INFO, execution_id, f"Deduplication complete. {len(final_items)} unique items remaining.")
    return final_items

def _validate_data(execution_id, items, expected_count):
    """Validates that the count of unique collected items matches the target count."""
    collected_data_count = len(items)
    if not expected_count or expected_count == 0:
        _log(logging.WARNING, execution_id, "Expected count is 0, skipping validation.")
        return
    if collected_data_count != expected_count:
        error_message = f"Validation Failed: Expected {expected_count}, but collected {collected_data_count} unique items."
        _log(logging.ERROR, execution_id, error_message)
        raise ValueError(error_message)
    _log(logging.INFO, execution_id, f"Validation successful: {collected_data_count}/{expected_count} unique items collected.")

def _calculate_and_store_tag_stats(dynamodb_table, execution_id, items):
    """Calculates tag statistics from all items and stores them in a single DynamoDB item."""
    if not items:
        _log(logging.INFO, execution_id, "No items to calculate tag stats from.")
        return

    _log(logging.INFO, execution_id, "Calculating tag statistics...")
    tag_counts = {}
    tag_weighted_scores_inverse_linear = {}
    tag_weighted_scores_inverse_rank = {}
    tag_weighted_scores_logarithmic = {}
    total_ranks = len(items)

    for item in items:
        Rank = item.get('Rank')
        if not isinstance(Rank, int) or Rank <= 0:
            continue

        weight_inverse_linear = total_ranks - Rank + 1
        weight_inverse_rank = 1 / Rank
        weight_logarithmic = 1 / math.log(Rank + 1)

        tags = item.get('Tags', [])
        if isinstance(tags, list):
            for tag in tags:
                tag_counts[tag] = tag_counts.get(tag, 0) + 1
                tag_weighted_scores_inverse_linear[tag] = tag_weighted_scores_inverse_linear.get(tag, 0) + weight_inverse_linear
                tag_weighted_scores_inverse_rank[tag] = tag_weighted_scores_inverse_rank.get(tag, 0) + weight_inverse_rank
                tag_weighted_scores_logarithmic[tag] = tag_weighted_scores_logarithmic.get(tag, 0) + weight_logarithmic

    if not tag_counts:
        _log(logging.INFO, execution_id, "No tags found in items to create stats.")
        return

    date = items[0]['Date']
    stats_item = {
        'ID': f'TAG_STATS#{date}',
        'Date': date,
        'DataType': 'CONTEST_TAG_STATS',
        'TagCounts': tag_counts,
        'TagWeightedScoresInverseLinear': {k: Decimal(str(v)) for k, v in tag_weighted_scores_inverse_linear.items()},
        'TagWeightedScoresInverseRank': {k: Decimal(str(v)) for k, v in tag_weighted_scores_inverse_rank.items()},
        'TagWeightedScoresLogarithmic': {k: Decimal(str(v)) for k, v in tag_weighted_scores_logarithmic.items()},
    }

    try:
        dynamodb_table.put_item(Item=stats_item)
        _log(logging.INFO, execution_id, f"Successfully stored tag stats for {date}.")
    except Exception as e:
        _log(logging.ERROR, execution_id, f"Failed to store tag stats for {date}. Error: {e}")

def daily_rank(items, prev_views):
    """일간 순위(면접 D22 규칙). 대표 순위로 쓴다 — 누적 순위(`Rank`)는 공모전 중반부터 거의 움직이지 않는다.

    - `ViewDelta` = 오늘 누적 조회 − 직전 수집일 누적 조회. **'누적 조회수 증가량'이지 인증 조회수가 아니다.**
    - 직전 **유효** 측정값(-1 아님)이 없으면 계산하지 않는다(속성을 싣지 않음 → 화면 NEW). 신규 등록·부활(전날
      placeholder)·늦게 찾은 작품을 모두 덮는다. 전날이 -1 인데 0 으로 치면 누적 전체가 하루치로 잡힌다.
    - 정렬: 증가 큰 순 → 누적 조회 많은 순 → 번호 작은 순(동점이 수천 건이라 결정적이어야 순위선이 요동치지 않는다).
    - 모수: 값이 있는 전체 참가작. 다른 작품이 사라지기만 해도 순위가 오를 수 있다(각주감).
    `prev_views`: {ID: 직전 수집일 View}. 값을 바꾼 items 를 그대로 돌려준다.
    """
    ranked = []
    for item in items:
        cur, prev = item.get('View'), prev_views.get(str(item.get('ID')))
        item.pop('ViewDelta', None)
        item.pop('DailyRank', None)
        if isinstance(cur, int) and cur >= 0 and prev is not None and prev >= 0:
            item['ViewDelta'] = cur - prev
            ranked.append(item)
    ranked.sort(key=lambda x: (-x['ViewDelta'], -x['View'], int(x['ID'])))
    for i, item in enumerate(ranked, 1):
        item['DailyRank'] = i
    return items


def _previous_views(dynamodb_table, date, execution_id):
    """실제 직전 수집일(달력 −1 아님 — DECISIONS 2026-07-01)과 그날의 {ID: View}."""
    meta = dynamodb_table.get_item(Key={'ID': 'CONTEST_AVAILABLE_DATES', 'Date': 'METADATA'}).get('Item') or {}
    earlier = sorted(d for d in (meta.get('dates') or set()) if d < date)
    if not earlier:
        _log(logging.INFO, execution_id, "No previous collection date — DailyRank is empty for this date.", date=date)
        return None, {}
    prev = earlier[-1]
    views, kw = {}, {
        'IndexName': 'DateViewIndex', 'KeyConditionExpression': Key('Date').eq(prev),
        'ProjectionExpression': 'ID, #v', 'ExpressionAttributeNames': {'#v': 'View'},
    }
    while True:
        r = dynamodb_table.query(**kw)
        for it in r['Items']:
            views[str(it['ID'])] = int(it['View'])
        if 'LastEvaluatedKey' not in r:
            break
        kw['ExclusiveStartKey'] = r['LastEvaluatedKey']
    _log(logging.INFO, execution_id, "Loaded previous collection.", prev_date=prev, items=len(views))
    return prev, views


def attach_author_works(items, index):
    """작품 행에 작가의 다른 작품 번호를 원문 그대로 붙인다(기성 여부는 백엔드가 판정 — 적재 때 굳히지 않는다).

    백엔드는 DynamoDB 읽기 권한만 있어 S3 색인을 직접 못 읽는다. 행마다 수십 바이트라 매일 붙여도 싸다.
    색인에 없는 작가(아직 못 받음)는 속성을 싣지 않는다 — '다른 작품 없음'과 구별된다.
    """
    for item in items:
        info = index.get(str(item.get('AuthorID')))
        if info is None:
            continue
        item['AuthorOtherNovels'] = [n for n in info.get('novels', []) if str(n) != str(item.get('ID'))]
        item['AuthorOtherMore'] = bool(info.get('more'))
    return items


def _load_author_index(execution_id):
    if not Config.STATE_BUCKET:
        return {}
    try:
        body = boto3.client('s3').get_object(Bucket=Config.STATE_BUCKET, Key=Config.AUTHOR_INDEX_KEY)['Body'].read()
        return json.loads(body)
    except Exception as e:  # noqa: BLE001 — 부가 정보라 적재를 막지 않는다
        _log(logging.WARNING, execution_id, f"Author index unavailable: {e}")
        return {}


def daily_tag_stats(items):
    """2026 태그 점수 — **일간 순위 기준**(대표 순위와 통일, 사용자 결정 2026-10-02). 데일리의 2-track 과 같은 식이다.

    - 인기 점수 = Σ 1/ln(DailyRank+1), 등장 = 일간 순위가 있는 작품 중 그 태그를 단 수, 상위 100 = DailyRank ≤ 100.
    - 상위권 집중도는 백엔드가 계산한다 — 데일리는 모수가 500 이라 '나머지 400'이 고정이지만 공모전은 순위가 매겨진
      작품 수가 날마다 달라 `RankedTotal` 을 함께 싣는다(나머지 = RankedTotal − 100).
    - 등장 2회 미만 태그는 뺀다(데일리와 같은 노이즈 제거). 일간 순위가 없는 날(첫 수집일)은 None.
    """
    ranked = [i for i in items if isinstance(i.get('DailyRank'), int)]
    if not ranked:
        return None
    counts, top100, power = {}, {}, {}
    for it in ranked:
        r = it['DailyRank']
        w = 1 / math.log(r + 1)
        for tag in it.get('Tags') or []:
            counts[tag] = counts.get(tag, 0) + 1
            power[tag] = power.get(tag, 0) + w
            if r <= 100:
                top100[tag] = top100.get(tag, 0) + 1
    for t in [t for t, c in counts.items() if c < 2]:
        counts.pop(t, None); top100.pop(t, None); power.pop(t, None)
    return {'TagCounts': counts, 'TagCountsTop100': top100, 'TagWeightedScoresLogarithmic': power, 'RankedTotal': len(ranked)}


def _store_daily_tag_stats(dynamodb_table, execution_id, items):
    stats = daily_tag_stats(items)
    if stats is None:
        _log(logging.INFO, execution_id, "No DailyRank yet — skipping daily tag stats.")
        return
    date = items[0]['Date']
    dynamodb_table.put_item(Item={
        'ID': f'DAILY_TAG_STATS#{date}', 'Date': date, 'DataType': 'CONTEST_DAILY_TAG_STATS',
        'TagCounts': stats['TagCounts'], 'TagCountsTop100': stats['TagCountsTop100'], 'RankedTotal': stats['RankedTotal'],
        'TagWeightedScoresLogarithmic': {k: Decimal(str(v)) for k, v in stats['TagWeightedScoresLogarithmic'].items()},
    })
    _log(logging.INFO, execution_id, f"Stored daily tag stats for {date}.", tags=len(stats['TagCounts']), ranked=stats['RankedTotal'])


def _process_and_upload_data(dynamodb_table, execution_id, items):
    """Calculates rank, retention rate, and batch-writes items to DynamoDB."""
    if not items:
        _log(logging.WARNING, execution_id, "No items to process for upload.")
        return

    # 1. Rank items based on View count (and ID as a tie-breaker)
    _log(logging.INFO, execution_id, "Ranking items based on 'View' count.")
    sorted_items = sorted(
        items,
        key=lambda x: (x.get('View', 0), -int(x.get('ID', '0'))),
        reverse=True
    )

    # 2. Add rank for each item
    processed_items = []
    for i, item in enumerate(sorted_items):
        item['Rank'] = i + 1
        processed_items.append(item)

    # 3. 일간 순위(대표 순위) — 직전 수집일 대비 누적 조회 증가
    prev_date, prev_views = _previous_views(dynamodb_table, processed_items[0]['Date'], execution_id)
    daily_rank(processed_items, prev_views)
    if prev_date:
        for item in processed_items:
            item['PrevDate'] = prev_date
    attach_author_works(processed_items, _load_author_index(execution_id))

    _log(logging.INFO, execution_id, f"Writing {len(processed_items)} items to DynamoDB.")
    
    with dynamodb_table.batch_writer() as batch:
        for item in processed_items:
            batch.put_item(Item=item)
    _log(logging.INFO, execution_id, "Batch write to DynamoDB complete.")
    
    # --- Calculate and store tag statistics ---
    _calculate_and_store_tag_stats(dynamodb_table, execution_id, processed_items)   # 2025 식 3-track(누적 순위) — 비교용으로 남긴다
    try:
        _store_daily_tag_stats(dynamodb_table, execution_id, processed_items)       # 2026 대표: 일간 순위 2-track
    except Exception as e:  # noqa: BLE001 — 통계는 원본에서 다시 계산할 수 있어 적재를 막지 않는다
        _log(logging.ERROR, execution_id, f"Failed to store daily tag stats: {e}")

    # --- Update the CONTEST_AVAILABLE_DATES item ---
    # This must happen only after the main data has been successfully written.
    try:
        # Get the date from the first processed item
        latest_date = processed_items[0]['Date']
        dynamodb_table.update_item(
            Key={'ID': 'CONTEST_AVAILABLE_DATES', 'Date': 'METADATA'},
            UpdateExpression="ADD #dates :d",
            ExpressionAttributeNames={'#dates': 'dates'},
            ExpressionAttributeValues={':d': {latest_date}}
        )
        _log(logging.INFO, execution_id, f"Successfully added {latest_date} to CONTEST_AVAILABLE_DATES.")
    except Exception as e:
        _log(logging.ERROR, execution_id, f"Failed to update CONTEST_AVAILABLE_DATES item: {e}")
        # This is not a critical failure, so we don't re-raise the exception.

def _delete_messages_from_sqs(sqs_client, execution_id, receipt_handles):
    """Deletes messages from SQS in batches of 10."""
    if not receipt_handles:
        return
    _log(logging.INFO, execution_id, f"Deleting {len(receipt_handles)} messages from SQS.")
    for i in range(0, len(receipt_handles), 10):
        batch = receipt_handles[i:i+10]
        if batch:
            sqs_client.delete_message_batch(QueueUrl=Config.SQS_RESULT_QUEUE_URL, Entries=batch)

# --- Main Handler ---
def handler(event, context):
    execution_id = event.get('execution_id', 'N/A')
    expected_count = event.get('fanned_out_count', 0)
    
    sqs_client = boto3.client('sqs')
    dynamodb = boto3.resource('dynamodb')
    table = dynamodb.Table(Config.DYNAMODB_TABLE_NAME)

    # 1. Collect all messages from SQS
    try:
        all_messages, receipt_handles = _collect_all_messages(sqs_client, execution_id)
    except Exception as e:
        _log(logging.ERROR, execution_id, f"Failed during SQS message retrieval: {e}", exc_info=True)
        raise

    if not all_messages:
        _log(logging.INFO, execution_id, "No items to process. Exiting.")
        return {'statusCode': 200, 'message': 'No items to process.'}

    # 2. Deduplicate and Validate
    unique_items = _deduplicate_items(all_messages, execution_id)
    _validate_data(execution_id, unique_items, expected_count)

    # 3. Commit Phase: Process, Upload, then Delete
    try:
        _process_and_upload_data(table, execution_id, unique_items)
        _delete_messages_from_sqs(sqs_client, execution_id, receipt_handles)
    except Exception as e:
        critical_error_msg = f"CRITICAL: Failed during commit phase: {e}"
        _log(logging.CRITICAL, execution_id, critical_error_msg, exc_info=True)
        raise

    return {
        'statusCode': 200,
        'processed_count': len(unique_items)
    }

# --- Distributed Map 경로 -----------------------------------------------------------
# 흐름: ParseMap → reconcile(모으고 빠진 것 계산) ─┬→ 빠진 게 있으면 대기 → 빠진 것만 ParseMap → reconcile (최대 RETRY_ROUNDS)
#                                                └→ consolidate(남은 결손은 placeholder + 실패 장부, 너무 많으면 쓰지 않고 실패)
# 작업 파일은 STATE_BUCKET 의 runs/{date}/{execution}/ 에 둔다 — 대조 결과를 상태 머신 페이로드(256KB)에 싣지 않는다.

RETRY_ROUNDS = int(os.environ.get('DMAP_RETRY_ROUNDS', '2'))
RETRY_WAITS = [30, 120]                      # 라운드별 대기(초) — 노벨피아의 순간 장애를 넘길 시간
MAX_MISSING_FRACTION = float(os.environ.get('DMAP_MAX_MISSING_FRACTION', '0.05'))
ID_LIST_KEY = 'contest_novel_ids_2026.json'


class TooManyMissing(Exception):
    """재시도 뒤에도 결손이 상한을 넘었다 — 그날을 반쪽으로 쓰지 않고 실패시킨다(상태 머신이 재시도하지 않는다)."""


def _s3():
    return boto3.client('s3')


def _get_json(key, default=None):
    try:
        return json.loads(_s3().get_object(Bucket=Config.STATE_BUCKET, Key=key)['Body'].read())
    except _s3().exceptions.NoSuchKey:
        return default


def _put_json(key, obj):
    _s3().put_object(Bucket=Config.STATE_BUCKET, Key=key, Body=json.dumps(obj, ensure_ascii=False, default=str).encode(),
                     ContentType='application/json')


def _run_prefix(date, execution_id):
    return f'runs/{date}/{execution_id}'


def _dmap_rows(manifest, execution_id):
    """ResultWriter manifest → (items, failed[{id,error}], 실패한 자식 수, 원본을 못 올린 작품 수)."""
    s3 = _s3()
    man = json.loads(s3.get_object(Bucket=manifest['Bucket'], Key=manifest['Key'])['Body'].read())
    bucket = man.get('DestinationBucket') or manifest['Bucket']
    items, failed, failed_children, raw_failed = [], [], 0, 0
    for kind, files in (man.get('ResultFiles') or {}).items():
        for f in files:
            for row in json.loads(s3.get_object(Bucket=bucket, Key=f['Key'])['Body'].read()):
                if kind != 'SUCCEEDED':
                    failed_children += 1   # 그 묶음의 작품은 결과에 없다 → 기대 목록과의 차이로 '빠진 작품'이 된다
                    continue
                out = json.loads(row.get('Output') or '{}')
                items += out.get('items') or []
                failed += [x if isinstance(x, dict) else {'id': str(x), 'error': None} for x in out.get('failed') or []]
                raw_failed += int(out.get('raw_failed') or 0)
    _log(logging.INFO, execution_id, "Collected DMap results.", items=len(items), failed=len(failed),
         failed_children=failed_children, raw_failed=raw_failed)
    return items, failed, failed_children, raw_failed


def _is_placeholder(it):
    return int(it.get('View', -1)) < 0


def _dedupe_prefer_real(items):
    """같은 ID 가 둘이면 실데이터(View ≥ 0)를 placeholder 보다, 실데이터끼리는 **먼저 받은 쪽**을 남긴다.

    SQS 판의 '가장 이른 SentTimestamp' 와 같은 원칙 — 자정에 가까운 값이 24시간 주기에 맞다.
    """
    best = {}
    for it in items:
        k = str(it.get('ID'))
        cur = best.get(k)
        if cur is None:
            best[k] = it
        elif _is_placeholder(cur) != _is_placeholder(it):
            if _is_placeholder(cur):
                best[k] = it
        elif (it.get('CrawledAt') or '~') < (cur.get('CrawledAt') or '~'):
            best[k] = it
    return list(best.values())


def reconcile_dmap(event):
    """ParseMap 한 라운드의 결과를 지금까지 모은 것과 합치고, 아직 못 받은 작품을 정한다.

    - 기대 목록은 첫 라운드에서 S3 ID 목록을 **복사해 고정**한다(그 사이 수집기가 목록을 다시 써도 흔들리지 않게).
    - 빠진 작품 = 기대 − (실데이터 또는 경고창·파싱 placeholder). 네트워크로 끝내 실패한 작품과 자식이 통째로 실패한
      묶음의 작품이 여기에 든다. 라운드마다 이유를 errors 에 쌓는다(실패 장부의 재료).
    """
    execution_id, date, rnd = event['execution_id'], event['date'], int(event.get('round', 0))
    pre = _run_prefix(date, execution_id)
    if rnd == 0:
        expected = [str(x) for x in json.loads(_s3().get_object(Bucket=Config.STATE_BUCKET, Key=ID_LIST_KEY)['Body'].read())]
        _put_json(f'{pre}/expected.json', expected)
        collected, errors, raw_failed_total, children_failed_total = [], {}, 0, 0
    else:
        expected = _get_json(f'{pre}/expected.json')
        state = _get_json(f'{pre}/collected.json')
        collected, errors = state['items'], state['errors']
        raw_failed_total, children_failed_total = state['raw_failed'], state['children_failed']

    items, failed, failed_children, raw_failed = _dmap_rows(event['manifest'], execution_id)
    unique = _dedupe_prefer_real(collected + items)
    have = {str(i['ID']) for i in unique}
    reason = {f['id']: f.get('error') for f in failed}
    missing = [k for k in expected if k not in have]
    for k in missing:
        errors.setdefault(k, []).append({'round': rnd, 'error': reason.get(k) or 'batch_failed'})
    _put_json(f'{pre}/collected.json', {'items': unique, 'errors': errors, 'raw_failed': raw_failed_total + raw_failed,
                                        'children_failed': children_failed_total + failed_children})
    _put_json(f'{pre}/missing-{rnd}.json', [int(k) for k in missing])

    retry = bool(missing) and rnd < RETRY_ROUNDS
    out = {'round': rnd + 1, 'expected': len(expected), 'missing': len(missing), 'retry': retry,
           'missing_key': f'{pre}/missing-{rnd}.json', 'wait_seconds': RETRY_WAITS[min(rnd, len(RETRY_WAITS) - 1)],
           # 다시 받을 때는 작게 나눠 천천히 — 실패 원인이 과부하일 수 있다
           'batch': 10, 'concurrency': 3}
    _log(logging.INFO if not missing else logging.WARNING, execution_id, "DMap reconcile.", **out)
    return out


def _placeholder(novel_id, date, reason):
    return {"Date": date, "ID": novel_id, "Title": f"N/A ({reason})", "AuthorName": "N/A", "AuthorID": "0",
            "View": -1, "Like": -1, "Fav": -1, "Alr": -1, "Eps": -1, "Tags": [], "Synopsis": "", "IsAdult": False}


def _notice(date, ledger):
    """알릴 만한 결손이 있으면 Discord 문구(멘션 없음). 없으면 None."""
    parts = []
    if ledger['fetch_failed']:
        parts.append(f"받지 못해 placeholder {len(ledger['fetch_failed'])}편")
    if ledger['recovered']:
        parts.append(f"재시도로 복구 {ledger['recovered']}편")
    if ledger['raw_failed']:
        parts.append(f"원본 저장 실패 {ledger['raw_failed']}편")
    d = ledger.get('discover') or {}
    if d.get('fallback'):
        parts.append("ID 수집 실패 → 23:30 목록으로 진행")
    elif d.get('listed_total') and d.get('total_contest') is not None and d['total_contest'] < d['listed_total']:
        parts.append(f"참가작 수 부족 {d['total_contest']}/{d['listed_total']}")
    if not parts:
        return None
    return f"2026 공모전 {date} 수집 경고: " + " · ".join(parts) + f" (장부 failures/{date}.json)"


def handler_dmap(event, context):
    """`action: reconcile` 이면 대조, 아니면 최종 적재. `dry_run` 이면 쓰지 않고 운영 테이블과 비교만 한다(그림자 실행)."""
    if event.get('action') == 'reconcile':
        return reconcile_dmap(event)

    execution_id, date = event.get('execution_id', 'N/A'), event['date']
    pre = _run_prefix(date, execution_id)
    expected = _get_json(f'{pre}/expected.json')
    state = _get_json(f'{pre}/collected.json')
    unique, errors = state['items'], state['errors']
    have = {str(i['ID']) for i in unique}
    still = [k for k in expected if k not in have]

    ledger = {
        'date': date, 'execution_id': execution_id, 'expected': len(expected),
        'fetch_failed': [{'id': k, 'attempts': errors.get(k, [])} for k in still],
        'recovered': sum(1 for k in errors if k in have),
        'placeholders': {r: sum(1 for i in unique if str(i.get('Title', '')).startswith(f'N/A ({r}'))
                         for r in ('Inaccessible', 'ParsingFailed')},
        'raw_failed': state['raw_failed'], 'children_failed': state['children_failed'],
        'discover': event.get('discover') or {},
    }
    if len(still) > MAX_MISSING_FRACTION * len(expected):
        if not event.get('dry_run'):
            _put_json(f'failures/{date}.json', {**ledger, 'written': False})
        raise TooManyMissing(f"{len(still)}/{len(expected)} novels still missing after retries — not writing {date}.")
    unique += [_placeholder(k, date, 'FetchFailed') for k in still]

    table = boto3.resource('dynamodb').Table(Config.DYNAMODB_TABLE_NAME)
    if event.get('dry_run'):
        prod, kw = {}, {'IndexName': 'DateViewIndex', 'KeyConditionExpression': Key('Date').eq(date)}
        while True:
            r = table.query(**kw)
            for it in r['Items']:
                prod[str(it['ID'])] = it
            if 'LastEvaluatedKey' not in r:
                break
            kw['ExclusiveStartKey'] = r['LastEvaluatedKey']
        mine = {str(i['ID']): i for i in unique}
        diff_view = [k for k in mine if k in prod and abs(int(prod[k].get('View', 0)) - int(mine[k].get('View', 0))) > max(50, int(prod[k].get('View', 0)) * 0.05)]
        added_by_consolidate = {'Rank', 'DailyRank', 'ViewDelta', 'PrevDate', 'AuthorOtherNovels', 'AuthorOtherMore'}
        missing_f, extra_f = {}, {}
        for k in set(mine) & set(prod):
            pk, mk = set(prod[k]) - added_by_consolidate, set(mine[k])
            for f in pk - mk:
                missing_f[f] = missing_f.get(f, 0) + 1
            for f in mk - pk:
                extra_f[f] = extra_f.get(f, 0) + 1
        report = {'dry_run': True, 'date': date, 'expected': len(expected), 'collected': len(unique),
                  'fetch_failed': len(still), 'recovered': ledger['recovered'], 'prod_rows': len(prod),
                  'only_in_dmap': len(set(mine) - set(prod)), 'only_in_prod': len(set(prod) - set(mine)),
                  'view_far_apart': len(diff_view),
                  'fields_missing_in_dmap': dict(sorted(missing_f.items(), key=lambda x: -x[1])[:10]),
                  'fields_extra_in_dmap': dict(sorted(extra_f.items(), key=lambda x: -x[1])[:10])}
        _log(logging.INFO, execution_id, "DMap dry-run comparison.", **report)
        notice = _notice(date, ledger)
        return {**report, 'degraded': bool(notice), 'notice': notice and f"[그림자] {notice}"}

    _validate_data(execution_id, unique, len(expected))
    _process_and_upload_data(table, execution_id, unique)
    _put_json(f'failures/{date}.json', {**ledger, 'written': True})   # 결손이 없어도 남긴다 — 그날 무엇을 했는지의 기록
    notice = _notice(date, ledger)
    return {'statusCode': 200, 'processed_count': len(unique), 'fetch_failed': len(still),
            'recovered': ledger['recovered'], 'degraded': bool(notice), 'notice': notice}
