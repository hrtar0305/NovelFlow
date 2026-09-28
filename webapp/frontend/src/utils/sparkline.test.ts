import { describe, expect, it } from 'vitest';
import { rankPath } from './sparkline';

describe('rankPath', () => {
  it('1위가 위, 큰 순위가 아래', () => {
    const r = rankPath([10, 1], 100, 50, 0);
    expect(r.d.startsWith('M0.0,')).toBe(true);
    const ys = [...r.d.matchAll(/[ML][\d.]+,([\d.]+)/g)].map(m => Number(m[1]));
    expect(ys[0]).toBeGreaterThan(ys[1]);
  });
  it('순위권 밖(null)에서 선이 끊긴다', () => {
    const r = rankPath([5, null, 3, 2], 90, 30);
    expect(r.d.match(/M/g)).toHaveLength(2);
  });
  it('마지막 점과 최고 순위 점', () => {
    const r = rankPath([30, 4, 8], 80, 40);
    expect(r.best?.rank).toBe(4);
    expect(r.last).not.toBeNull();
  });
  it('값이 하나도 없으면 빈 경로', () => {
    expect(rankPath([null, null], 50, 20)).toEqual({ d: '', last: null, best: null });
  });
});
