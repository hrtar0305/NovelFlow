import json
import boto3
from boto3.dynamodb.conditions import Key
import logging
import os
from decimal import Decimal
import math

# --- Basic Setup ---
logger = logging.getLogger()
logger.setLevel(logging.INFO)

# --- Centralized Configuration ---
class Config:
    """Houses all configuration variables for the consolidation script."""
    DYNAMODB_TABLE_NAME = os.environ.get('DYNAMODB_TABLE_NAME')
    # 수집기 상태(참가작 메타·작가 다른 작품 색인)와 대조 작업 파일(runs/)을 두는 버킷. 배포가 늘 넣는다.
    STATE_BUCKET = os.environ.get('STATE_BUCKET')
    AUTHOR_INDEX_KEY = 'state/author_works.json'
    # 공모전 개막일(2026-10-01 12:00 개막). 참가작은 모두 이날 0 에서 출발한다 — `opening_day_ids`.
    CONTEST_OPEN_DATE = os.environ.get('CONTEST_OPEN_DATE', '2026-10-01')
    # 기록 날짜 D 의 수집 = D+1 00:00 KST. 그 뒤 이만큼 안에 수집기가 처음 찾은 번호까지 D 의 작품으로 친다(`_found_after_date`).
    # 자정 수집기는 길어야 12분(ID 수집 마감) — 그 뒤(손 실행 등)에 찾은 번호는 그 날짜의 작품이 아니다(그림자 실행 2026-10-03 실측:
    # 2시간 여유면 00:38 손 실행이 찾은 자정 뒤 등록작 20편이 전날로 들어갔다).
    LATE_FOUND_GRACE_HOURS = 0.25

if not Config.DYNAMODB_TABLE_NAME:
    raise ValueError("DYNAMODB_TABLE_NAME env var must be set.")

# --- Logging Helper ---
def _log(level, execution_id, message, **kwargs):
    """Creates a structured log message."""
    log_data = {"execution_id": execution_id, "message": message, **kwargs}
    logger.log(level, json.dumps(log_data, ensure_ascii=False))

# --- Helper Functions ---
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

def _found_after_date(date, meta):
    """수집기가 이 번호를 기록 날짜 `date` 의 수집(다음 날 00:00 KST) **뒤**에 처음 봤나 — 그날엔 없던 작품.

    기준은 처음 본 시각이다(`via: recheck` 면 번호를 처음 본 `first_seen` — 재확인으로 찾은 시각은 등록보다 늦다).
    여유 `Config.LATE_FOUND_GRACE_HOURS` 는 정상 자정 실행의 수집기 소요를 덮는다. 시각을 모르면 False(빼지 않는다).
    """
    from datetime import datetime, timedelta
    from zoneinfo import ZoneInfo
    if not meta:
        return False
    seen = meta.get('first_seen') if meta.get('via') == 'recheck' else meta.get('found_at')
    if not seen:
        return False
    upper = datetime.fromisoformat(date).replace(tzinfo=ZoneInfo('Asia/Seoul')) + timedelta(days=1, hours=Config.LATE_FOUND_GRACE_HOURS)
    try:
        return datetime.fromisoformat(seen) >= upper
    except (TypeError, ValueError):
        return False


def opening_day_ids(prev_date, date, items):
    """개막일(직전 수집 없음)의 신작 = 참가작 전부. 모두 개막 뒤 0 에서 출발해 누적 조회가 곧 그날 조회라, 그날도 일간 순위를 매긴다
    (사용자 2026-10-05 — 전에는 첫 수집일이라 비워 10/02 변동이 전부 New 였다). 다른 날은 빈 집합."""
    if prev_date is None and date == Config.CONTEST_OPEN_DATE:
        return {str(i.get('ID')) for i in items}
    return set()


def new_since(prev_date, items, prev_views, contest_meta, date=None):
    """직전 수집 **뒤에 새로 등록된** 참가작 번호들 — 이들의 누적 조회는 곧 그 하루(등록~자정)의 조회다.

    셋 다 맞아야 한다(하나라도 모르면 신작으로 치지 않는다 — 오염보다 누락이 낫다):
    - 직전 수집일에 행이 아예 없다(placeholder 라도 있었으면 '부활'이라 기준값을 모른다),
    - 수집기가 새 번호 훑기로 찾았다(`via: recheck` 이면 등록은 더 일렀을 수 있다 — 배지가 늦게 보였거나 비공개였다),
    - 처음 찾은 시각이 직전 수집(그 날짜 다음 날 00:00 KST) 무렵 이후다(직전 수집 사이에 빠진 날이 있으면 며칠 치가 섞인다).
    그리고 기록 날짜 `date` 의 수집 **뒤**에 찾은 번호는 신작이 아니다(`_found_after_date`) — 과거 날짜를 target_date 로 다시
    돌리면 목록에 그 뒤 등록된 작품이 섞여, 그날 없던 작품이 그날 신작으로 잡힌다. 하한과 대칭인 상한이다.
    """
    if not prev_date:
        return set()
    from datetime import datetime, timedelta
    from zoneinfo import ZoneInfo
    cutoff = datetime.fromisoformat(prev_date).replace(tzinfo=ZoneInfo('Asia/Seoul')) + timedelta(days=1, hours=-2)
    out = set()
    for it in items:
        k = str(it.get('ID'))
        meta = contest_meta.get(k)
        if k in prev_views or not meta or meta.get('via') == 'recheck' or not meta.get('found_at'):
            continue
        try:
            if datetime.fromisoformat(meta['found_at']) >= cutoff and not (date and _found_after_date(date, meta)):
                out.add(k)
        except ValueError:
            continue
    return out


def daily_rank(items, prev_views, new_ids=frozenset()):
    """일간 순위(면접 D22 규칙). 대표 순위로 쓴다 — 누적 순위(`Rank`)는 공모전 중반부터 거의 움직이지 않는다.

    - `ViewDelta` = 오늘 누적 조회 − 직전 수집일 누적 조회. **'누적 조회수 증가량'이지 인증 조회수가 아니다.**
    - 직전 **유효** 측정값(-1 아님)이 없으면 계산하지 않는다 — 순위·증가량을 싣지 않고 다음 날의 기준값으로만 쓴다.
      부활(전날 placeholder)·늦게 찾은 작품이 여기 든다. 전날이 -1 인데 0 으로 치면 누적 전체가 하루치로 잡힌다.
    - **예외: 직전 수집 뒤 새로 등록된 작품(`new_ids`)은 누적 조회가 곧 그날 조회라 `ViewDelta = View` 로 순위에 넣고
      `IsNew` 를 단다**(사용자 결정 2026-10-02). 판정은 `new_since`.
    - 정렬: 증가 큰 순 → 누적 조회 많은 순 → 번호 작은 순(동점이 수천 건이라 결정적이어야 순위선이 요동치지 않는다).
    - 모수: 값이 있는 전체 참가작. 다른 작품이 사라지기만 해도 순위가 오를 수 있다(각주감).
    `prev_views`: {ID: 직전 수집일 View}. 값을 바꾼 items 를 그대로 돌려준다.
    """
    ranked = []
    for item in items:
        cur, prev = item.get('View'), prev_views.get(str(item.get('ID')))
        item.pop('ViewDelta', None)
        item.pop('DailyRank', None)
        item.pop('IsNew', None)
        if not (isinstance(cur, int) and cur >= 0):
            continue
        if prev is not None and prev >= 0:
            item['ViewDelta'] = cur - prev
            ranked.append(item)
        elif prev is None and str(item.get('ID')) in new_ids:
            item['ViewDelta'], item['IsNew'] = cur, True
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
    rows = _rows_for_date(dynamodb_table, prev, ProjectionExpression='ID, #v', ExpressionAttributeNames={'#v': 'View'})
    views = {k: int(it['View']) for k, it in rows.items()}
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


def _load_state(key, execution_id, what):
    """수집기가 남긴 상태(참가작 메타·작가 색인). 못 읽으면 빈 dict — 부가 정보라 적재를 막지 않는다."""
    try:
        v = _get_json(key)
    except Exception as e:  # noqa: BLE001
        v, why = None, e
    else:
        why = 'missing'
    if v is None:
        _log(logging.WARNING, execution_id, f"Could not load {what}: {why}")
        return {}
    return v


def _load_contest_meta(execution_id):
    """수집기의 참가작 상태(번호 → 처음 찾은 시각·경로). 못 읽으면 신작 판정만 빠지고 적재는 계속한다."""
    return _load_state('state/contest_ids.json', execution_id, 'contest meta (new-novel ranking skipped)')


def daily_tag_stats(items):
    """2026 태그 점수 — **일간 순위 기준**(대표 순위와 통일, 사용자 결정 2026-10-02). 데일리의 2-track 과 같은 식이다.

    - 인기 점수 = Σ 1/ln(DailyRank+1), 등장 = 일간 순위가 있는 작품 중 그 태그를 단 수, 상위 100 = DailyRank ≤ 100.
    - 상위권 집중도는 백엔드가 계산한다 — 데일리는 모수가 500 이라 '나머지 400'이 고정이지만 공모전은 순위가 매겨진
      작품 수가 날마다 달라 `RankedTotal` 을 함께 싣는다(나머지 = RankedTotal − 100).
    - 등장 2회 미만 태그는 뺀다(데일리와 같은 노이즈 제거). 일간 순위가 없는 날(첫 수집일)은 None.
    - `TagScoreSum`/`ScoreTotal` = 일간 순위가 있는 작품의 그날 조회 증가(`ViewDelta`) 합 — 태그 랭킹 인기 점수(점유율)의 재료.
      데일리의 랭킹 점수 자리에 공모전 일간 순위의 기준값을 쓴다(DECISIONS 2026-10-06).
    """
    ranked = [i for i in items if isinstance(i.get('DailyRank'), int)]
    if not ranked:
        return None
    counts, top100, power, score = {}, {}, {}, {}
    for it in ranked:
        r = it['DailyRank']
        w = 1 / math.log(r + 1)
        delta = int(it.get('ViewDelta') or 0)
        for tag in it.get('Tags') or []:
            counts[tag] = counts.get(tag, 0) + 1
            power[tag] = power.get(tag, 0) + w
            score[tag] = score.get(tag, 0) + delta
            if r <= 100:
                top100[tag] = top100.get(tag, 0) + 1
    for t in [t for t, c in counts.items() if c < 2]:
        counts.pop(t, None); top100.pop(t, None); power.pop(t, None); score.pop(t, None)
    return {'TagCounts': counts, 'TagCountsTop100': top100, 'TagWeightedScoresLogarithmic': power, 'RankedTotal': len(ranked),
            'TagScoreSum': score, 'ScoreTotal': sum(int(i.get('ViewDelta') or 0) for i in ranked)}


def _store_daily_tag_stats(dynamodb_table, execution_id, items):
    stats = daily_tag_stats(items)
    if stats is None:
        _log(logging.INFO, execution_id, "No DailyRank yet — skipping daily tag stats.")
        return
    date = items[0]['Date']
    dynamodb_table.put_item(Item={
        'ID': f'DAILY_TAG_STATS#{date}', 'Date': date, 'DataType': 'CONTEST_DAILY_TAG_STATS',
        'TagCounts': stats['TagCounts'], 'TagCountsTop100': stats['TagCountsTop100'], 'RankedTotal': stats['RankedTotal'],
        'TagScoreSum': stats['TagScoreSum'], 'ScoreTotal': stats['ScoreTotal'],
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
    processed_items = sorted(
        items,
        key=lambda x: (x.get('View', 0), -int(x.get('ID', '0'))),
        reverse=True
    )

    # 2. Add rank for each item
    for i, item in enumerate(processed_items, 1):
        item['Rank'] = i

    # 3. 일간 순위(대표 순위) — 직전 수집일 대비 누적 조회 증가
    prev_date, prev_views = _previous_views(dynamodb_table, processed_items[0]['Date'], execution_id)
    new_ids = new_since(prev_date, processed_items, prev_views, _load_contest_meta(execution_id), processed_items[0]['Date']) \
        | opening_day_ids(prev_date, processed_items[0]['Date'], processed_items)
    daily_rank(processed_items, prev_views, new_ids)
    _log(logging.INFO, execution_id, "Daily rank computed.", prev_date=prev_date, new_novels=len(new_ids),
         ranked=sum(1 for i in processed_items if 'DailyRank' in i))
    if prev_date:
        for item in processed_items:
            item['PrevDate'] = prev_date
    attach_author_works(processed_items, _load_state(Config.AUTHOR_INDEX_KEY, execution_id, 'author index'))

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
    # 실패를 삼키지 않는다: 이 집합은 다음 날 `_previous_views` 가 실제 직전 수집일을 고르는 유일한 근거라, 빠지면 다음 날
    # 일간 순위가 이틀치 증가로 계산된다. 올리면 상태 머신이 적재를 다시 돈다(행 덮어쓰기·집합 ADD 라 멱등).
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
        raise

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


class ReprocessBatchFailed(Exception):
    """원본 재계산의 자식(원본 묶음 2개)이 통째로 실패했다 — Lambda 제한·시간 초과·S3 일시 오류처럼 다시 하면 될 일이다.

    재해석은 결정적이고 멱등이라 결손을 placeholder 로 채우지 않고 시도를 실패시킨다(병렬 단계 `Run` 이 한 번 다시 한다).
    채우면 그날의 정상 자정 행을 'N/A (ReprocessFailed)' 로 덮는다(리뷰 2026-10-04). 대조 단계 자신은 다시 부르지 않는다.
    """


s3 = boto3.client('s3')


def _get_json(key, default=None):
    try:
        return json.loads(s3.get_object(Bucket=Config.STATE_BUCKET, Key=key)['Body'].read())
    except s3.exceptions.NoSuchKey:
        return default


def _put_json(key, obj):
    s3.put_object(Bucket=Config.STATE_BUCKET, Key=key, Body=json.dumps(obj, ensure_ascii=False, default=str).encode(),
                  ContentType='application/json')


def _run_prefix(date, execution_id):
    return f'runs/{date}/{execution_id}'


def _dmap_rows(manifest, execution_id):
    """ResultWriter manifest → (items, failed[{id,error}], 실패한 자식 수, 원본을 못 올린 작품 수)."""
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

    자정에 가까운 값이 24시간 주기에 맞다(걷어낸 SQS 판의 '가장 이른 SentTimestamp' 와 같은 원칙).
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
      원본 재계산(`reprocess`)이면 그 날짜 원본 묶음의 작품 번호(파서 `reprocess_index`)이고, 재시도 라운드가 없다.
      어느 쪽이든 기록 날짜의 수집 뒤에 처음 찾은 번호는 뺀다(아래).
    - 빠진 작품 = 기대 − (실데이터 또는 경고창·파싱 placeholder). 네트워크로 끝내 실패한 작품과 자식이 통째로 실패한
      묶음의 작품이 여기에 든다. 라운드마다 이유를 errors 에 쌓는다(실패 장부의 재료).
    """
    execution_id, date, rnd = event['execution_id'], event['date'], int(event.get('round', 0))
    reprocess = bool(event.get('reprocess'))
    pre = _run_prefix(date, execution_id)
    if rnd == 0:
        if reprocess:
            # 원본 재계산: 기대 목록은 그 날짜 원본 묶음에 든 작품 전부(파서 `reprocess_index`) — 오늘의 ID 목록이 아니다.
            index = _get_json(f'{pre}/reprocess-index.json')
            if index is None:
                raise RuntimeError(f"reprocess index missing: {pre}/reprocess-index.json (ReprocessIndex 단계가 먼저 돌아야 한다)")
            expected = sorted(str(k) for k in index.get('ids', {}))
        else:
            expected = [str(x) for x in json.loads(s3.get_object(Bucket=Config.STATE_BUCKET, Key=ID_LIST_KEY)['Body'].read())]
        # 기록 날짜의 수집 뒤에 처음 찾은 번호는 그날 없던 작품이다(과거 날짜를 target_date 로 다시 돌릴 때 섞인다) — 기대에서 빼
        # 그날 행을 만들지 않는다. 받기는 했어도 적재(수량 검증·placeholder)는 기대 목록만 본다. 다음 날 정상 수집에서 신작으로 든다.
        meta = _load_contest_meta(execution_id)
        late = {k for k in expected if _found_after_date(date, meta.get(k))}
        if late:
            expected = [k for k in expected if k not in late]
            _log(logging.WARNING, execution_id, "Excluded novels first found after this date's collection.",
                 date=date, excluded=len(late), sample=sorted(late)[:10])
        _put_json(f'{pre}/expected.json', expected)
        collected, errors, raw_failed_total, children_failed_total = [], {}, 0, 0
    else:
        expected = _get_json(f'{pre}/expected.json')
        state = _get_json(f'{pre}/collected.json')
        collected, errors = state['items'], state['errors']
        raw_failed_total, children_failed_total = state['raw_failed'], state['children_failed']

    items, failed, failed_children, raw_failed = _dmap_rows(event['manifest'], execution_id)
    if reprocess and failed_children and not event.get('dry_run'):
        raise ReprocessBatchFailed(f"{date} 원본 재계산: 자식 {failed_children}개(원본 묶음 최대 {failed_children * 2}개)가 실패해 "
                                   f"그 작품들을 다시 계산하지 못했습니다 — 결손으로 채우지 않고 시도를 다시 합니다.")
    unique = _dedupe_prefer_real(collected + items)
    have = {str(i['ID']) for i in unique}
    reason = {f['id']: f.get('error') for f in failed}
    missing = [k for k in expected if k not in have]
    for k in missing:
        errors.setdefault(k, []).append({'round': rnd, 'error': reason.get(k) or 'batch_failed'})
    _put_json(f'{pre}/collected.json', {'items': unique, 'errors': errors, 'raw_failed': raw_failed_total + raw_failed,
                                        'children_failed': children_failed_total + failed_children})
    _put_json(f'{pre}/missing-{rnd}.json', [int(k) for k in missing])

    # 원본 재계산은 다시 받을 것이 없다(같은 원본을 다시 읽어도 같은 결과) — 남은 결손은 바로 적재 단계의 placeholder 로.
    retry = bool(missing) and rnd < RETRY_ROUNDS and not reprocess
    out = {'round': rnd + 1, 'expected': len(expected), 'missing': len(missing), 'retry': retry,
           'missing_key': f'{pre}/missing-{rnd}.json', 'wait_seconds': RETRY_WAITS[min(rnd, len(RETRY_WAITS) - 1)],
           # 다시 받을 때는 작게 나눠 천천히 — 실패 원인이 과부하일 수 있다
           'batch': 10, 'concurrency': 3}
    _log(logging.INFO if not missing else logging.WARNING, execution_id, "DMap reconcile.", **out)
    return out


# 적재 단계가 붙이는 필드 — 기존 행을 다시 쓸 때 걷어내고 다시 계산한다.
ADDED_BY_CONSOLIDATE = ('Rank', 'DailyRank', 'ViewDelta', 'PrevDate', 'IsNew', 'AuthorOtherNovels', 'AuthorOtherMore')


def _reuse_row(row):
    """운영 테이블의 행 → 다시 쓸 수 있는 파서 출력 꼴(정수 Decimal → int, 적재 단계 필드 제거)."""
    def conv(v):
        if isinstance(v, Decimal):
            return int(v) if v == v.to_integral_value() else v
        if isinstance(v, list):
            return [conv(x) for x in v]
        if isinstance(v, dict):
            return {k: conv(x) for k, x in v.items()}
        return v
    return {k: conv(v) for k, v in row.items() if k not in ADDED_BY_CONSOLIDATE}


def _placeholder(novel_id, date, reason):
    return {"Date": date, "ID": novel_id, "Title": f"N/A ({reason})", "AuthorName": "N/A", "AuthorID": "0",
            "View": -1, "Like": -1, "Fav": -1, "Alr": -1, "Eps": -1, "Tags": [], "Synopsis": "", "IsAdult": False}


def _minutes_after_midnight(date, items):
    """받은 값이 기록 날짜의 자정(D+1 00:00 KST)에서 몇 분 뒤인가 — 실데이터의 가장 이른 CrawledAt 기준. 모르면 None."""
    from datetime import datetime, timedelta, timezone
    from zoneinfo import ZoneInfo
    midnight = datetime.fromisoformat(date).replace(tzinfo=ZoneInfo('Asia/Seoul')) + timedelta(days=1)
    stamps = []
    for it in items:
        if _is_placeholder(it) or not it.get('CrawledAt'):
            continue
        try:
            dt = datetime.fromisoformat(str(it['CrawledAt']).replace('Z', '+00:00'))
            stamps.append(dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc))
        except ValueError:
            continue
    if not stamps:
        return None
    return round((min(stamps) - midnight).total_seconds() / 60, 1)


def _ledger_key(date, reprocess):
    """실패 장부의 위치. 원본 재계산은 자정 실행의 장부를 덮지 않는다(그날 자정에 무엇이 실패했는지가 남아야 한다)."""
    return f'failures/{date}-reprocess.json' if reprocess else f'failures/{date}.json'


def _hm(minutes):
    """985 → '16시간 25분', 7 → '7분'."""
    m = int(round(minutes))
    if m < 1:
        return '1분 미만'
    return f"{m // 60}시간 {m % 60}분" if m >= 60 else f"{m}분"


def _notice(date, ledger, test=False, run=None):
    """알릴 만한 일이 있으면 Discord 카드(구조화된 알림 dict, 멘션 없음 — `utils/discord_notify.py`). 없으면 None.

    결손 외에 **자동 재실행으로 적재한 날**(시도 2 이상)도 알린다 — 값이 자정에서 몇 분 늦었는지와 함께. 원본 재계산은 늘 알린다
    (운영자가 과거 날짜를 다시 쓴 기록). 내부 용어(placeholder·장부·그림자) 대신 읽는 사람이 바로 알 말로 쓴다.
    `test`(dry_run): 아무것도 쓰지 않았으므로 '저장했다'고 말하지 않고, 장부 위치도 싣지 않는다(쓰지 않았다).
    """
    reprocess = ledger.get('mode') == 'reprocess'
    lines, actions, fields = [], [], []
    warn = False
    attempt = ledger.get('attempt')
    if reprocess:
        n = ledger['expected'] - len(ledger['fetch_failed'])   # 원본으로 실제로 다시 계산한 수(기존 값 유지·수집 실패 제외)
        lines.append(f"노벨피아에 다시 요청하지 않고, 그날 자정에 저장해 둔 **원본 HTML 로 {n:,}편을 다시 계산**해 "
                     + ('덮어쓸 결과를 만들었습니다.' if test else '덮어썼습니다.'))
        if ledger.get('untouched_rows'):
            lines.append(f"원본이 없는 {len(ledger['untouched_rows']):,}편(자정에 받지 못했거나 원본 저장에 실패한 작품)은 기존 행을 그대로 뒀습니다.")
        if ledger.get('kept_rows'):
            lines.append(f"원본으로 다시 계산하지 못한 {len(ledger['kept_rows']):,}편은 기존 값을 그대로 뒀습니다.")
        if ledger.get('later_dates'):
            warn = True
            nxt = ledger['later_dates'][0]
            actions.append(f"이 날짜가 새로 생겨 다음 수집일 {nxt} 의 일간 순위 기준(전날 값)이 바뀌었습니다. 그 날짜도 다시 계산하세요: "
                           f"`{{\"reprocess\": true, \"target_date\": \"{nxt}\"}}`")
    elif isinstance(attempt, int) and attempt > 1:
        warn = True
        late = ledger.get('late_minutes')
        lines.append("첫 시도가 실패해 **자동으로 한 번 더 실행**" + ("했습니다." if test else "해서 저장했습니다.")
                     + (f" 값은 자정보다 **{_hm(late)} 늦게** 받은 것입니다." if not test and isinstance(late, (int, float)) and late > 0 else ""))
        errors = [str(e)[:300] for e in (ledger.get('previous_errors') or [])[:2]]
        if errors:
            fields.append({'name': '첫 시도에서 난 오류', 'value': '\n'.join('> ' + e for e in errors)})
    placeholders = len(ledger['fetch_failed']) - len(ledger.get('kept_rows') or [])
    if placeholders > 0:
        warn = True
        why = '원본으로 다시 계산하지 못한' if reprocess else '재시도까지 했는데도 받지 못한'
        lines.append(f"{why} **{placeholders:,}편**은 "
                     + ("실제였다면 '수집 실패'로 기록돼 그날과 다음 수집일의 일간 순위·태그 통계에서 빠졌을 것입니다." if test else
                        "'수집 실패'로 기록했습니다 — 그날과 다음 수집일(견줄 전날 값이 없음)의 일간 순위·태그 통계에서 빠집니다."))
    if ledger['recovered']:
        lines.append(f"처음엔 실패했다가 다시 받아 살린 작품 {ledger['recovered']:,}편 — 데이터에는 문제 없습니다.")
    if ledger['raw_failed']:
        warn = True
        lines.append(f"원본 HTML 저장에 실패한 {ledger['raw_failed']:,}편 — 이 작품들은 나중에 원본으로 다시 계산할 수 없습니다.")
    d = ledger.get('discover') or {}
    if reprocess:
        pass   # ID 수집을 하지 않는다 — 참가작 수 비교는 그날 자정 실행의 장부에 있다
    elif d.get('fallback'):
        warn = True
        lines.append("참가작 번호 수집이 실패해 **마지막으로 저장된 참가작 목록**(보통 23:30 준비 실행 결과)으로 진행했습니다 — "
                     "그 뒤 등록된 작품은 이날 빠졌을 수 있습니다.")
    else:
        # 노벨피아 표시 수는 지금 보이는 작품만 센다 — 우리 목록(누적, 삭제·비공개 뒤에도 추적)이 아니라 '살아 있는' 수와 견준다.
        ours = d.get('alive_contest') if d.get('alive_contest') is not None else d.get('total_contest')
        if d.get('listed_total') and ours is not None and ours < d['listed_total']:
            warn = True
            lines.append(f"우리가 찾은 참가작이 노벨피아 표시보다 적습니다({ours:,} / {d['listed_total']:,}) — 새 작품을 놓쳤을 수 있습니다.")
    if not lines and not actions:
        return None
    if reprocess:
        title = '저장된 원본으로 다시 계산'
    elif warn:
        title = '자정 수집 — 확인할 점 있음'
    else:
        title = '자정 수집 — 정상, 참고 사항'
    if not test:
        fields.append({'name': '자세한 기록', 'value': f"상태 버킷 `{_ledger_key(date, reprocess)}`"})
    return {'level': 'warn' if warn else 'info', 'pipeline': '2026 공모전', 'date': date, 'title': title,
            'lines': lines, 'fields': fields, 'action': '\n'.join(actions) or None, 'test': test, 'run': run}


# 원본 재계산 그림자 실행에서 운영 행과 정확히 견줄 필드 — 같은 원본·같은 해석이면 모두 같아야 한다.
EXACT_FIELDS = ('Title', 'AuthorName', 'AuthorID', 'View', 'Like', 'Fav', 'Alr', 'Eps', 'Tags', 'Synopsis', 'ThumbnailURL',
                'IsAdult', 'Badges', 'SerialStatus', 'SerialDays', 'LifePick', 'FirstEpView', 'FirstEpNum', 'Ep30View', 'Ep30Num',
                'RecentBaseView', 'RecentBaseNum', 'TargetLatestEpView', 'TargetLatestEpNum')


def _plain(v):
    """DynamoDB 값(Decimal·set)을 파서 출력과 같은 꼴로."""
    if isinstance(v, Decimal):
        return int(v) if v == v.to_integral_value() else float(v)
    if isinstance(v, list):
        return [_plain(x) for x in v]
    if isinstance(v, dict):
        return {k: _plain(x) for k, x in v.items()}
    return v


def _exact_mismatch(mine, prod):
    """필드별 불일치 수와 표본(번호). 한쪽에만 있는 필드도 불일치로 센다."""
    out = {}
    for k in set(mine) & set(prod):
        for f in EXACT_FIELDS:
            if _plain(prod[k].get(f)) != _plain(mine[k].get(f)):
                e = out.setdefault(f, {'count': 0, 'sample': []})
                e['count'] += 1
                if len(e['sample']) < 5:
                    e['sample'].append(k)
    return out


def _rows_for_date(table, date, **query_kw):
    """운영 테이블의 그 날짜 작품 행 {ID: 행}(DateViewIndex — View 가 없는 특수 항목은 들어오지 않는다)."""
    rows, kw = {}, {'IndexName': 'DateViewIndex', 'KeyConditionExpression': Key('Date').eq(date), **query_kw}
    while True:
        r = table.query(**kw)
        for it in r['Items']:
            rows[str(it['ID'])] = it
        if 'LastEvaluatedKey' not in r:
            break
        kw['ExclusiveStartKey'] = r['LastEvaluatedKey']
    return rows


def _later_dates_if_new(table, date):
    """`date` 가 아직 수집일 집합에 없고 그 뒤 수집일이 있으면 그 날짜들 — 다음 수집일의 일간 순위가 이 날짜를 기준으로 바뀐다.

    (그 날짜의 일간 순위는 이 날짜가 없던 때 그 전 날짜와 견준 이틀치 증가다. 그 날짜도 원본 재계산하면 바로잡힌다.)
    """
    try:
        meta = table.get_item(Key={'ID': 'CONTEST_AVAILABLE_DATES', 'Date': 'METADATA'}).get('Item') or {}
    except Exception:  # noqa: BLE001 — 알림 문구용
        return []
    dates = set(meta.get('dates') or set())
    return [] if date in dates else sorted(d for d in dates if d > date)


def handler_dmap(event, context):
    """`action: reconcile` 이면 대조, 아니면 최종 적재. `dry_run` 이면 쓰지 않고 운영 테이블과 비교만 한다(그림자 실행).

    `reprocess`(원본 재계산)면 장부를 `failures/{date}-reprocess.json` 에 따로 남기고 `state/gone_ids.json` 을 건드리지 않는다.
    `attempt`(상태 머신 `StartAttempt` 결과)가 2 이상이면 자동 재실행으로 적재한 날이라 알린다.
    """
    if event.get('action') == 'reconcile':
        return reconcile_dmap(event)

    execution_id, date = event.get('execution_id', 'N/A'), event['date']
    reprocess = bool(event.get('reprocess'))
    # 시도 정보(상태 머신 `StartAttempt` 결과 통째로). 옛 상태 머신이면 없다.
    attempt_info = event.get('attempt') if isinstance(event.get('attempt'), dict) else {}
    attempt = attempt_info.get('attempt')
    pre = _run_prefix(date, execution_id)
    expected = _get_json(f'{pre}/expected.json')
    state = _get_json(f'{pre}/collected.json')
    unique, errors = state['items'], state['errors']
    # 받은 것 중 기대 목록 밖(기록 날짜 뒤에 찾아 reconcile 이 뺀 번호 등)은 그날 행으로 쓰지 않는다.
    exp_set = set(expected)
    outside = [str(i['ID']) for i in unique if str(i['ID']) not in exp_set]
    if outside:
        _log(logging.WARNING, execution_id, "Dropping collected novels outside the expected list.", count=len(outside), sample=outside[:10])
        unique = [i for i in unique if str(i['ID']) in exp_set]
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
        'mode': 'reprocess' if reprocess else 'fetch', 'attempt': attempt,
        'previous_errors': attempt_info.get('previous_errors') or [],
        'late_minutes': _minutes_after_midnight(date, unique),
    }
    if len(still) > MAX_MISSING_FRACTION * len(expected):
        if not event.get('dry_run'):
            _put_json(_ledger_key(date, reprocess), {**ledger, 'written': False})
        raise TooManyMissing(f"{len(still)}/{len(expected)} novels still missing after retries — not writing {date}.")
    table = boto3.resource('dynamodb').Table(Config.DYNAMODB_TABLE_NAME)
    prod = _rows_for_date(table, date) if (reprocess or event.get('dry_run')) else None
    kept = []
    if reprocess:
        # 원본에서 다시 계산하지 못한 작품에 그날 실데이터 행이 이미 있으면 그 행을 그대로 다시 쓴다 — 자리표시로 덮지 않는다.
        # 그 행은 자정(또는 앞선 원본 재계산)의 값이라 '자정 값' 원칙에 맞고, 순위·태그 통계 모수에도 그대로 들어가야 한다.
        kept = [_reuse_row(prod[k]) for k in still if k in prod and not _is_placeholder(prod[k])]
        ledger['kept_rows'] = sorted(str(r['ID']) for r in kept)
    kept_ids = {str(r['ID']) for r in kept}
    # 원본 재계산에서 빠진 작품은 '받지 못함'이 아니라 '원본에서 다시 계산하지 못함'이다.
    unique += kept + [_placeholder(k, date, 'ReprocessFailed' if reprocess else 'FetchFailed') for k in still if k not in kept_ids]

    if event.get('dry_run'):
        mine = {str(i['ID']): i for i in unique}
        diff_view = [k for k in mine if k in prod and abs(int(prod[k].get('View', 0)) - int(mine[k].get('View', 0))) > max(50, int(prod[k].get('View', 0)) * 0.05)]
        added_by_consolidate = set(ADDED_BY_CONSOLIDATE)   # 비교 대상(unique)은 순위 계산 전 파서 출력이다
        missing_f, extra_f = {}, {}
        for k in set(mine) & set(prod):
            pk, mk = set(prod[k]) - added_by_consolidate, set(mine[k])
            for f in pk - mk:
                missing_f[f] = missing_f.get(f, 0) + 1
            for f in mk - pk:
                extra_f[f] = extra_f.get(f, 0) + 1
        exact = _exact_mismatch(mine, prod) if reprocess else None
        report = {'dry_run': True, 'date': date, 'mode': ledger['mode'], 'attempt': attempt,
                  'late_minutes': ledger['late_minutes'], 'expected': len(expected), 'collected': len(unique),
                  'fetch_failed': len(still), 'kept_real_rows': len(kept), 'recovered': ledger['recovered'], 'prod_rows': len(prod),
                  'only_in_dmap': len(set(mine) - set(prod)), 'only_in_prod': len(set(prod) - set(mine)),
                  'view_far_apart': len(diff_view),
                  'fields_missing_in_dmap': dict(sorted(missing_f.items(), key=lambda x: -x[1])[:10]),
                  'fields_extra_in_dmap': dict(sorted(extra_f.items(), key=lambda x: -x[1])[:10])}
        if exact is not None:
            report['exact_mismatch'] = exact   # 원본 재계산은 같은 원본이라 값이 정확히 같아야 한다
        _log(logging.INFO, execution_id, "DMap dry-run comparison.", **report)
        notice = _notice(date, ledger, test=True, run=execution_id)
        return {**report, 'degraded': bool(notice), 'notice': notice}

    if reprocess:
        ledger['later_dates'] = _later_dates_if_new(table, date)   # 쓰기 전에 본다 — 쓰고 나면 이 날짜가 집합에 들어간다
        ledger['written_rows'] = len(unique)
        # 원본이 없는 그날 행(자정에 받지 못한 FetchFailed 자리표시 — 원본은 받은 작품만 남는다)은 다시 쓰지 않고 그대로 둔다.
        ledger['untouched_rows'] = sorted(set(prod) - {str(i['ID']) for i in unique})
    _process_and_upload_data(table, execution_id, unique)
    _put_json(_ledger_key(date, reprocess), {**ledger, 'written': True})   # 결손이 없어도 남긴다 — 그날 무엇을 했는지의 기록
    if reprocess:
        # gone_ids 는 '지금' 보이지 않는 참가작이다(수집기가 오늘 표시 수와 견준다) — 과거 날짜를 다시 계산하며 덮지 않는다.
        notice = _notice(date, ledger, run=execution_id)
        return {'statusCode': 200, 'processed_count': len(unique), 'fetch_failed': len(still), 'kept_rows': len(kept),
                'mode': 'reprocess', 'degraded': bool(notice), 'notice': notice}
    # 지금 보이지 않는 참가작(경고창·파싱 실패 자리표시 — 받지 못한 FetchFailed 는 제외)을 수집기에 알린다. 수집기는 이 번호를 빼고
    # '살아 있는 수'를 노벨피아 표시 수와 견준다(누적 목록이 삭제·비공개작까지 세서 놓친 신작을 가리지 않게). 매일 덮어쓴다.
    try:
        gone = sorted(str(i['ID']) for i in unique if str(i.get('Title', '')).startswith(('N/A (Inaccessible', 'N/A (ParsingFailed')))
        _put_json('state/gone_ids.json', gone)
    except Exception as e:  # noqa: BLE001 — 부가 정보라 적재를 막지 않는다
        _log(logging.WARNING, execution_id, f"Could not write gone_ids: {e}")
    notice = _notice(date, ledger, run=execution_id)
    return {'statusCode': 200, 'processed_count': len(unique), 'fetch_failed': len(still), 'attempt': attempt,
            'late_minutes': ledger['late_minutes'], 'recovered': ledger['recovered'], 'degraded': bool(notice), 'notice': notice}
