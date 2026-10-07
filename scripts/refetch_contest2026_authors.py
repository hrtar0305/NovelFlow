"""2026 공모전 작가의 다른 작품을 로그인 세션으로 다시 받고, 지난 날짜 작품 행의 원문(AuthorOtherNovels·More)을 맞춘다.

    python scripts/refetch_contest2026_authors.py --dry-run     # 받기만 하고 바뀔 작가·행 수를 센다
    python scripts/refetch_contest2026_authors.py               # 작가 원본·색인을 쓰고 행을 고친다
    --authors=1097127,114367                                     # 그 작가만(점검용)

2026-10-08 까지 수집기는 익명으로 받아 19금 작품이 통째로 빠졌다(DECISIONS 2026-10-08). 기성 여부는 '공모전 시작 전
작품이 있나'라 날짜와 무관하므로, 다시 받은 값으로 모든 날짜 행을 덮어도 어긋나지 않는다(순위·조회수는 건드리지 않는다).
**예전에 본 작품과 합친다(덮지 않는다).** 공모전 시작 뒤 예전 작품을 비공개·삭제한 작가가 있어(10-08 실측: 다시 받으면 기성 98명이
신인으로 바뀌었다 — 그 작품들은 지금 '잘못된 접근'·'삭제된 소설'), 한 번이라도 본 공모전 전 작품은 기성의 근거로 남긴다.
작가 원본도 예전 쪽 뒤에 새 쪽을 덧붙여, `build_author_index.py` 로 색인을 다시 만들어도 같은 합집합이 나온다.
받다가 실패한 작가는 예전 값 그대로 둔다 — 노벨피아가 연달아 받으면 막아서(두 번째 전체 실행은 절반 실패) 다시 돌리면 된다.
색인은 끝에서 **그때의 색인에 합친다** — 그 사이 수집기가 더한 작가를 지우지 않게. 수집기가 도는 시각(11:30·23:30·00:00)은 피한다.
"""
import json
import os
import sys
from concurrent.futures import ThreadPoolExecutor

import boto3
from boto3.dynamodb.conditions import Key

BUCKET = f"novelflow-contest-2026-{boto3.client('sts').get_caller_identity()['Account']}"
os.environ.setdefault('S3_BUCKET_NAME', BUCKET)
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'contests', '2026', 'contest_id_collector'))
import app as C  # noqa: E402

TABLE = boto3.resource('dynamodb', region_name='ap-northeast-2').Table('NovelFlowContest2026')
DRY = '--dry-run' in sys.argv


def targets():
    """작가 → 다른 작품을 물을 참가작 번호(수집기처럼 최근 참가작)."""
    out = {}
    for k, meta in sorted(C._get(C.CONTEST_META_KEY, {}).items(), key=lambda kv: -int(kv[0])):
        if meta.get('author_id'):
            out.setdefault(meta['author_id'], int(k))
    return out


def refetch(auth, todo):
    got, failed = {}, []

    def one(t):
        i, (aid, nno) = t
        return aid, nno, C.author_works(auth[i % C.WORKERS], aid, nno)

    with ThreadPoolExecutor(C.WORKERS) as pool:
        for n, (aid, nno, pages) in enumerate(pool.map(one, enumerate(todo.items())), 1):
            if C.summarize_author(pages) is None:
                failed.append(aid)
                continue
            old = C._get(C.AUTHOR_KEY.format(aid), {})
            kept = old.get('pages') or []
            if C.summarize_author(kept) is None:      # 예전 받기가 오류였으면(색인에도 없다) 새 쪽만
                kept = []
            merged = kept + [{**pg, 'refetched_at': C._now(), 'novel_no': nno} for pg in pages]
            got[aid] = (C.summarize_author(merged), {**old, 'author_id': aid, 'fetched_at': old.get('fetched_at') or C._now(),
                                                     'novel_no': old.get('novel_no', nno), 'auth': True, 'pages': merged})
            if n % 200 == 0:
                print(f'  {n}/{len(todo)}', flush=True)
    return got, failed


def is_veteran(novels):
    return any(int(n) < C.CONTEST_FIRST_ID for n in novels)


def fix_rows(index):
    dates = sorted(TABLE.get_item(Key={'ID': 'CONTEST_AVAILABLE_DATES', 'Date': 'METADATA'}).get('Item', {}).get('dates', []))
    changed = 0
    for d in dates:
        rows, kw = [], {'IndexName': 'DateViewIndex', 'KeyConditionExpression': Key('Date').eq(d),
                        'ProjectionExpression': 'ID, AuthorID, AuthorOtherNovels, AuthorOtherMore, #d',
                        'ExpressionAttributeNames': {'#d': 'Date'}}
        while True:
            r = TABLE.query(**kw)
            rows += r['Items']
            if 'LastEvaluatedKey' not in r:
                break
            kw['ExclusiveStartKey'] = r['LastEvaluatedKey']
        n = 0
        for row in rows:
            info = index.get(str(row.get('AuthorID')))
            if info is None:
                continue
            novels = [n_ for n_ in info['novels'] if str(n_) != str(row['ID'])]   # 적재 attach_author_works 와 같은 규칙
            more = bool(info['more'])
            if [int(x) for x in row.get('AuthorOtherNovels') or []] == novels and bool(row.get('AuthorOtherMore')) == more \
                    and 'AuthorOtherNovels' in row:
                continue
            n += 1
            if not DRY:
                TABLE.update_item(Key={'ID': row['ID'], 'Date': row['Date']},
                                  UpdateExpression='SET AuthorOtherNovels = :n, AuthorOtherMore = :m',
                                  ExpressionAttributeValues={':n': novels, ':m': more})
        print(f'{d}: rows {len(rows)} · changed {n}')
        changed += n
    return changed


def main():
    auth = C.auth_sessions('refetch')
    if auth is None:
        sys.exit('로그인 세션을 만들지 못했습니다(쿠키 만료?). 데일리 21시 실행 뒤 다시 돌리세요.')
    todo = targets()
    only = next((a.split('=', 1)[1] for a in sys.argv if a.startswith('--authors=')), None)
    if only:
        todo = {a: todo[a] for a in only.split(',') if a in todo}
    old = C._get(C.AUTHOR_INDEX_KEY, {})
    print(f'authors {len(todo)} (index {len(old)})')
    got, failed = refetch(auth, todo)
    flips = [a for a, (s, _) in got.items() if a in old and is_veteran(s['novels']) != is_veteran(old[a]['novels'])]
    print(f'fetched {len(got)} · failed {len(failed)} · veteran changed {len(flips)} '
          f'(→기성 {sum(1 for a in flips if is_veteran(got[a][0]["novels"]))})')
    if not DRY:
        with ThreadPoolExecutor(16) as pool:
            list(pool.map(lambda a: C._put(C.AUTHOR_KEY.format(a), got[a][1]), got))
        index = C._get(C.AUTHOR_INDEX_KEY, {})   # 그 사이 수집기가 더한 작가를 살린다
        index.update({a: s for a, (s, _) in got.items()})
        C._put(C.AUTHOR_INDEX_KEY, index)
    else:
        index = {**old, **{a: s for a, (s, _) in got.items()}}
    print(f'rows changed {fix_rows(index)}' + (' (dry run)' if DRY else ''))


if __name__ == '__main__':
    main()
