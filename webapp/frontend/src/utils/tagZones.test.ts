import { describe, expect, it } from 'vitest';
import { CONTEST_RULES, formatLift, formatShare, nextTagSort, sortTags, withZones, zoneCounts, zoneOf, type DailyTag } from './tagZones';

const t = (Rank: number, count: number, local_lift: number | null, rank_change: DailyTag['rank_change'] = 0, power_score = 10 - Rank): DailyTag =>
  ({ Rank, tag: `t${Rank}`, count, local_lift, rank_change, power_score });

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
  const rows = [t(1, 10, null, 3), t(2, 20, 1.5, 'New'), t(3, 30, 0.4, null), t(4, 30, 2.0, -5)];
  it('빈 값은 방향과 무관하게 끝', () => {
    expect(sortTags(rows, { key: 'local_lift', direction: 'descending' }).map(r => r.Rank)).toEqual([4, 2, 3, 1]);
    expect(sortTags(rows, { key: 'local_lift', direction: 'ascending' }).map(r => r.Rank)).toEqual([3, 2, 4, 1]);
  });
  it('변동 내림차순은 NEW → 상승 → 하락, 비교 불가는 끝', () => {
    expect(sortTags(rows, { key: 'rank_change', direction: 'descending' }).map(r => r.Rank)).toEqual([2, 1, 4, 3]);
    expect(sortTags(rows, { key: 'rank_change', direction: 'ascending' }).map(r => r.Rank)).toEqual([4, 1, 2, 3]);
  });
  it('동점은 순위 순', () => {
    expect(sortTags(rows, { key: 'count', direction: 'descending' }).map(r => r.Rank)).toEqual([3, 4, 2, 1]);
  });
  it('100위 안 비율로 정렬', () => {
    const r2 = [{ ...t(1, 10, null), top100: 1 }, { ...t(2, 10, null), top100: 5 }, { ...t(3, 10, null), top100: null }];
    expect(sortTags(r2, { key: 'top_share', direction: 'descending' }).map(r => r.Rank)).toEqual([2, 1, 3]);
  });
});

describe('nextTagSort', () => {
  it('새 열은 순위만 오름차순, 나머지는 내림차순으로 시작', () => {
    expect(nextTagSort({ key: 'count', direction: 'descending' }, 'Rank')).toEqual({ key: 'Rank', direction: 'ascending' });
    expect(nextTagSort({ key: 'Rank', direction: 'ascending' }, 'count')).toEqual({ key: 'count', direction: 'descending' });
    expect(nextTagSort({ key: 'count', direction: 'descending' }, 'count')).toEqual({ key: 'count', direction: 'ascending' });
  });
});

describe('formatShare / formatLift', () => {
  it('점유율은 소수 한 자리 %, 없으면 –', () => {
    expect(formatShare(0.6677)).toBe('66.8%');
    expect(formatShare(0.004)).toBe('0.4%');
    expect(formatShare(null)).toBe('–');
  });
  it('배수는 소수 한 자리 + ×', () => {
    expect(formatLift(1.26)).toBe('1.3×');
    expect(formatLift(null)).toBe('–');
  });
});
