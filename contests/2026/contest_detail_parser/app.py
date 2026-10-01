import boto3
import json
import os
import logging
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

logger = logging.getLogger()
logger.setLevel(logging.INFO)

S3_BUCKET_NAME = os.environ.get('S3_BUCKET_NAME')
S3_FILE_NAME = os.environ.get('S3_FILE_NAME')
SQS_TASK_QUEUE_URL = os.environ.get('SQS_TASK_QUEUE_URL')
AWS_REGION = "ap-northeast-2"

if not all([S3_BUCKET_NAME, S3_FILE_NAME, SQS_TASK_QUEUE_URL]):
    raise ValueError("Env vars S3_BUCKET_NAME, S3_FILE_NAME, and SQS_TASK_QUEUE_URL must be set.")

s3_client = boto3.client('s3', region_name=AWS_REGION)
sqs_client = boto3.client('sqs', region_name=AWS_REGION)

def _log(level, execution_id, message, **kwargs):
    """Creates a structured log message."""
    log_data = {"execution_id": execution_id, "message": message, **kwargs}
    logger.log(level, json.dumps(log_data, ensure_ascii=False))

def collection_date(event):
    """이 실행이 기록할 날짜(KST).

    2026 은 **자정(00:00 KST)에 돌고, 방금 끝난 날의 이름을 붙인다** — 10/2 00:00 실행이 '10/1'.
    일간 순위의 '10월 5일'이 정확히 그날 0시~24시의 조회 증가가 되고, 예선 마감(10/29 23:59)
    직후 실행이 '10/29'가 된다. 규칙은 '실행 시각 − 12시간'의 날짜라 아침에 다시 돌려도 같은
    날짜가 나온다. 다른 날짜로 다시 돌릴 때는 상태 머신 입력에 `target_date`(YYYY-MM-DD)를 준다.
    """
    if event.get('target_date'):
        return datetime.strptime(event['target_date'], "%Y-%m-%d").strftime("%Y-%m-%d")
    entered = event.get('date')
    if not entered:
        raise ValueError("Date must be provided from the Step Functions event.")
    kst = datetime.fromisoformat(entered.replace('Z', '+00:00')).astimezone(ZoneInfo("Asia/Seoul"))
    return (kst - timedelta(hours=12)).strftime("%Y-%m-%d")


def get_id_list_from_s3(event, context):
    """
    Reads the master list of novel IDs from S3 and sends each novel ID as a
    separate message to the Task SQS queue (Fan-Out).
    This decouples the process and avoids high state transition costs in Step Functions.

    **여기서 큐를 purge 하지 않는다.** 상태 머신이 purge → 65초 대기 → 이 함수 순서로
    부른다. purge 는 끝나는 데 최대 60초가 걸리고 그 사이 보낸 메시지를 지울 수 있어서,
    purge 직후 곧바로 보내면 작업이 사라진다(2026-09-11, 4,719건 중 599건 유실).
    이 함수의 타임아웃은 30초라 여기서 기다릴 수도 없다.
    """
    execution_id = event.get('execution_id', 'N/A')
    formatted_date = collection_date(event)
    if event.get('resolve_only'):
        # Distributed Map 경로: 날짜만 정하고 큐에는 보내지 않는다(Map 이 S3 목록을 직접 읽는다).
        return {"date": formatted_date}

    try:
        logger.info(f"[{execution_id}] Attempting to read s3://{S3_BUCKET_NAME}/{S3_FILE_NAME}")
        
        response = s3_client.get_object(
            Bucket=S3_BUCKET_NAME,
            Key=S3_FILE_NAME
        )
        
        content = response['Body'].read().decode('utf-8')
        novel_ids = json.loads(content)
        
        logger.info(f"[{execution_id}] Fanning out {len(novel_ids)} novel IDs to SQS queue.")
        
        def send_batch(batch):
            # send_message_batch 는 일부 항목이 실패해도 예외 없이 `Failed` 로만 돌려준다.
            # 확인하지 않으면 fanned_out_count 만 4,719 로 남고 작업은 조용히 빠진다.
            # 여기서 실패시키면 상태 머신이 재시도하고, 중복은 완료 판정(유니크 ID)과
            # consolidate(최초 타임스탬프 우선)가 걸러낸다.
            failed = sqs_client.send_message_batch(QueueUrl=SQS_TASK_QUEUE_URL, Entries=batch).get('Failed')
            if failed:
                raise RuntimeError(f"send_message_batch failed for {len(failed)} entries: {failed[:3]}")

        entries = []
        for i, novel_id in enumerate(novel_ids):
            message_body = json.dumps({
                "novel_id": novel_id,
                "date": formatted_date,
                "execution_id": execution_id
            })
            entries.append({'Id': str(i), 'MessageBody': message_body})

            if len(entries) == 10:
                send_batch(entries)
                entries = []

        if entries: # Send any remaining messages
            send_batch(entries)

        logger.info(f"[{execution_id}] Successfully sent all {len(novel_ids)} messages to SQS.")
        return {
            "status": "SUCCESS",
            "fanned_out_count": len(novel_ids),
            "date": formatted_date,
        }
        
    except s3_client.exceptions.NoSuchKey:
        logger.error(f"[{execution_id}] S3 object not found: s3://{S3_BUCKET_NAME}/{S3_FILE_NAME}")
        raise
    except Exception as e:
        logger.error(f"[{execution_id}] Fan-out failed: {e}", exc_info=True)
        raise