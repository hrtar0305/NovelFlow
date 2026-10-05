"""연재 기록 백필 — 작품마다 노벨피아 회차 목록 전체를 받아 둔다(로컬 실행, 설계: docs/superpowers/specs/2026-10-05-episode-upload-history-design.md).

대상: 데일리 테이블(NovelRanks)의 모든 작품 + 2026 공모전 참가작. **2025 공모전은 넣지 않는다(사용자 결정).**
결과는 저장소가 확정될 때까지 로컬에 둔다(git 제외 `review/episode-history/<날짜>/`):
  * `history.jsonl` — 작품 한 줄: {"novel_id", "source", "checked_at", "status", "episodes": [[고유번호, 'EP.N'·'BONUS' 등, 날짜, 날짜 원문]],
                       "scheduled": [[원문, 받은 시각]], "pages"}
  * `raw-XXXXX.jsonl.zst` — 받은 목록 쪽 원본(작품 묶음, zstd — ELT: 나중에 다른 규칙으로 다시 해석할 수 있게)
이미 `history.jsonl` 에 있는 작품은 건너뛴다(중단 뒤 다시 돌리면 이어서).

규칙(설계 2.1):
  * 최신순(`sort=UP`)으로 0쪽부터 받는다. 한 쪽 보통 20칸이지만 **삭제가 있던 작품은 쪽 칸 수가 들쭉날쭉**하다(378108 첫 쪽 19칸).
    그래서 칸 수로 끝을 판정하지 않고, 새 고유 번호가 없거나(마지막 쪽을 넘기면 같은 쪽이 다시 온다) 가장 오래된 회차(EP.0·EP.1 —
    'EP.N' 은 순서라 가장 오래된 공개 회차가 늘 이 번호)가 보이면 끝.
  * 회차 키는 고유 번호(`span.episode_count_view` 의 `novel_count_view_N`). 'EP.N' 은 순서라 바뀔 수 있다.
  * 날짜: 'YY.MM.DD' 또는 'N초전·N분전·N시간전'(그날 올린 회차 — 받은 시각에서 빼 KST 날짜로).
  * 조회수 칸이 없는 '공개예정 N시간후' 는 예약 회차 — 연재로 세지 않고 `scheduled` 에만 남긴다(감시용).

    python scripts/backfill_episode_history.py --dry-run --limit 3        # 3편만 받아 보고 저장하지 않음
    python scripts/backfill_episode_history.py --only contest             # 공모전만
    python scripts/backfill_episode_history.py                            # 전체(이어 받기)
"""
import argparse
import io
import json
import os
import re
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta, timezone

import requests
from bs4 import BeautifulSoup

KST = timezone(timedelta(hours=9))
URL = 'https://novelpia.com/proc/episode_list'
UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'
MAX_PAGES = 400
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'review', 'episode-history')


class RateLimiter:
    """요청 시작 간격을 전체 스레드에 걸쳐 일정 이상으로 — 노벨피아에 몰아서 보내지 않는다."""
    def __init__(self, interval):
        self.interval, self.lock, self.next = interval, threading.Lock(), 0.0

    def wait(self):
        with self.lock:
            now = time.monotonic()
            t = max(now, self.next)
            self.next = t + self.interval
        if t > now:
            time.sleep(t - now)


_local = threading.local()


def _session():
    if not hasattr(_local, 's'):
        s = requests.Session()
        s.headers['User-Agent'] = UA
        _local.s = s
    return _local.s


def fetch_page(nid, page, limiter):
    for attempt in range(5):
        limiter.wait()
        try:
            r = _session().post(URL, data={'novel_no': nid, 'sort': 'UP', 'page': page}, timeout=20,
                                headers={'Referer': f'https://novelpia.com/novel/{nid}', 'X-Requested-With': 'XMLHttpRequest'})
            if r.status_code == 200:
                return r.text, datetime.now(KST)
            if r.status_code in (429, 500, 502, 503, 504):
                time.sleep(2 * (attempt + 1))
                continue
            return None, datetime.now(KST)
        except requests.RequestException:
            time.sleep(2 * (attempt + 1))
    raise RuntimeError(f'{nid} page {page}: 5번 실패')


_REL = re.compile(r'(\d+)\s*(초|분|시간)\s*전')


def to_date(text, fetched_at):
    t = (text or '').strip()
    m = re.match(r'^(\d{2})\.(\d{2})\.(\d{2})$', t)
    if m:
        return f'20{m[1]}-{m[2]}-{m[3]}'
    m = _REL.search(t)
    if m:
        n, unit = int(m[1]), m[2]
        delta = {'초': timedelta(seconds=n), '분': timedelta(minutes=n), '시간': timedelta(hours=n)}[unit]
        return (fetched_at - delta).date().isoformat()
    return None


def parse(html, fetched_at):
    """목록 한 쪽 → (회차들, 예약 회차 원문들, 그 쪽의 칸 수). 칸 수는 조회수 칸 없는 항목(비공개·예약 등)까지 센다 — 끝 판정용."""
    soup = BeautifulSoup(html, 'html.parser')
    eps, scheduled = [], []
    divs = soup.select('div.ep_style2')
    for d in divs:
        sp = d.select_one('span.episode_count_view')
        m = re.search(r'novel_count_view_(\d+)', ' '.join(sp.get('class', []))) if sp else None
        text = re.sub(r'\s+', ' ', d.get_text(' ', strip=True))
        if not m:
            if '공개예정' in text or '시간후' in text or '분후' in text:
                scheduled.append([text[:120], fetched_at.isoformat()])
            continue
        num = d.select_one('span:first-child')
        b = d.select_one('b')
        raw_date = b.get_text(strip=True) if b else ''
        eps.append([m.group(1), num.get_text(strip=True) if num else None, to_date(raw_date, fetched_at), raw_date])
    return eps, scheduled, len(divs)


def collect(nid, source, limiter):
    seen, eps, scheduled, pages_raw = set(), [], [], []
    status, checked_at = 'ok', None
    for page in range(MAX_PAGES):
        html, fetched_at = fetch_page(nid, page, limiter)
        checked_at = checked_at or fetched_at
        if html is None:
            status = 'http_error'
            break
        pages_raw.append({'page': page, 'fetched_at': fetched_at.isoformat(), 'html': html})
        got, sch, slots = parse(html, fetched_at)
        if page == 0:
            scheduled = sch
        new = [e for e in got if e[0] not in seen]
        for e in new:
            seen.add(e[0])
            eps.append(e)
        # 끝: 새 고유 번호가 없음(마지막 쪽을 넘기면 같은 쪽이 다시 온다), 또는 가장 오래된 회차(EP.0·EP.1)가 보임.
        # 'EP.N' 은 순서라 가장 오래된 공개 회차는 늘 EP.0 이나 EP.1 이다. 쪽당 칸 수로는 판정하지 않는다 — 삭제가 있던 작품은
        # 첫 쪽이 20칸보다 적고 다음 쪽이 이어진다(378108: 19칸 → 20칸 → …).
        # EP.1 이 꽉 찬 쪽(20칸)의 맨 끝이면 프롤로그(EP.0)가 다음 쪽에 있을 수 있어 한 쪽 더 본다.
        labels = [e[1] for e in got]
        if not new or 'EP.0' in labels or ('EP.1' in labels and not (labels[-1] == 'EP.1' and slots >= 20)):
            break
    else:
        status = 'max_pages'
    if not eps and status == 'ok':
        status = 'empty'   # 회차가 없거나(전부 비공개·삭제) 작품이 없다
    rec = {'novel_id': nid, 'source': source, 'checked_at': checked_at.isoformat() if checked_at else None, 'status': status,
           'episodes': eps, 'scheduled': scheduled, 'pages': len(pages_raw)}
    return rec, {'novel_id': nid, 'pages': pages_raw}


def targets(only):
    import boto3
    from boto3.dynamodb.conditions import Attr  # noqa: F401
    ddb = boto3.resource('dynamodb', region_name='ap-northeast-2')

    def ids(table):
        t, out, kw = ddb.Table(table), set(), {'ProjectionExpression': 'ID'}
        while True:
            r = t.scan(**kw)
            out |= {str(i['ID']) for i in r['Items'] if str(i['ID']).isdigit()}
            if 'LastEvaluatedKey' not in r:
                return out
            kw['ExclusiveStartKey'] = r['LastEvaluatedKey']
    daily = ids('NovelRanks') if only in (None, 'daily') else set()
    contest = ids('NovelFlowContest2026') if only in (None, 'contest') else set()
    # 두 곳에 다 나온 작품은 한 번만 받는다(기록은 작품 하나).
    return [(n, 'daily+contest2026' if n in contest else 'daily') for n in sorted(daily, key=int)] + \
           [(n, 'contest2026') for n in sorted(contest - daily, key=int)]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--only', choices=['daily', 'contest'])
    ap.add_argument('--limit', type=int)
    ap.add_argument('--dry-run', action='store_true')
    ap.add_argument('--workers', type=int, default=3)
    ap.add_argument('--interval', type=float, default=0.12, help='요청 시작 최소 간격(초, 전체 스레드 합)')
    ap.add_argument('--out', default=os.path.join(ROOT, datetime.now(KST).strftime('%Y-%m-%d')))
    a = ap.parse_args()

    todo = targets(a.only)
    os.makedirs(a.out, exist_ok=True)
    hist_path = os.path.join(a.out, 'history.jsonl')
    done = set()
    if os.path.exists(hist_path):
        with open(hist_path, encoding='utf-8') as f:
            done = {json.loads(line)['novel_id'] for line in f if line.strip()}
    todo = [t for t in todo if t[0] not in done]
    if a.limit:
        todo = todo[:a.limit]
    print(json.dumps({'targets': len(todo), 'already_done': len(done), 'out': a.out, 'dry_run': a.dry_run}, ensure_ascii=False), flush=True)

    limiter = RateLimiter(a.interval)
    lock = threading.Lock()
    raw_buf, raw_idx = [], len([f for f in os.listdir(a.out) if f.startswith('raw-')])
    stats = {'novels': 0, 'pages': 0, 'episodes': 0, 'status': {}}
    started = time.monotonic()

    def flush_raw(force=False):
        nonlocal raw_buf, raw_idx
        if not raw_buf or (len(raw_buf) < 50 and not force):
            return
        import zstandard
        data = '\n'.join(json.dumps(x, ensure_ascii=False) for x in raw_buf).encode()
        with open(os.path.join(a.out, f'raw-{raw_idx:05d}.jsonl.zst'), 'wb') as f:
            f.write(zstandard.ZstdCompressor(level=10).compress(data))
        raw_idx += 1
        raw_buf = []

    with ThreadPoolExecutor(a.workers) as ex, open(hist_path, 'a', encoding='utf-8') as hist:
        futs = {ex.submit(collect, nid, src, limiter): nid for nid, src in todo}
        for fut in as_completed(futs):
            try:
                rec, raw = fut.result()
            except Exception as e:  # noqa: BLE001 — 한 작품 실패가 전체를 멈추지 않게. 다음 실행이 이어 받는다.
                print(json.dumps({'failed': futs[fut], 'error': repr(e)[:200]}, ensure_ascii=False), flush=True)
                continue
            with lock:
                stats['novels'] += 1
                stats['pages'] += rec['pages']
                stats['episodes'] += len(rec['episodes'])
                stats['status'][rec['status']] = stats['status'].get(rec['status'], 0) + 1
                if a.dry_run:
                    print(json.dumps({**rec, 'episodes': rec['episodes'][:3] + (['…'] if len(rec['episodes']) > 3 else [])}, ensure_ascii=False))
                    continue
                hist.write(json.dumps(rec, ensure_ascii=False) + '\n')
                raw_buf.append(raw)
                flush_raw()
                if stats['novels'] % 100 == 0:
                    hist.flush()
                    el = time.monotonic() - started
                    print(json.dumps({'progress': stats['novels'], 'of': len(todo), 'pages': stats['pages'], 'elapsed_min': round(el / 60, 1),
                                      'eta_min': round(el / stats['novels'] * (len(todo) - stats['novels']) / 60, 1), 'status': stats['status']},
                                     ensure_ascii=False), flush=True)
        if not a.dry_run:
            flush_raw(force=True)
    print(json.dumps({'done': stats, 'elapsed_min': round((time.monotonic() - started) / 60, 1)}, ensure_ascii=False), flush=True)


if __name__ == '__main__':
    sys.exit(main())
