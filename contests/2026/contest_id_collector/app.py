"""2026 공모전 참가작 ID 수집기.

2025(`contests/2025/contest_id_collector`)와 같은 방식 — 새 소설 번호를 차례로 열어 상세의 공모전 배지
(`p.in-badge span.b_contest2`, 2026 실측 '우주최강')로 참가작을 찾는다. 노벨피아의 참가작 목록
(`/contest_list`)은 '최신순'이 마지막 업데이트순이라 넘기는 사이 순서가 바뀌어(8쪽 240칸 중 고유 194편)
원천으로 쓰지 않는다. 참가는 새 작품 등록이므로 번호 훑기로 빠짐없이 잡힌다.

2025 와 다른 점
- **상태를 S3 에 둔다.** 2025 는 SSM 이었는데 재확인 목록이 4KB 한도의 99.6%까지 찼다(백로그 #24).
- **시간 예산.** 개막일에는 8시간에 번호가 1,550개 생겼다(한 번호 0.45초 → 하루치 22분, Lambda 15분 초과).
  남은 시간이 예산 아래로 내려가면 상태를 저장하고 `done: false` 로 끝낸다 — 상태 머신이 다시 부른다.
- **끝 판정은 '잘못된 소설 번호' 연속 STOP_RUN 번**(백로그 #23 — 단일 이상 번호에 멈추지 않게).
- **재확인 목록에서 번호를 지우지 않는다(2025 와 같은 의도).** 작가가 언제든 비공개로 돌렸다 풀 수 있다.
  대신 공개 일반작으로 확인된 번호는 NORMAL_RECHECK_DAYS 마다만 다시 본다(개막 직전 번호의 28%가 비공개라
  매일 전부 보면 한 달에 수천 개).
- **공개 일반작도 재확인 목록에 넣는다(2025 에 없던 것).** 먼저 공개한 작품을 나중에 공모전에 참가시키는 경우가
  있다 — 455833 은 개막일 20:40 에 일반작이었는데 22:24 엔 참가작이었고, 2025 방식(경고창 번호만 재확인)으로는
  끝내 못 잡는다. 생긴 지 FRESH_DAYS 안의 번호는 매일, 그 뒤는 NORMAL_RECHECK_DAYS 마다 본다.
- **작가의 다른 작품**(`/proc/novel_curation`, cmd=writer_other_novel)을 참가작을 처음 찾을 때 원본 JSON
  그대로 남긴다(작가당 1회). 기성 여부 판정은 나중에 한다(제안: 공모전 시작 번호 이전 작품이 있으면 기성).
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
STOP_RUN = int(os.environ.get('STOP_RUN', '5'))
WORKERS = int(os.environ.get('WORKERS', '4'))
NORMAL_RECHECK_DAYS = int(os.environ.get('NORMAL_RECHECK_DAYS', '3'))
FRESH_DAYS = int(os.environ.get('FRESH_DAYS', '7'))
BUDGET_MS = int(os.environ.get('STOP_WHEN_REMAINING_MS', '90000'))
CHUNK = 40

ID_LIST_KEY = f"contest_novel_ids_{YEAR}.json"      # 팬아웃이 읽는 목록(2025 와 같은 모양: 번호 배열)
STATE_KEY = "state/progress.json"
RECHECK_KEY = "state/recheck_ids.json"
CONTEST_META_KEY = "state/contest_ids.json"        # 번호 → 처음 찾은 시각·작가
AUTHORS_DONE_KEY = "state/authors_fetched.json"    # 다른 작품을 받은 작가 번호들
AUTHOR_INDEX_KEY = "state/author_works.json"       # 작가 → 다른 작품 번호들(적재가 작품 행에 붙인다)
AUTHOR_KEY = "authors/{}.json"

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
            if b.select_one('p.in-badge span.b_contest2'):
                w = b.select_one('a.writer-name')
                title = b.select_one('div.epnew-novel-title')
                return 'contest', {
                    'author_id': w['href'].rstrip('/').split('/')[-1] if w else None,
                    'author': w.get_text(strip=True) if w else None,
                    'title': title.get_text(strip=True) if title else None,
                }
            return 'normal', None
        except requests.RequestException as e:
            err = str(e)[:120]
            time.sleep(1.5 * (attempt + 1))
    return 'retry', f'request failed: {err}'


def author_works(session, author_id, novel_no):
    """작가의 다른 작품 원본 페이지. 공모전 시작 전 번호를 찾거나 다음 쪽이 없으면 멈춘다(최대 5쪽)."""
    pages = []
    for page in range(1, 6):
        try:
            r = session.get('https://novelpia.com/proc/novel_curation', params={
                'mem_no': author_id, 'novel_no': novel_no, 'page': page, 'cmd': 'writer_other_novel'},
                headers={'X-Requested-With': 'XMLHttpRequest', 'Referer': f'https://novelpia.com/novel/{novel_no}'}, timeout=15)
            d = r.json()
        except Exception as e:  # noqa: BLE001 — 부가 정보라 실패해도 수집을 막지 않는다
            pages.append({'page': page, 'error': str(e)[:120]})
            break
        pages.append({'page': page, 'raw': d})
        w = d.get('writer_other_novel') or {}
        if any(int(x.get('novel_no') or 0) < CONTEST_FIRST_ID for x in w.get('list') or []) or not w.get('is_next_page'):
            break
    return pages


def summarize_author(pages):
    """원본 페이지들 → {'novels': [번호...], 'more': 다음 쪽이 남았나}. 해석(기성 여부)은 하지 않는다."""
    novels, more = set(), False
    for p in pages:
        w = (p.get('raw') or {}).get('writer_other_novel') or {}
        novels |= {int(x['novel_no']) for x in w.get('list') or [] if x.get('novel_no')}
        more = bool(w.get('is_next_page'))
    return {'novels': sorted(novels), 'more': more}


def handler(event, context):
    execution_id = event.get('execution_id', 'N/A')
    remaining = (lambda: context.get_remaining_time_in_millis()) if context else (lambda: 10 ** 9)
    st = _get(STATE_KEY, {'next_id': START_ID, 'last_checked_id': START_ID - 1})
    contest = _get(CONTEST_META_KEY, {})
    recheck = _get(RECHECK_KEY, {})
    sess = [_session() for _ in range(WORKERS)]
    pool = ThreadPoolExecutor(WORKERS)

    def run_ids(ids):
        return list(pool.map(lambda t: check(sess[t[0] % WORKERS], t[1]), enumerate(ids)))

    new_contest = []
    done_scan = st.get('scan_done_at') is not None and st.get('scan_run_id') == execution_id
    run = 0
    nid = st['next_id']
    # ---- 1. 새 번호 ----
    while not done_scan and remaining() > BUDGET_MS:
        ids = list(range(nid, nid + CHUNK))
        stop_at = None
        for i, (kind, info) in zip(ids, run_ids(ids)):
            if kind == 'invalid':
                run += 1
                if run >= STOP_RUN:
                    stop_at = i
                    break
                continue
            run = 0
            if kind == 'contest':
                contest[str(i)] = {**info, 'found_at': _now()}
                new_contest.append(i)
            elif kind == 'retry':
                recheck.setdefault(str(i), {'reason': info, 'first_seen': _now(), 'status': 'retry', 'last_checked': _now()})
            else:  # 공개 일반작 — 나중에 공모전에 참가할 수 있다
                recheck.setdefault(str(i), {'reason': 'normal', 'first_seen': _now(), 'status': 'normal', 'last_checked': _now(), 'last_run': execution_id})
        if stop_at:
            nid = stop_at - run + 1
            st.update(next_id=nid, last_checked_id=nid - 1, scan_done_at=_now(), scan_run_id=execution_id)
            done_scan = True
        else:
            nid = ids[-1] + 1
            st.update(next_id=nid, last_checked_id=nid - 1)
        _put(STATE_KEY, st)
        _put(CONTEST_META_KEY, contest)
        _put(RECHECK_KEY, recheck)

    # ---- 2. 재확인(지우지 않는다; 공개 일반작은 주기만 늘린다) ----
    today = datetime.now(KST)
    # 같은 실행 안에서 다시 불려도(예산 반복) 이번 실행에서 본 번호는 다시 보지 않는다.
    def is_due(v):
        if v.get('status') != 'normal':
            return True
        age = today - datetime.fromisoformat(v['first_seen'])
        gap = timedelta(days=1 if age < timedelta(days=FRESH_DAYS) else NORMAL_RECHECK_DAYS)
        return today - datetime.fromisoformat(v['last_checked']) >= gap - timedelta(hours=2)   # 매일 실행 시각의 오차 흡수

    due = [k for k, v in recheck.items() if k not in contest and v.get('last_run') != execution_id and is_due(v)]
    rechecked = 0
    while done_scan and due and remaining() > BUDGET_MS:
        part, due = due[:CHUNK], due[CHUNK:]
        for k, (kind, info) in zip(part, run_ids([int(x) for x in part])):
            v = recheck[k]
            v['last_checked'] = _now()
            v['last_run'] = execution_id
            if kind == 'contest':
                contest[k] = {**info, 'found_at': _now(), 'via': 'recheck'}
                new_contest.append(int(k))
                v['status'] = 'contest'
            elif kind == 'normal':
                v['status'] = 'normal'
            elif kind == 'retry':
                v['status'], v['reason'] = 'retry', info
            rechecked += 1
        _put(RECHECK_KEY, recheck)
        _put(CONTEST_META_KEY, contest)

    # ---- 3. 작가 다른 작품(작가당 1회). 예산이 모자라 못 받은 작가는 다음 실행이 이어 받는다 ----
    fetched = set(_get(AUTHORS_DONE_KEY, []))
    index = _get(AUTHOR_INDEX_KEY, {})
    pending = {}
    for k, meta in contest.items():
        aid = meta.get('author_id')
        if aid and aid not in fetched and aid not in pending:
            pending[aid] = int(k)
    got = 0
    for aid, nno in pending.items():
        if remaining() < BUDGET_MS // 2:
            break
        pages = author_works(sess[0], aid, nno)
        _put(AUTHOR_KEY.format(aid), {'author_id': aid, 'fetched_at': _now(), 'novel_no': nno, 'pages': pages})
        index[aid] = summarize_author(pages)
        fetched.add(aid)
        got += 1
        if got % 50 == 0:
            _put(AUTHORS_DONE_KEY, sorted(fetched))
            _put(AUTHOR_INDEX_KEY, index)
    _put(AUTHORS_DONE_KEY, sorted(fetched))
    _put(AUTHOR_INDEX_KEY, index)

    _put(ID_LIST_KEY, sorted(int(k) for k in contest))
    done = done_scan and not due
    _log(logging.INFO, execution_id, "Contest ID collection pass finished.", done=done, last_checked_id=st['last_checked_id'],
         total_contest=len(contest), new_contest=len(new_contest), recheck_total=len(recheck),
         rechecked=rechecked, recheck_left=len(due), authors_fetched=got, authors_pending=len(pending) - got)
    return {"done": done, "total_contest": len(contest), "new_contest": len(new_contest), "last_checked_id": st['last_checked_id']}
