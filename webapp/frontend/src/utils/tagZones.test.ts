import { describe, expect, it } from 'vitest';
import { CONTEST_RULES, shareAxis, formatTop, nextTagSort, sortTags, withZones, zoneCounts, zoneOf, type DailyTag } from './tagZones';

const t = (Rank: number, count: number, local_lift: number | null, power_score = 10 - Rank): DailyTag =>
  ({ Rank, tag: `t${Rank}`, count, local_lift, power_score });

describe('zoneOf (하루 판정, 데일리 N=500)', () => {
  const z = (count: number, top100: number) => zoneOf({ count, top100, ranked_total: 500 });
  it('흔한 태그(30편 이상)는 100위 안 비율 20% 를 기준으로 대세 · 과포화', () => {
    expect(z(30, 6).zone).toBe('mainstream');
    expect(z(100, 19).zone).toBe('saturated');
    expect(z(29, 9).zone).toBe('gem');            // 29편은 흔한 태그가 아니다
  });
  it('평균의 ±10%(데일리 ±2%p)는 경계', () => {
    expect(z(100, 22)).toEqual({ zone: 'mainstream', edge: true });
    expect(z(100, 18)).toEqual({ zone: 'saturated', edge: true });
    expect(z(100, 23).edge).toBe(false);
  });
  it('숨은 강자 = 5~29편 · 100위 안 4편 이상 · 30% 이상', () => {
    expect(z(13, 4).zone).toBe('gem');
    expect(z(16, 3).zone).toBeNull();     // 3편 — 판단 보류
    expect(z(20, 5).zone).toBeNull();     // 25%
    expect(z(4, 4).zone).toBeNull();      // 5편 미만
  });
  it('N 이 100 이하면 구역 없음', () => {
    expect(zoneOf({ count: 50, top100: 40, ranked_total: 90 }).zone).toBeNull();
  });
  it('100위 안 · N 정보가 없으면 구역 없음', () => {
    expect(zoneOf({ count: 50, top100: null, ranked_total: 500 }).zone).toBeNull();
    expect(zoneOf({ count: 50, top100: 20, ranked_total: null }).zone).toBeNull();
  });
  it('공모전은 숨은 강자에 100위 안 6편 이상', () => {
    const c = (count: number, top100: number) => zoneOf({ count, top100, ranked_total: 3000 }, CONTEST_RULES).zone;
    expect(c(100, 5)).toBeNull();           // 5% · 5편
    expect(c(100, 6)).toBe('gem');           // 6% ≥ 1.5 × 3.3%
    expect(c(180, 7)).toBe('mainstream');    // 180편 = 6% · 3.9% ≥ 3.3%
  });
});

describe('withZones / zoneCounts', () => {
  it('구역 없는 태그는 세지 않는다', () => {
    const rows = withZones([
      { ...t(1, 40, null), top100: 10, ranked_total: 500 },
      { ...t(2, 40, null), top100: 4, ranked_total: 500 },
      { ...t(3, 10, null), top100: 4, ranked_total: 500 },
      { ...t(4, 10, null), top100: 1, ranked_total: 500 },
    ]);
    expect(rows.map(r => r.zone)).toEqual(['mainstream', 'saturated', 'gem', null]);
    expect(zoneCounts(rows)).toEqual({ mainstream: 1, gem: 1, saturated: 1 });
  });
});

describe('sortTags', () => {
  const rows = [t(1, 10, null), t(2, 20, 1.5), t(3, 30, 0.4), t(4, 30, 2.0)];
  it('동점은 순위 순', () => {
    expect(sortTags(rows, { key: 'count', direction: 'descending' }).map(r => r.Rank)).toEqual([3, 4, 2, 1]);
  });
  it('100위 안 비율로 정렬', () => {
    const r2 = [{ ...t(1, 10, null), top100: 1 }, { ...t(2, 10, null), top100: 5 }, { ...t(3, 10, null), top100: null }];
    expect(sortTags(r2, { key: 'top_share', direction: 'descending' }).map(r => r.Rank)).toEqual([2, 1, 3]);
  });
  it('작품 5편 미만은 비율이 없는 것으로 쳐 끝에 둔다 — 2편 중 2편(100%)이 맨 위를 차지했다', () => {
    const r3 = [{ ...t(1, 300, null), top100: 70 }, { ...t(2, 2, null), top100: 2 }, { ...t(3, 8, null), top100: 4 }];
    expect(sortTags(r3, { key: 'top_share', direction: 'descending' }).map(r => r.Rank)).toEqual([3, 1, 2]);
  });
});

describe('nextTagSort', () => {
  it('새 열은 순위만 오름차순, 나머지는 내림차순으로 시작', () => {
    expect(nextTagSort({ key: 'count', direction: 'descending' }, 'Rank')).toEqual({ key: 'Rank', direction: 'ascending' });
    expect(nextTagSort({ key: 'Rank', direction: 'ascending' }, 'count')).toEqual({ key: 'count', direction: 'descending' });
    expect(nextTagSort({ key: 'count', direction: 'descending' }, 'count')).toEqual({ key: 'count', direction: 'ascending' });
  });
});

describe('formatTop', () => {
  it('평균이 10% 이상(데일리)이면 정수 %, 그보다 작으면(공모전 3.4%) 소수 한 자리 — 3.41% 와 3.34% 가 둘 다 3% 로 보였다', () => {
    expect(formatTop({ count: 150, top100: 37, ranked_total: 500 })).toBe('37편 · 25%');
    expect(formatTop({ count: 381, top100: 13, ranked_total: 2981 })).toBe('13편 · 3.4%');
    expect(formatTop({ count: 10, top100: null, ranked_total: 500 })).toBe('–');
    expect(formatTop({ count: 3, top100: 2, ranked_total: 500 })).toBe('2편');   // 5편 미만은 편수만
  });
});


describe('shareAxis (지형 지도 세로축)', () => {
  it('가장 높은 점이 위 끝에 붙지 않게 한 칸 여유를 둔다 — 평균 3배(60%)에 딱 걸린 점이 테두리에 붙어 누르기 어려웠다', () => {
    const a = shareAxis(0.2, 0.6);
    expect(a.top).toBeGreaterThan(0.6);
    expect(a.ticks.at(-1)).toBe(a.top);
  });
  it('평균 3배보다 높은 점(100%)도 자르지 않는다', () => {
    expect(shareAxis(0.2, 1).top).toBeGreaterThan(1);
  });
  it('점이 낮으면 평균 3배까지는 보인다(구역선 자리)', () => {
    expect(shareAxis(0.2, 0.3).top).toBeGreaterThanOrEqual(0.6);
    expect(shareAxis(0.034, 0.05).top).toBeGreaterThanOrEqual(0.102);
  });
  it('아래 끝도 0 보다 조금 아래 — 0% 점이 축선에 겹치지 않게', () => {
    expect(shareAxis(0.2, 0.6).bottom).toBeLessThan(0);
    expect(shareAxis(0.2, 0.6).ticks[0]).toBe(0);
  });
});
