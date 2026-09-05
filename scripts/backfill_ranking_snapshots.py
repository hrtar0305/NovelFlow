"""데이터 분석 리포트가 읽는 날짜별 압축 스냅샷(`RSNAP#<date>`)을 과거 날짜에 채운다.

무엇을 위한 스크립트인가
    분석 리포트는 기간 전체(최대 90일)를 봐야 한다. 그런데 날짜당 랭킹은 364행
    340KB이고 `DateRankIndex` 조회가 웜 0.37초·콜드 30초다. 90일을 요청 시점에
    모으면 API Gateway 29초 제한을 넘고 브라우저 페이로드도 30MB가 된다.

    그래서 적재 파이프라인(`data-pipeline/data_ingestion.py`)이 날짜마다 16KB짜리
    압축 스냅샷을 남기고, 백엔드가 `batch_get_item` 한 번(100키)으로 다 읽는다.
    이 스크립트는 **파이프라인 변경 이전 날짜들**을 같은 형식으로 소급 생성한다.
    돌리지 않으면 리포트가 배포일 이후 날짜만 보게 되고, 90일 창이 다 차기까지
    3개월이 걸린다.

성인작을 걸러내지 않는 이유
    `IsAdult`를 그대로 실어 보내고 판정은 백엔드 `_is_adult_item()` 한 곳에서만 한다.
    차단 목록(`ADULT_BLOCKLIST`)은 과거 전 기간을 덮고 언제든 갱신되므로, 적재
    시점에 굳혀 버리면 나중에 추가된 작품이 리포트에 남는다. 판정 로직을 두 군데
    두지 않는 것이 이 설계의 핵심이다.

사용법
    python scripts/backfill_ranking_snapshots.py                 # 최근 90일
    python scripts/backfill_ranking_snapshots.py --days 180
    python scripts/backfill_ranking_snapshots.py --dry-run       # 저장 없이 크기만
    python scripts/backfill_ranking_snapshots.py --overwrite     # 이미 있는 것도 다시
"""

import argparse
import os
import sys
import time

import boto3
from boto3.dynamodb.conditions import Key

TABLE_NAME = os.environ.get('DYNAMODB_TABLE_NAME', 'NovelRanks')
AVAILABLE_DATES_KEY = {'ID': 'AVAILABLE_DATES', 'Date': 'ALL_DATES'}


def available_dates(table, days):
    item = table.get_item(Key=AVAILABLE_DATES_KEY).get('Item') or {}
    dates = sorted(item.get('dates') or [], reverse=True)
    if not dates:
        sys.exit('AVAILABLE_DATES 항목이 비어 있다 — 적재가 한 번도 돌지 않았다.')
    return dates[:days]


def query_date(table, date):
    """그 날짜의 랭킹 전량. 스냅샷에 담을 필드만 받는다(전 속성이면 읽기가 20배).

    `Like`·`View`·`Rank`는 DynamoDB 예약어라 `#` 별칭이 필요하다.
    """
    rows, args = [], {
        'IndexName': 'DateRankIndex',
        'KeyConditionExpression': Key('Date').eq(date),
        'ProjectionExpression': 'ID, Ranking, Eps, #v, #l, IsAdult',
        'ExpressionAttributeNames': {'#v': 'View', '#l': 'Like'},
    }
    while True:
        page = table.query(**args)
        rows.extend(page.get('Items', []))
        if 'LastEvaluatedKey' not in page:
            return rows
        args['ExclusiveStartKey'] = page['LastEvaluatedKey']


def build_item(date, rows):
    """병렬 배열로 담는다 — 행마다 키 이름을 반복하면 항목이 몇 배로 커진다."""
    ids, rank, eps, view, like, adult = [], [], [], [], [], []
    for r in rows:
        if not r.get('ID'):
            continue
        ids.append(str(r['ID']))
        rank.append(int(r.get('Ranking') or 0))
        eps.append(int(r.get('Eps') or 0))
        view.append(int(r.get('View') or 0))
        like.append(int(r.get('Like') or 0))
        adult.append(bool(r.get('IsAdult')))
    return {
        'ID': f'RSNAP#{date}', 'Date': date,
        'ids': ids, 'rank': rank, 'eps': eps,
        'view': view, 'like': like, 'adult': adult,
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--days', type=int, default=90, help='최근 며칠까지 (기본 90)')
    ap.add_argument('--dry-run', action='store_true', help='저장하지 않고 크기만 본다')
    ap.add_argument('--overwrite', action='store_true', help='이미 있는 날짜도 다시 만든다')
    args = ap.parse_args()

    table = boto3.resource('dynamodb').Table(TABLE_NAME)
    dates = available_dates(table, args.days)
    print(f"대상 {len(dates)}일: {dates[-1]} ~ {dates[0]}")

    made = skipped = failed = 0
    total_rows = 0
    for i, date in enumerate(dates, 1):
        try:
            if not args.overwrite:
                got = table.get_item(
                    Key={'ID': f'RSNAP#{date}', 'Date': date},
                    ProjectionExpression='ID',
                ).get('Item')
                if got:
                    skipped += 1
                    continue

            rows = query_date(table, date)
            if not rows:
                print(f"  [{i}/{len(dates)}] {date} 행이 없다 — 건너뜀")
                skipped += 1
                continue

            item = build_item(date, rows)
            total_rows += len(item['ids'])
            if args.dry_run:
                print(f"  [{i}/{len(dates)}] {date} {len(item['ids'])}행 (저장 안 함)")
            else:
                table.put_item(Item=item)
                print(f"  [{i}/{len(dates)}] {date} {len(item['ids'])}행 저장")
            made += 1
            time.sleep(0.05)          # 쓰기 스로틀을 피한다
        except Exception as e:        # noqa: BLE001 — 한 날짜 실패로 전체를 멈추지 않는다
            print(f"  [{i}/{len(dates)}] {date} 실패: {e}")
            failed += 1

    print(f"\n생성 {made} · 건너뜀 {skipped} · 실패 {failed} · 총 {total_rows}행")
    if failed:
        sys.exit(1)


if __name__ == '__main__':
    main()
