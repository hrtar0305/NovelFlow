import { describe, expect, it } from 'vitest';
import { buildTagTrends, computeChurn, type TagSeriesResponse } from './tagTrends';

const row = (rank: (number | null)[], count: number | (number | null)[] = 10) => ({
  rank,
  count: Array.isArray(count) ? count : rank.map(r => (r == null ? null : count)),
  score: rank.map(r => (r == null ? null : 100 / r)),
  lift: rank.map(() => null),
});
const S = (tags: TagSeriesResponse['tags'], n = 4): TagSeriesResponse => ({ dates: ['2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04'].slice(0, n), tags });

describe('buildTagTrends', () => {
  it('수집일이 2일 미만이면 빈 목록', () => {
    expect(buildTagTrends(S({ a: row([1]) }, 1)).risers).toEqual([]);
    expect(buildTagTrends(null).churn).toBeNull();
  });

  it('시작에 없고 끝에 있으면 들어옴, 반대면 빠짐 — 뜬·식은에는 넣지 않는다', () => {
    const r = buildTagTrends(S({ a: row([null, 5, 4, 3]), b: row([7, 8, null, null]), c: row([2, 2, 2, 2]) }));
    expect(r.entered.map(e => e.tag)).toEqual(['a']);
    expect(r.left.map(e => e.tag)).toEqual(['b']);
    expect([...r.risers, ...r.fallers].map(t => t.tag)).toEqual([]);
  });

  it('들어옴은 끝날, 빠짐은 첫날 작품 5편 이상만 — 1↔2편을 오가며 깜빡이는 꼬리 태그를 거른다', () => {
    const r = buildTagTrends(S({ a: row([null, 90, 88, 85], 2), b: row([95, 96, null, null], 2), c: row([null, 40, 38, 30], 6), d: row([50, 52, null, null], 7) }));
    expect(r.entered.map(e => e.tag)).toEqual(['c']);
    expect(r.left.map(e => e.tag)).toEqual(['d']);
  });

  it('작품 5편 미만(시작 또는 끝)은 뜬·식은에서 뺀다', () => {
    const r = buildTagTrends(S({ a: row([20, 15, 12, 10], [4, 6, 6, 6]), b: row([30, 25, 22, 21]) }));
    expect(r.risers.map(t => t.tag)).toEqual(['b']);
  });

  it('뜬 태그는 순위 변동 큰 순, 식은 태그는 하락 큰 순', () => {
    const r = buildTagTrends(S({ a: row([10, 9, 8, 7]), b: row([20, 15, 12, 10]), c: row([5, 6, 8, 9]), d: row([3, 3, 4, 4]) }));
    expect(r.risers.map(t => t.tag)).toEqual(['b', 'a']);
    expect(r.fallers.map(t => t.tag)).toEqual(['c', 'd']);
    expect(r.risers[0]).toMatchObject({ rankChange: 10, bestRank: 10 });
  });

  it('치솟음은 시작·끝 중 나은 쪽보다 3계단 이상 위로 갔던 태그', () => {
    const r = buildTagTrends(S({ a: row([40, 30, 38, 41]), b: row([40, 38, 39, 40]) }));
    expect(r.spikes.map(t => [t.tag, t.spike])).toEqual([['a', 10]]);
  });

  it('출렁임은 기록 4일 이상만', () => {
    const r = buildTagTrends(S({ a: row([10, null, 30, 10]), b: row([10, 20, 15, 12]) }));
    expect(r.swings.map(t => t.tag)).toEqual(['b']);
  });
});

describe('computeChurn', () => {
  it('순서가 그대로면 τ = 1, 완전히 뒤집히면 −1', () => {
    const same = computeChurn({ a: row([1, 1]), b: row([2, 2]), c: row([3, 3]) }, 1)!;
    expect(same).toMatchObject({ footrule: 0, tau: 1, common: 3 });
    const flip = computeChurn({ a: row([1, 3]), b: row([2, 2]), c: row([3, 1]) }, 1)!;
    expect(flip.tau).toBe(-1);
    expect(flip.footrule).toBeCloseTo(4 / 3);
  });
  it('양쪽에 다 있는 태그가 2개 미만이면 null', () => {
    expect(computeChurn({ a: row([1, 1]), b: row([2, null]) }, 1)).toBeNull();
  });
});
