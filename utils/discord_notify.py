"""NovelFlow 알림을 Discord 채널로 보내는 단일 입구.

알림은 **카드(embed) 하나**로 보낸다 — 색 띠(빨강 실패 · 주황 확인 필요 · 파랑 참고 · 초록 해제 · 회색 시험),
제목 한 줄(무엇이·언제·어떻게 됐나), 쉬운 말 설명 몇 줄, 필요하면 '해야 할 일'과 원문 오류.
읽는 사람이 상태 머신 이름이나 내부 용어(그림자, placeholder…)를 몰라도 무슨 일인지 알 수 있어야 한다.

받는 것
  * Step Functions 실행 상태 변경 (EventBridge 규칙 `novelflow-pipeline-failure`)
      → 실패·타임아웃·중단. **멘션한다 — 시험 실행(입력에 `dry_run`/`test_mode`)도.** 시험 실패는 대개 운영도 같은 코드라
        같은 오류가 난다는 뜻이다(2026-10-04 시험 실패 멘션이 파서 이미지 배포 버그를 자정 전에 잡았다). 카드는 회색·시험 표시.
  * CloudWatch 알람 상태 변경 (EventBridge 규칙 `novelflow-alarm-state`)
      → ALARM 이면 멘션, ALARM 에서 OK 로 풀리면 멘션 없이. 알람을 만들 때 생기는
        INSUFFICIENT_DATA → OK 같은 전환은 소식이 아니므로 보내지 않는다.
  * 구조화된 알림 — 파이프라인이 직접 invoke:
        {"notice": {"level": "warn", "pipeline": "2026 공모전", "date": "2026-10-03",
                    "title": "자정 수집 — 저장함, 확인할 점 있음",
                    "lines": ["끝내 받지 못한 **3편**은 …"], "fields": [{"name": "…", "value": "…"}],
                    "errors": [{"label": "첫 시도에서 난 오류", "error": "States.TaskFailed", "cause": "원문(Lambda 오류 JSON 이면 메시지만 보여 줌)"}],
                    "action": "…", "test": false, "run": "실행 이름"},
         "mention": false}
      level: fail(빨강) · warn(주황) · info(파랑) · ok(초록). test 면 회색 + 시험 표시, 멘션하지 않는다(파이프라인 상태 알림).
      알림 형식이 잘못돼 카드를 못 만들면 내용을 JSON 텍스트로라도 보낸다.
      (옛 상태 머신이 `content` 에 이 dict 를 넣어 보내도 같은 것으로 받는다.)
  * 일반 텍스트 — 직접 invoke 하거나 앞으로 붙일 자동화(CI/CD 등)용:
        {"content": "배포 완료: crawler 1.5.0", "mention": false}

멘션은 `allowed_mentions` 로 **지정한 사용자 한 명만** 허용한다. 실패 원인(cause) 같은
외부 텍스트에 `@everyone` 이 섞여 있어도 아무도 불리지 않는다. 카드 안의 멘션은 울리지 않으므로 멘션은 본문(content)에 둔다.

Discord 전송이 실패하면 예외를 올린다 — EventBridge 가 비동기 호출을 재시도한다.
카드가 형식 오류(400)로 거절되면 같은 내용을 텍스트로 한 번 더 보낸다(알림이 사라지지 않게).
"""

import json
import os
import re
import urllib.error
import urllib.parse
import urllib.request
from datetime import date as _date, datetime, timezone, timedelta

WEBHOOK_URL = os.environ.get('DISCORD_WEBHOOK_URL')
MENTION_USER_ID = os.environ.get('DISCORD_MENTION_USER_ID', '')
REGION = os.environ.get('AWS_REGION', 'ap-northeast-2')
KST = timezone(timedelta(hours=9))

# 배포된 이름은 옛 프로젝트명(NpTrend*)이라 화면에는 뜻으로 보여 준다.
# (이름, 기록 날짜 = 실행 시작 KST 에서 몇 시간 전의 날짜인가)
PIPELINES = {
    'NpTrendCrawlerWorkflow': ('데일리 랭킹', 0),                 # 21:00 실행, 그날 날짜
    'NpTrendContestDataPipelineMainWorkflow': ('2025 공모전', 0),
    'NovelFlowContest2026DMapWorkflow': ('2026 공모전', 12),     # 00:00 실행, 방금 끝난 날
}

LEVELS = {   # 색, 제목 앞 기호
    'fail': (0xE5484D, '🚨'),
    'warn': (0xF5A524, '⚠️'),
    'info': (0x3E7BFA, 'ℹ️'),
    'ok': (0x30A46C, '✅'),
}
TEST_COLOR = 0x8B8D98
TEST_BANNER = "**🧪 시험 실행** — 실제로는 아무것도 저장하지 않았습니다. 아래는 '실제였다면'의 결과입니다."
TEST_FAIL_BANNER = "**🧪 시험 실행이 실패했습니다** — 운영 데이터는 바뀌지 않았지만, 운영 실행도 같은 코드를 쓰면 같은 오류가 납니다."

# Discord 상한: 본문 2000, 제목 256, 설명 4096, 필드 이름 256 · 값 1024, 필드 25개, 카드 전체 6000.
MAX_CONTENT = 2000
MAX_CAUSE = 700
WEEKDAYS = '월화수목금토일'

# 실행 실패의 오류 이름 → (무슨 일인지, 해야 할 일). 해야 할 일의 {date} 는 기록 날짜.
ERROR_HELP = {
    'LateRefetchRefused': ("정해진 수집 시간(자정 ~ 01:00)이 지나 시작한 시도라 노벨피아에서 받지 않고 거절했습니다. "
                           "늦게 받은 값은 다른 날과 비교할 수 없어서, 그날은 비워 두는 것이 정책입니다.",
                           "할 일 없음. 단, 자정 실행이 받기를 끝내고 저장만 실패했던 날이면 저장된 원본으로 다시 계산할 수 있습니다: "
                           "`{{\"reprocess\": true, \"target_date\": \"{date}\"}}`"),
    'LateRunRefused': ("받기를 시작하려던 시각이 22:00 을 넘겨(실행 시작이 아니라 이번 시도·받기 직전 기준 — 자동 재시도나 대기로 늦어진 경우 포함) "
                       "노벨피아에서 받지 않고 거절했습니다. "
                       "늦게 받은 값은 다른 날과 비교할 수 없어서, 그날은 비워 두는 것이 정책입니다.", "할 일 없음."),
    'TooManyMissing': ("재시도까지 했는데도 받지 못한 작품이 5%를 넘어서, 반쪽짜리 하루를 저장하지 않았습니다.", None),
    'ReprocessNoRaw': ("저장된 원본 HTML 이 없어 다시 계산할 수 없습니다.", "할 일 없음 — 그날은 복구할 재료가 없습니다."),
    'ReprocessIncomplete': ("저장된 원본에 그날 작품이 다 있지 않아(받기가 중간에 끊긴 날) 다시 계산한 값을 저장하지 않았습니다.",
                            "할 일 없음 — 반쪽 하루를 완전한 날로 저장하지 않도록 그날은 비워 둡니다."),
    'ReprocessBatchFailed': ("원본으로 다시 계산하는 중 일부 묶음이 실패했습니다.", "같은 입력으로 다시 실행하세요(마감 없음)."),
    'Runtime.ImportModuleError': ("배포된 코드가 시작하자마자 실패합니다(필요한 파일·모듈이 이미지에 없음). 배포 문제입니다.",
                                  "최근에 올린 Lambda 코드·이미지를 확인하고 다시 배포하세요."),
    'States.Timeout': ("실행이 제한 시간을 넘겨 멈췄습니다.", None),
    'States.ExceedToleratedFailureThreshold': ("병렬로 받던 작업 중 실패가 허용치를 넘었습니다.", None),
    'TimeoutError': ("결과를 모으다가 제한 시간을 넘겼습니다.", None),
    'InjectedAttemptFailure': ("시험용으로 일부러 낸 실패입니다.", None),
    'TestInducedFailure': ("시험용으로 일부러 낸 실패입니다.", None),
}
# 같은 오류 이름이라도 경우가 갈리는 것 — (오류 이름, 메시지에 든 문구) → (무슨 일인지, 해야 할 일). ERROR_HELP 보다 먼저 본다.
ERROR_CASES = [
    ('LateRefetchRefused', '이릅니다',
     "자정 수집 시간(23:55 ~ 01:00)보다 일찍 시작해 노벨피아에서 받기 전에 거절했습니다. 입력 없이 돌린 실행이면 거절 전에 그 날짜의 "
     "날짜 잠금을 이미 잡았으므로, **다음 자정 예약 실행이 '중복'으로 건너뛰어집니다.**",
     "자정 전에 잠금 항목을 지우세요: `NovelFlowContest2026` 테이블 ID=`RUN_LOCK#{date}`, Date=`LOCK`. "
     "시험이었다면 다음부터 `\"dry_run\": true` 로 돌리세요."),
    ('ReprocessIncomplete', '읽을 수 없어',
     "저장된 원본 묶음 일부를 읽지 못해, 그 안의 작품을 몰라 다시 계산한 값을 저장하지 않았습니다.",
     "`accept_partial` 로도 넘어가지 않습니다. 로그의 묶음 키로 원본 파일을 확인하세요."),
    ('ReprocessIncomplete', '기대 목록',
     "그날 자정 실행의 기대 목록이 없어, 원본이 그날 작품을 다 덮는지 알 수 없어 저장하지 않았습니다.",
     "원본에 든 작품 수가 그날 전부라고 확인했다면 입력에 `\"accept_partial\": true` 를 더해 다시 실행하세요."),
]
# 이름만으로 모를 때(ValueError 등) 메시지 문구로 짐작한다.
MESSAGE_HELP = [
    (r'Quality gate', "저장 전 품질 검사에 걸려 저장하지 않았습니다(빈 값·조회수 감소 등이 기준을 넘음)."),
    (r'Expected \d+ novels, but found', "노벨피아 랭킹 목록의 작품 수가 기대와 달랐습니다."),
    (r'Failed to fetch novel list', "노벨피아 랭킹 목록을 받지 못했습니다."),
    (r'adult', "로그인·성인 모드를 확인하지 못했습니다."),
    (r'Credentials not found', "노벨피아 로그인 정보(Parameter Store)를 읽지 못했습니다."),
    (r'still missing after retries', "재시도까지 했는데도 받지 못한 작품이 너무 많았습니다."),
]
# 파이프라인별 기본 '해야 할 일' — 오류별 안내가 없을 때.
DEFAULT_ACTION = {
    '데일리 랭킹': "22:00 전이면 입력에서 `scheduled` 를 빼고 수동 실행해 다시 받을 수 있습니다. 22:00 이 지났으면 그날은 비워 둡니다.",
    '2026 공모전': ("자정 + 1시간(01:00) 전이면 `{{\"target_date\": \"{date}\"}}` 로 다시 받을 수 있습니다. 그 뒤라면, 받기가 끝난 날에 한해 "
                   "저장된 원본으로 다시 계산합니다: `{{\"reprocess\": true, \"target_date\": \"{date}\"}}` (먼저 `\"dry_run\": true` 로 확인)."),
    '2025 공모전': "실행 기록 링크에서 실패한 단계를 확인하세요.",
}
REPROCESS_ACTION = "같은 입력으로 다시 실행하세요(원본 재계산은 마감이 없습니다). 먼저 `\"dry_run\": true` 로 확인하세요."

ALARMS = {   # 알람 이름 → (짧은 제목, 무슨 일인지, 해야 할 일)
    'novelflow-daily-no-success-26h': ('데일리 수집이 하루 넘게 성공 없음', "데일리 랭킹 수집이 26시간 넘게 한 번도 성공하지 않았습니다(실행 자체가 없었을 수도 있습니다).",
                                       "스케줄러 `run-np-trend-crawler-daily` 가 켜져 있는지, 최근 실행이 실패했는지 확인하세요."),
    'novelflow-contest-no-success-26h': ('2025 공모전 수집이 하루 넘게 성공 없음', "2025 공모전 수집이 26시간 넘게 한 번도 성공하지 않았습니다(실행 자체가 없었을 수도 있습니다).",
                                         "스케줄 `RunContestDataPipelineDaily` 와 최근 실행을 확인하세요."),
    'np-trend-crawler-dlq-alarm': ('데일리 예약 실행이 시작되지 못함', "스케줄러 `run-np-trend-crawler-daily` 가 데일리 상태 머신을 시작하지 못해 "
                                   "실패 보관함(DLQ)에 남겼습니다. 그날 데일리 수집이 아예 돌지 않았을 수 있습니다.",
                                   "DLQ `np-trend-crawler-dlq` 메시지의 오류(권한·대상 없음 등)를 확인하고, 22:00 전이면 입력에서 `scheduled` 를 빼고 수동 실행하세요."),
    'novelflow-contest-2026-no-success-26h': ('2026 공모전 자정 수집이 하루 넘게 성공 없음', "2026 공모전 자정 수집이 26시간 넘게 한 번도 성공하지 않았습니다(실행 자체가 없었을 수도 있습니다).",
                                              "스케줄 `NovelFlowContest2026Daily` 가 켜져 있는지, 최근 자정 실행이 실패·거절됐는지 확인하세요. "
                                              "받기가 끝난 날이면 원본 재계산으로 살릴 수 있습니다."),
    'novelflow-contest-2026-collector-errors': ('2026 공모전 번호 수집기 오류', "2026 공모전 참가작 번호 수집기(11:30·23:30 준비 실행 또는 자정)가 오류를 냈습니다.",
                                                "한 번이면 다음 실행이 이어받습니다. 반복되면 로그 `/aws/lambda/novelflow-contest-2026-id-collector` 를 확인하세요."),
    'novelflow-daily-ingestion-errors': ('데일리 DB 적재 오류', "데일리 결과를 DB 에 넣는 단계(적재)가 오류를 냈습니다. 수집은 성공했어도 그날 랭킹이 사이트에 안 보일 수 있습니다.",
                                         "사이트에서 그날 랭킹이 보이는지 확인하세요. 로그 `/aws/lambda/np-trend-data-ingestion`."),
}


def _kst(value):
    """epoch ms 또는 ISO 문자열 → datetime(KST). 읽지 못하면 None."""
    try:
        if isinstance(value, (int, float)):
            dt = datetime.fromtimestamp(value / 1000, tz=timezone.utc)
        else:
            dt = datetime.fromisoformat(str(value).replace('Z', '+00:00'))
        return dt.astimezone(KST)
    except (TypeError, ValueError):
        return None


def _when(value):
    dt = _kst(value)
    return f"{dt.month}월 {dt.day}일 {dt:%H:%M}" if dt else str(value)


def date_label(iso):
    """'2026-10-03' → '10월 3일(토)'. 읽지 못하면 원문."""
    try:
        d = _date.fromisoformat(str(iso))
        return f"{d.month}월 {d.day}일({WEEKDAYS[d.weekday()]})"
    except ValueError:
        return str(iso)


def _clip(text, limit):
    text = str(text)
    return text if len(text) <= limit else text[:limit - 1] + '…'


def _quote(text, limit):
    return _clip('\n'.join('> ' + line for line in _clip(text, limit).splitlines() or ['']), 1024)


def _console_link(arn):
    return f"https://{REGION}.console.aws.amazon.com/states/home?region={REGION}#/v2/executions/details/{arn}"


_ERROR_MESSAGE = re.compile(r'\{"errorMessage":\s*("(?:[^"\\]|\\.)*")')


def _error_message(cause):
    """Lambda 오류 Cause 는 {"errorMessage", "errorType", "stackTrace"} JSON 문자열이다 — 메시지만 꺼낸다.

    상태 머신이 여러 시도의 오류를 이어 붙인 문장 안에 그 JSON 이 끼어 있어도(데일리 CrawlFail) 그 자리를 메시지로 바꾼다.
    """
    if not cause:
        return ''
    text, out, i = str(cause), [], 0
    decoder = json.JSONDecoder()
    while True:
        j = text.find('{"errorMessage"', i)
        if j < 0:
            out.append(text[i:])
            break
        try:
            obj, end = decoder.raw_decode(text, j)
        except ValueError:
            # 상태 머신이 길이를 잘라 JSON 이 끝나지 않았다 — 메시지 문자열만 꺼내고, 다음 시도 구간(' / ')부터 다시 본다.
            m = _ERROR_MESSAGE.match(text, j)
            if not m:
                out.append(text[i:])
                break
            out.append(text[i:j] + json.loads(m.group(1)))
            k = text.find(' / ', m.end())
            i = k if k >= 0 else len(text)
            continue
        out.append(text[i:j] + str(obj.get('errorMessage', '')) if isinstance(obj, dict) else text[i:end])
        i = end
    return ''.join(out)


def _explain(error, message):
    for name, needle, text, action in ERROR_CASES:
        if error == name and needle in (message or ''):
            return text, action
    help_ = ERROR_HELP.get(error)
    if help_:
        return help_
    for pattern, text in MESSAGE_HELP:
        if re.search(pattern, message or '', re.IGNORECASE):
            return text, None
    return None, None


# ---------------------------------------------------------------- 카드 만들기

def build_embed(notice):
    """구조화된 알림 → Discord embed dict."""
    level = notice.get('level') if notice.get('level') in LEVELS else 'info'
    color, mark = LEVELS[level]
    test = bool(notice.get('test'))
    head = ' · '.join(x for x in (notice.get('pipeline'), date_label(notice['date']) if notice.get('date') else None,
                                   notice.get('title')) if x)
    title = f"{'🧪 시험 · ' if test else mark + ' '}{head}"
    desc = []
    if test:
        desc += [TEST_FAIL_BANNER if level == 'fail' else TEST_BANNER, '']
    lines = notice.get('lines') or []
    desc += [f"• {line}" for line in ([lines] if isinstance(lines, str) else lines)]
    embed = {'title': _clip(title, 256), 'color': TEST_COLOR if test else color,
             'timestamp': datetime.now(timezone.utc).isoformat()}
    if desc:
        embed['description'] = _clip('\n'.join(desc), 4000)
    fields = [{'name': _clip(f['name'], 256), 'value': _clip(f['value'], 1024)}
              for f in notice.get('fields') or [] if f.get('name') and f.get('value')]
    for e in notice.get('errors') or []:   # 원문 오류 — Lambda 오류 JSON 이면 메시지만
        name = f"{e.get('label') or '오류'}" + (f" `{e['error']}`" if e.get('error') else '')
        fields.append({'name': _clip(name, 256), 'value': _quote(_error_message(e.get('cause')) or '(원인 문구 없음)', MAX_CAUSE)})
    if notice.get('action'):
        fields.append({'name': '👉 해야 할 일', 'value': _clip(notice['action'], 1024)})
    if fields:
        embed['fields'] = fields[:25]
    if notice.get('link'):
        embed['url'] = notice['link']
    if notice.get('run'):
        embed['footer'] = {'text': _clip(f"실행 {notice['run']}", 2048)}
    # 카드 전체 6000자 — 넘으면 설명부터 줄인다.
    total = sum(len(str(embed.get(k, ''))) for k in ('title', 'description')) + sum(len(f['name']) + len(f['value']) for f in fields)
    if total > 5800 and embed.get('description'):
        embed['description'] = _clip(embed['description'], max(200, len(embed['description']) - (total - 5800)))
    return embed


def embed_as_text(embed):
    """카드가 거절됐을 때 보낼 텍스트판."""
    parts = [f"**{embed.get('title', '')}**"]
    if embed.get('description'):
        parts.append(embed['description'])
    for f in embed.get('fields') or []:
        parts.append(f"**{f['name']}**\n{f['value']}")
    if embed.get('url') and embed['url'] not in embed.get('description', ''):   # 설명에 이미 링크가 있으면 다시 붙이지 않는다
        parts.append(embed['url'])
    return '\n'.join(parts)


def _format_execution(event):
    d = event.get('detail', {})
    sm_name = str(d.get('stateMachineArn', '')).rsplit(':', 1)[-1]
    pipeline, back_hours = PIPELINES.get(sm_name, (sm_name, 0))
    try:
        inp = json.loads(d.get('input') or '{}') or {}
    except (TypeError, ValueError):
        inp = {}
    inp = inp if isinstance(inp, dict) else {}
    test = bool(inp.get('dry_run') or inp.get('test_mode'))
    started = _kst(d.get('startDate'))
    run_date = inp.get('target_date') or (started and (started - timedelta(hours=back_hours)).date().isoformat())

    status = {'FAILED': '실패', 'TIMED_OUT': '제한 시간 초과로 중단', 'ABORTED': '수동으로 중단됨'}.get(d.get('status'), d.get('status'))
    what = '원본 재계산' if inp.get('reprocess') else ('수집' if pipeline != sm_name else '실행')
    error = d.get('error') or ''
    message = _error_message(d.get('cause'))
    explain, action = _explain(error, message)
    if not action and not test and d.get('status') != 'ABORTED':
        action = REPROCESS_ACTION if inp.get('reprocess') else DEFAULT_ACTION.get(pipeline)
    lines = [explain] if explain else []
    lines.append(f"시작 {_when(d.get('startDate'))} · [실행 기록 보기]({_console_link(d.get('executionArn', ''))})")
    fields = []
    if error or message:
        fields.append({'name': f"오류 `{error}`" if error else '오류', 'value': _quote(message or '(원인 문구 없음)', MAX_CAUSE)})
    notice = {
        'level': 'fail', 'pipeline': pipeline, 'date': run_date, 'title': f"{what} {status}",
        'lines': lines, 'fields': fields, 'action': action and action.format(date=run_date),
        'test': test, 'run': d.get('name'), 'link': _console_link(d.get('executionArn', '')),
    }
    return notice, True   # 시험 실패도 멘션한다(머리말)


def _format_alarm(event):
    d = event.get('detail', {})
    name = d.get('alarmName', '?')
    state = (d.get('state') or {}).get('value')
    previous = (d.get('previousState') or {}).get('value')
    link = (f"https://{REGION}.console.aws.amazon.com/cloudwatch/home?region={REGION}"
            f"#alarmsV2:alarm/{urllib.parse.quote(name)}")
    short, explain, action = ALARMS.get(name, (name, (d.get('configuration') or {}).get('description') or '', None))

    if state == 'ALARM':
        reason = (d.get('state') or {}).get('reason') or ''
        notice = {'level': 'fail', 'pipeline': '경보', 'title': short,
                  'lines': [x for x in (explain, f"[알람 보기]({link})") if x],
                  'fields': [{'name': f"알람 `{name}`", 'value': _quote(reason, MAX_CAUSE)}] if reason else [],
                  'action': action, 'link': link}
        return notice, True
    if state == 'OK' and previous == 'ALARM':
        notice = {'level': 'ok', 'pipeline': '경보 해제', 'title': short,
                  'lines': [(f"한동안 새 오류가 없어 알람이 자동으로 풀렸습니다 ({_when(event.get('time'))}). 앞서 실패한 일이 "
                             "복구됐다는 뜻은 아닙니다 — 그날 데이터를 확인하세요." if name.endswith('-errors') else
                             f"`{name}` 이(가) 정상으로 돌아왔습니다 ({_when(event.get('time'))})."), f"[알람 보기]({link})"],
                  'link': link}
        return notice, False
    return None, False   # 생성 직후 INSUFFICIENT_DATA ↔ OK 등은 보내지 않는다


def build_message(event):
    """이벤트 → (알림, 멘션 여부). 알림은 dict(카드로 보냄) 또는 str(텍스트). 보낼 것이 없으면 None."""
    source = event.get('source')
    detail_type = event.get('detail-type')
    if source == 'aws.states' and detail_type == 'Step Functions Execution Status Change':
        return _format_execution(event)
    if source == 'aws.cloudwatch' and detail_type == 'CloudWatch Alarm State Change':
        return _format_alarm(event)
    body = event.get('notice', event.get('content'))
    if isinstance(body, dict):   # 구조화된 알림(옛 상태 머신은 content 에 넣어 보낸다)
        return body, bool(event.get('mention', False)) and not body.get('test')
    if 'content' in event:
        return str(event['content']), bool(event.get('mention', False))
    raise ValueError(f"Unsupported event: source={source!r} detail-type={detail_type!r}")


# ---------------------------------------------------------------- 보내기

def _send(payload):
    req = urllib.request.Request(
        WEBHOOK_URL, data=json.dumps(payload).encode('utf-8'), method='POST',
        # 기본 UA(Python-urllib)는 Discord 앞단에서 거절될 수 있다.
        headers={'Content-Type': 'application/json', 'User-Agent': 'NovelFlow-Notify/1.1'},
    )
    with urllib.request.urlopen(req, timeout=5) as resp:
        return resp.status


def post(message, mention):
    if not WEBHOOK_URL:
        raise RuntimeError("DISCORD_WEBHOOK_URL is not set")
    ping = f"<@{MENTION_USER_ID}>" if mention and MENTION_USER_ID else ''
    base = {'username': 'NovelFlow',
            'allowed_mentions': {'parse': [], 'users': [MENTION_USER_ID] if ping else []}}
    embed = None
    if isinstance(message, dict):
        try:
            embed = build_embed(message)
        except Exception as e:  # noqa: BLE001 — 형식이 잘못된 알림이라도 내용은 보낸다
            print(json.dumps({"bad_notice": repr(e)[:300]}, ensure_ascii=False))
            message = json.dumps(message, ensure_ascii=False, default=str)
    if embed is not None:
        payload = {**base, 'embeds': [embed]}
        if ping:
            payload['content'] = f"{ping} 확인이 필요합니다"
    else:
        payload = {**base, 'content': _clip(f"{ping} {message}".strip(), MAX_CONTENT)}
    try:
        return _send(payload)
    except urllib.error.HTTPError as e:
        detail = e.read()[:300]
        if embed is not None and e.code == 400:   # 카드 형식 오류 — 같은 내용을 텍스트로
            print(json.dumps({"embed_rejected": True, "detail": detail.decode('utf-8', 'replace')}, ensure_ascii=False))
            try:
                return _send({**base, 'content': _clip(f"{ping} {embed_as_text(embed)}".strip(), MAX_CONTENT)})
            except urllib.error.HTTPError as e2:
                raise RuntimeError(f"Discord webhook returned {e2.code}: {e2.read()[:300]!r}") from None
        # 본문에 토큰이 나오지 않는다. URL 은 로그에 남기지 않는다.
        raise RuntimeError(f"Discord webhook returned {e.code}: {detail!r}") from None


def handler(event, context):
    message, mention = build_message(event)
    if message is None:
        print(json.dumps({"skipped": True, "source": event.get('source'),
                          "detail-type": event.get('detail-type')}, ensure_ascii=False))
        return {"sent": False}
    status = post(message, mention)
    print(json.dumps({"sent": True, "status": status, "mention": mention, "card": isinstance(message, dict),
                      "source": event.get('source', 'direct')}, ensure_ascii=False))
    return {"sent": True, "status": status}
