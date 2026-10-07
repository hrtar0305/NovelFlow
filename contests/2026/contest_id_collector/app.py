"""2026 공모전 참가작 ID 수집기.

2025(`contests/2025/contest_id_collector`)와 같은 방식 — 새 소설 번호를 차례로 열어 상세의 공모전 배지
(`p.in-badge span.b_contest2`, 2026 실측 '우주최강')로 참가작을 찾는다. 노벨피아의 참가작 목록
(`/contest_list`)은 '최신순'이 마지막 업데이트순이라 넘기는 사이 순서가 바뀌어(8쪽 240칸 중 고유 194편)
원천으로 쓰지 않는다. 참가는 새 작품 등록이므로 번호 훑기로 빠짐없이 잡힌다.

실행은 두 가지다(사용자 결정 2026-10-02 — 자정 수집이 24시간 주기에 최대한 가깝도록 자정 경로를 짧게 둔다).
- `mode: "prep"` (11:30·23:30, 스케줄러가 직접 부른다): 그때까지의 새 번호 + 일정이 된 재확인(비공개·일반작) + 새 작가의 다른 작품.
  하루 두 번이라 한 번에 받는 양이 절반쯤이다 — 노벨피아는 한 IP 의 요청을 사실상 하나씩 처리해(초당 약 1.6장) 양이 곧 시간이다.
- `mode: "midnight"` (00:00, 상태 머신 첫 단계 — 기본값): 끝 번호부터 첫 '잘못된 소설 번호'까지 + 노벨피아 표시 수와
  견주기(모자라면 끝 번호만 다시, 최대 MATCH_ROUNDS_MIDNIGHT 번) + 새 작가의 다른 작품(최대 MIDNIGHT_AUTHOR_SECONDS 초,
  실패해도 목록은 이미 써 둔다). 재확인은 하지 않는다 — 끝 번호를 다시 훑어도
  안 메워지는 차이(배지가 늦게 보인 작품 등)는 경고만 남기고 다음 준비 실행이 메운다.

2025 와 다른 점
- **상태를 S3 에 둔다.** 2025 는 SSM 이었는데 재확인 목록이 4KB 한도의 99.6%까지 찼다(백로그 #24).
- **시간 예산.** 개막일에는 8시간에 번호가 1,550개 생겼다(한 번호 0.45초 → 하루치 22분, Lambda 15분 초과).
  남은 시간이 예산 아래로 내려가면 상태를 저장하고 `done: false` 로 끝낸다 — 상태 머신이 다시 부른다.
- **끝 판정은 '잘못된 소설 번호'가 처음 나오는 순간**(사용자 결정 — 최대한 빨리 멈추고 바로 수를 확인한다). 대신 멈춘 직후
  노벨피아 표시 등록 수('총 N개 작품', 0회차까지 센 전체 — 같은 시각 실측 1,743 = 1,743)와 견주고, 모자라면 끝 번호부터
  다시 훑는다(최대 MATCH_ROUNDS 번). 중간의 일시적 이상 번호에 멈춰도 이 확인이 잡는다.
- **재확인 목록에서 번호를 지우지 않는다(2025 와 같은 의도).** 작가가 언제든 비공개로 돌렸다 풀 수 있다.
  대신 공개 일반작으로 확인된 번호는 NORMAL_RECHECK_DAYS 마다만 다시 본다(개막 직전 번호의 28%가 비공개라
  매일 전부 보면 한 달에 수천 개).
- **공개 일반작도 재확인 목록에 넣는다(2025 에 없던 것).** 개막일 20:40 훑기에서 배지 없는 일반작으로 분류된
  455833·456924 가 22:24 엔 배지가 있었다(노벨피아 표시 1,687편과의 차이 2편). **원인은 확인하지 못했다** — 일반작을
  나중에 공모전으로 바꾸는 것은 불가능하다(사용자 확인), 같은 방식으로 40번 다시 받아도 재현되지 않았다. 등록 직후
  배지가 늦게 붙는 구간이거나 그 순간 비정상 응답이었을 수 있다. 원인과 무관하게 잡히도록 생긴 지 FRESH_DAYS 안의
  번호는 매일, 그 뒤는 NORMAL_RECHECK_DAYS 마다 다시 보고, 원인을 가릴 수 있게 분류 근거(배지 칸·제목 유무)를 남긴다.
- **제목이 없는 페이지는 일반작이 아니라 '다시 볼 번호'다.** 경고창·배지가 없다는 것만으로는 정상 페이지인지 모른다.
- **작가의 다른 작품**(`/proc/novel_curation`, cmd=writer_other_novel)을 참가작을 처음 찾을 때 원본 JSON
  그대로 남긴다(작가당 1회). 기성 여부 판정은 나중에 한다(제안: 공모전 시작 번호 이전 작품이 있으면 기성).
  **이 요청만 로그인 세션으로 보낸다**(2026-10-08) — 익명 응답은 19금 작품을 통째로 뺀다(작가 2,909명의 2,072건 중 19금 0건,
  데일리에 19금 작품이 있는 참가 작가 31명이 신인으로 보였다). 쿠키는 데일리 크롤러가 매일 SSM 에 남기는 것을 빌린다.
  만료된 쿠키는 오류 없이 익명 결과를 주므로, 받기 전에 19금 작품이 있는 작가(AUTH_CANARIES)로 로그인이 살아 있는지 보고,
  아니면 그 실행은 작가를 받지 않는다(작가당 1회라 한 번 익명으로 받으면 틀린 값이 굳는다 — 미루면 화면은 '모름'이다).
  상세 훑기는 그대로 익명이다(DECISIONS 2026-07-01).
"""
import json
import logging
import os
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

import boto3
import requests
from bs4 import BeautifulSoup

logger = logging.getLogger()
logger.setLevel(logging.INFO)

S3_BUCKET = os.environ['S3_BUCKET_NAME']
YEAR = os.environ.get('CONTEST_YEAR', '2026')
START_ID = int(os.environ.get('START_ID', '455000'))
CONTEST_FIRST_ID = int(os.environ.get('CONTEST_FIRST_ID', '455325'))
WORKERS = int(os.environ.get('WORKERS', '4'))
NORMAL_RECHECK_DAYS = int(os.environ.get('NORMAL_RECHECK_DAYS', '3'))
FRESH_DAYS = int(os.environ.get('FRESH_DAYS', '7'))
BUDGET_MS = int(os.environ.get('STOP_WHEN_REMAINING_MS', '90000'))
CHUNK = 40
MATCH_ROUNDS_MIDNIGHT = int(os.environ.get('MATCH_ROUNDS_MIDNIGHT', '3'))   # 자정: 노벨피아 표시 수와 맞을 때까지 다시 훑는 최대 횟수
MIDNIGHT_AUTHOR_SECONDS = int(os.environ.get('MIDNIGHT_AUTHOR_SECONDS', '20'))  # 자정: 작가 받기에 쓸 최대 시간(밀린 몫은 준비 실행)
UPSTREAM_FAIL_STREAK = int(os.environ.get('UPSTREAM_FAIL_STREAK', str(2 * WORKERS)))  # 훑기: 노벨피아 장애로 보고 멈추는 연속 실패 수

ID_LIST_KEY = f"contest_novel_ids_{YEAR}.json"      # 팬아웃이 읽는 목록(2025 와 같은 모양: 번호 배열)
STATE_KEY = "state/progress.json"
RECHECK_KEY = "state/recheck_ids.json"
CONTEST_META_KEY = "state/contest_ids.json"        # 번호 → 처음 찾은 시각·작가
AUTHOR_INDEX_KEY = "state/author_works.json"       # 작가 → 다른 작품 번호들(적재가 작품 행에 붙인다). 받은 작가의 유일한 기록
# (예전의 state/authors_fetched.json 은 쓰지 않는다 — 두 파일이 어긋나면 작가가 색인에서 영구히 빠졌다)
AUTHOR_KEY = "authors/{}.json"
# 적재가 매일 덮어쓰는 '그날 경고창·파싱 실패로 placeholder 가 된 참가작' 번호 배열(네트워크 실패분은 넣지 않는다).
# contest 는 삭제·철회된 작품도 지우지 않는 누적이라, 노벨피아의 현재 등록 수와 견줄 때만 이것을 뺀다(없으면 빼지 않는다).
GONE_KEY = "state/gone_ids.json"
AUTH_COOKIE_PARAM = os.environ.get('AUTH_COOKIE_PARAM', '/NP-Trend/AUTH_COOKIES')   # 데일리 크롤러가 매일 21시에 쓴다
# 로그인 확인용 '작가 번호:그 작가의 참가작 번호' — 다른 작품에 19금이 있는 작가. 하나라도 19금이 보이면 로그인 세션이다.
AUTH_CANARIES = [tuple(p.split(':')) for p in os.environ.get('AUTH_CANARIES', '1097127:455819,114367:456230').split(',')]

UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Safari/537.36"
KST = ZoneInfo("Asia/Seoul")
s3 = boto3.client('s3', region_name='ap-northeast-2')


def _log(level, execution_id, message, **kw):
    logger.log(level, json.dumps({"execution_id": execution_id, "message": message, **kw}, ensure_ascii=False))


def _get(key, default):
    try:
        return json.loads(s3.get_object(Bucket=S3_BUCKET, Key=key)['Body'].read())
    except s3.exceptions.NoSuchKey:
        return default


def _put(key, obj):
    s3.put_object(Bucket=S3_BUCKET, Key=key, Body=json.dumps(obj, ensure_ascii=False).encode(), ContentType='application/json')


def _now():
    return datetime.now(KST).strftime('%Y-%m-%dT%H:%M:%S%z')


def _session():
    s = requests.Session()
    s.headers['User-Agent'] = UA
    return s


def check(session, nid):
    """('contest'|'normal'|'invalid'|'retry', info)."""
    err = ''
    for attempt in range(3):
        try:
            r = session.get(f'https://novelpia.com/novel/{nid}', timeout=15)
            r.raise_for_status()
            b = BeautifulSoup(r.text, 'html.parser')
            a = b.select_one('#alert_modal .modal-body p')
            if a:
                t = a.get_text(strip=True)
                return ('invalid', t) if '잘못된 소설 번호' in t else ('retry', t)
            if not b.select_one('div.epnew-novel-title'):
                # 경고창도 제목도 없다 — 정상 작품 페이지가 아니다(일반작으로 단정하지 않는다).
                return 'retry', f'no title (status {r.status_code}, {len(r.text)} bytes)'
            if b.select_one('p.in-badge span.b_contest2'):
                w = b.select_one('a.writer-name')
                title = b.select_one('div.epnew-novel-title')
                return 'contest', {
                    'author_id': w['href'].rstrip('/').split('/')[-1] if w else None,
                    'author': w.get_text(strip=True) if w else None,
                    'title': title.get_text(strip=True) if title else None,
                }
            # 분류 근거: 나중에 참가작으로 바뀌어 보이면 '처음 본 배지 칸'과 견줘 원인을 가린다.
            holder = b.select_one('p.in-badge')
            return 'normal', {'badges': [' '.join(c for c in (sp.get('class') or []) if c != 's_inv') for sp in holder.find_all('span')] if holder else None}
        except requests.RequestException as e:
            err = str(e)[:120]
            time.sleep(1.5 * (attempt + 1))
    return 'retry', f'request failed: {err}'


def auth_sessions(execution_id):
    """작가의 다른 작품을 받을 로그인 세션 WORKERS 개. 쿠키를 못 읽거나 카나리아에서 19금이 안 보이면 None."""
    try:
        p = boto3.client('ssm', region_name='ap-northeast-2').get_parameter(Name=AUTH_COOKIE_PARAM, WithDecryption=True)
        cookies = json.loads(p['Parameter']['Value'])
    except Exception as e:  # noqa: BLE001
        _log(logging.WARNING, execution_id, f"Auth cookies unavailable — author fetch skipped: {e}")
        return None
    out = []
    for _ in range(WORKERS):
        s = _session()
        for c in cookies:
            s.cookies.set(c['name'], c['value'], domain=c['domain'], path=c['path'])
        out.append(s)
    for aid, nno in AUTH_CANARIES:
        if any(str(x.get('novel_age')) == '19' for pg in author_works(out[0], aid, int(nno)) for x in _writer_block(pg.get('raw')).get('list') or []):
            return out
    _log(logging.WARNING, execution_id, "Login not effective (no 19+ works on canaries) — author fetch skipped.")
    return None


def _upstream_failure(kind, info):
    """노벨피아 쪽 장애로 보이는 'retry'(요청 실패·제목 없는 페이지). 경고창이 뜬 비공개 등은 정상 응답이라 아니다."""
    return kind == 'retry' and isinstance(info, str) and info.startswith(('request failed', 'no title'))


def author_works(session, author_id, novel_no):
    """작가의 다른 작품 원본 페이지. 공모전 시작 전 번호를 찾거나 다음 쪽이 없으면 멈춘다(최대 5쪽)."""
    pages = []
    for page in range(1, 6):
        try:
            r = session.get('https://novelpia.com/proc/novel_curation', params={
                'mem_no': author_id, 'novel_no': novel_no, 'page': page, 'cmd': 'writer_other_novel'},
                headers={'X-Requested-With': 'XMLHttpRequest', 'Referer': f'https://novelpia.com/novel/{novel_no}'}, timeout=15)
            d = r.json()
            pages.append({'page': page, 'raw': d})
            if not (isinstance(d, dict) and isinstance(d.get('writer_other_novel'), dict)):
                # '다른 작품 없음'의 실제 응답도 {'writer_other_novel': {'list': [], ...}} 다 — 다른 모양은 모르는 응답이다.
                raise ValueError('unexpected response shape')
            w = _writer_block(d)
            if any(n < CONTEST_FIRST_ID for n in _novel_nos(w)) or not w.get('is_next_page'):
                break
        except Exception as e:  # noqa: BLE001 — 부가 정보라 실패해도 수집을 막지 않는다(그 작가는 다음에 다시 받는다)
            pages.append({'page': page, 'error': str(e)[:120]})
            break
    return pages


def _writer_block(d):
    w = d.get('writer_other_novel') if isinstance(d, dict) else None
    return w if isinstance(w, dict) else {}


def _novel_nos(w):
    """작품 번호들 — 숫자가 아닌 값은 건너뛴다(응답 모양이 바뀌어도 수집을 막지 않게)."""
    out = []
    for x in w.get('list') or []:
        try:
            out.append(int(x['novel_no']))
        except (TypeError, KeyError, ValueError):
            pass
    return out


def listed_total(session):
    """노벨피아가 표시하는 공모전 등록 작품 수('총 N개 작품'). 우리 수집 수와 같아야 한다(2026-10-01 같은 시각 실측
    1,743 = 1,743). 목록 페이지 자체는 일부만 보여 주지만 이 숫자는 0회차 작품까지 센 전체 등록 수다. 못 읽으면 None."""
    import re
    try:
        h = session.get('https://novelpia.com/contest_list', timeout=15).text
        m = re.search(r'총\s*([\d,]+)\s*개 작품', h)
        return int(m.group(1).replace(',', '')) if m else None
    except requests.RequestException:
        return None


def summarize_author(pages):
    """원본 페이지들 → {'novels': [번호...], 'more': 다음 쪽이 남았나}. 해석(기성 여부)은 하지 않는다.

    받다가 오류가 난 쪽이 있으면 None — '다른 작품 없음'(신인)으로 잘못 굳지 않게 색인에 넣지 않고 다음에 다시 받는다.
    """
    if any('error' in p for p in pages):
        return None
    novels, more = set(), False
    for p in pages:
        w = _writer_block(p.get('raw'))
        novels |= set(_novel_nos(w))
        more = bool(w.get('is_next_page'))
    return {'novels': sorted(novels), 'more': more}


def handler(event, context):
    execution_id = event.get('execution_id', 'N/A')
    prep = event.get('mode') == 'prep'
    remaining = (lambda: context.get_remaining_time_in_millis()) if context else (lambda: 10 ** 9)
    st = _get(STATE_KEY, {'next_id': START_ID, 'last_checked_id': START_ID - 1})
    contest = _get(CONTEST_META_KEY, {})
    recheck = _get(RECHECK_KEY, {})
    gone = {str(x) for x in _get(GONE_KEY, [])}
    sess = [_session() for _ in range(WORKERS)]
    pool = ThreadPoolExecutor(WORKERS)

    def run_ids(ids):
        return list(pool.map(lambda t: check(sess[t[0] % WORKERS], t[1]), enumerate(ids)))

    new_contest = []
    aborted = None   # 마지막 훑기를 노벨피아 장애로 끊었으면 사유(끝 번호는 앞으로 밀지 않았다)
    done_scan = st.get('scan_done_at') is not None and st.get('scan_run_id') == execution_id

    def alive():
        """노벨피아 표시 수('총 N개 작품', 현재 등록 수)와 견줄 우리 쪽 수 — 누적에서 사라진 참가작을 뺀다."""
        return sum(1 for k in contest if k not in gone)

    def save():
        _put(STATE_KEY, st)
        _put(CONTEST_META_KEY, contest)
        _put(RECHECK_KEY, recheck)

    def record(i, kind, info):
        if kind == 'contest':
            contest[str(i)] = {**info, 'found_at': _now()}
            new_contest.append(i)
        elif kind == 'retry':
            recheck.setdefault(str(i), {'reason': info, 'first_seen': _now(), 'status': 'retry', 'last_checked': _now()})
        else:  # 공개 일반작 — 개막일에 배지가 늦게 보인 사례가 있어 다시 본다(원인 미확인)
            recheck.setdefault(str(i), {'reason': 'normal', 'first_seen': _now(), 'status': 'normal', 'last_checked': _now(),
                                        'last_run': execution_id, 'seen_badges': (info or {}).get('badges')})

    def scan_to_frontier():
        """다음 번호부터 '잘못된 소설 번호'가 **처음 나오는 순간** 멈춘다(사용자 결정 2026-10-01).

        한 번에 WORKERS 개씩만 동시에 요청하고 번호 순서대로 판정하므로, 끝을 넘어 나가는 요청은 최대 WORKERS−1 개다.
        중간의 일시적 이상 번호에 멈추더라도 뒤의 수량 확인이 모자람을 잡아 다시 훑게 한다. 끝까지 갔으면 True.

        노벨피아 장애(요청 실패·제목 없는 페이지)가 UPSTREAM_FAIL_STREAK 번 잇달으면 끝 번호를 그 연속의 첫 번호로 되돌리고
        멈춘다(True, `aborted`). 장애 중엔 '잘못된 소설 번호'를 못 만나 아직 없는 번호를 수백 개 지나치고, 그 구간에 나중에 등록되는
        참가작을 번호 훑기로는 영영 못 찾는다(없는 번호가 재확인 목록에 쌓이기도 한다). 그래서 연속 중인 번호는 연속이 끊길 때
        (정상 응답을 만나면) 기록하고, 저장하는 끝 번호도 연속의 첫 번호 앞까지만 둔다.
        """
        nonlocal aborted
        aborted = None
        nid, n, streak = st['next_id'], 0, []
        while remaining() > BUDGET_MS:
            ids = list(range(nid, nid + WORKERS))
            for i, (kind, info) in zip(ids, run_ids(ids)):
                if _upstream_failure(kind, info):
                    streak.append((i, kind, info))
                    if len(streak) >= UPSTREAM_FAIL_STREAK:
                        first = streak[0][0]
                        st.update(next_id=first, last_checked_id=first - 1, scan_done_at=_now(), scan_run_id=execution_id)
                        save()
                        aborted = 'upstream_unavailable'
                        _log(logging.WARNING, execution_id, "Novelpia looks unavailable — scan stopped without advancing the frontier.",
                             from_id=first, to_id=i, streak=len(streak), last_error=info)
                        return True
                    continue
                for p in streak:
                    record(*p)
                streak = []
                if kind == 'invalid':
                    st.update(next_id=i, last_checked_id=i - 1, scan_done_at=_now(), scan_run_id=execution_id)
                    save()
                    return True
                record(i, kind, info)
            nid = ids[-1] + 1
            resume = streak[0][0] if streak else nid   # 아직 기록하지 않은 연속은 다음 호출이 다시 본다
            st.update(next_id=resume, last_checked_id=resume - 1)
            n += 1
            if n % 10 == 0:
                save()
        save()
        return False

    def fetch_authors(seconds=None):
        """색인에 없는 작가의 다른 작품(작가당 1회) — 받은 작가는 다시 받지 않으므로 늘 '증가분'이다.

        - 받을 작가 = 색인에 없는 작가. 기록이 색인 하나라, 실행이 겹쳐 한쪽 쓰기가 덮여도 빠진 작가는 다음 실행이 다시
          받는다(스스로 복구). 오류가 난 작가도 색인에 넣지 않아 다음에 다시 받는다.
        - 자정에는 `seconds` 로 시간을 묶는다 — 평소엔 그 30분 사이 새 작가 몇 명이지만, 준비 실행이 실패한 날의 밀린 몫이
          자정 수집을 늦추면 안 된다. 최근 참가작의 작가부터 받는다. WORKERS 명씩 동시에.
        """
        index = _get(AUTHOR_INDEX_KEY, {})
        pending = {}
        for k, meta in sorted(contest.items(), key=lambda kv: -int(kv[0])):
            aid = meta.get('author_id')
            if aid and aid not in index and aid not in pending:
                pending[aid] = int(k)
        if not pending:
            return 0, 0, 0
        auth = auth_sessions(execution_id)
        if auth is None:
            return 0, 0, len(pending)
        deadline = time.monotonic() + seconds if seconds else None
        todo, got, failed, batches = list(pending.items()), 0, 0, 0

        while todo and remaining() > BUDGET_MS // 2 and (deadline is None or time.monotonic() < deadline):
            part, todo = todo[:WORKERS], todo[WORKERS:]
            for (aid, nno), pages in zip(part, pool.map(lambda t: author_works(auth[t[0]], t[1][0], t[1][1]), enumerate(part))):
                _put(AUTHOR_KEY.format(aid), {'author_id': aid, 'fetched_at': _now(), 'novel_no': nno, 'auth': True, 'pages': pages})
                summary = summarize_author(pages)
                if summary is None:
                    failed += 1
                    continue
                index[aid] = summary
                got += 1
            batches += 1
            if batches % 12 == 0:
                _put(AUTHOR_INDEX_KEY, index)
        _put(AUTHOR_INDEX_KEY, index)
        return got, failed, len(todo)

    # ---- 1. 새 번호. 자정이면 노벨피아 표시 수와 견주고, 모자라면 끝 번호만 다시 훑는다 ----
    if not done_scan:
        done_scan = scan_to_frontier()
    listed, rounds = None, 0
    # 노벨피아 장애로 끊긴 훑기는 몇 초 뒤 다시 훑어도 같다 — 자정 수집만 늦추므로 다시 훑지 않는다(수 부족 경고는 남는다).
    while not prep and done_scan and rounds < MATCH_ROUNDS_MIDNIGHT and remaining() > BUDGET_MS:
        rounds += 1
        listed = listed_total(sess[0])
        if listed is None or alive() >= listed or aborted:
            break
        _log(logging.INFO, execution_id, "Short of Novelpia count — rescanning the frontier.", round=rounds, ours=alive(), listed=listed)
        time.sleep(3)
        scan_to_frontier()
    if not prep:
        # 자정 경로는 여기서 끝낸다 — 재확인은 23:30 준비 실행이 맡는다. 목록을 **먼저** 쓴다: 작가 받기는 부가 정보라
        # 거기서 무엇이 터져도 그날 스냅샷을 막으면 안 된다.
        _put(ID_LIST_KEY, sorted(int(k) for k in contest))
        got = failed = authors_left = None
        if done_scan:
            try:
                got, failed, authors_left = fetch_authors(MIDNIGHT_AUTHOR_SECONDS)
            except Exception as e:  # noqa: BLE001
                _log(logging.ERROR, execution_id, f"Author fetch failed at midnight (prep run will retry): {e}")
        if listed is not None and alive() < listed:
            _log(logging.WARNING, execution_id, "Collected fewer contest novels than Novelpia lists (prep run will recheck).",
                 ours=alive(), listed=listed, short_by=listed - alive(), gone=len(contest) - alive(), rounds=rounds)
        _log(logging.INFO, execution_id, "Midnight ID pass finished.", done=done_scan, last_checked_id=st['last_checked_id'],
             total_contest=len(contest), alive_contest=alive(), new_contest=len(new_contest), listed=listed, match_rounds=rounds,
             aborted=aborted, authors_fetched=got, authors_failed=failed, authors_left=authors_left)
        # alive_contest = 노벨피아 표시 수(listed_total)와 견줄 수. total_contest 는 누적(목록 크기)이다.
        return {"done": done_scan, "total_contest": len(contest), "alive_contest": alive(), "listed_total": listed,
                "new_contest": len(new_contest), "last_checked_id": st['last_checked_id'], "aborted": aborted}

    # ---- 2. 재확인(지우지 않는다; 공개 일반작은 주기만 늘린다) ----
    today = datetime.now(KST)
    # 같은 실행 안에서 다시 불려도(예산 반복) 이번 실행에서 본 번호는 다시 보지 않는다.
    # 준비 실행은 하루 두 번(11:30·23:30)이고 **재확인은 번호 짝수/홀수로 나눠 맡는다**(짝수 = 오전 실행, 홀수 = 밤 실행) —
    # 노벨피아는 한 IP 의 요청을 사실상 하나씩 처리해(초당 약 1.6장) 양이 곧 시간이라, 23:30 의 양을 정확히 반으로 줄인다.
    # 그래서 어느 번호든 하루 한 번(자기 몫의 실행에서) 본다. 비공개·다시 볼 번호도 같다(실행마다 보면 하루 두 번이 된다).
    # 주기는 '마지막으로 본 뒤'로 잰다. 여유는 14시간이다 — 남의 슬롯(자정·반대편 준비 실행)에서 처음 기록된 번호는 같은 날
    # 자기 슬롯까지 11.5~12시간뿐이라, 여유가 작으면 첫 재확인이 다음 날(36시간 뒤)로 밀린다. 그래서 하루 주기는 10시간(자기 슬롯이
    # 하루 한 번을 보장한다 — 같은 슬롯에서 몇 시간 뒤 손으로 다시 돌려도 건너뛴다), 3일 주기는 58시간(72시간 뒤 자기 슬롯)이다.
    # 시각으로 실행을 가르므로 손으로 돌려도 같은 규칙이다.
    slot = 0 if today.hour < 18 else 1

    def is_due(k, v):
        if int(k) % 2 != slot:
            return False
        if v.get('status') != 'normal':
            gap = timedelta(days=1)
        else:
            age = today - datetime.fromisoformat(v['first_seen'])
            gap = timedelta(days=1 if age < timedelta(days=FRESH_DAYS) else NORMAL_RECHECK_DAYS)
        return today - datetime.fromisoformat(v['last_checked']) >= gap - timedelta(hours=14)

    due = [k for k, v in recheck.items() if k not in contest and v.get('last_run') != execution_id and is_due(k, v)]
    rechecked = 0
    # 훑기가 노벨피아 장애로 끊겼으면 재확인도 미룬다 — 돌리면 전부 실패한 채 '오늘 봤다'로 남아 하루를 잃는다.
    while done_scan and not aborted and due and remaining() > BUDGET_MS:
        part, due = due[:CHUNK], due[CHUNK:]
        for k, (kind, info) in zip(part, run_ids([int(x) for x in part])):
            v = recheck[k]
            v['last_checked'] = _now()
            v['last_run'] = execution_id
            if kind == 'contest':
                # 처음 본 시각·당시 분류와 함께 남겨, 배지가 언제 생겼는지 가릴 수 있게 한다.
                contest[k] = {**info, 'found_at': _now(), 'via': 'recheck', 'first_seen': v.get('first_seen'),
                              'was': v.get('status'), 'was_badges': v.get('seen_badges')}
                new_contest.append(int(k))
                v['status'] = 'contest'
            elif kind == 'normal':
                v['status'] = 'normal'
            elif kind == 'retry':
                v['status'], v['reason'] = 'retry', info
            rechecked += 1
        _put(RECHECK_KEY, recheck)
        _put(CONTEST_META_KEY, contest)

    # ---- 3. 작가 다른 작품(증가분) ----
    got, failed, authors_left = fetch_authors()

    _put(ID_LIST_KEY, sorted(int(k) for k in contest))
    done = done_scan and not due
    listed = listed_total(sess[0])   # 준비 실행은 기록만(자정 실행이 맞춘다)
    _log(logging.INFO, execution_id, "Contest ID collection pass finished.", done=done, last_checked_id=st['last_checked_id'],
         total_contest=len(contest), alive_contest=alive(), new_contest=len(new_contest), recheck_total=len(recheck),
         rechecked=rechecked, recheck_left=len(due), authors_fetched=got, authors_failed=failed, authors_left=authors_left, listed=listed,
         match_rounds=rounds, aborted=aborted)
    return {"done": done, "total_contest": len(contest), "alive_contest": alive(), "listed_total": listed,
            "new_contest": len(new_contest), "last_checked_id": st['last_checked_id'], "aborted": aborted}
