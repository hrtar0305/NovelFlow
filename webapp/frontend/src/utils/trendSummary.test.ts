import { describe, expect, it } from 'vitest';
import { isOutOfRank, windowOf } from './trendSummary';

describe('isOutOfRank', () => {
  it('2025-07-21 이후 501위 이상은 순위권 밖', () => {
    expect(isOutOfRank(500, '2026-09-01')).toBe(false);
    expect(isOutOfRank(501, '2026-09-01')).toBe(true);
  });
  it('2025-07-20 이전은 301위부터 순위권 밖', () => {
    expect(isOutOfRank(301, '2025-07-20')).toBe(true);
    expect(isOutOfRank(300, '2025-07-20')).toBe(false);
  });
  it('값이 없으면 순위권 밖', () => expect(isOutOfRank(null, '2026-09-01')).toBe(true));
});

describe('windowOf', () => {
  it('끝 날짜를 포함해 앞쪽 수집일 N개(빠진 날은 건너뜀)', () => {
    const dates = ['2026-09-20', '2026-09-22', '2026-09-23', '2026-09-24', '2026-09-26'];
    expect(windowOf(dates, '2026-09-24', 3)).toEqual(['2026-09-22', '2026-09-23', '2026-09-24']);
    expect(windowOf(dates, '2026-09-21', 3)).toEqual(['2026-09-20']);
  });
});
