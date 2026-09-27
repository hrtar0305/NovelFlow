"""NovelFlow 알림을 Discord 채널로 보내는 단일 입구.

받는 것
  * Step Functions 실행 상태 변경 (EventBridge 규칙 `novelflow-pipeline-failure`)
      → 실패·타임아웃·중단. **멘션한다.**
  * CloudWatch 알람 상태 변경 (EventBridge 규칙 `novelflow-alarm-state`)
      → ALARM 이면 멘션, ALARM 에서 OK 로 풀리면 멘션 없이. 알람을 만들 때 생기는
        INSUFFICIENT_DATA → OK 같은 전환은 소식이 아니므로 보내지 않는다.
  * 일반 메시지 — 직접 invoke 하거나 앞으로 붙일 자동화(CI/CD 등)용:
        {"content": "배포 완료: crawler 1.5.0", "mention": false}

멘션은 `allowed_mentions` 로 **지정한 사용자 한 명만** 허용한다. 실패 원인(cause) 같은
외부 텍스트에 `@everyone` 이 섞여 있어도 아무도 불리지 않는다.

Discord 전송이 실패하면 예외를 올린다 — EventBridge 가 비동기 호출을 재시도한다.
"""

import json
import os
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone, timedelta

WEBHOOK_URL = os.environ.get('DISCORD_WEBHOOK_URL')
MENTION_USER_ID = os.environ.get('DISCORD_MENTION_USER_ID', '')
REGION = os.environ.get('AWS_REGION', 'ap-northeast-2')
KST = timezone(timedelta(hours=9))

# 배포된 이름은 옛 프로젝트명(NpTrend*)이라 화면에는 뜻으로 보여 준다.
PIPELINE_NAMES = {
    'NpTrendCrawlerWorkflow': '데일리 랭킹',
    'NpTrendContestDataPipelineMainWorkflow': '공모전',
}

# Discord 메시지 상한 2000자. 원인 문자열은 Lambda 오류 JSON 이라 길 수 있다.
MAX_CONTENT = 2000
MAX_CAUSE = 600


def _kst(value):
    """epoch ms 또는 ISO 문자열 → 'YYYY-MM-DD HH:MM KST'. 읽지 못하면 원문."""
    try:
        if isinstance(value, (int, float)):
            dt = datetime.fromtimestamp(value / 1000, tz=timezone.utc)
        else:
            dt = datetime.fromisoformat(str(value).replace('Z', '+00:00'))
        return dt.astimezone(KST).strftime('%Y-%m-%d %H:%M KST')
    except (TypeError, ValueError):
        return str(value)


def _clip(text, limit):
    text = str(text)
    return text if len(text) <= limit else text[:limit - 1] + '…'


def _format_execution(event):
    d = event.get('detail', {})
    sm_name = str(d.get('stateMachineArn', '')).rsplit(':', 1)[-1]
    pipeline = PIPELINE_NAMES.get(sm_name, sm_name)
    lines = [
        f"🚨 **NovelFlow 파이프라인 {d.get('status')}** — {pipeline}",
        f"• 상태 머신: `{sm_name}`",
        f"• 실행: `{d.get('name')}` (시작 {_kst(d.get('startDate'))})",
    ]
    if d.get('error'):
        lines.append(f"• 오류: `{d['error']}`")
    if d.get('cause'):
        lines.append(f"• 원인: {_clip(d['cause'], MAX_CAUSE)}")
    arn = d.get('executionArn', '')
    lines.append(f"https://{REGION}.console.aws.amazon.com/states/home?region={REGION}"
                 f"#/v2/executions/details/{arn}")
    return '\n'.join(lines), True


def _format_alarm(event):
    d = event.get('detail', {})
    name = d.get('alarmName', '?')
    state = (d.get('state') or {}).get('value')
    previous = (d.get('previousState') or {}).get('value')
    link = (f"https://{REGION}.console.aws.amazon.com/cloudwatch/home?region={REGION}"
            f"#alarmsV2:alarm/{urllib.parse.quote(name)}")

    if state == 'ALARM':
        desc = (d.get('configuration') or {}).get('description') or ''
        reason = (d.get('state') or {}).get('reason') or ''
        text = f"🚨 **알람 발생** — `{name}`\n{desc}\n• 사유: {_clip(reason, MAX_CAUSE)}\n{link}"
        return text, True
    if state == 'OK' and previous == 'ALARM':
        return f"✅ **알람 해제** — `{name}` ({_kst(event.get('time'))})\n{link}", False
    return None, False   # 생성 직후 INSUFFICIENT_DATA ↔ OK 등은 보내지 않는다


def build_message(event):
    """이벤트 → (본문, 멘션 여부). 보낼 것이 없으면 본문 None."""
    source = event.get('source')
    detail_type = event.get('detail-type')
    if source == 'aws.states' and detail_type == 'Step Functions Execution Status Change':
        return _format_execution(event)
    if source == 'aws.cloudwatch' and detail_type == 'CloudWatch Alarm State Change':
        return _format_alarm(event)
    if 'content' in event:
        return str(event['content']), bool(event.get('mention', False))
    raise ValueError(f"Unsupported event: source={source!r} detail-type={detail_type!r}")


def post(content, mention):
    if not WEBHOOK_URL:
        raise RuntimeError("DISCORD_WEBHOOK_URL is not set")
    if mention and MENTION_USER_ID:
        content = f"<@{MENTION_USER_ID}> {content}"
    payload = {
        'username': 'NovelFlow',
        'content': _clip(content, MAX_CONTENT),
        'allowed_mentions': {'parse': [], 'users': [MENTION_USER_ID] if mention and MENTION_USER_ID else []},
    }
    req = urllib.request.Request(
        WEBHOOK_URL, data=json.dumps(payload).encode('utf-8'), method='POST',
        # 기본 UA(Python-urllib)는 Discord 앞단에서 거절될 수 있다.
        headers={'Content-Type': 'application/json', 'User-Agent': 'NovelFlow-Notify/1.0'},
    )
    try:
        with urllib.request.urlopen(req, timeout=5) as resp:
            return resp.status
    except urllib.error.HTTPError as e:
        # 본문에 토큰이 나오지 않는다. URL 은 로그에 남기지 않는다.
        raise RuntimeError(f"Discord webhook returned {e.code}: {e.read()[:300]!r}") from None


def handler(event, context):
    content, mention = build_message(event)
    if content is None:
        print(json.dumps({"skipped": True, "source": event.get('source'),
                          "detail-type": event.get('detail-type')}, ensure_ascii=False))
        return {"sent": False}
    status = post(content, mention)
    print(json.dumps({"sent": True, "status": status, "mention": mention,
                      "source": event.get('source', 'direct')}, ensure_ascii=False))
    return {"sent": True, "status": status}
