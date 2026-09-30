import { describe, expect, it } from 'vitest';
import { formatLift, mainstreamCut, nextTagSort, sortTags, withZones, zoneCounts, zoneOf, type DailyTag } from './tagZones';

const t = (Rank: number, count: number, local_lift: number | null, rank_change: DailyTag['rank_change'] = 0, power_score = 10 - Rank): DailyTag =>
  ({ Rank, tag: `t${Rank}`, count, local_lift, rank_change, power_score });

describe('mainstreamCut', () => {
  it('집중도가 있는 태그만으로 P75를 잡는다', () => {
    const tags = [t(1, 10, 1), t(2, 20, 1), t(3, 30, 1), t(4, 40, 1), t(5, 999, null)];
    expect(mainstreamCut(tags)).toBe(40);
  });
  it('집중도가 하나도 없으면 null', () => {
    expect(mainstreamCut([t(1, 3, null)])).toBeNull();
  });
});

describe('zoneOf', () => {
  it('경계값은 위쪽 구역에 넣는다', () => {
    expect(zoneOf(40, 1, 40)).toBe('mainstream');
    expect(zoneOf(40, 0.99, 40)).toBe('saturated');
    expect(zoneOf(39, 1, 40)).toBe('gem');
    expect(zoneOf(39, 0.5, 40)).toBe('cold');
  });
  it('집중도가 없으면 구역도 없다', () => {
    expect(zoneOf(100, null, 40)).toBeNull();
  });
});

describe('withZones / zoneCounts', () => {
  it('구역 없는 태그는 세지 않는다', () => {
    const rows = withZones([t(1, 10, 2), t(2, 20, 0.5), t(3, 30, 1.5), t(4, 40, 0.2), t(5, 2, null)]);
    expect(rows.map(r => r.zone)).toEqual(['gem', 'cold', 'gem', 'saturated', null]);
    expect(zoneCounts(rows)).toEqual({ mainstream: 0, gem: 2, saturated: 1, cold: 1 });
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
});

describe('nextTagSort', () => {
  it('새 열은 순위만 오름차순, 나머지는 내림차순으로 시작', () => {
    expect(nextTagSort({ key: 'count', direction: 'descending' }, 'Rank')).toEqual({ key: 'Rank', direction: 'ascending' });
    expect(nextTagSort({ key: 'Rank', direction: 'ascending' }, 'count')).toEqual({ key: 'count', direction: 'descending' });
    expect(nextTagSort({ key: 'count', direction: 'descending' }, 'count')).toEqual({ key: 'count', direction: 'ascending' });
  });
});

describe('formatLift', () => {
  it('소수 한 자리 + ×, 없으면 –', () => {
    expect(formatLift(1.26)).toBe('1.3×');
    expect(formatLift(null)).toBe('–');
  });
});
