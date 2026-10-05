"""로컬 연재 기록 백필(`scripts/backfill_episode_history.py` 결과)을 `NovelFlowEpisodeHistory` 에 적재하고, 목록 원본을 원본 버킷에 올린다.

백필로 채운 회차는 '처음 본 시각'이 없다(None) — 행 펼침은 이 회차들을 날짜만 보고 센다(설계 3.3). 기록은 끝까지 받았으므로
`Complete=True`. 받을 수 없던 작품(`status: empty`)도 빈 기록으로 넣는다(다음 수집이 처음부터 다시 받지 않게).

    python scripts/load_episode_history.py --src review/episode-history/2026-10-05 --dry-run
    python scripts/load_episode_history.py --src review/episode-history/2026-10-05
"""
import argparse
import glob
import json
import os
import sys

TABLE = 'NovelFlowEpisodeHistory'
ITEM_LIMIT = 400 * 1024


def to_item(rec):
    eps = {e[0]: [e[2], None, None] for e in rec.get('episodes') or [] if e[2]}
    dates = [v[0] for v in eps.values()]
    return {'NovelId': str(rec['novel_id']), 'Episodes': eps, 'CheckedAt': rec.get('checked_at'),
            'CheckedCount': len(eps), 'Complete': True, 'OldestDate': min(dates) if dates else None,
            'Scheduled': list(rec.get('scheduled') or []), 'Version': 1}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--src', required=True)
    ap.add_argument('--dry-run', action='store_true')
    a = ap.parse_args()
    with open(os.path.join(a.src, 'history.jsonl'), encoding='utf-8') as f:
        items = [to_item(json.loads(line)) for line in f if line.strip()]
    sizes = sorted((len(json.dumps(i, ensure_ascii=False).encode()), i['NovelId']) for i in items)
    over = [s for s in sizes if s[0] > ITEM_LIMIT]
    print(json.dumps({'items': len(items), 'max_bytes': sizes[-1], 'over_limit': over[:5], 'raw_bundles': len(glob.glob(os.path.join(a.src, 'raw-*.jsonl.zst'))),
                      'dry_run': a.dry_run}, ensure_ascii=False), flush=True)
    if over:
        sys.exit('400KB 를 넘는 항목이 있어 적재하지 않습니다.')
    if a.dry_run:
        return
    import boto3
    ddb = boto3.resource('dynamodb', region_name='ap-northeast-2')
    with ddb.Table(TABLE).batch_writer() as w:
        for n, it in enumerate(items, 1):
            w.put_item(Item=it)
            if n % 1000 == 0:
                print(json.dumps({'written': n}), flush=True)
    s3 = boto3.client('s3', region_name='ap-northeast-2')
    acc = boto3.client('sts').get_caller_identity()['Account']
    bucket = f'novelflow-raw-html-{acc}-ap-northeast-2-an'
    stamp = os.path.basename(os.path.normpath(a.src))
    for fn in sorted(glob.glob(os.path.join(a.src, 'raw-*.jsonl.zst'))):
        s3.upload_file(fn, bucket, f'episode-history/backfill-{stamp}/{os.path.basename(fn)}')
    print(json.dumps({'done': len(items), 'raw_prefix': f's3://{bucket}/episode-history/backfill-{stamp}/'}), flush=True)


if __name__ == '__main__':
    main()
