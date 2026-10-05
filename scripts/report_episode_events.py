"""연재 기록(NovelFlowEpisodeHistory) 감시 집계 — 읽기만 한다(DECISIONS 2026-10-05 '앞으로 계속 감시').

연재 줄은 실제 회차 목록에서 세지만, 목록이 우리 가정과 다르게 움직이는 경우를 지켜본다:
  * 사라진 회차(gone_at) — 삭제·비공개. 삭제 후 재업로드면 같은 날 새 고유 번호가 함께 생긴다(이중 계산 — 자정 걸치면 허용).
  * 늦은 등장 — 처음 본 날이 목록 날짜보다 2일 이상 뒤(처음 본 시각이 있는 것만 — 백필은 없다). 예약 공개가 작성일로 찍히거나,
    순위 밖이던 작품이 다시 들어와 메운 경우(데일리). 공모전에서 나오면 이상하다(매일 전 작품을 본다).
  * 예약 회차 관찰 수, 다 받지 못한 기록(Complete=false — 처음 본 긴 작품, 다음 확인이 이어 받는다).

    python scripts/report_episode_events.py [--days 7] [--show 10]
"""
import argparse
from datetime import date, datetime, timedelta, timezone

import boto3

KST = timezone(timedelta(hours=9))


def scan(table):
    kw = {}
    while True:
        page = table.scan(**kw)
        yield from page.get('Items', [])
        if 'LastEvaluatedKey' not in page:
            return
        kw['ExclusiveStartKey'] = page['LastEvaluatedKey']


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--days', type=int, default=7)
    ap.add_argument('--show', type=int, default=10)
    ap.add_argument('--table', default='NovelFlowEpisodeHistory')
    a = ap.parse_args()
    since = (datetime.now(KST).date() - timedelta(days=a.days)).isoformat()
    table = boto3.resource('dynamodb', region_name='ap-northeast-2').Table(a.table)
    works = incomplete = scheduled = 0
    gone, late = [], []
    for it in scan(table):
        works += 1
        incomplete += not it.get('Complete')
        scheduled += len(it.get('Scheduled') or [])
        for eid, (d, first_seen, gone_at) in (it.get('Episodes') or {}).items():
            if gone_at and gone_at[:10] >= since:
                gone.append((gone_at, it['NovelId'], eid, d))
            if first_seen and first_seen[:10] >= since and d and \
                    (date.fromisoformat(first_seen[:10]) - date.fromisoformat(d)).days >= 2:
                late.append((first_seen, it['NovelId'], eid, d))
    print(f'작품 {works} · 다 받지 못한 기록 {incomplete} · 예약 관찰 {scheduled}')
    print(f'최근 {a.days}일 사라진 회차 {len(gone)} · 늦은 등장(처음 본 날 − 목록 날짜 ≥ 2일) {len(late)}')
    for name, rows in (('사라짐', gone), ('늦은 등장', late)):
        for at, nid, eid, d in sorted(rows, reverse=True)[:a.show]:
            print(f'  {name}  작품 {nid}  회차 {eid}  목록 날짜 {d}  {"사라진" if name == "사라짐" else "처음 본"} 시각 {at}')


if __name__ == '__main__':
    main()
