"""태그 통계에 랭킹 점수 합(`TagScoreSum`·`ScoreTotal`·`RankedTotal`)을 소급한다 — 태그 랭킹 하루 판정(DECISIONS 2026-10-06).

왜: 태그 랭킹의 인기 점수를 '랭킹 점수 점유율'로 바꿨다(적재는 2026-10-06 부터 싣는다). 지난 날짜에 이 필드가 없으면 변동(전날 대비)과
14일 순위선이 두 정의를 섞어 비교하므로, **웹을 배포하기 전에** 모든 날짜를 채운다.

- `--source daily`: `AVAILABLE_DATES` 의 날짜마다 랭킹 행(`DateRankIndex`: Ranking · Score · Tags)을 읽어 적재와 같은 함수
  (`data-pipeline/tag_stats.daily_tag_stats`)로 계산하고 `STATS#{date}` 에 세 필드만 `update_item` 한다(다른 필드는 그대로).
- `--source contest2026`: `CONTEST_AVAILABLE_DATES` 의 날짜마다 참가작 행(DailyRank · ViewDelta · Tags)을 읽어
  `consolidate_contest_data.daily_tag_stats` 로 계산하고 `DAILY_TAG_STATS#{date}` 가 있을 때만 갱신한다.
- 검산: 저장된 `TagCounts` 가 같은 행에서 다시 센 값과 다르면 그 날짜를 쓰지 않고 알린다(정의가 어긋났다는 뜻). 2026-04-13
  이전 STATS 는 1편짜리 태그를 지우기 전이라 저장된 태그가 더 많다 — 가지치기 전 숫자와 같으면 통과하고, 점수 합도 **저장된 태그
  목록에 맞춰**(1편 태그 포함) 싣는다. 그래야 그날 화면의 태그마다 점유율이 있다.

    python scripts/backfill_tag_score_sum.py --source daily --dry-run
    python scripts/backfill_tag_score_sum.py --source daily
    python scripts/backfill_tag_score_sum.py --source contest2026 --dry-run
"""
import argparse
import os
import sys

import boto3
from boto3.dynamodb.conditions import Key

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
sys.path.insert(0, os.path.join(ROOT, 'data-pipeline'))
sys.path.insert(0, os.path.join(ROOT, 'contests', '2026', 'contest_detail_parser'))
os.environ.setdefault('DYNAMODB_TABLE_NAME', 'NovelFlowContest2026')
import tag_stats  # noqa: E402
import consolidate_contest_data as C  # noqa: E402

REGION = 'ap-northeast-2'


def _query(table, **args):
    rows = []
    while True:
        page = table.query(**args)
        rows.extend(page.get('Items', []))
        if 'LastEvaluatedKey' not in page:
            return rows
        args['ExclusiveStartKey'] = page['LastEvaluatedKey']


def daily_rows(table, date):
    rows = _query(table, IndexName='DateRankIndex', KeyConditionExpression=Key('Date').eq(date),
                  ProjectionExpression='ID, Ranking, Score, Tags')
    return [{'Ranking': int(r['Ranking']), 'Score': int(r.get('Score') or 0), 'Tags': list(r.get('Tags') or [])}
            for r in rows if r.get('Ranking') is not None]


def contest_rows(ddb, table, date):
    ids = [r['ID'] for r in _query(table, IndexName='DateViewIndex', KeyConditionExpression=Key('Date').eq(date),
                                   ProjectionExpression='ID')]
    out = []
    for i in range(0, len(ids), 100):
        req = {table.name: {'Keys': [{'ID': x, 'Date': date} for x in ids[i:i + 100]],
                            'ProjectionExpression': 'ID, DailyRank, ViewDelta, Tags'}}
        while req:
            r = ddb.batch_get_item(RequestItems=req)
            for it in r['Responses'].get(table.name, []):
                rank = it.get('DailyRank')
                out.append({'ID': str(it['ID']), 'DailyRank': int(rank) if rank is not None else None,
                            'ViewDelta': int(it.get('ViewDelta') or 0), 'Tags': list(it.get('Tags') or [])})
            req = r.get('UnprocessedKeys') or None
    return out


def _unpruned(rows):
    """가지치기 없는 태그별 작품 수·점수 합(순위가 있는 행만). 데일리는 Ranking·Score, 공모전은 DailyRank·ViewDelta."""
    counts, score = {}, {}
    for r in rows:
        rank = r.get('Ranking', r.get('DailyRank'))
        if not isinstance(rank, int) or rank <= 0:
            continue
        v = int(r.get('Score', r.get('ViewDelta')) or 0)
        for t in r.get('Tags') or []:
            counts[t] = counts.get(t, 0) + 1
            score[t] = score.get(t, 0) + v
    return counts, score


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--source', choices=['daily', 'contest2026'], required=True)
    ap.add_argument('--since', default='0000-00-00')
    ap.add_argument('--dry-run', action='store_true')
    a = ap.parse_args()
    ddb = boto3.resource('dynamodb', region_name=REGION)
    if a.source == 'daily':
        table, meta_key, prefix = ddb.Table('NovelRanks'), {'ID': 'AVAILABLE_DATES', 'Date': 'ALL_DATES'}, 'STATS#'
    else:
        table, meta_key, prefix = ddb.Table('NovelFlowContest2026'), {'ID': 'CONTEST_AVAILABLE_DATES', 'Date': 'METADATA'}, 'DAILY_TAG_STATS#'
    dates = sorted(d for d in (table.get_item(Key=meta_key).get('Item') or {}).get('dates') or [] if d >= a.since)
    done = skipped = mismatched = 0
    for d in dates:
        stored = table.get_item(Key={'ID': f'{prefix}{d}', 'Date': d}, ProjectionExpression='TagCounts').get('Item')
        if not stored:
            skipped += 1
            continue
        rows = daily_rows(table, d) if a.source == 'daily' else contest_rows(ddb, table, d)
        stats = tag_stats.daily_tag_stats(rows) if a.source == 'daily' else C.daily_tag_stats(rows)
        if not stats:
            skipped += 1
            continue
        old = {k: int(v) for k, v in (stored.get('TagCounts') or {}).items()}
        raw_counts, raw_score = _unpruned(rows)
        if old == stats['TagCounts']:
            diff = set()
        else:   # 가지치기 전 STATS(2026-04-13 이전)
            diff = {t for t in set(old) | set(raw_counts) if t in old and old.get(t) != raw_counts.get(t)}
            stats['TagScoreSum'] = {t: raw_score.get(t, 0) for t in old}
        line = f"{d} N={stats['RankedTotal']} total={stats['ScoreTotal']} tags={len(stats['TagScoreSum'])}"
        if diff:
            # 그날 저장 뒤 행이 바뀌었거나(재적재 등) 정의가 어긋났다 — 쓰지 않고 알린다.
            mismatched += 1
            print(line, f'TagCounts 불일치 {len(diff)}개 (예: {sorted(diff)[:5]}) — 건너뜀')
            continue
        print(line, 'dry-run' if a.dry_run else 'updated')
        if not a.dry_run:
            table.update_item(Key={'ID': f'{prefix}{d}', 'Date': d},
                              UpdateExpression='SET TagScoreSum = :s, ScoreTotal = :t, RankedTotal = :n',
                              ConditionExpression='attribute_exists(ID)',
                              ExpressionAttributeValues={':s': stats['TagScoreSum'], ':t': stats['ScoreTotal'], ':n': stats['RankedTotal']})
        done += 1
    print(f"{a.source}: 날짜 {len(dates)} · {'계산' if a.dry_run else '갱신'} {done} · 통계 없음 {skipped} · 불일치 {mismatched}")


if __name__ == '__main__':
    main()
