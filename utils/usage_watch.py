"""정해진 사용 한도가 있는 것들을 하루 한 번 재고, 한도의 50% 를 넘거나 월말 전망이 한도를 넘으면 Discord 로 알린다(2026-10-18).

익명 사용자에게 사이트를 열면 비용 상한 장치(한도)가 곧 '사이트가 멈추는 스위치'가 된다 — 한도에 닿기 전에 알아야 조정할 수 있다.
  * API Gateway 사용량 계획(월 1만 건 — 비용 상한으로 일부러 둔 값, 넘으면 그달 API 가 429)
  * CloudFront 정액 Free 요금제(월 요청 100만 · 전송 100GB — 넘어도 요금은 없지만 계속 넘으면 전송 성능이 조정된다)
  * Algolia 무료 요금제(검색 요청 월 1만 · 레코드 5만 — 2026-08 에 레코드 100만 → 5만으로 줄었다). 사용량 조회 권한(usage ACL)이 있는
    키가 SSM `ALGOLIA_USAGE_KEY_PARAM` 에 있어야 잰다 — 색인 갱신용 키에는 그 권한이 없다.
  * AWS 프리 티어 항목 중 월말 전망이 한도의 80% 를 넘는 것(Step Functions 상태 전이 등) — 참고로만 싣는다. 넘어도 서비스는
    멈추지 않고 소액이 청구될 뿐이라(Step Functions 는 이미 매달 넘는다) 그것만으로 알림을 보내지 않는다.

알림은 문제가 있는 날에만 보낸다. 월요일에는 조용해도 한 번 요약을 보낸다(감시가 살아 있다는 신호).
"""
import calendar
import json
import os
import urllib.request
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone

KST = timezone(timedelta(hours=9))
NOTIFY_FUNCTION = os.environ.get('NOTIFY_FUNCTION', 'novelflow-discord-notify')
API_USAGE_PLAN_ID = os.environ.get('API_USAGE_PLAN_ID', '0gtgam')
CF_DISTRIBUTION_ID = os.environ.get('CF_DISTRIBUTION_ID', 'E1PP4QRS4HH998')
CF_PLAN_REQUESTS = int(os.environ.get('CF_PLAN_REQUESTS', '1000000'))
CF_PLAN_BYTES = int(os.environ.get('CF_PLAN_BYTES', str(100 * 10**9)))
ALGOLIA_APP_ID = os.environ.get('ALGOLIA_APP_ID', '')
ALGOLIA_USAGE_KEY_PARAM = os.environ.get('ALGOLIA_USAGE_KEY_PARAM', '/NovelFlow/ALGOLIA_USAGE_API_KEY')
ALGOLIA_SEARCH_LIMIT = int(os.environ.get('ALGOLIA_SEARCH_LIMIT', '10000'))
ALGOLIA_RECORD_LIMIT = int(os.environ.get('ALGOLIA_RECORD_LIMIT', '50000'))
FREE_TIER_WARN = 0.8


@dataclass
class Meter:
    name: str
    used: float
    limit: float
    unit: str
    projected: float | None = None   # 월말 전망(누적형만 — 레코드 수처럼 쌓인 값은 None)
    note: str = ''
    soft: bool = False   # 넘어도 서비스는 멈추지 않고 소액 청구만(프리 티어) — 목록에는 보이되 그것만으로 알리지 않는다


def project(used: float, today: date) -> float:
    """월초부터 오늘까지 쓴 양을 그 속도 그대로 월말까지 늘린 값."""
    days = calendar.monthrange(today.year, today.month)[1]
    return used / max(today.day, 1) * days


def level_of(m: Meter) -> str | None:
    if m.soft:
        return None
    pct = m.used / m.limit if m.limit else 0
    proj = (m.projected or 0) / m.limit if m.limit else 0
    if pct >= 1:
        return 'fail'
    if pct >= 0.8 or proj >= 1:
        return 'warn'
    if pct >= 0.5:
        return 'info'
    return None


def _fmt(v: float, unit: str) -> str:
    if unit == 'GB':
        return f'{v / 10**9:,.1f}GB'
    return f'{v:,.0f}{unit}'


def build_notice(meters: list[Meter], today: date, weekly: bool) -> dict | None:
    rank = {'fail': 3, 'warn': 2, 'info': 1, None: 0}
    levels = [level_of(m) for m in meters]
    worst = max(levels, key=lambda lv: rank[lv])
    if worst is None and not weekly:
        return None
    lines = []
    for m, lv in sorted(zip(meters, levels), key=lambda x: -rank[x[1]]):
        mark = {'fail': '🔴', 'warn': '🟠', 'info': '🔵', None: '⚪'}[lv]
        proj = f' · 월말 전망 {_fmt(m.projected, m.unit)}({m.projected / m.limit:.0%})' if m.projected is not None and m.limit else ''
        lines.append(f'{mark} **{m.name}** {_fmt(m.used, m.unit)} / {_fmt(m.limit, m.unit)} ({m.used / m.limit:.0%}){proj}'
                     + (f' — {m.note}' if m.note else ''))
    title = {'fail': '사용 한도에 닿았습니다', 'warn': '사용 한도에 가까워지고 있습니다', 'info': '사용량이 한도의 절반을 넘었습니다',
             None: '주간 사용량 요약 — 모두 여유 있음'}[worst]
    return {'level': worst or 'ok', 'pipeline': '사용 한도 감시', 'date': today.isoformat(), 'title': title, 'lines': lines,
            'action': '추세를 보고 한도(API Gateway 사용량 계획 · CloudFront 요금제 · Algolia 요금제)를 조정하세요.' if rank[worst] >= 2 else ''}


# ── 재는 부분(AWS · Algolia 호출) ────────────────────────────────────────────

def _month_start(today: date) -> date:
    return today.replace(day=1)


def api_gateway(today: date) -> list[Meter]:
    import boto3
    ag = boto3.client('apigateway')
    plan = ag.get_usage_plan(usagePlanId=API_USAGE_PLAN_ID)
    limit = (plan.get('quota') or {}).get('limit')
    usage = ag.get_usage(usagePlanId=API_USAGE_PLAN_ID, startDate=_month_start(today).isoformat(), endDate=today.isoformat())
    used = sum(day[0] for days in usage.get('items', {}).values() for day in days)
    return [Meter('API Gateway 월 한도', used, limit, '건', project(used, today), '넘으면 그달 API 가 429')] if limit else []


def cloudfront(today: date) -> list[Meter]:
    import boto3
    cw = boto3.client('cloudwatch', region_name='us-east-1')
    start = datetime.combine(_month_start(today), datetime.min.time(), tzinfo=timezone.utc)
    end = datetime.now(timezone.utc)
    q = lambda i, metric: {'Id': i, 'MetricStat': {'Metric': {'Namespace': 'AWS/CloudFront', 'MetricName': metric,
        'Dimensions': [{'Name': 'DistributionId', 'Value': CF_DISTRIBUTION_ID}, {'Name': 'Region', 'Value': 'Global'}]},
        'Period': 86400, 'Stat': 'Sum'}}
    r = cw.get_metric_data(MetricDataQueries=[q('req', 'Requests'), q('bytes', 'BytesDownloaded')], StartTime=start, EndTime=end)
    total = {x['Id']: sum(x['Values']) for x in r['MetricDataResults']}
    return [Meter('CloudFront 요청(Free 요금제)', total.get('req', 0), CF_PLAN_REQUESTS, '건', project(total.get('req', 0), today), '넘어도 요금 없음 · 계속 넘으면 성능 조정'),
            Meter('CloudFront 전송(Free 요금제)', total.get('bytes', 0), CF_PLAN_BYTES, 'GB', project(total.get('bytes', 0), today))]


def algolia(today: date) -> list[Meter]:
    import boto3
    if not ALGOLIA_APP_ID:
        return []
    try:
        key = boto3.client('ssm').get_parameter(Name=ALGOLIA_USAGE_KEY_PARAM, WithDecryption=True)['Parameter']['Value']
    except Exception:
        return [Meter('Algolia', 0, 1, '', note='사용량 조회 키가 없어 재지 못함(SSM ' + ALGOLIA_USAGE_KEY_PARAM + ')')]

    def stat(name: str) -> list:
        url = (f'https://usage.algolia.com/1/usage/{name}?granularity=daily'
               f'&startDate={_month_start(today).isoformat()}T00:00:00Z&endDate={today.isoformat()}T23:59:59Z')
        req = urllib.request.Request(url, headers={'X-Algolia-Application-Id': ALGOLIA_APP_ID, 'X-Algolia-API-Key': key})
        with urllib.request.urlopen(req, timeout=20) as resp:
            return json.loads(resp.read()).get(name, [])

    out = []
    searches = sum(p.get('v') or 0 for p in stat('total_search_requests'))
    out.append(Meter('Algolia 검색 요청', searches, ALGOLIA_SEARCH_LIMIT, '건', project(searches, today), '넘으면 검색이 멈출 수 있음'))
    records = [p.get('v') or 0 for p in stat('records')]
    if records:
        out.append(Meter('Algolia 레코드', records[-1], ALGOLIA_RECORD_LIMIT, '개'))
    return out


def free_tier() -> list[Meter]:
    import boto3
    ft = boto3.client('freetier', region_name='us-east-1')
    out, token = [], None
    while True:
        r = ft.get_free_tier_usage(**({'nextToken': token} if token else {}))
        for u in r.get('freeTierUsages', []):
            limit, used, fc = u.get('limit') or 0, u.get('actualUsageAmount') or 0, u.get('forecastedUsageAmount') or 0
            if limit and max(used, fc) >= FREE_TIER_WARN * limit:
                out.append(Meter(f"프리 티어 · {u.get('service')} {u.get('usageType')}", used, limit, f" {u.get('unit', '')}", fc,
                                 '넘는 만큼 소액 종량 청구(참고)', soft=True))
        token = r.get('nextToken')
        if not token:
            return out


def handler(event, context):
    import boto3
    today = datetime.now(KST).date()
    meters, errors = [], []
    for name, fn in (('API Gateway', lambda: api_gateway(today)), ('CloudFront', lambda: cloudfront(today)),
                     ('Algolia', lambda: algolia(today)), ('프리 티어', free_tier)):
        try:
            meters += fn()
        except Exception as e:   # 하나를 못 재도 나머지는 알린다
            errors.append(f'{name}: {type(e).__name__}: {str(e)[:160]}')
    notice = build_notice(meters, today, weekly=today.weekday() == 0 or bool((event or {}).get('force')))
    if errors:
        notice = notice or {'level': 'warn', 'pipeline': '사용 한도 감시', 'date': today.isoformat(), 'title': '일부 사용량을 재지 못했습니다', 'lines': []}
        notice['lines'] = notice['lines'] + [f'⚠️ {e}' for e in errors]
    if notice:
        boto3.client('lambda').invoke(FunctionName=NOTIFY_FUNCTION, InvocationType='Event',
                                      Payload=json.dumps({'notice': notice, 'mention': notice['level'] == 'fail'}).encode())
    return {'meters': [m.__dict__ for m in meters], 'errors': errors, 'notified': bool(notice)}
