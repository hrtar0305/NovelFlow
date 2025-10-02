import boto3
import json
import logging
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
            AttributeNames=['ApproximateNumberOfMessages']
        )['Attributes']
        
        current_count = int(attributes.get('ApproximateNumberOfMessages', 0))
        
        _log(logging.INFO, execution_id, f"Checking completion status: {current_count}/{expected_count} messages in result queue.")

        return {"is_done": current_count >= expected_count}

    except Exception as e:
        _log(logging.ERROR, execution_id, f"Failed to check SQS queue status: {e}", exc_info=True)
        # In case of error, assume not done to allow for retries.
        return {"is_done": False}