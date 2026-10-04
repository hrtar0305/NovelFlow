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

KST = ZoneInfo("Asia/Seoul")
# 하루의 값은 자정 값이다(사용자 결정 2026-10-04). 노벨피아에서 다시 받아 기록 날짜 D 로 쓰는 시도는 D+1 00:00 KST 뒤
# 이 시간 안에 시작해야 한다 — 자동 재실행(상태 머신 `Run` 의 Retry)으로 생기는 지연까지만 허용한다. 그 뒤에 받은 값은 그 시각의
# 누적이라 일간 증가가 시각 차를 품는다. 받기는 끝났는데 적재가 실패했다면 원본 재계산(`reprocess`)으로 자정 값을 다시 계산한다.
REFETCH_GRACE_MINUTES = int(os.environ.get('REFETCH_GRACE_MINUTES', '60'))
EARLY_GRACE_MINUTES = 5   # 자정 몇 분 전 시작(스케줄러·시계 오차)은 그 날짜의 자정 수집으로 본다


class LateRefetchRefused(Exception):
    """기록 날짜의 자정 + 1시간이 지나 노벨피아에서 다시 받으려 했다 — 받기 전에 거절한다(상태 머신이 재시도하지 않는다)."""


class InjectedAttemptFailure(Exception):
    """재실행 경로 시험(그림자 실행 전용, `fail_first_attempt`): 첫 시도를 일부러 실패시킨다."""


def _parse_ts(value):
    if not value:
        return None
    dt = datetime.fromisoformat(str(value).replace('Z', '+00:00'))
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def refetch_deadline(date):
    """기록 날짜 `date` 로 노벨피아에서 받을 수 있는 마지막 시작 시각 = D+1 00:00 KST + `REFETCH_GRACE_MINUTES`."""
    return datetime.strptime(date, "%Y-%m-%d").replace(tzinfo=KST) + timedelta(days=1, minutes=REFETCH_GRACE_MINUTES)


# 실행 제한(상태 머신 TimeoutSeconds 6300초 = 105분). 마감 안에 시작한 시도도 이만큼은 더 받을 수 있다.
EXECUTION_LIMIT_MINUTES = int(os.environ.get('EXECUTION_LIMIT_MINUTES', '105'))


def raw_accept_until(date):
    """기록 날짜 `date` 의 원본으로 인정하는 마지막 받은 시각 = 받기 마감 + 실행 제한(D+1 02:45 KST).

    원본 재계산(`parser.reprocess_index`·`reparse_raw_batch`)은 그 날짜 접두어 아래 묶음 중 이보다 늦게 받은 줄을 버린다.
    마감(`refetch_deadline`) 안에 시작한 시도(자동 재실행 포함)는 실행 제한 안에서 받기를 끝내므로 이 시각을 넘지 않는다.
    더 늦은 줄은 마감을 지키지 않은 실행의 것이다 — 그림자 실행(마감 면제)은 이제 원본을 올리지 않지만(parser), 그 전에 올린
    묶음이나 손으로 넣은 묶음이 '자정 값'으로 섞이지 않게 한다. 상태 머신 TimeoutSeconds 를 바꾸면 함께 바꾼다.
    """
    return refetch_deadline(date) + timedelta(minutes=EXECUTION_LIMIT_MINUTES)


def check_refetch_allowed(date, at, dry_run=False, reprocess=False):
    """`at`(시도 시작 시각)에 노벨피아에서 받아 `date` 로 써도 되나. 안 되면 `LateRefetchRefused`.

    - 그림자 실행(`dry_run`)은 쓰지 않으므로 늘 허용 — 과거 날짜로 견주는 시험은 그대로 된다.
    - 원본 재계산(`reprocess`)은 받지 않으므로 늘 허용 — 값이 자정에 저장한 원본에서 나온다.
    """
    if dry_run or reprocess:
        return
    # 이른 쪽도 막는다: 낮에 입력 없이 손으로 돌리면 날짜가 '시작 − 12시간'이라 그날(D)이 되어 RUN_LOCK#D 를 먼저 잡고,
    # 정작 D+1 00:00 예약 실행이 '중복'으로 건너뛰어져 낮 값이 그날 값으로 남았다(검증 2026-10-04, 사용자 결정).
    earliest = refetch_deadline(date) - timedelta(minutes=REFETCH_GRACE_MINUTES + EARLY_GRACE_MINUTES)
    if at < earliest:
        at_kst, e_kst = at.astimezone(KST), earliest.astimezone(KST)
        raise LateRefetchRefused(
            f"{date} 수집 거절: 이 시도는 {at_kst:%Y-%m-%d %H:%M:%S} KST 에 시작해, 그 날짜의 자정 수집 창({e_kst:%Y-%m-%d %H:%M} KST "
            f"이후)보다 이릅니다. 하루의 값은 자정 값이어야 합니다 — 지금 받으면 그날이 끝나기 전 값이 {date} 이름으로 적재되고, "
            f"날짜 잠금을 먼저 잡아 자정 예약 실행이 건너뛰어집니다. 시험이면 dry_run 으로 돌리세요.")
    deadline = refetch_deadline(date)
    if at > deadline:
        at_kst, dl_kst = at.astimezone(KST), deadline.astimezone(KST)
        raise LateRefetchRefused(
            f"{date} 수집 거절: 이 시도는 {at_kst:%Y-%m-%d %H:%M:%S} KST 에 시작해 마감({dl_kst:%Y-%m-%d %H:%M} KST, "
            f"자정 + {REFETCH_GRACE_MINUTES}분)을 넘겼습니다. 하루의 값은 자정 값이어야 합니다 — 지금 노벨피아에서 다시 받으면 "
            f"그 시각의 누적이 {date} 이름으로 적재되어 일간 순위가 늦은 만큼 부풀습니다. "
            f"받기는 끝났는데 적재가 실패했다면 자정에 저장한 원본으로 다시 계산하세요: "
            f"{{\"reprocess\": true, \"target_date\": \"{date}\"}}. 자정 수집 자체가 실패한 날은 비워 둡니다"
            f"(다음 날 일간 순위는 실제 직전 수집일과 견줍니다).")


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
    `action: attempt_start` 면 시도 시작(`attempt_start` — 받기 마감·시도 번호)을 한다.
    """
    if event.get('action') == 'attempt_start':
        return attempt_start(event)
    execution_id = event.get('execution_id', 'N/A')
    if event.get('reprocess') and not event.get('target_date'):
        raise ValueError("reprocess 에는 target_date(YYYY-MM-DD)가 필요합니다 — 어느 날짜의 원본을 다시 계산할지.")
    formatted_date = collection_date(event)
    # 수집기 재호출 마감도 여기서 정한다 — 상태 머신은 시각 덧셈을 못 한다. Choice 의 Timestamp 비교가 받는 RFC3339(UTC, Z) 모양.
    started = datetime.fromisoformat(event['date'].replace('Z', '+00:00')) if event.get('date') else datetime.now(timezone.utc)
    deadline = started.astimezone(timezone.utc) + timedelta(minutes=DISCOVERY_RECALL_MINUTES)
    _log(logging.INFO, execution_id, "Resolved collection date.", date=formatted_date, target_date=event.get('target_date') or None)
    return {"date": formatted_date, "discovery_deadline": deadline.strftime('%Y-%m-%dT%H:%M:%SZ')}


def _record_attempt(bucket, date, execution_id, token):
    """이 실행의 몇 번째 시도인가 — 상태 버킷 `runs/{date}/{execution}/attempts/{token}` 표지의 순번.

    `token` 은 상태 머신 `BeginAttempt`(Pass)에 들어간 시각이다. 병렬 단계(`Run`)가 다시 돌 때마다 새로 정해지고, 이 Task 의
    Lambda 재시도에서는 같으므로 같은 시도를 두 번 세지 않는다(멱등). 시각 문자열이라 사전순이 곧 시도 순서다.
    """
    import boto3
    s3 = boto3.client('s3')
    prefix = f"runs/{date}/{execution_id}/attempts/"
    key = prefix + token
    tokens = set()
    for page in s3.get_paginator('list_objects_v2').paginate(Bucket=bucket, Prefix=prefix):
        tokens |= {o['Key'][len(prefix):] for o in page.get('Contents') or []}
    if token not in tokens:
        s3.put_object(Bucket=bucket, Key=key, Body=b'{}', ContentType='application/json')
        tokens.add(token)
    return sorted(tokens).index(token) + 1


def _attempt_error_summary(raw):
    """상태 머신 `RecordAttemptError` 가 남긴 시도 상태(JSON 문자열 또는 dict) → 한 줄 요약(오류·어디까지 했나).

    운영자가 원본 재계산(`reprocess`)을 돌려도 되는지 — 받기가 끝났는지 — 를 실행 기록을 열지 않고 알 수 있게 한다.
    """
    st = raw or {}
    # S3 putObject 통합은 Body 로 받은 문자열(States.JsonToString 결과)을 다시 JSON 으로 감싸 쓴다 — 한 겹 더 벗긴다.
    for _ in range(3):
        if not isinstance(st, (str, bytes)):
            break
        st = json.loads(st)
    if not isinstance(st, dict):
        raise ValueError(f"시도 상태가 객체가 아님: {type(st).__name__}")
    err = st.get('Err') or {}
    cause = str(err.get('Cause') or '')
    try:   # Lambda 오류의 Cause 는 {"errorMessage", "errorType", "stackTrace"} JSON 문자열이다
        cause = json.loads(cause).get('errorMessage') or cause
    except (ValueError, AttributeError):
        pass
    rec, work = st.get('Rec') or {}, st.get('Work') or {}
    if st.get('Result'):
        stage = "적재까지 끝남"
    elif rec and not rec.get('retry'):
        stage = f"받기 끝남(빠진 {rec.get('missing')}/{rec.get('expected')}) — 적재 단계에서 실패, 원본 재계산 가능"
    elif rec:
        stage = f"대조 {rec.get('round')}회까지(빠진 {rec.get('missing')}/{rec.get('expected')}) — 재시도 받기 중 실패, 받기가 끝나지 않음"
    elif st.get('Map') or 'round' in work:
        stage = "첫 받기 라운드 중 실패 — 받기가 끝나지 않음"
    else:
        stage = "받기 전 실패"
    return f"{err.get('Error') or '?'}: {cause[:300]} [{stage}]"


def _previous_attempt_errors(bucket, date, execution_id, token):
    """이 실행의 앞선 시도들이 남긴 오류 요약(시도 순서). `runs/{date}/{execution}/attempt-errors/{token}.json`.

    시도 표지(`attempts/`)와 접두어를 나눈다 — 같은 접두어면 `_record_attempt` 가 오류 표지를 시도로 센다.
    """
    import boto3
    s3 = boto3.client('s3')
    prefix = f"runs/{date}/{execution_id}/attempt-errors/"
    keys = []
    for page in s3.get_paginator('list_objects_v2').paginate(Bucket=bucket, Prefix=prefix):
        keys += [o['Key'] for o in page.get('Contents') or [] if o['Key'][len(prefix):] < f"{token}"]
    out = []
    for k in sorted(keys):
        try:
            out.append(_attempt_error_summary(s3.get_object(Bucket=bucket, Key=k)['Body'].read()))
        except Exception as e:  # noqa: BLE001 — 알림 문구용
            out.append(f"(오류 기록을 읽지 못함: {e})")
    return out


def attempt_start(event):
    """상태 머신 `StartAttempt`: 병렬 단계(`Run`) 한 번 = 한 시도의 첫 단계. 받기 전에 마감을 보고 시도 번호를 남긴다.

    입력: {"date"(기록 날짜), "execution_id", "token"(BeginAttempt 진입 시각), "state_bucket",
           "dry_run", "reprocess", "fail_first_attempt"}  (`execution_start` 는 받지만 쓰지 않는다)
    - 시도 번호: `_record_attempt`. 못 세면(S3 오류) None — 알림 문구만 빠지고 수집은 막지 않는다.
    - 마감(`check_refetch_allowed`): 첫 시도든 재실행이든 **그 시도의 시작**(token) 시각으로 본다. 예전에는 첫 시도를 실행
      시작으로 봤는데, 첫 시도의 표지 쓰기가 실패하면 01:00 뒤 재실행이 '첫 시도'로 세어져 실행 시작(00:00) 기준으로 통과했다
      (리뷰 2026-10-04). 자정 실행에서 잠금·날짜 계산으로 생기는 몇 초는 1시간 마감에 영향이 없다.
    - 앞선 시도의 오류(`_previous_attempt_errors`)를 거절 문구와 결과(`previous_errors`)에 싣는다 — 재실행이 마감에 걸리면
      실패 알림이 재실행의 거절만 보여 주어, 첫 시도가 받기를 끝냈는지(원본 재계산을 해도 되는지) 알 수 없었다.
    - 수집기 재호출 마감도 시도 시작 + `DISCOVERY_RECALL_MINUTES` 로 다시 정한다(재실행이 첫 시도의 마감을 물려받지 않게).
    - 시험(`fail_first_attempt`, 그림자 실행 전용): 첫 시도를 여기서 실패시켜 재실행 경로를 안전하게 돌려 본다.
    """
    execution_id, date = event.get('execution_id', 'N/A'), event['date']
    dry_run, reprocess = bool(event.get('dry_run')), bool(event.get('reprocess'))
    now = _parse_ts(event.get('token')) or datetime.now(timezone.utc)
    attempt, previous = None, []
    if event.get('state_bucket') and event.get('token'):
        try:
            attempt = _record_attempt(event['state_bucket'], date, execution_id, event['token'])
        except Exception as e:  # noqa: BLE001 — 시도 번호는 알림용이다. 마감은 이 시도의 시작으로 보므로 영향이 없다
            _log(logging.WARNING, execution_id, f"Could not record attempt marker: {e}")
        if attempt != 1:
            try:
                previous = _previous_attempt_errors(event['state_bucket'], date, execution_id, event['token'])
            except Exception as e:  # noqa: BLE001 — 알림 문구용
                _log(logging.WARNING, execution_id, f"Could not read previous attempt errors: {e}")
    try:
        check_refetch_allowed(date, now, dry_run=dry_run, reprocess=reprocess)
    except LateRefetchRefused as e:
        if previous:
            raise LateRefetchRefused(f"{e} 앞선 시도: " + " / ".join(previous)) from None
        raise
    if event.get('fail_first_attempt'):
        if not dry_run:
            _log(logging.WARNING, execution_id, "fail_first_attempt is only honoured on dry_run executions — ignored.")
        elif attempt == 1:
            raise InjectedAttemptFailure("시험: 첫 시도를 일부러 실패시킵니다(fail_first_attempt, 그림자 실행). 자동 재실행이 이어받아야 합니다.")
    deadline = now.astimezone(timezone.utc) + timedelta(minutes=DISCOVERY_RECALL_MINUTES)
    out = {"attempt": attempt, "started_at": now.astimezone(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),
           "discovery_deadline": deadline.strftime('%Y-%m-%dT%H:%M:%SZ'),
           "refetch_deadline": refetch_deadline(date).astimezone(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),
           "previous_errors": previous}
    _log(logging.INFO, execution_id, "Attempt started.", date=date, dry_run=dry_run, reprocess=reprocess, **out)
    return out
