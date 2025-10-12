import boto3
import json
import logging
import time
import os

logger = logging.getLogger()
logger.setLevel(logging.INFO)

SQS_RESULT_QUEUE_URL = os.environ.get('SQS_RESULT_QUEUE_URL')
if not SQS_RESULT_QUEUE_URL:
    raise ValueError("Environment variable SQS_RESULT_QUEUE_URL must be set.")

sqs_client = boto3.client('sqs')

def _log(level, execution_id, message, **kwargs):
    """Creates a structured log message."""
    log_data = {"execution_id": execution_id, "message": message, **kwargs}
    logger.log(level, json.dumps(log_data, ensure_ascii=False))

def _get_unique_id_count(execution_id):
    """
    Reads all messages from the SQS queue without deleting them to count unique novel IDs.
    This is more accurate than ApproximateNumberOfMessages in case of duplicates.
    """
    unique_ids = set()
    all_entries_to_reset = []
    loop_start_time = time.time()
    timeout_seconds = 30

    try:
        while time.time() - loop_start_time < timeout_seconds:
            response = sqs_client.receive_message(
                QueueUrl=SQS_RESULT_QUEUE_URL,
                MaxNumberOfMessages=10,
                WaitTimeSeconds=1 
            )
            messages = response.get('Messages', [])
            if not messages:
                break

            for message in messages:
                try:
                    unique_ids.add(json.loads(message['Body'])['ID'])
                    all_entries_to_reset.append({
                        'Id': message['MessageId'],
                        'ReceiptHandle': message['ReceiptHandle'],
                        'VisibilityTimeout': 0
                    })
                except (json.JSONDecodeError, KeyError):
                    _log(logging.WARNING, execution_id, "Could not parse novel ID from a message.", body=message.get('Body'))
    finally:
        if all_entries_to_reset:
            _log(logging.INFO, execution_id, f"Resetting visibility for {len(all_entries_to_reset)} messages.")
            for i in range(0, len(all_entries_to_reset), 10):
                batch = all_entries_to_reset[i:i+10]
                sqs_client.change_message_visibility_batch(
                    QueueUrl=SQS_RESULT_QUEUE_URL,
                    Entries=batch
                )

    return len(unique_ids)

def handler(event, context):
    """
    Checks if the number of messages in the Result SQS Queue matches the
    expected count of fanned-out tasks.
    """
    execution_id = event.get('execution_id', 'N/A')
    expected_count = event.get('fanned_out_count', 0)

    if expected_count == 0:
        _log(logging.WARNING, execution_id, "Expected count is 0. Assuming completion.")
        return {"is_done": True}
        
    try:
        attributes = sqs_client.get_queue_attributes(
            QueueUrl=SQS_RESULT_QUEUE_URL,
            AttributeNames=['ApproximateNumberOfMessages', 'ApproximateNumberOfMessagesNotVisible', 'ApproximateNumberOfMessagesDelayed']
        )['Attributes']
        approx_count = int(attributes.get('ApproximateNumberOfMessages', 0))
        not_visible_count = int(attributes.get('ApproximateNumberOfMessagesNotVisible', 0))
        delayed_count = int(attributes.get('ApproximateNumberOfMessagesDelayed', 0))

        if approx_count < expected_count:
            _log(logging.INFO, execution_id, 
                 f"Quick check: Not complete. Approximate count: {approx_count}/{expected_count}.",
                 visible=approx_count,
                 not_visible=not_visible_count,
                 delayed=delayed_count)
            return {"is_done": False}

        _log(logging.INFO, execution_id, f"Approximate count ({approx_count}) met target. Verifying unique IDs...")
        unique_count = _get_unique_id_count(execution_id)
        
        is_done = unique_count >= expected_count
        
        _log(logging.INFO, execution_id, f"Completion check result: {is_done}. Unique IDs found: {unique_count}/{expected_count}.")

        return {"is_done": is_done}

    except Exception as e:
        _log(logging.ERROR, execution_id, f"Failed to check SQS queue status: {e}", exc_info=True)
        # In case of error, assume not done to allow for retries.
        return {"is_done": False}