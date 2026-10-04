"""노벨피아 공식 공모전 24H 랭킹(최대 1000위)을 받아 저장한다 — 분석용 일회성 수집(파이프라인 밖).

왜: 공식 랭킹의 점수는 노벨피아가 세는 '인증 조회수'(24시간)다. 우리 일간 순위(누적 조회 증가량)와 기준이 달라
그대로 쓰지는 않지만, 매크로 등으로 조회수를 부풀린 작품은 두 값의 비가 다른 작품과 크게 다를 것이라 예상해
자정 무렵 목록을 우리 자정 수집과 견줘 보려는 것이다(사용자 요청 2026-10-04). 파이프라인은 바꾸지 않는다.

받는 곳(브라우저와 같은 요청 — 기본은 익명 세션, `--auth` 면 로그인·성인 모드 세션):
  * GET  https://novelpia.com/top100/contest           — 1~100위(HTML)
  * POST https://novelpia.com/proc/rank_more            — 101위부터 100개씩(JSON 의 result 에 HTML 조각)
        load=top100 cate=contest proc=today info=view req1=all req2=all idx=100,200,… page_cut=100
점수 표기: 1000 미만은 정수, 이상은 '3.7K' 처럼 반올림(정밀도는 표기 그대로 — score_text 를 함께 남긴다).

저장: 원본 응답(gzip)과 해석한 목록(JSON)을 로컬 `review/official_top100/{captured_at}/` 와
상태 버킷 `s3://novelflow-contest-2026-<계정>/analysis/official_top100/{captured_at}/` 에 둔다
(원본 버킷 `contest/2026/{date}/` 는 원본 재계산이 읽으므로 쓰지 않는다).

    python scripts/capture_official_top100.py                 # 지금 한 번
    python scripts/capture_official_top100.py --auth --at 00:00:30 00:03 00:06 --until-success   # 자정 직후 한 번(실패할 때만 다음 시각)
    python scripts/capture_official_top100.py --no-s3         # 로컬에만
    python scripts/capture_official_top100.py --auth          # 로그인·성인 모드(성인작 포함)

**익명 세션에서는 성인작(19)이 목록에서 통째로 빠진다**(10-04 실측: 공모전 성인작 207편 중 0편). `--auth` 는 데일리
크롤러가 매일 21:00 로그인·성인 모드로 만든 쿠키(SSM SecureString `/NP-Trend/AUTH_COOKIES` 최신 버전)를 그대로 쓴다 —
새로 로그인하지 않는다. 쿠키 값은 출력하지 않는다. 받은 목록에 성인 배지가 하나도 없으면 세션이 풀린 것으로 보고 실패한다.
"""
import argparse
import gzip
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone

KST = timezone(timedelta(hours=9))
BASE = 'https://novelpia.com'
UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'review', 'official_top100')


_COOKIE = None   # --auth 일 때 'name=value; …'


def _load_auth_cookie_header():
    import boto3
    ssm = boto3.client('ssm', region_name='ap-northeast-2')
    cookies = json.loads(ssm.get_parameter(Name='/NP-Trend/AUTH_COOKIES', WithDecryption=True)['Parameter']['Value'])
    return '; '.join(f"{c['name']}={c['value']}" for c in cookies if isinstance(c, dict) and c.get('name') and c.get('value') is not None)


def _get(url, data=None):
    headers = {'User-Agent': UA, 'Referer': f'{BASE}/top100/contest'}
    if _COOKIE:
        headers['Cookie'] = _COOKIE
    if data is not None:
        data = urllib.parse.urlencode(data).encode()
        headers['X-Requested-With'] = 'XMLHttpRequest'
        headers['Content-Type'] = 'application/x-www-form-urlencoded; charset=UTF-8'
    req = urllib.request.Request(url, data=data, headers=headers, method='POST' if data is not None else 'GET')
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                return r.read()
        except Exception:  # noqa: BLE001
            if attempt == 2:
                raise
            time.sleep(3)


def _score(text):
    t = text.strip().replace(',', '')
    m = re.fullmatch(r'([\d.]+)\s*([KkMm]?)', t)
    if not m:
        return None
    v = float(m.group(1)) * {'': 1, 'k': 1_000, 'm': 1_000_000}[m.group(2).lower()]
    return int(round(v))


def parse(fragment):
    """랭킹 HTML(페이지 또는 rank_more 조각) → 항목 목록. PC 블록(`col-md-2 novelbox`) 하나가 한 작품."""
    out = []
    for b in re.split(r'(?=<div class="col-md-2 novelbox)', fragment)[1:]:
        nid = re.search(r"location='/novel/(\d+)'", b)
        rank = re.search(r'class="thumb_s1">\s*(\d+)\s*<', b)
        score = re.search(r'class="thumb_s4">\s*<i[^>]*></i>\s*([^<]+?)\s*<', b)
        ep = re.search(r'class="thumb_s2">\s*EP\.(\d+)\s*<', b)
        title = re.search(r'class="cut_line_one">\s*(.*?)\s*</b>', b, re.S)
        author = re.search(r'</b>\s*<font[^>]*>\s*(.*?)\s*</font>', b, re.S)
        badges = re.findall(r'<span class="(b_[a-z0-9_]+)[^"]*">\s*([^<]*?)\s*</span>', b)
        if not (nid and rank):
            continue
        out.append({
            'rank': int(rank.group(1)), 'novel_id': nid.group(1),
            'score_text': score.group(1) if score else None, 'score': _score(score.group(1)) if score else None,
            'ep': int(ep.group(1)) if ep else None,
            'title': re.sub(r'\s+', ' ', title.group(1)) if title else None,
            'author': re.sub(r'\s+', ' ', author.group(1)) if author else None,
            'badges': [f"{c}:{t}" for c, t in badges],
        })
    return out


def capture(upload=True, auth=False):
    global _COOKIE
    _COOKIE = _load_auth_cookie_header() if auth else None
    started = datetime.now(KST)
    stamp = started.strftime('%Y%m%dT%H%M%S') + ('-auth' if auth else '')
    raws = {}
    page = _get(f'{BASE}/top100/contest').decode('utf-8', 'replace')
    raws['page.html'] = page
    items = parse(page)
    idx = 100
    while idx < 1000:
        body = _get(f'{BASE}/proc/rank_more', {'load': 'top100', 'cate': 'contest', 'proc': 'today', 'info': 'view',
                                              'req1': 'all', 'req2': 'all', 'req3': '', 'idx': idx, 'page_cut': 100,
                                              'main_genre': ''})
        raws[f'more_{idx}.json'] = body.decode('utf-8', 'replace')
        got = parse(json.loads(body).get('result') or '')
        items += got
        if len(got) < 100:
            break
        idx += 100
        time.sleep(1)   # 브라우저가 '더 보기'를 누르는 정도의 간격
    finished = datetime.now(KST)
    ranks = [i['rank'] for i in items]
    summary = {
        'captured_at': started.isoformat(), 'finished_at': finished.isoformat(), 'count': len(items),
        'unique_ids': len({i['novel_id'] for i in items}), 'rank_min': min(ranks, default=None), 'rank_max': max(ranks, default=None),
        'rank_gaps': sorted(set(range(1, max(ranks, default=0) + 1)) - set(ranks))[:20],
        'adult_badges': sum(1 for i in items if any(b.startswith('b_19') for b in i['badges'])),
        'source': 'novelpia.com/top100/contest (24H, 조회순, ' + ('로그인·성인 모드' if auth else '익명 세션') + ')',
    }
    if auth and not summary['adult_badges']:
        raise RuntimeError("로그인판인데 성인 배지가 하나도 없습니다 — 쿠키 세션이 풀렸거나 성인 모드가 꺼졌습니다(저장하지 않음).")
    d = os.path.join(ROOT, stamp)
    os.makedirs(d, exist_ok=True)
    doc = {'summary': summary, 'items': items}
    with open(os.path.join(d, 'ranking.json'), 'w', encoding='utf-8') as f:
        json.dump(doc, f, ensure_ascii=False, indent=1)
    with gzip.open(os.path.join(d, 'raw.json.gz'), 'wt', encoding='utf-8') as f:
        json.dump(raws, f, ensure_ascii=False)
    if upload:
        import boto3
        acc = boto3.client('sts').get_caller_identity()['Account']
        bucket, pre = f'novelflow-contest-2026-{acc}', f'analysis/official_top100/{stamp}/'
        s3 = boto3.client('s3', region_name='ap-northeast-2')
        for name in ('ranking.json', 'raw.json.gz'):
            s3.upload_file(os.path.join(d, name), bucket, pre + name)
        summary['s3'] = f's3://{bucket}/{pre}'
    print(json.dumps(summary, ensure_ascii=False), flush=True)
    return summary


def _next(hms, now):
    parts = [int(x) for x in hms.split(':')] + [0, 0]
    t = now.replace(hour=parts[0], minute=parts[1], second=parts[2], microsecond=0)
    return t if t > now else t + timedelta(days=1)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--at', nargs='*', help='KST 시각(HH:MM[:SS]) — 다음에 오는 그 시각마다 받는다')
    ap.add_argument('--no-s3', action='store_true')
    ap.add_argument('--auth', action='store_true', help='로그인·성인 모드 세션(데일리 크롤러의 SSM 쿠키)')
    ap.add_argument('--until-success', action='store_true', help='--at 의 시각 중 처음 성공하면 끝낸다(나머지는 재시도용)')
    a = ap.parse_args()
    if not a.at:
        capture(not a.no_s3, a.auth)
        return
    now = datetime.now(KST)
    targets = sorted(_next(t, now) for t in a.at)
    print(json.dumps({'scheduled': [t.isoformat() for t in targets]}), flush=True)
    for t in targets:
        wait = (t - datetime.now(KST)).total_seconds()
        if wait > 0:
            time.sleep(wait)
        try:
            capture(not a.no_s3, a.auth)
            if a.until_success:
                return
        except Exception as e:  # noqa: BLE001 — 한 번 실패해도 다음 시각은 받는다
            print(json.dumps({'failed_at': datetime.now(KST).isoformat(), 'error': repr(e)[:300]}), flush=True)


if __name__ == '__main__':
    sys.exit(main())
