/**
 * 작품 상세 '지표' 영역의 계산(2026-09-30 개편). 차트·표는 이 결과만 그린다.
 *
 * - 누적값(조회·추천·선호·회차)은 그대로 그리면 늘 오르는 선이라 읽을 게 없다 — **직전 기록 대비 증가량**을 쓴다.
 * - 직전 기록이 하루 전이 아니면(순위권 밖이었거나 수집이 빠진 날) 증가량은 여러 날치다. `span`(며칠치)을 함께 두고,
 *   차트는 하루 평균 높이의 점선 막대로, 표는 'N일치'로 밝힌다. 하루치인 척하지 않는다.
 * - 기록 여부는 조회수 유무로 본다. 일간 추이 API는 순위권 밖 날을 `Ranking: null`·값 없음으로 채워 준다.
 */

export interface MetricRow {
  Date: string;
  Ranking: number | null;
  Score?: number | null;
  View?: number | null;
  Like?: number | null;
  Fav?: number | null;
  Eps?: number | null;
  Alr?: number | null;
}

export type Delta = { view: number | null; like: number | null; fav: number | null; eps: number | null };

export interface MetricPoint {
  date: string;
  /** 그날 기록이 있는가(일간: 순위권 안) */
  rec: boolean;
  rank: number | null;
  score: number | null;
  view: number | null;
  like: number | null;
  fav: number | null;
  eps: number | null;
  alr: number | null;
  /** 직전 기록과 며칠 떨어졌나. 첫 기록이면 0 */
  span: number;
  /** 직전 기록 대비 증가량. 첫 기록이면 null */
  d: Delta | null;
  /** 순위 변동(+ = 상승). 'New' = 비교 기준일에 기록 없음, null = 비교할 수 없음 */
  change: number | 'New' | null;
}

/** 전날 비교 기준: 일간은 달력 기준 하루 전, 공모전은 실제로 수집한 직전 날(DECISIONS 2026-07-01). */
export type Compare = 'calendar' | 'collection';

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const dayNo = (iso: string) => Math.round(Date.parse(`${iso}T00:00:00Z`) / 86_400_000);
const sub = (a: number | null, b: number | null) => (a != null && b != null ? a - b : null);

export function buildMetricPoints(rows: MetricRow[], compare: Compare): MetricPoint[] {
  const sorted = [...rows].sort((a, b) => a.Date.localeCompare(b.Date));
  const out: MetricPoint[] = [];
  let prevRec: MetricPoint | null = null;
  for (let i = 0; i < sorted.length; i++) {
    const r = sorted[i];
    const view = num(r.View);
    const rec = view != null;
    const p: MetricPoint = {
      date: r.Date, rec,
      rank: rec ? num(r.Ranking) : null,
      score: rec ? num(r.Score) : null,
      view, like: rec ? num(r.Like) : null, fav: rec ? num(r.Fav) : null, eps: rec ? num(r.Eps) : null, alr: rec ? num(r.Alr) : null,
      span: 0, d: null, change: null,
    };
    if (rec && prevRec) {
      p.span = dayNo(p.date) - dayNo(prevRec.date);
      p.d = { view: sub(p.view, prevRec.view), like: sub(p.like, prevRec.like), fav: sub(p.fav, prevRec.fav), eps: sub(p.eps, prevRec.eps) };
    }
    if (rec && p.rank != null && i > 0) {
      const before = out[i - 1];
      const adjacent = compare === 'collection' || dayNo(p.date) - dayNo(before.date) === 1;
      if (adjacent) p.change = before.rec && before.rank != null ? before.rank - p.rank : 'New';
    }
    out.push(p);
    if (rec) prevRec = p;
  }
  return out;
}

export interface MetricSummary {
  first: MetricPoint;
  last: MetricPoint;
  best: MetricPoint;
  /** 기록이 있는 날 수 / 표에 오른 날 수 */
  days: number;
  total: number;
  d: Delta;
  /** 기간 추천비 = 늘어난 추천 ÷ 늘어난 조회 */
  ratio: number | null;
}

export function summarizeMetrics(points: MetricPoint[]): MetricSummary | null {
  const recs = points.filter(p => p.rec);
  if (recs.length === 0) return null;
  const first = recs[0];
  const last = recs[recs.length - 1];
  const ranked = recs.filter(p => p.rank != null);
  const best = ranked.length ? ranked.reduce((a, b) => (b.rank! < a.rank! ? b : a)) : last;
  const d: Delta = { view: sub(last.view, first.view), like: sub(last.like, first.like), fav: sub(last.fav, first.fav), eps: sub(last.eps, first.eps) };
  return { first, last, best, days: recs.length, total: points.length, d, ratio: d.view && d.view > 0 && d.like != null ? d.like / d.view : null };
}

/** 부호를 붙인 증감(+1,234 / −207 / ±0). */
export const signed = (v: number | null | undefined): string => {
  if (v == null || !Number.isFinite(v)) return '–';
  const abs = Math.abs(v).toLocaleString('ko-KR');
  return v > 0 ? `+${abs}` : v < 0 ? `−${abs}` : '±0';
};

/** 순위 축 눈금: 1·2·5 단계로 4~6개. 1위 쪽을 위로 그리므로 오름차순. */
export function rankTicks(lo: number, hi: number): number[] {
  const span = Math.max(1, hi - lo);
  const raw = span / 5;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = Math.max(1, [1, 2, 5, 10].map(m => m * mag).find(s => s >= raw) ?? 10 * mag);  // 순위는 정수
  const out: number[] = [];
  for (let t = Math.ceil(lo / step) * step; t <= hi; t += step) if (t >= 1) out.push(t);
  return out;
}

export interface UploadStats {
  /** 올렸는지 알 수 있는 날(직전 기록이 바로 전날인 날) */
  known: number;
  /** 그중 회차가 늘어난 날 */
  uploaded: number;
  /** 기간 끝에서 거꾸로 센 연속 연재일 / 연속 휴재일(둘 중 하나만 0이 아니다) */
  streak: number;
  resting: number;
}

/**
 * 연재 줄의 요약. 하루 단위로 쪼개면 회차 증가는 거의 늘 1이라 양은 뜻이 없고 **올렸는가 / 쉬었는가**가 뜻이다.
 * 여러 날치(span > 1)는 그 사이 어느 날 올렸는지 알 수 없어 세지 않고, 연속 계산도 거기서 끊는다.
 */
export function uploadStats(points: MetricPoint[]): UploadStats {
  const days = points.filter(p => p.rec && p.span === 1 && p.d?.eps != null);
  const uploaded = days.filter(p => (p.d!.eps ?? 0) > 0).length;
  let streak = 0;
  let resting = 0;
  for (let i = points.length - 1; i >= 0; i--) {
    const p = points[i];
    if (!p.rec || p.span !== 1 || p.d?.eps == null) break;
    const up = p.d.eps > 0;
    if (streak === 0 && resting === 0) { if (up) streak = 1; else resting = 1; continue; }
    if (up && streak > 0) streak += 1;
    else if (!up && resting > 0) resting += 1;
    else break;
  }
  return { known: days.length, uploaded, streak, resting };
}
