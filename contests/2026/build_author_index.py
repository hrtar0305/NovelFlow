"""작가별 원본(authors/{id}.json)에서 색인(state/author_works.json)을 다시 만든다.

    python contests/2026/build_author_index.py [--dry-run]

수집기는 새로 받은 작가만 색인에 더하므로, 색인을 처음 만들 때나 깨졌을 때 이것으로 전체를 다시 만든다.
수집기가 도는 시간(00:00 실행 중)에는 돌리지 말 것 — 같은 파일을 쓴다.
"""
import json
import sys
from concurrent.futures import ThreadPoolExecutor

import boto3

sys.path.insert(0, 'contest_id_collector')


def summarize(pages):
    """수집기 `summarize_author` 와 같은 규칙 — 오류가 난 쪽이 있으면 None(색인에서 빼 수집기가 다시 받게)."""
    if any('error' in p for p in pages):
        return None
    novels, more = set(), False
    for p in pages:
        raw = p.get('raw')
        w = raw.get('writer_other_novel') if isinstance(raw, dict) else None
        w = w if isinstance(w, dict) else {}
        for x in w.get('list') or []:
            try:
                novels.add(int(x['novel_no']))
            except (TypeError, KeyError, ValueError):
                pass
        more = bool(w.get('is_next_page'))
    return {'novels': sorted(novels), 'more': more}


def main():
    s3 = boto3.client('s3', region_name='ap-northeast-2')
    bucket = f"novelflow-contest-2026-{boto3.client('sts').get_caller_identity()['Account']}"
    keys = []
    for page in s3.get_paginator('list_objects_v2').paginate(Bucket=bucket, Prefix='authors/'):
        keys += [o['Key'] for o in page.get('Contents', [])]
    load = lambda k: json.loads(s3.get_object(Bucket=bucket, Key=k)['Body'].read())
    with ThreadPoolExecutor(16) as ex:
        docs = list(ex.map(load, keys))
    index = {d['author_id']: v for d in docs if (v := summarize(d.get('pages') or [])) is not None}
    print(f'authors {len(index)}/{len(docs)} · with other works {sum(1 for v in index.values() if v["novels"])}')
    if '--dry-run' not in sys.argv:
        s3.put_object(Bucket=bucket, Key='state/author_works.json', Body=json.dumps(index).encode(), ContentType='application/json')
        print('written')


if __name__ == '__main__':
    main()
