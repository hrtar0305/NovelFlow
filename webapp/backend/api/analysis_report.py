"""데이터 분석 리포트의 계산부.

**I/O 도 성인작 판정도 여기서 하지 않는다.** `main.py` 가 스냅샷을 읽고 차단 목록을
적용한 뒤, 이미 걸러진 데이터를 넣어 준다. 판정 로직은 `_is_adult_item()` 한 곳에만
있어야 하므로 이 모듈은 그것을 모른다.

입력은 두 가지다:
  * `snaps`  — 날짜 오름차순의 압축 스냅샷. 행마다 id/rank/eps/view/like.
               (`RSNAP#<date>`, 적재 파이프라인이 매일 쓴다)
  * `end_rows` — 기간 마지막 날의 전체 행. 제목·작가·태그·잔류율이 여기 있다.
"""

from __future__ import annotations

import math
from typing import Any


# ── 기간 추천비 하한 ────────────────────────────────────────────────────────
# 기간 동안의 조회 증가분이 작으면 몇 건에 비율이 출렁인다. 30일 실측에서 258편 중
# 이 하한을 넘는 것이 258편이라 사실상 전부 남는다(음수 0건).
DELTA_VIEW_FLOOR = 5_000


def _pctl(sorted_vals: list[float], p: float) -> float | None:
    if not sorted_vals:
        return None
    return sorted_vals[min(len(sorted_vals) - 1, int(len(sorted_vals) * p))]


# ─────────────────────────────────────────────────────────────────────────────
# 기간 지표 (작품별)
# ─────────────────────────────────────────────────────────────────────────────

def per_work(snaps: list[dict]) -> dict[str, dict]:
    """기간 전체를 훑어 작품별 관측을 모은다.

    표본을 뽑지 않는다 — 기간 안의 **모든 수집일**이 들어온다. 그래서 최고 순위와
    평균 순위가 실제 값이 된다(표본 4개만 보던 때는 알 수 없었다).

    **자리표시(placeholder) 행은 순위로만 센다.** 크롤러가 상세를 못 읽은 작품은
    순위는 정상이고 회차·조회·추천이 0으로 실린다(스냅샷에는 표시가 따로 없다). 그 값을
    관측으로 쓰면 첫날이 자리표시인 작품은 `added_eps` 가 전체 회차가, `delta_view` 가 누적
    조회 전체가 된다. 랭킹에 든 실제 작품은 조회가 0일 수 없으므로 `view == 0 and eps == 0`
    을 결손으로 보고, `first_*`/`last_*`(값과 그 날짜)는 정상 행에서만 잡는다. 정상 행이
    하나도 없는 작품은 기간 증가량이 전부 None 이다. 순위 기준 마지막 날은 `dates[-1]`.
    """
    out: dict[str, dict] = {}
    for s in snaps:
        date = s['date']
        for i, nid in enumerate(s['ids']):
            w = out.get(nid)
            if w is None:
                w = out[nid] = {
                    'ranks': [], 'dates': [], 'value_obs': 0,
                    'first_eps': None, 'last_eps': None,
                    'first_view': None, 'last_view': None,
                    'first_like': None, 'last_like': None,
                    'first_date': None, 'last_date': None,
                }
            w['ranks'].append(s['rank'][i])
            w['dates'].append(date)
            if s['view'][i] == 0 and s['eps'][i] == 0:   # 자리표시: 값은 모른다
                continue
            if w['first_eps'] is None:
                w['first_eps'], w['first_view'] = s['eps'][i], s['view'][i]
                w['first_like'], w['first_date'] = s['like'][i], date
            w['last_eps'] = s['eps'][i]
            w['last_view'] = s['view'][i]
            w['last_like'] = s['like'][i]
            w['last_date'] = date
            w['value_obs'] += 1

    for w in out.values():
        rs = w['ranks']
        w['best_rank'] = min(rs)
        w['avg_rank'] = sum(rs) / len(rs)
        w['observations'] = len(rs)
        if w['first_eps'] is None:
            w['added_eps'] = w['per_week'] = None
            w['delta_view'] = w['period_ratio'] = None
            continue
        w['added_eps'] = w['last_eps'] - w['first_eps']
        span = _day_gap(w['first_date'], w['last_date'])
        w['per_week'] = (w['added_eps'] / span) * 7 if span else 0.0
        dv = w['last_view'] - w['first_view']
        dl = w['last_like'] - w['first_like']
        w['delta_view'] = dv
        # 기간 추천비. 응답의 누적 Like/View 와 **다른 값**이다 — 누적은 작품 전체
        # 역사이고 이것은 이 기간에 새로 읽은 사람들의 추천 비율이다.
        w['period_ratio'] = (dl / dv) if dv >= DELTA_VIEW_FLOOR else None
    return out


def _day_gap(a: str, b: str) -> int:
    from datetime import datetime
    d = (datetime.strptime(b, '%Y-%m-%d') - datetime.strptime(a, '%Y-%m-%d')).days
    return max(d, 0)


# ─────────────────────────────────────────────────────────────────────────────
# 연재 페이스 — 순위표가 아니라 분포로
# ─────────────────────────────────────────────────────────────────────────────

def pace_distribution(works: dict[str, dict], end_ids: set[str]) -> dict:
    """회차가 늘어난 작품 수와 그대로인 작품 수. 주당 회차 분위수(중앙값 · 상위 10% · 최대)는 뺐다 — 대부분 매일 연재라
    7 · 30 · 90일 모두 중앙값 약 7화, 상위 10% 약 8화로 기간과 무관했다(2026-10-18). 어떤 작품이 많이 올렸는지는 목록(pace_top)이 답한다.
    관측 횟수는 **값을 읽은 날**(자리표시 제외, `value_obs`)로 센다 — 순위만 있는 날로는 페이스를 잴 수 없다."""
    rows = [w for nid, w in works.items() if nid in end_ids and w['value_obs'] >= 2]
    return {
        'growing': sum(1 for w in rows if w['added_eps'] > 0),
        'flat': sum(1 for w in rows if w['added_eps'] == 0),
    }


# ─────────────────────────────────────────────────────────────────────────────
# 태그
# ─────────────────────────────────────────────────────────────────────────────

def tag_counts(rows: list[dict]) -> dict[str, int]:
    m: dict[str, int] = {}
    for r in rows:
        for t in dict.fromkeys(r.get('Tags') or []):
            m[t] = m.get(t, 0) + 1
    return m


def tag_combinations(rows: list[dict], size: int, min_count: int, top: int,
                     max_jaccard: float = 0.5, max_contain: float = 0.8) -> list[dict]:
    """같이 달린 태그 조합(2026-09-30 개편). 흔한 태그끼리는 그냥 자주 만나므로 빈도가 아니라
    **우연히 만날 때보다 몇 배인지**로 줄 세운다.

    - 두 태그: 기대값 = c(a)·c(b)/N. 달린 작품이 절반 이상 겹치는 짝(Jaccard ≥ 0.5)은 뺀다 —
      '현대판타지 + 현대'처럼 사실상 같은 말이라 조합이라 부를 수 없다. 작은 쪽의 80% 이상이 큰 쪽과 겹치는 짝도
      뺀다 — '버튜버(21편 중 20편) + 인터넷방송'은 Jaccard 0.4 라 앞 조건을 빠져나갔다(2026-10-07 리뷰).
    - 세 태그: 기대값 = 세 가지로 나눈 '두 태그 짝 + 나머지 하나' 중 가장 큰 값, 즉
      max(c(짝)·c(셋째)/N). 단순 lift(c(a)·c(b)·c(c)/N²)로 세면 이미 강한 짝 하나에 아무 태그나
      붙어도 배수가 커져, 목록이 그 짝의 변주로 찬다. 가장 강한 짝 대비로 세야 '셋이어야 생기는'
      조합이 남는다. 안에 든 짝이 하나라도 위 겹침 조건에 걸리면 뺀다.
    """
    from itertools import combinations
    n = max(len(rows), 1)
    solo = tag_counts(rows)
    pair: dict[tuple, int] = {}
    combo: dict[tuple, int] = {}
    for r in rows:
        tags = sorted(dict.fromkeys(r.get('Tags') or []))
        for c in combinations(tags, 2):
            pair[c] = pair.get(c, 0) + 1
        if size != 2 and len(tags) >= size:
            for c in combinations(tags, size):
                combo[c] = combo.get(c, 0) + 1
    if size == 2:
        combo = pair

    def overlaps(a: str, b: str) -> bool:
        both = pair.get((a, b), 0)
        union = solo.get(a, 0) + solo.get(b, 0) - both
        small = min(solo.get(a, 0), solo.get(b, 0))
        return union > 0 and (both / union >= max_jaccard or both / small >= max_contain)

    out = []
    for key, c in combo.items():
        if c < min_count:
            continue
        if any(overlaps(a, b) for a, b in combinations(key, 2)):
            continue
        if size == 2:
            expected = solo.get(key[0], 0) * solo.get(key[1], 0) / n
        else:
            expected = max(
                pair.get(tuple(sorted(p)), 0) * solo.get(next(t for t in key if t not in p), 0) / n
                for p in combinations(key, 2)
            )
        if expected <= 0:
            continue
        out.append({'tags': list(key), 'count': c, 'lift': c / expected})
    out.sort(key=lambda x: (-x['lift'], -x['count']))
    return out[:top]


# ─────────────────────────────────────────────────────────────────────────────
# 순위대 — 임의 구간이 아니라 그 기간 목록의 4분위
# ─────────────────────────────────────────────────────────────────────────────

def rank_quartiles(avg_ranks: list[float]) -> list[dict]:
    """작품을 견줄 순위대를 **그 기간 목록의 4분위**로 나눈다.

    1~50 / 51~150 같은 고정 구간은 근거가 없고, 성인작 제외로 실제 편수가 날마다
    달라 구간별 표본이 흔들린다. 4분위는 어느 기간에서든 각 구간에 같은 수가 든다.

    기준 순위는 **기간 평균 순위**다. 마지막 날 순위 하나로 정하면 그날 우연히
    튄 작품이 엉뚱한 구간에 들어간다 — 기간 리포트이므로 기간 값을 쓴다.
    """
    if len(avg_ranks) < 8:
        return []
    xs = sorted(avg_ranks)
    cuts = [xs[int(len(xs) * q)] for q in (0.25, 0.5, 0.75)]
    edges = [(0.0, cuts[0]), (cuts[0], cuts[1]), (cuts[1], cuts[2]),
             (cuts[2], float('inf'))]
    names = ['상위 25%', '상위 25~50%', '상위 50~75%', '하위 25%']
    out = []
    for name, (lo, hi) in zip(names, edges):
        cnt = sum(1 for r in xs if lo <= r < hi)
        out.append({
            'label': name, 'min': lo,
            'max': None if hi == float('inf') else hi,
            'count': cnt,
        })
    return out


def band_of(avg_rank: float, quartiles: list[dict]) -> int | None:
    for i, q in enumerate(quartiles):
        if avg_rank >= q['min'] and (q['max'] is None or avg_rank < q['max']):
            return i
    return None
