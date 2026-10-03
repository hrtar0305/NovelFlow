import json
import boto3
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
    SQS_RESULT_QUEUE_URL = os.environ.get('SQS_RESULT_QUEUE_URL')
    LOOP_TIMEOUT_SECONDS = 600  # 10 minutes
    # ParsingFailed 자리표시가 이 비율을 넘으면 쓰지 않고 실패한다(데일리 consolidate 의 5% 게이트와 같은 취지).
    # Inaccessible(삭제·비공개)은 1년째 추적 중이라 평소에도 절반이 넘으므로 세지 않는다 — 실측 2026-10-02 2,570/4,719,
    # ParsingFailed 는 표본 12일 모두 0건.
    MAX_PARSING_FAILED_RATIO = 0.05

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

def _is_placeholder(item):
    return int(item.get('View', -1)) < 0

def _deduplicate_items(messages, execution_id):
    """Deduplicates items based on 'ID': real data over placeholders, then the earliest SentTimestamp.

    배치 재시도로 1회차의 자리표시와 2회차의 실데이터가 함께 남을 수 있다. 2026 판 `_dedupe_prefer_real`과 같은 원칙.
    """
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

            # 새로운 아이템이거나, 자리표시를 실데이터로 바꾸거나, 같은 종류끼리 더 먼저 보내진 경우에만 저장/덮어쓰기
            cur = unique_items_map.get(novel_id)
            if (cur is None
                    or (_is_placeholder(cur[0]) and not _is_placeholder(item))
                    or (_is_placeholder(cur[0]) == _is_placeholder(item) and sent_timestamp < cur[1])):
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

def _check_quality(execution_id, items):
    """수량은 맞아도 셀렉터가 깨진 날(전 건 ParsingFailed)은 쓰지 않는다.

    commit 전에 올려야 DynamoDB 쓰기와 SQS 삭제가 둘 다 막히고, 실행이 실패해 알림이 간다.
    """
    if not items:
        return
    failed = sum(1 for i in items if str(i.get('Title', '')).startswith('N/A (ParsingFailed'))
    if failed / len(items) > Config.MAX_PARSING_FAILED_RATIO:
        error_message = f"Quality gate failed: {failed}/{len(items)} ParsingFailed placeholders."
        _log(logging.ERROR, execution_id, error_message)
        raise ValueError(error_message)

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

    _log(logging.INFO, execution_id, f"Writing {len(processed_items)} items to DynamoDB.")
    
    with dynamodb_table.batch_writer() as batch:
        for item in processed_items:
            batch.put_item(Item=item)
    _log(logging.INFO, execution_id, "Batch write to DynamoDB complete.")
    
    # --- Calculate and store tag statistics ---
    _calculate_and_store_tag_stats(dynamodb_table, execution_id, processed_items)

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
        # 백엔드는 날짜 목록·직전 수집일을 이 항목에서만 읽으므로 사실상 커밋의 일부다. 다시 던져 SQS 삭제를 막고
        # 실행을 실패시킨다(행 쓰기·집합 ADD 모두 멱등이라 재시도·재실행으로 복구된다).
        raise

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
    _check_quality(execution_id, unique_items)

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