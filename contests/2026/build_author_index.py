"""작가별 원본(authors/{id}.json)에서 색인(state/author_works.json)을 다시 만든다.

    python contests/2026/build_author_index.py [--dry-run]

수집기는 새로 받은 작가만 색인에 더하므로, 색인을 처음 만들 때나 깨졌을 때 이것으로 전체를 다시 만든다.
수집기가 도는 시간(00:00 실행 중)에는 돌리지 말 것 — 같은 파일을 쓴다.
"""
import json
import os
import sys
from concurrent.futures import ThreadPoolExecutor

import boto3

# 수집기와 같은 규칙을 쓴다 — 오류가 난 쪽이 있으면 None(색인에서 빼 수집기가 다시 받게).
# 수집기는 import 때 S3_BUCKET_NAME 을 읽는다. summarize_author 는 버킷을 쓰지 않으므로 아무 값이면 된다.
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), 'contest_id_collector'))
os.environ.setdefault('S3_BUCKET_NAME', 'unused')
from app import summarize_author  # noqa: E402


def main():
    s3 = boto3.client('s3', region_name='ap-northeast-2')
    bucket = f"novelflow-contest-2026-{boto3.client('sts').get_caller_identity()['Account']}"
    keys = []
    for page in s3.get_paginator('list_objects_v2').paginate(Bucket=bucket, Prefix='authors/'):
        keys += [o['Key'] for o in page.get('Contents', [])]
    load = lambda k: json.loads(s3.get_object(Bucket=bucket, Key=k)['Body'].read())
    with ThreadPoolExecutor(16) as ex:
        docs = list(ex.map(load, keys))
    index = {d['author_id']: v for d in docs if (v := summarize_author(d.get('pages') or [])) is not None}
    print(f'authors {len(index)}/{len(docs)} · with other works {sum(1 for v in index.values() if v["novels"])}')
    if '--dry-run' not in sys.argv:
        s3.put_object(Bucket=bucket, Key='state/author_works.json', Body=json.dumps(index).encode(), ContentType='application/json')
        print('written')


if __name__ == '__main__':
    main()
