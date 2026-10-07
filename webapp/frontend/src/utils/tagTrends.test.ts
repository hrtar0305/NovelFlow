import { describe, expect, it } from 'vitest';
import { buildTagTrends, computeChurn, crossesSampleChange, type TagSeriesResponse } from './tagTrends';

/** rank · 점유율(score, 0~1) · 작품 수. null = 그날 없음 */
const row = (rank: (number | null)[], score: (number | null)[], count: number | (number | null)[] = 10) => ({
  rank,
  score,
  count: Array.isArray(count) ? count : rank.map(r => (r == null ? null : count)),
  top: rank.map(() => null),
});
const S = (tags: TagSeriesResponse['tags'], n = 4): TagSeriesResponse => ({ dates: ['2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04'].slice(0, n), tags });

describe('buildTagTrends', () => {
  it('수집일이 2일 미만이면 빈 목록', () => {
    expect(buildTagTrends(S({ a: row([1], [0.5]) }, 1)).risers).toEqual([]);
    expect(buildTagTrends(null).churn).toBeNull();
  });

  it('뜬·식은 태그는 인기 점수(점유율) 변화 %p 순 — 순위가 그대로인 큰 태그의 흐름도 잡는다', () => {
    const r = buildTagTrends(S({
      big: row([5, 5, 5, 5], [0.326, 0.33, 0.35, 0.371]),     // +4.5%p, 순위 그대로
      tail: row([103, 90, 80, 75], [0.008, 0.01, 0.012, 0.014]), // +0.6%p, ▲28
      down: row([9, 9, 10, 10], [0.198, 0.19, 0.18, 0.169]),   // −2.9%p
    }));
    expect(r.risers.map(t => t.tag)).toEqual(['big', 'tail']);
    expect(r.fallers.map(t => t.tag)).toEqual(['down']);
    expect(r.risers[0].shareChange).toBeCloseTo(0.045);
    expect(r.risers[1]).toMatchObject({ rankChange: 28 });
  });

  it('변화가 ±0.2%p 미만이면 뜬·식은에 넣지 않는다', () => {
    const r = buildTagTrends(S({ a: row([20, 20, 20, 20], [0.1, 0.1, 0.1, 0.1015]), b: row([30, 30, 30, 30], [0.05, 0.05, 0.05, 0.0481]) }));
    expect([...r.risers, ...r.fallers]).toEqual([]);
  });

  it('작품 5편 미만(시작 또는 끝)은 뜬·식은에서 뺀다', () => {
    const r = buildTagTrends(S({ a: row([20, 15, 12, 10], [0.01, 0.02, 0.03, 0.04], [4, 6, 6, 6]), b: row([30, 25, 22, 21], [0.01, 0.02, 0.03, 0.04]) }));
    expect(r.risers.map(t => t.tag)).toEqual(['b']);
  });

  it('시작에 없고 끝에 있으면 들어옴, 반대면 빠짐 — 빠짐은 마지막으로 있던 날을 안다', () => {
    const r = buildTagTrends(S({ a: row([null, 5, 4, 3], [null, 0.1, 0.1, 0.1]), b: row([7, 8, null, null], [0.1, 0.1, null, null]), c: row([2, 2, 2, 2], [0.3, 0.3, 0.3, 0.3]) }));
    expect(r.entered.map(e => e.tag)).toEqual(['a']);
    expect(r.left.map(e => [e.tag, e.lastSeen])).toEqual([['b', '2026-09-02']]);
  });

  it('들어옴은 끝날, 빠짐은 첫날 작품 5편 이상만', () => {
    const r = buildTagTrends(S({ a: row([null, 90, 88, 85], [null, 0.01, 0.01, 0.01], 2), b: row([95, 96, null, null], [0.01, 0.01, null, null], 2), c: row([null, 40, 38, 30], [null, 0.02, 0.02, 0.02], 6), d: row([50, 52, null, null], [0.02, 0.02, null, null], 7) }));
    expect(r.entered.map(e => e.tag)).toEqual(['c']);
    expect(r.left.map(e => e.tag)).toEqual(['d']);
  });

  it('치솟았다 돌아옴 = 최고 점유율이 처음·끝보다 0.5%p 이상 높고, 처음과 끝 차이가 그 폭의 절반 이하', () => {
    const r = buildTagTrends(S({
      back: row([40, 30, 38, 41], [0.024, 0.041, 0.03, 0.026]),   // 2.4 → 4.1 → 2.6: 돌아옴
      stay: row([40, 30, 31, 31], [0.01, 0.019, 0.018, 0.018]),   // 1.0 → 1.9 → 1.8: 오른 채 머묾 — 아님
      small: row([40, 38, 39, 40], [0.02, 0.023, 0.021, 0.02]),  // 폭 0.3%p — 아님
    }));
    expect(r.spikes.map(t => t.tag)).toEqual(['back']);
    expect(r.spikes[0].spike).toBeCloseTo(0.015);
  });
});

describe('computeChurn', () => {
  it('순서가 그대로면 τ = 1, 완전히 뒤집히면 −1', () => {
    const same = computeChurn({ a: row([1, 1], [0.3, 0.3]), b: row([2, 2], [0.2, 0.2]), c: row([3, 3], [0.1, 0.1]) }, 1)!;
    expect(same).toMatchObject({ footrule: 0, tau: 1, common: 3 });
    const flip = computeChurn({ a: row([1, 3], [0.3, 0.1]), b: row([2, 2], [0.2, 0.2]), c: row([3, 1], [0.1, 0.3]) }, 1)!;
    expect(flip.tau).toBe(-1);
    expect(flip.footrule).toBeCloseTo(4 / 3);
  });
  it('양쪽에 다 있는 태그가 2개 미만이면 null', () => {
    expect(computeChurn({ a: row([1, 1], [0.3, 0.3]), b: row([2, null], [0.2, null]) }, 1)).toBeNull();
  });
  it('작품 5편 미만 태그는 세지 않는다 — 아래 목록과 같은 모집단', () => {
    const c = computeChurn({ a: row([1, 1], [0.3, 0.3]), b: row([2, 2], [0.2, 0.2]), tail: row([3, 9], [0.01, 0.005], 2) }, 1)!;
    expect(c).toMatchObject({ common: 2, footrule: 0 });
  });
});

describe('crossesSampleChange', () => {
  it('2025-07-20(300 → 500편)을 사이에 두면 참', () => {
    expect(crossesSampleChange('2025-07-14', '2025-07-27')).toBe(true);
    expect(crossesSampleChange('2025-07-21', '2025-07-27')).toBe(false);
    expect(crossesSampleChange('2025-07-01', '2025-07-20')).toBe(false);
  });
});
