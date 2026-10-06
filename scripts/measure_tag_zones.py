"""태그 구역 규칙(하루 판정, DECISIONS 2026-10-06)을 날짜 범위에 계산해 안정성과 예를 본다 — 쓰기 없음.

화면의 `webapp/frontend/src/utils/tagZones.ts` `zoneOf` 와 같은 규칙이다(바꾸면 둘 다):
  N = 순위 작품 수, p0 = 100/N, cut = ceil(cutShare·N)
  n ≥ cut → 비율 t/n ≥ p0 이면 대세, 아니면 과포화(|t/n ÷ p0 − 1| ≤ edge 면 경계 — 평균에 대한 상대 폭, 데일리 ±2%p)
  5 ≤ n < cut, t ≥ gemMinTop, t/n ≥ gemMult·p0 → 숨은 강자. N ≤ 100 이면 구역 없음.

    python scripts/measure_tag_zones.py --source daily --days 14
    python scripts/measure_tag_zones.py --source contest2026 --cut-share 0.03 --gem-mult 2 --edge 0.1
"""
import argparse
import math
from collections import Counter

import boto3

REGION = 'ap-northeast-2'


def zone_of(n, t, N, cut_share, gem_mult, gem_min_top, edge):
    if N <= 100 or t is None or n < 5:
        return None, False
    p0 = 100 / N
    cut = math.ceil(cut_share * N)
    share = t / n
    if n >= cut:
        return ('대세' if share >= p0 else '과포화'), abs(share / p0 - 1) <= edge + 1e-9
    if t >= gem_min_top and share >= gem_mult * p0 - 1e-9:   # 화면(tagZones.ts)과 같은 허용 오차 — 1.5·0.2 = 0.30000000000000004
        return '숨은 강자', False
    return None, False


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--source', choices=['daily', 'contest2026'], required=True)
    ap.add_argument('--days', type=int, default=14)
    ap.add_argument('--cut-share', type=float, default=0.06)
    ap.add_argument('--gem-mult', type=float, default=1.5)
    ap.add_argument('--gem-min-top', type=int, default=4)
    ap.add_argument('--edge', type=float, default=0.1)
    a = ap.parse_args()
    ddb = boto3.resource('dynamodb', region_name=REGION)
    if a.source == 'daily':
        table, meta, prefix = ddb.Table('NovelRanks'), {'ID': 'AVAILABLE_DATES', 'Date': 'ALL_DATES'}, 'STATS#'
    else:
        table, meta, prefix = ddb.Table('NovelFlowContest2026'), {'ID': 'CONTEST_AVAILABLE_DATES', 'Date': 'METADATA'}, 'DAILY_TAG_STATS#'
    dates = sorted((table.get_item(Key=meta).get('Item') or {}).get('dates') or [])[-a.days:]
    zones = {}
    for d in dates:
        it = table.get_item(Key={'ID': f'{prefix}{d}', 'Date': d}).get('Item')
        if not it or 'RankedTotal' not in it:
            print(d, '통계 없음')
            continue
        N = int(it['RankedTotal'])
        counts = {k: int(v) for k, v in it['TagCounts'].items()}
        top = {k: int(v) for k, v in (it.get('TagCountsTop100') or {}).items()}
        z = {}
        for tag, n in counts.items():
            zone, edge = zone_of(n, top.get(tag, 0), N, a.cut_share, a.gem_mult, a.gem_min_top, a.edge)
            z[tag] = (zone, edge, n, top.get(tag, 0))
        zones[d] = (N, z)
    ds = list(zones)
    flips, kept = [], Counter()
    seen = Counter()
    for x, y in zip(ds, ds[1:]):
        zx, zy = zones[x][1], zones[y][1]
        both = set(zx) & set(zy)
        flips.append(sum(1 for t in both if zx[t][0] != zy[t][0]))
        for t in both:
            if zx[t][0]:
                seen[zx[t][0]] += 1
                kept[zx[t][0]] += zy[t][0] == zx[t][0]
    last = ds[-1]
    N, z = zones[last]
    cnt = Counter(v[0] for v in z.values() if v[0])
    print(f"{a.source} {ds[0]}~{last} · 규칙 cut {a.cut_share:.0%}·N, 숨은 강자 {a.gem_mult}·p0 · {a.gem_min_top}편, 경계 평균의 ±{a.edge:.0%}")
    print(f"하루 구역 바뀜 평균 {sum(flips) / max(1, len(flips)):.1f}개 (날짜쌍 {len(flips)})")
    print('다음 날 유지율', {k: f'{kept[k] / seen[k]:.0%}' for k in seen})
    print(f"{last} N={N} p0={100 / N:.1%} cut={math.ceil(a.cut_share * N)}편 · 구역 {dict(cnt)} · 경계 {sum(1 for v in z.values() if v[1])} · 없음 {sum(1 for v in z.values() if not v[0])}")
    for name in ('대세', '과포화', '숨은 강자'):
        ex = sorted(((t, v[2], v[3]) for t, v in z.items() if v[0] == name), key=lambda r: -r[1])[:6]
        print(f"  {name}: " + ', '.join(f"{t} {n}/{tp}/{tp / n:.0%}" for t, n, tp in ex))


if __name__ == '__main__':
    main()
