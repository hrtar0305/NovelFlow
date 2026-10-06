"""데일리 태그 통계(STATS#{date}) 계산 — 적재(data_ingestion)와 소급(scripts/backfill_tag_score_sum.py)이 같이 쓴다.

태그 랭킹은 그날 하루로 판단한다(DECISIONS 2026-10-06): 작품 수 · 100위 안 작품 수 · 인기 점수(랭킹 점수 점유율).
`TagScoreSum`/`ScoreTotal` 이 인기 점수의 재료다 — 노벨피아가 매긴 랭킹 점수를 그대로 더해, 순위에 따른 인기 차이가 임의 가중치
없이 들어간다. `TagWeightedScoresLogarithmic`(Σ1/ln(rank+1))은 기간 페이지가 아직 쓰므로 남긴다.
등장 2회 미만 태그는 노이즈라 뺀다(용량이 아니라 노이즈 — DECISIONS 2026-04-13 정정). 전체 합(`ScoreTotal`)과 작품 수(`RankedTotal`)는
가지치기와 무관하게 순위가 있는 모든 행이다.
"""
import math


def daily_tag_stats(items):
    counts, top100, logw, score_sum = {}, {}, {}, {}
    total, ranked = 0, 0
    for item in items:
        rank = item.get('Ranking')
        if not isinstance(rank, int) or rank <= 0:
            continue
        score = int(item.get('Score') or 0)
        ranked += 1
        total += score
        w = 1 / math.log(rank + 1)
        for tag in item.get('Tags') or []:
            counts[tag] = counts.get(tag, 0) + 1
            logw[tag] = logw.get(tag, 0) + w
            score_sum[tag] = score_sum.get(tag, 0) + score
            if rank <= 100:
                top100[tag] = top100.get(tag, 0) + 1
    for tag in [t for t, c in counts.items() if c < 2]:
        for m in (counts, top100, logw, score_sum):
            m.pop(tag, None)
    return {'TagCounts': counts, 'TagCountsTop100': top100, 'TagWeightedScoresLogarithmic': logw,
            'TagScoreSum': score_sum, 'ScoreTotal': total, 'RankedTotal': ranked}
