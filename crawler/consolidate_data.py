import json
import boto3
import csv
import io
import logging
import os
import time

# --- Basic Setup ---
logger = logging.getLogger()
logger.setLevel(logging.INFO)

# --- Centralized Configuration ---
class Config:
    """Houses all configuration variables for the consolidation script."""
    S3_BUCKET_NAME = os.environ.get('S3_BUCKET_NAME')
    SQS_QUEUE_URL = os.environ.get('SQS_QUEUE_URL')
    LOOP_TIMEOUT_SECONDS = 270
    CSV_HEADERS = [
        "Date", "Ranking", "ID", "Score", "Title", "AuthorName", "AuthorID",
        "View", "Like", "Fav", "Alr", "Eps", "Tags", "Synopsis",
        "ThumbnailURL",
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
                all_novel_data.append(json.loads(message['Body']))
                receipt_handles_to_delete.append({'Id': message['MessageId'], 'ReceiptHandle': message['ReceiptHandle']})
            except json.JSONDecodeError:
                _log(logging.ERROR, execution_id, "Failed to parse message body.", body=message.get('Body'))
    else:
        raise TimeoutError(f"Consolidation loop timed out after {Config.LOOP_TIMEOUT_SECONDS} seconds.")
    
    return all_novel_data, receipt_handles_to_delete

def _validate_data(execution_id, collected_data, target_count):
    """Validates that the collected data count matches the target count."""
    collected_count = len(collected_data)
    if collected_count != target_count:
        error_message = f"Validation Failed: Expected {target_count}, but collected {collected_count}."
        _log(logging.ERROR, execution_id, error_message)
        raise ValueError(error_message)
    _log(logging.INFO, execution_id, "Validation successful.")

def _upload_csv_to_s3(s3_client, execution_id, data, date):
    """Sorts data, creates a CSV, and uploads it to S3."""
    data.sort(key=lambda x: x.get('Ranking', 0))
    csv_buffer = io.StringIO()
    writer = csv.DictWriter(csv_buffer, fieldnames=Config.CSV_HEADERS, extrasaction='ignore')
    writer.writeheader()
    writer.writerows(data)

    file_name = f"{date}.csv"
    s3_client.put_object(
        Bucket=Config.S3_BUCKET_NAME, Key=file_name,
        Body=csv_buffer.getvalue().encode('utf-8'), ContentType='text/csv'
    )
    s3_uri = f"s3://{Config.S3_BUCKET_NAME}/{file_name}"
    _log(logging.INFO, execution_id, f"Successfully uploaded to {s3_uri}")
    return s3_uri

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
        all_novel_data, receipt_handles = _collect_messages_from_sqs(sqs_client, execution_id, target_novel_count)
    except Exception as e:
        _log(logging.ERROR, execution_id, f"Failed during SQS message retrieval: {e}", exc_info=True)
        raise

    # 2. Data Validation
    _validate_data(execution_id, all_novel_data, target_novel_count)

    # 3. Commit Phase: Upload to S3 & Then Delete Messages
    try:
        consolidated_s3_uri = _upload_csv_to_s3(s3_client, execution_id, all_novel_data, consolidated_file_date)
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
