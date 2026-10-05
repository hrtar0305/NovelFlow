"""2026 공모전 개막일(2026-10-01)의 일간 순위를 소급한다 — 일회성(사용자 2026-10-05).

왜: 적재가 일간 순위를 '직전 수집 대비 누적 조회 증가'로 매기는데 10/01 은 직전 수집이 없어 비웠다. 그러나 공모전은
10/01 12:00 에 개막했고 참가작은 모두 0 에서 출발했다 — 누적 조회가 곧 그날 조회다. 적재 코드(`opening_day_ids`)는 고쳤고,
이 스크립트는 이미 적재된 10/01 행에 같은 계산을 얹는다. 원본 재계산(`reprocess`)을 쓰지 않는 이유: 10/04 이전 원본에는 회차
조회수가 없어 잔류율이 지워진다.

쓰는 것: 10/01 행의 `DailyRank`·`ViewDelta`·`IsNew` 세 필드(UpdateItem — 다른 필드는 그대로, 이미 DailyRank 가 있으면 건너뜀)와
`DAILY_TAG_STATS#2026-10-01`(없을 때만). 계산은 적재와 같은 함수(`daily_rank`·`daily_tag_stats`)다.

    python scripts/fix_contest2026_opening_day.py --dry-run
    python scripts/fix_contest2026_opening_day.py
"""
import argparse
import os
import sys
from decimal import Decimal

import boto3
from boto3.dynamodb.conditions import Key

os.environ.setdefault('DYNAMODB_TABLE_NAME', 'NovelFlowContest2026')
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'contests', '2026', 'contest_detail_parser'))
import consolidate_contest_data as C  # noqa: E402

DATE = '2026-10-01'


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--dry-run', action='store_true')
    a = ap.parse_args()
    ddb = boto3.resource('dynamodb', region_name='ap-northeast-2')
    t = ddb.Table(os.environ['DYNAMODB_TABLE_NAME'])
    ids, kw = [], {'IndexName': 'DateViewIndex', 'KeyConditionExpression': Key('Date').eq(DATE), 'ProjectionExpression': 'ID'}
    while True:
        r = t.query(**kw)
        ids += [it['ID'] for it in r['Items']]
        if 'LastEvaluatedKey' not in r:
            break
        kw['ExclusiveStartKey'] = r['LastEvaluatedKey']
    items = []
    for i in range(0, len(ids), 100):
        keys = [{'ID': x, 'Date': DATE} for x in ids[i:i + 100]]
        req = {t.name: {'Keys': keys, 'ProjectionExpression': 'ID, #d, #v, Tags, DailyRank', 'ExpressionAttributeNames': {'#d': 'Date', '#v': 'View'}}}
        while req:
            r = ddb.batch_get_item(RequestItems=req)
            items += r['Responses'][t.name]
            req = r.get('UnprocessedKeys') or None
    items = [{**it, 'ID': str(it['ID']), 'View': int(it['View'])} for it in items if not str(it['ID']).isalpha() and '#' not in str(it['ID'])]
    already = sum(1 for it in items if it.get('DailyRank') is not None)
    prev_date, _ = C._previous_views(t, DATE, 'fix-opening-day')
    assert prev_date is None, f'{DATE} 앞에 수집일이 있다({prev_date}) — 개막일 규칙을 쓸 날이 아니다'
    for it in items:
        it.pop('DailyRank', None)
    C.daily_rank(items, {}, C.opening_day_ids(None, DATE, items))
    ranked = sorted((it for it in items if 'DailyRank' in it), key=lambda x: x['DailyRank'])
    stats = C.daily_tag_stats(items)
    has_stats = 'Item' in t.get_item(Key={'ID': f'DAILY_TAG_STATS#{DATE}', 'Date': DATE})
    print(f'{DATE} 행 {len(items)} · 이미 일간 순위 있음 {already} · 순위 매김 {len(ranked)} · 값 없음(-1 등) {len(items) - len(ranked)}')
    print('상위 5:', [(x['DailyRank'], x['ID'], x['ViewDelta']) for x in ranked[:5]])
    top = sorted(stats['TagWeightedScoresLogarithmic'].items(), key=lambda kv: -kv[1])[:5]
    print(f"태그 통계: 태그 {len(stats['TagCounts'])} · RankedTotal {stats['RankedTotal']} · 상위 {[(k, round(v, 1)) for k, v in top]} · 이미 있음 {has_stats}")
    if a.dry_run:
        print('dry-run — 쓰지 않음')
        return
    done = skipped = 0
    for it in ranked:
        try:
            t.update_item(Key={'ID': it['ID'], 'Date': DATE},
                          UpdateExpression='SET DailyRank = :r, ViewDelta = :d, IsNew = :n',
                          ConditionExpression='attribute_exists(ID) AND attribute_not_exists(DailyRank)',
                          ExpressionAttributeValues={':r': it['DailyRank'], ':d': it['ViewDelta'], ':n': True})
            done += 1
        except t.meta.client.exceptions.ConditionalCheckFailedException:
            skipped += 1
    if not has_stats:
        C._store_daily_tag_stats(t, 'fix-opening-day', [{**it, 'Date': DATE} for it in items])
    print(f'썼음 {done} · 건너뜀 {skipped} · 태그 통계 {"썼음" if not has_stats else "이미 있어 건너뜀"}')


if __name__ == '__main__':
    main()
