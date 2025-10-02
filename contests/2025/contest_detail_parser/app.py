import boto3
import json
import time
import os
import logging
from datetime import datetime
from zoneinfo import ZoneInfo

logger = logging.getLogger()
logger.setLevel(logging.INFO)

S3_BUCKET_NAME = os.environ.get('S3_BUCKET_NAME')
S3_FILE_NAME = os.environ.get('S3_FILE_NAME')
SQS_TASK_QUEUE_URL = os.environ.get('SQS_TASK_QUEUE_URL')
SQS_RESULT_QUEUE_URL = os.environ.get('SQS_RESULT_QUEUE_URL')
AWS_REGION = "ap-northeast-2"

if not all([S3_BUCKET_NAME, S3_FILE_NAME, SQS_TASK_QUEUE_URL, SQS_RESULT_QUEUE_URL]):
    raise ValueError("Env vars S3_BUCKET_NAME, S3_FILE_NAME, SQS_TASK_QUEUE_URL, and SQS_RESULT_QUEUE_URL must be set.")

s3_client = boto3.client('s3', region_name=AWS_REGION)
sqs_client = boto3.client('sqs', region_name=AWS_REGION)

def _log(level, execution_id, message, **kwargs):
    """Creates a structured log message."""
    log_data = {"execution_id": execution_id, "message": message, **kwargs}
    logger.log(level, json.dumps(log_data, ensure_ascii=False))

def _wait_for_queue_empty(queue_url, execution_id, timeout_seconds=70):
    """Waits for an SQS queue to become empty after a purge request."""
    start_time = time.time()
    _log(logging.INFO, execution_id, f"Waiting for queue to be empty: {queue_url}")
    while time.time() - start_time < timeout_seconds:
        try:
            attributes = sqs_client.get_queue_attributes(
                QueueUrl=queue_url,
                AttributeNames=['ApproximateNumberOfMessages', 'ApproximateNumberOfMessagesNotVisible']
            )['Attributes']
            if int(attributes['ApproximateNumberOfMessages']) == 0 and int(attributes['ApproximateNumberOfMessagesNotVisible']) == 0:
                _log(logging.INFO, execution_id, f"Queue is confirmed empty: {queue_url}")
                return
        except Exception as e:
            _log(logging.WARNING, execution_id, f"Error checking queue status for {queue_url}, retrying: {e}")
        time.sleep(5)
    raise TimeoutError(f"Queue {queue_url} was not empty after {timeout_seconds} seconds.")

def get_id_list_from_s3(event, context):
    """
    Reads the master list of novel IDs from S3, purges the target SQS queue,
    and then sends each novel ID as a separate message to the SQS queue (Fan-Out).
    This decouples the process and avoids high state transition costs in Step Functions.
    """
    execution_id = event.get('execution_id', 'N/A')
    execution_date = event.get('date')
    if not execution_date:
        raise ValueError("Date must be provided from the Step Functions event.")
    
    # Convert the UTC timestamp from Step Functions to a KST date string.
    utc_time = datetime.fromisoformat(execution_date.replace('Z', '+00:00'))
    kst_time = utc_time.astimezone(ZoneInfo("Asia/Seoul"))
    formatted_date = kst_time.strftime("%Y-%m-%d")

    try:
        _log(logging.INFO, execution_id, f"Sending purge request to SQS Task Queue: {SQS_TASK_QUEUE_URL}")
        sqs_client.purge_queue(QueueUrl=SQS_TASK_QUEUE_URL)

        _log(logging.INFO, execution_id, f"Sending purge request to SQS Result Queue: {SQS_RESULT_QUEUE_URL}")
        sqs_client.purge_queue(QueueUrl=SQS_RESULT_QUEUE_URL)

        _wait_for_queue_empty(SQS_RESULT_QUEUE_URL, execution_id)
        _wait_for_queue_empty(SQS_TASK_QUEUE_URL, execution_id)

        logger.info(f"[{execution_id}] Attempting to read s3://{S3_BUCKET_NAME}/{S3_FILE_NAME}")
        
        response = s3_client.get_object(
            Bucket=S3_BUCKET_NAME,
            Key=S3_FILE_NAME
        )
        
        content = response['Body'].read().decode('utf-8')
        novel_ids = json.loads(content)
        
        logger.info(f"[{execution_id}] Fanning out {len(novel_ids)} novel IDs to SQS queue.")
        
        entries = []
        for i, novel_id in enumerate(novel_ids):
            message_body = json.dumps({
                "novel_id": novel_id,
                "date": formatted_date,
                "execution_id": execution_id
            })
            entries.append({'Id': str(i), 'MessageBody': message_body})
            
            if len(entries) == 10:
                sqs_client.send_message_batch(QueueUrl=SQS_TASK_QUEUE_URL, Entries=entries)
                entries = []
        
        if entries: # Send any remaining messages
            sqs_client.send_message_batch(QueueUrl=SQS_TASK_QUEUE_URL, Entries=entries)

        logger.info(f"[{execution_id}] Successfully sent all {len(novel_ids)} messages to SQS.")
        return {
            "status": "SUCCESS",
            "fanned_out_count": len(novel_ids)
        }
        
    except s3_client.exceptions.NoSuchKey:
        logger.error(f"[{execution_id}] S3 object not found: s3://{S3_BUCKET_NAME}/{S3_FILE_NAME}")
        raise
    except Exception as e:
        logger.error(f"[{execution_id}] Failed to read or parse S3 object: {e}", exc_info=True)
        raise