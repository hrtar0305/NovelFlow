import { describe, expect, it } from 'vitest';
import { buildMetricPoints, rankTicks, signed, summarizeMetrics, uploadStats, type MetricRow } from './metricSeries';

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
  it('공모전: 순위 없는 기록(수집 첫날 등)은 순위 요약에서 빼고, 증가량에는 쓴다', () => {
    const s = summarizeMetrics(buildMetricPoints([rec('2026-10-01', null, 1000), rec('2026-10-02', 12, 3000), rec('2026-10-03', 5, 6000)], 'collection'))!;
    expect(s.first.date).toBe('2026-10-01');          // 증가량의 시작은 첫 기록
    expect(s.rankFirst?.rank).toBe(12);                // 순위 요약의 시작은 첫 순위
    expect(s.rankLast?.rank).toBe(5);
    expect(s.best.rank).toBe(5);
    expect(s.d.view).toBe(5000);
  });
  it('순위가 하루도 없으면 순위 요약이 없다', () => {
    const s = summarizeMetrics(buildMetricPoints([rec('2026-10-01', null, 1000)], 'collection'))!;
    expect(s.rankFirst).toBeNull();
    expect(s.rankLast).toBeNull();
  });
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

describe('uploadStats', () => {
  const eps = (list: (number | null)[]) => buildMetricPoints(list.map((e, i) => (e == null
    ? { Date: `2026-09-${String(i + 1).padStart(2, '0')}`, Ranking: null, View: null }
    : rec(`2026-09-${String(i + 1).padStart(2, '0')}`, 10, 1000 + i, { Eps: e }))), 'calendar');
  it('올린 날 수와 끝에서 센 연속 연재', () => {
    expect(uploadStats(eps([10, 11, 11, 12, 13, 14]))).toEqual({ known: 5, uploaded: 4, streak: 3, resting: 0 });
  });
  it('끝에서 쉬는 중이면 연속 휴재', () => {
    expect(uploadStats(eps([10, 11, 12, 12, 12]))).toEqual({ known: 4, uploaded: 2, streak: 0, resting: 2 });
  });
  it('여러 날치는 세지 않고 연속도 거기서 끊는다', () => {
    expect(uploadStats(eps([10, 11, null, 13, 14]))).toEqual({ known: 2, uploaded: 2, streak: 1, resting: 0 });
  });
});

describe('windowStart(기간 전날 기준값)', () => {
  const rows = [rec('2026-08-31', 60, 900, { Eps: 9 }), rec('2026-09-01', 50, 1000, { Eps: 10 }), rec('2026-09-02', 40, 1500, { Eps: 11 })];
  const pts = buildMetricPoints(rows, 'calendar', '2026-09-01');
  it('기준일은 결과에서 빠지고 첫날도 증가량·변동을 갖는다', () => {
    expect(pts.map(p => p.date)).toEqual(['2026-09-01', '2026-09-02']);
    expect(pts[0]).toMatchObject({ span: 1, d: { view: 100, eps: 1 }, change: 10 });
  });
  it('기간 증가량은 기준일부터 센다', () => {
    expect(summarizeMetrics(pts)!.d).toMatchObject({ view: 600, eps: 2 });
  });
  it('연재 판단도 첫날부터', () => {
    expect(uploadStats(pts)).toMatchObject({ known: 2, uploaded: 2 });
  });
  it('기준일이 순위권 밖이면 첫날은 알 수 없음', () => {
    const p = buildMetricPoints([out('2026-08-31'), ...rows.slice(1)], 'calendar', '2026-09-01');
    expect(p[0]).toMatchObject({ d: null, change: 'New' });
  });
});

describe('수집 실패 자리표시', () => {
  it('공모전 View -1 은 기록 없음, 복귀한 날 증가량은 그 앞 정상 기록부터(N일치)', () => {
    const p = buildMetricPoints([rec('2026-10-01', 5, 1000), rec('2026-10-02', null, -1, { Like: -1, Fav: -1, Eps: -1 }), rec('2026-10-03', 4, 1500)], 'collection');
    expect(p[1]).toMatchObject({ rec: false, view: null, d: null });
    expect(p[2]).toMatchObject({ span: 2, d: { view: 500 } });
  });
  it('삭제돼 마지막 기록이 -1 이어도 기간 증가량은 정상 기록끼리', () => {
    const s = summarizeMetrics(buildMetricPoints([rec('2026-10-01', 5, 1000), rec('2026-10-02', 3, 3000), rec('2026-10-03', null, -1)], 'collection'))!;
    expect(s.last.date).toBe('2026-10-02');
    expect(s.d.view).toBe(2000);
  });
  it('일간 N/A(조회 0): 순위·점수는 남기고 수치·증가량은 값 없음', () => {
    const p = buildMetricPoints([
      rec('2026-10-01', 50, 1000, { Eps: 10 }),
      rec('2026-10-02', 45, 0, { Title: 'N/A (FetchFailed)', Like: 0, Fav: 0, Eps: 0, Alr: 0, Score: 1200 }),
      rec('2026-10-03', 40, 1600, { Eps: 12 }),
    ], 'calendar');
    expect(p[1]).toMatchObject({ rec: true, rank: 45, score: 1200, view: null, eps: null, d: null, change: 5 });
    expect(p[2]).toMatchObject({ span: 2, d: { view: 600, eps: 2 }, change: 5 });
    expect(uploadStats(p)).toMatchObject({ known: 0, streak: 0, resting: 0 });
    expect(summarizeMetrics(p)!).toMatchObject({ days: 3, d: { view: 600 } });
  });
});
