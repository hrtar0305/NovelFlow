"""로컬에서 미리 모은 2026 참가작 목록을 수집기 상태(S3) 형식으로 올린다. 개막일 한 번만 쓴다.

    python contests/2026/seed_state.py <로컬 state 디렉터리> [--dry-run]

로컬 수집(개막일 저녁)은 2026 수집기와 같은 규칙으로 돌렸다. 여기서는 형식만 맞춘다 —
재확인 항목에 status/last_checked 를 붙이고, 작가 다른 작품을 작가별 객체로 나눈다.
"""
import json
import os
import sys

import boto3



def main():
    src = sys.argv[1]
    dry = '--dry-run' in sys.argv
    load = lambda n: json.load(open(os.path.join(src, n)))
    progress = load('progress.json')
    contest = load('contest_ids.json')
    recheck = {k: {**v, 'status': 'retry', 'last_checked': v['first_seen']} for k, v in load('recheck_ids.json').items()}
    authors = load('authors.json')
    objs = {
        'state/progress.json': {'next_id': progress['next_id'], 'last_checked_id': progress['last_checked_id']},
        'state/contest_ids.json': contest,
        'state/recheck_ids.json': recheck,
        'state/authors_fetched.json': sorted(authors),
        'contest_novel_ids_2026.json': sorted(int(k) for k in contest),
    }
    for aid, v in authors.items():
        objs[f'authors/{aid}.json'] = {'author_id': aid, **v}
    print(f"contest {len(contest)} · recheck {len(recheck)} · authors {len(authors)} · next_id {progress['next_id']} · objects {len(objs)}")
    if dry:
        return
    s3 = boto3.client('s3', region_name='ap-northeast-2')
    bucket = f"novelflow-contest-2026-{boto3.client('sts').get_caller_identity()['Account']}"
    for i, (k, v) in enumerate(objs.items()):
        s3.put_object(Bucket=bucket, Key=k, Body=json.dumps(v, ensure_ascii=False).encode(), ContentType='application/json')
        if i % 200 == 0:
            print(f'  {i}/{len(objs)}')
    print('seeded')


if __name__ == '__main__':
    main()
