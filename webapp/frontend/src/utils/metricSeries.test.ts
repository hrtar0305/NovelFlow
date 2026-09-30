import { describe, expect, it } from 'vitest';
import { buildMetricPoints, rankTicks, signed, summarizeMetrics, type MetricRow } from './metricSeries';

const rec = (Date: string, Ranking: number | null, View: number, extra: Partial<MetricRow> = {}): MetricRow =>
  ({ Date, Ranking, View, Like: View / 10, Fav: 100, Eps: 10, Alr: 5, Score: 1000, ...extra });
const out = (Date: string): MetricRow => ({ Date, Ranking: null, View: null });

describe('buildMetricPoints', () => {
  const rows = [rec('2026-09-01', 50, 1000), rec('2026-09-02', 40, 1500, { Eps: 11 }), out('2026-09-03'), out('2026-09-04'), rec('2026-09-05', 45, 2400, { Eps: 12 })];
  const pts = buildMetricPoints(rows, 'calendar');

  it('증가량은 직전 기록 대비, 첫 기록은 null', () => {
    expect(pts[0].d).toBeNull();
    expect(pts[1].d).toMatchObject({ view: 500, eps: 1 });
    expect(pts[1].span).toBe(1);
  });
  it('순위권 밖을 건너뛴 증가량은 여러 날치(span)', () => {
    expect(pts[4]).toMatchObject({ span: 3, d: { view: 900, eps: 1 } });
    expect(pts[2]).toMatchObject({ rec: false, d: null, rank: null });
  });
  it('일간 변동: 전날 기록 없으면 NEW, 전날이 창 밖이면 비교 불가', () => {
    expect(pts[0].change).toBeNull();
    expect(pts[1].change).toBe(10);
    expect(pts[4].change).toBe('New');
  });
  it('일간 변동: 전날이 수집되지 않아 표에 없으면 비교 불가(달력 기준)', () => {
    const p = buildMetricPoints([rec('2026-09-01', 50, 1000), rec('2026-09-03', 40, 1500)], 'calendar');
    expect(p[1].change).toBeNull();
    expect(p[1].span).toBe(2);
  });
  it('공모전 변동: 실제 직전 수집일과 비교', () => {
    const p = buildMetricPoints([rec('2026-09-01', 50, 1000), rec('2026-09-03', 40, 1500)], 'collection');
    expect(p[1].change).toBe(10);
  });
});

describe('summarizeMetrics', () => {
  it('첫 기록 → 마지막 기록, 최고 순위, 기간 추천비', () => {
    const s = summarizeMetrics(buildMetricPoints([out('2026-09-01'), rec('2026-09-02', 60, 1000), rec('2026-09-03', 30, 2000), rec('2026-09-04', 45, 3000)], 'calendar'))!;
    expect(s.first.rank).toBe(60);
    expect(s.last.rank).toBe(45);
    expect(s.best.rank).toBe(30);
    expect(s).toMatchObject({ days: 3, total: 4, d: { view: 2000, like: 200 } });
    expect(s.ratio).toBeCloseTo(0.1);
  });
  it('기록이 없으면 null', () => expect(summarizeMetrics(buildMetricPoints([out('2026-09-01')], 'calendar'))).toBeNull());
});

describe('signed / rankTicks', () => {
  it('부호', () => {
    expect(signed(1234)).toBe('+1,234');
    expect(signed(-207)).toBe('−207');
    expect(signed(0)).toBe('±0');
    expect(signed(null)).toBe('–');
  });
  it('1·2·5 단계 눈금', () => {
    expect(rankTicks(128, 496)).toEqual([200, 300, 400]);
    expect(rankTicks(125, 137)).toEqual([125, 130, 135]);
    expect(rankTicks(1, 3)).toEqual([1, 2, 3]);
  });
});
