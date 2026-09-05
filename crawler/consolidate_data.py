import json
import boto3
import csv
import io
import logging
import os
import time
from datetime import datetime, timedelta

import raw_store
from raw_store import RAW_FIELD

# --- Basic Setup ---
logger = logging.getLogger()
logger.setLevel(logging.INFO)

# --- Centralized Configuration ---
class Config:
    """Houses all configuration variables for the consolidation script."""
    S3_BUCKET_NAME = os.environ.get('S3_BUCKET_NAME')
    # 원본 HTML 묶음을 둘 버킷. 비워 두면 원본을 버리고 기존 동작만 한다.
    RAW_BUCKET = os.environ.get('RAW_HTML_BUCKET')
    RAW_PREFIX = os.environ.get('RAW_HTML_PREFIX', 'raw')
    SQS_QUEUE_URL = os.environ.get('SQS_QUEUE_URL')
    LOOP_TIMEOUT_SECONDS = 270
    # NDJSON 의 키 순서를 읽기 좋게 맞추는 용도로만 쓴다.
    #
    # 예전에는 이것이 **스키마 계약**이었다 — `csv.DictWriter(..., extrasaction='ignore')`
    # 때문에 여기 없는 필드는 에러도 없이 사라졌다. 그래서 크롤러가 새 값을 뽑아도
    # S3 에 도달하지 못했고, 과거를 채울 방법도 없었다. 지금은 레코드 전체를 NDJSON 으로
    # 적재하므로 이 목록에 없는 키도 그대로 살아남는다.
    FIELD_ORDER = [
        "Date", "Ranking", "ID", "Score", "Title", "AuthorName", "AuthorID",
        "View", "Like", "Fav", "Alr", "Eps", "Tags", "Synopsis",
        "ThumbnailURL", "IsAdult",
        "FirstEpView", "FirstEpNum", "Ep30View", "Ep30Num",
        "RecentBaseView", "RecentBaseNum", "TargetLatestEpView", "TargetLatestEpNum"
    ]

if not Config.S3_BUCKET_NAME or not Config.SQS_QUEUE_URL:
    raise ValueError("S3_BUCKET_NAME and SQS_QUEUE_URL env vars must be set.")

# --- Logging Helper ---
def _log(level, execution_id, message, **kwargs):
    """Creates a structured log message."""
    log_data = {"execution_id": execution_id, "message": message, **kwargs}
    logger.log(level, json.dumps(log_data, ensure_ascii=False))

# --- Helper Functions ---
def _collect_messages_from_sqs(sqs_client, execution_id, target_novel_count):
    """Collects all available messages from the SQS queue until empty or timeout."""
    all_novel_data = []
    receipt_handles_to_delete = []
    raw_payloads = []            # 소설별 gzip 원본. 검증을 통과한 뒤에만 묶어 올린다.
    loop_start_time = time.time()

    _log(logging.INFO, execution_id, f"Expecting {target_novel_count} items from SQS.")

    while time.time() - loop_start_time < Config.LOOP_TIMEOUT_SECONDS:
        response = sqs_client.receive_message(
            QueueUrl=Config.SQS_QUEUE_URL, MaxNumberOfMessages=10, WaitTimeSeconds=5
        )
        messages = response.get('Messages', [])
        if not messages:
            _log(logging.INFO, execution_id, "Queue is empty. Finalizing collection.")
            break

        for message in messages:
            try:
                item = json.loads(message['Body'])
                # 원본은 항목에서 **떼어낸다.** NDJSON 과 DynamoDB 에 들어가면 안 되고
                # (한 줄이 122KB 가 된다) 묶음 파일로만 간다.
                encoded = item.pop(RAW_FIELD, None)
                if encoded:
                    # **gzip 을 풀어 비압축 JSON 으로 모은다.** gzip 인 채로 묶으면
                    # 이중 압축이라 zstd 가 더 줄이지 못하고(실측 편당 79KB), 게다가
                    # gzip 바이트의 0x0A 가 줄 구분자를 깨뜨린다.
                    raw_payloads.append(raw_store.decode_to_json_bytes(encoded))
                all_novel_data.append(item)
                receipt_handles_to_delete.append({'Id': message['MessageId'], 'ReceiptHandle': message['ReceiptHandle']})
            except json.JSONDecodeError:
                _log(logging.ERROR, execution_id, "Failed to parse message body.", body=message.get('Body'))
    else:
        raise TimeoutError(f"Consolidation loop timed out after {Config.LOOP_TIMEOUT_SECONDS} seconds.")

    return all_novel_data, receipt_handles_to_delete, raw_payloads

def _validate_data(execution_id, collected_data, target_count):
    """Validates that the collected data count matches the target count."""
    collected_count = len(collected_data)
    if collected_count != target_count:
        error_message = f"Validation Failed: Expected {target_count}, but collected {collected_count}."
        _log(logging.ERROR, execution_id, error_message)
        raise ValueError(error_message)
    _log(logging.INFO, execution_id, "Validation successful.")


# --- 품질 게이트 ---------------------------------------------------------------
# 수량 검증만으로는 "500건을 받았지만 내용이 전부 망가진" 경우를 잡지 못한다.
# 실제로 걱정되는 시나리오 두 가지:
#   ① DOM 변경 → 전 건 placeholder. 수량은 500이라 통과한다.
#   ② 로그인/성인 모드 실패 → 성인작이 랭킹에서 통째로 빠지고 다른 작품이 그 자리를
#      채운다. 역시 500건이라 통과하고, 데이터의 1/4이 조용히 바뀐다
#      (2026-08-24 실측: 상위 500건 중 성인작 132건 = 26.4%).
#
# 임계값은 감이 아니라 실측 기반이다:
#   - placeholder: 정상일 0.0~0.8% (2026-08-22~24 실측) → 5%에서 실패
#   - View 감소: 정상일 0건 (6개 날짜쌍 실측) → 100건에서 실패
#     누적 조회수는 단조 증가해야 하므로 대량 감소는 다른 날짜/다른 사이트를 긁었다는 신호.
PLACEHOLDER_TITLE_PREFIX = "N/A ("
MAX_PLACEHOLDER_RATIO = 0.05
MAX_VIEW_DECREASE_COUNT = 100


def _is_placeholder(item):
    return str(item.get("Title", "")).startswith(PLACEHOLDER_TITLE_PREFIX)


def _load_previous_day_views(s3_client, execution_id, date):
    """직전 수집일 파일에서 ID→View를 읽는다. 실패하면 빈 dict(해당 검사 생략)."""
    try:
        previous_date = (
            datetime.strptime(date, "%Y-%m-%d") - timedelta(days=1)
        ).strftime("%Y-%m-%d")
        # 전환 기간에는 두 형식이 섞인다. jsonl 을 먼저 보고 없으면 csv 로 떨어진다.
        rows = None
        for key, kind in ((f"{previous_date}.jsonl", 'jsonl'), (f"{previous_date}.csv", 'csv')):
            try:
                body = s3_client.get_object(
                    Bucket=Config.S3_BUCKET_NAME, Key=key
                )['Body'].read().decode('utf-8')
            except Exception:
                continue
            if kind == 'jsonl':
                rows = [json.loads(line) for line in body.splitlines() if line.strip()]
            else:
                rows = list(csv.DictReader(io.StringIO(body)))
            break
        if rows is None:
            _log(logging.WARNING, execution_id,
                 f"전날({previous_date}) 파일을 찾지 못해 조회수 검증을 건너뛴다.")
            return {}
        return {
            str(r['ID']): int(r['View'])
            for r in rows if r.get('ID') and str(r.get('View', '')).strip().isdigit()
        }
    except Exception as e:
        _log(logging.WARNING, execution_id, f"전날 조회수 로드 실패: {e}")
        return {}


def _quality_gate(s3_client, execution_id, data, date):
    """수량 외 품질 검사. 위반 시 예외를 던져 S3 업로드와 SQS 삭제를 막는다."""
    total = len(data)
    if total == 0:
        raise ValueError("Quality gate: no data to validate.")

    # ① placeholder 비율
    placeholders = sum(1 for item in data if _is_placeholder(item))
    ratio = placeholders / total
    if ratio > MAX_PLACEHOLDER_RATIO:
        raise ValueError(
            f"Quality gate failed: placeholder ratio {ratio:.1%} "
            f"({placeholders}/{total}) exceeds {MAX_PLACEHOLDER_RATIO:.0%}. "
            "Likely a DOM change or auth failure."
        )

    # ② 누적 조회수 단조성
    previous_views = _load_previous_day_views(s3_client, execution_id, date)
    decreased = 0
    if previous_views:
        for item in data:
            if _is_placeholder(item):
                continue
            before = previous_views.get(str(item.get("ID")))
            try:
                after = int(item.get("View"))
            except (ValueError, TypeError):
                continue
            if before is not None and after < before:
                decreased += 1
        if decreased > MAX_VIEW_DECREASE_COUNT:
            raise ValueError(
                f"Quality gate failed: cumulative View decreased for {decreased} novels "
                f"(threshold {MAX_VIEW_DECREASE_COUNT}). Cumulative views must not shrink."
            )

    _log(logging.INFO, execution_id,
         f"Quality gate passed: placeholders {placeholders}/{total} ({ratio:.1%}), "
         f"view decreases {decreased}"
         + ("" if previous_views else " (previous day unavailable)"))

def _upload_records_to_s3(s3_client, execution_id, data, date):
    """정렬한 레코드를 NDJSON 으로 S3 에 올린다.

    CSV 를 버린 이유는 컬럼 고정이 스키마 계약이 되어 **크롤러가 뽑은 필드를 조용히
    버렸기** 때문이다(`extrasaction='ignore'`). NDJSON 은 줄 단위라 CSV 처럼
    스트리밍으로 읽히면서 레코드마다 키가 달라도 된다 — 새 필드를 추가할 때
    이 파일을 고칠 필요가 없다.
    """
    # 순위 오름차순. 적재·재적재 결과가 항상 같은 순서여야 파일 비교가 가능하다
    # (예전 CSV 함수가 하던 일이고, NDJSON 으로 바꾸면서 한 번 빠뜨렸다).
    data.sort(key=lambda x: x.get('Ranking', 0))

    ordered_keys = Config.FIELD_ORDER
    buf = io.StringIO()
    for row in data:
        rest = [k for k in row if k not in ordered_keys]
        buf.write(json.dumps({k: row[k] for k in ordered_keys if k in row}
                             | {k: row[k] for k in sorted(rest)},
                             ensure_ascii=False))
        buf.write("\n")

    file_name = f"{date}.jsonl"
    s3_client.put_object(
        Bucket=Config.S3_BUCKET_NAME, Key=file_name,
        Body=buf.getvalue().encode('utf-8'), ContentType='application/x-ndjson'
    )
    s3_uri = f"s3://{Config.S3_BUCKET_NAME}/{file_name}"
    _log(logging.INFO, execution_id, f"Successfully uploaded to {s3_uri}")
    return s3_uri

def _upload_raw_bundle(s3_client, execution_id, payloads, date):
    """하루치 원본을 한 덩어리로 묶어 올린다.

    **소설마다 하나씩 올리지 않는 이유**(실측 2026-09-05, 30편):
        개별 gzip        편당 91KB · PUT 500회
        묶어서 zstd-10   편당  9KB · PUT   1회
    gzip 은 윈도가 32KB 라 묶어도 이득이 0이었다(2252KB → 2281KB). zstd 는 윈도가
    커서 노벨피아 페이지의 공통 보일러플레이트를 걷어낸다.

    실패해도 예외를 올리지 않는다 — 원본은 부가 기능이고, 이 시점에는 NDJSON 이 이미
    올라가 SQS 메시지 삭제만 남은 상태다. 여기서 막으면 메시지가 재처리돼 중복이 된다.
    """
    if not payloads or not Config.RAW_BUCKET:
        return None
    try:
        body = raw_store.bundle(payloads)
        key = f"{Config.RAW_PREFIX}/{date}.jsonl.zst"
        s3_client.put_object(
            Bucket=Config.RAW_BUCKET, Key=key, Body=body,
            ContentType='application/zstd',
        )
        _log(logging.INFO, execution_id, "Uploaded raw bundle.",
             key=key, novels=len(payloads), bytes=len(body),
             per_novel_kb=round(len(body) / len(payloads) / 1024, 1))
        return f"s3://{Config.RAW_BUCKET}/{key}"
    except Exception as e:  # noqa: BLE001
        _log(logging.ERROR, execution_id, f"Failed to upload raw bundle: {e}", exc_info=True)
        return None


def _delete_messages_from_sqs(sqs_client, execution_id, receipt_handles):
    """Deletes messages from SQS in batches of 10."""
    _log(logging.INFO, execution_id, f"Deleting {len(receipt_handles)} messages from SQS.")
    for i in range(0, len(receipt_handles), 10):
        batch = receipt_handles[i:i+10]
        if batch:
            sqs_client.delete_message_batch(QueueUrl=Config.SQS_QUEUE_URL, Entries=batch)

# --- Main Handler ---
def handler(event, context):
    execution_id = event.get('execution_id', 'N/A')
    target_novel_count = event['target_novel_count']
    consolidated_file_date = event['date']

    sqs_client = boto3.client('sqs')
    s3_client = boto3.client('s3')

    # 1. Data Collection (Read-Only)
    try:
        all_novel_data, receipt_handles, raw_payloads = _collect_messages_from_sqs(
            sqs_client, execution_id, target_novel_count)
    except Exception as e:
        _log(logging.ERROR, execution_id, f"Failed during SQS message retrieval: {e}", exc_info=True)
        raise

    # 2. Data Validation — 수량 검증 후 품질 게이트.
    #    둘 다 업로드 전에 둔다: 실패하면 SQS 메시지가 큐에 남아 재처리가 가능하다
    #    (원자적 커밋 패턴 — 검증 → 업로드 → 삭제 순서를 깨면 안 된다).
    _validate_data(execution_id, all_novel_data, target_novel_count)
    _quality_gate(s3_client, execution_id, all_novel_data, consolidated_file_date)

    # 3. Commit Phase: Upload to S3 & Then Delete Messages
    try:
        consolidated_s3_uri = _upload_records_to_s3(s3_client, execution_id, all_novel_data, consolidated_file_date)
        # 원본 묶음은 NDJSON 뒤에 올린다. 실패해도 예외를 올리지 않으므로
        # 아래 메시지 삭제까지 그대로 진행된다.
        _upload_raw_bundle(s3_client, execution_id, raw_payloads, consolidated_file_date)
        _delete_messages_from_sqs(sqs_client, execution_id, receipt_handles)
    except Exception as e:
        critical_error_msg = f"CRITICAL: Failed during commit phase: {e}"
        _log(logging.CRITICAL, execution_id, critical_error_msg, exc_info=True)
        raise

    return {
        'statusCode': 200,
        'consolidated_s3_uri': consolidated_s3_uri,
        'processed_count': len(all_novel_data)
    }
