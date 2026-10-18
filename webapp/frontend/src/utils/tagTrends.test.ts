import { describe, expect, it } from 'vitest';
import { buildTagTrends, crossesSampleChange, type TagSeriesResponse } from './tagTrends';

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
    expect(buildTagTrends(null).zones).toEqual([]);
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

describe('구역 바뀜(zones)', () => {
  // N=500: 흔한 기준 30편, 전체 20%(경계 ±2%p), 숨은 강자 5~29편 · 100위 안 4편 · 30% 이상
  const z = (count: [number, number], top: [number, number]) => ({ rank: [1, 1], score: [0.1, 0.1], count, top });
  const Z = (tags: TagSeriesResponse['tags']): TagSeriesResponse => ({ dates: ['2026-09-01', '2026-09-02'], tags, ranked_total: [500, 500] });

  it('첫날과 마지막 날 구역이 다른 태그만, 구역 없음 → 구역도 포함', () => {
    const r = buildTagTrends(Z({
      up: z([100, 100], [15, 25]),     // 과포화(15%) → 대세(25%)
      same: z([100, 100], [25, 30]),   // 대세 그대로
      gem: z([10, 12], [2, 5]),        // 구역 없음 → 숨은 강자(5편 · 42%)
    })).zones;
    expect(r.map(m => [m.tag, m.from, m.to])).toEqual([['gem', null, 'gem'], ['up', 'saturated', 'mainstream']].sort());
  });

  it('어느 한쪽이라도 경계(전체 ±2%p 안)면 뺀다 — 하루 사이에도 잘 바뀐다', () => {
    const r = buildTagTrends(Z({ edge: z([100, 100], [19, 21]) })).zones;   // 19% · 21% 모두 경계
    expect(r).toEqual([]);
  });

  it('N 이 없는 응답(구 백엔드)이면 구역을 판정하지 않는다', () => {
    const r = buildTagTrends({ dates: ['2026-09-01', '2026-09-02'], tags: { up: z([100, 100], [15, 25]) } }).zones;
    expect(r).toEqual([]);
  });
});

describe('crossesSampleChange', () => {
  it('2025-07-20(300 → 500편)을 사이에 두면 참', () => {
    expect(crossesSampleChange('2025-07-14', '2025-07-27')).toBe(true);
    expect(crossesSampleChange('2025-07-21', '2025-07-27')).toBe(false);
    expect(crossesSampleChange('2025-07-01', '2025-07-20')).toBe(false);
  });
});
