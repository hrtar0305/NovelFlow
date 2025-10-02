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
    all_items = []
    receipt_handles_to_delete = []
    loop_start_time = time.time()

    _log(logging.INFO, execution_id, "Starting to collect all messages from SQS.")

    while time.time() - loop_start_time < Config.LOOP_TIMEOUT_SECONDS:
        response = sqs_client.receive_message(
            QueueUrl=Config.SQS_RESULT_QUEUE_URL, MaxNumberOfMessages=10, WaitTimeSeconds=5
        )
        messages = response.get('Messages', [])
        if not messages:
            _log(logging.INFO, execution_id, f"Queue is empty. Collected {len(all_items)} items in total.")
            break

        for message in messages:
            try:
                all_items.append(json.loads(message['Body']))
                receipt_handles_to_delete.append({'Id': message['MessageId'], 'ReceiptHandle': message['ReceiptHandle']})
            except json.JSONDecodeError:
                _log(logging.ERROR, execution_id, "Failed to parse message body.", body=message.get('Body'))
    else:
        raise TimeoutError(f"Consolidation loop timed out after {Config.LOOP_TIMEOUT_SECONDS} seconds.")
    
    return all_items, receipt_handles_to_delete

def _deduplicate_items(items, execution_id):
    """Deduplicates a list of items based on 'ID', keeping the last seen item."""
    if not items:
        return []
    _log(logging.INFO, execution_id, f"Deduplicating {len(items)} items...")
    deduped_map = {item['ID']: item for item in items}
    _log(logging.INFO, execution_id, f"Deduplication complete. {len(deduped_map)} unique items remaining.")
    return list(deduped_map.values())

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

def _process_and_upload_data(dynamodb_table, execution_id, items):
    """Calculates retention rate and batch-writes items to DynamoDB."""
    processed_items = []
    # The parser already ensures that view and episode numbers are integers,
    # and invalid values are set to -1. This function now only calculates RetentionRate.
    for item in items:
        first_view = item.get("FirstEpView", -1)
        latest_view = item.get("TargetLatestEpView", -1)
        first_ep_num = item.get("FirstEpNum", -1)
        latest_ep_num = item.get("TargetLatestEpNum", -1)

        episode_diff = latest_ep_num - first_ep_num
        if first_view > 0 and episode_diff > 0:
            r_value = math.pow(latest_view / first_view, 1 / episode_diff)
            item["RetentionRate"] = Decimal(f"{r_value:.4f}")
        else:
            item["RetentionRate"] = None

        processed_items.append(item)

    _log(logging.INFO, execution_id, f"Writing {len(processed_items)} items to DynamoDB.")
    with dynamodb_table.batch_writer() as batch:
        for item in processed_items:
            # The RetentionRate is already a Decimal. Other floats are not expected.
            # Simply put the item. The boto3 library handles Decimal types correctly.
            if item.get("RetentionRate") is None:
                item.pop("RetentionRate", None) # Remove None value if it exists
            batch.put_item(Item=item)
    _log(logging.INFO, execution_id, "Batch write to DynamoDB complete.")

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
        all_items, receipt_handles = _collect_all_messages(sqs_client, execution_id)
    except Exception as e:
        _log(logging.ERROR, execution_id, f"Failed during SQS message retrieval: {e}", exc_info=True)
        raise

    if not all_items:
        _log(logging.INFO, execution_id, "No items to process. Exiting.")
        return {'statusCode': 200, 'message': 'No items to process.'}

    # 2. Deduplicate and Validate
    unique_items = _deduplicate_items(all_items, execution_id)
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