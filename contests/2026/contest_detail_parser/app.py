import json
import os
import logging
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

logger = logging.getLogger()
logger.setLevel(logging.INFO)

# DMap 판: 실행 시작 뒤 이 시각이 지나면 ID 수집기를 다시 부르지 않고 지금 목록으로 진행한다(상태 머신 `DiscoverAgain?`).
# 호출 한 번이 최대 15분(Lambda 900초)이라 수집 단계는 최악 12 + 15 = 27분에 끝나고, 실행 제한 45분 중 18분이 수집·적재에 남는다.
DISCOVERY_RECALL_MINUTES = int(os.environ.get('DISCOVERY_RECALL_MINUTES', '12'))


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
    """DMap 상태 머신 `ResolveDate`: 기록 날짜(`collection_date`)와 ID 수집기 재호출 마감을 정한다.

    함수 이름(`novelflow-contest-2026-fanout`)과 핸들러 이름은 SQS 판에서 S3 목록을 작업 큐로 팬아웃하던
    때의 것이다. SQS 판을 걷어낸 뒤(2026-10-04)로는 날짜만 정하고 큐에는 아무것도 보내지 않는다 — Map 이
    S3 목록을 직접 읽는다. 배포된 상태 머신이 이 이름으로 부르므로 이름은 바꾸지 않는다.
    입력 `resolve_only` 는 상태 머신이 아직 넘기지만 이제 뜻이 없다(항상 날짜만 정한다).
    """
    execution_id = event.get('execution_id', 'N/A')
    formatted_date = collection_date(event)
    # 수집기 재호출 마감도 여기서 정한다 — 상태 머신은 시각 덧셈을 못 한다. Choice 의 Timestamp 비교가 받는 RFC3339(UTC, Z) 모양.
    started = datetime.fromisoformat(event['date'].replace('Z', '+00:00')) if event.get('date') else datetime.now(timezone.utc)
    deadline = started.astimezone(timezone.utc) + timedelta(minutes=DISCOVERY_RECALL_MINUTES)
    _log(logging.INFO, execution_id, "Resolved collection date.", date=formatted_date, target_date=event.get('target_date') or None)
    return {"date": formatted_date, "discovery_deadline": deadline.strftime('%Y-%m-%dT%H:%M:%SZ')}
