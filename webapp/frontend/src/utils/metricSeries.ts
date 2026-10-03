/**
 * 작품 상세 '지표' 영역의 계산(2026-09-30 개편). 차트·표는 이 결과만 그린다.
 *
 * - 누적값(조회·추천·선호·회차)은 그대로 그리면 늘 오르는 선이라 읽을 게 없다 — **직전 기록 대비 증가량**을 쓴다.
 * - 직전 기록이 하루 전이 아니면(순위권 밖이었거나 수집이 빠진 날) 증가량은 여러 날치다. `span`(며칠치)을 함께 두고,
 *   차트는 하루 평균 높이의 점선 막대로, 표는 'N일치'로 밝힌다. 하루치인 척하지 않는다.
 * - 기록 여부는 조회수 유무로 본다. 일간 추이 API는 순위권 밖 날을 `Ranking: null`·값 없음으로 채워 준다.
 * - 수집 실패 자리표시(제목 'N/A (…)', 조회 0 또는 -1)의 수치는 값 없음으로 본다 — 실제 값으로 치면 그날과 다음 날
 *   증가량이 −(누적)·+(누적)으로 튄다. 일간 자리표시는 순위·점수가 정상이라(그날 순위권 안) 기록으로 두되,
 *   증가량의 기준은 그 앞의 정상 기록에 머문다(다음 정상 기록의 증가량은 'N일치').
 */

export interface MetricRow {
  Date: string;
  Ranking: number | null;
  Title?: string | null;
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
  /** 그날 기록이 있는가(일간: 순위권 안). 일간 자리표시는 순위만 있고 수치(view 등)는 null 이다. */
  rec: boolean;
  rank: number | null;
  score: number | null;
  view: number | null;
  like: number | null;
  fav: number | null;
  eps: number | null;
  alr: number | null;
  /** 직전 기록(수치가 있는)과 며칠 떨어졌나. 첫 기록이면 0 */
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

/**
 * `windowStart`를 주면 그보다 앞선 행은 **비교 기준으로만** 쓰고 결과에서 뺀다. 기간 첫날도 전날과 견줄 수 있게
 * 호출부가 하루(공모전은 직전 수집일이 나오도록 며칠) 더 앞에서부터 받아 넘긴다 — 없으면 30일을 골라도
 * 연재 여부·증가량이 29일치만 나왔다.
 */
export function buildMetricPoints(rows: MetricRow[], compare: Compare, windowStart?: string): MetricPoint[] {
  const sorted = [...rows].sort((a, b) => a.Date.localeCompare(b.Date));
  const out: MetricPoint[] = [];
  let prevRec: MetricPoint | null = null;  // 증가량의 기준 = 수치가 있는 직전 기록
  for (let i = 0; i < sorted.length; i++) {
    const r = sorted[i];
    const placeholder = (num(r.View) ?? 0) < 0 || String(r.Title ?? '').startsWith('N/A (');
    const view = placeholder ? null : num(r.View);
    const hasVal = view != null;
    const rec = hasVal || (placeholder && num(r.Ranking) != null);
    const p: MetricPoint = {
      date: r.Date, rec,
      rank: rec ? num(r.Ranking) : null,
      score: rec ? num(r.Score) : null,
      view, like: hasVal ? num(r.Like) : null, fav: hasVal ? num(r.Fav) : null, eps: hasVal ? num(r.Eps) : null, alr: hasVal ? num(r.Alr) : null,
      span: 0, d: null, change: null,
    };
    if (hasVal && prevRec) {
      p.span = dayNo(p.date) - dayNo(prevRec.date);
      p.d = { view: sub(p.view, prevRec.view), like: sub(p.like, prevRec.like), fav: sub(p.fav, prevRec.fav), eps: sub(p.eps, prevRec.eps) };
    }
    if (rec && p.rank != null && i > 0) {
      const before = out[i - 1];
      const adjacent = compare === 'collection' || dayNo(p.date) - dayNo(before.date) === 1;
      if (adjacent) p.change = before.rec && before.rank != null ? before.rank - p.rank : 'New';
    }
    out.push(p);
    if (hasVal) prevRec = p;
  }
  return windowStart ? out.filter(p => p.date >= windowStart) : out;
}

export interface MetricSummary {
  /** 기간 증가량의 처음·끝 기록(수치가 있는 기록. 자리표시뿐이면 처음·끝 기록) */
  first: MetricPoint;
  last: MetricPoint;
  /**
   * 순위 요약의 처음·끝 — 순위가 있는 기록만. 일간은 기록 = 순위권이라 first/last 와 같지만, 공모전은 순위 없는 기록
   * (수집 첫날·직전 기준값이 없는 날)이 있어 그 날을 '시작 순위'로 쓰면 'null위'가 됐다. 순위가 하루도 없으면 null.
   */
  rankFirst: MetricPoint | null;
  rankLast: MetricPoint | null;
  /** 최고 순위 기록(순위가 하루도 없으면 last — rank 가 null 이다) */
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
  const vals = recs.filter(p => p.view != null);
  const first = vals[0] ?? recs[0];
  const last = vals[vals.length - 1] ?? recs[recs.length - 1];
  const ranked = recs.filter(p => p.rank != null);
  const best = ranked.length ? ranked.reduce((a, b) => (b.rank! < a.rank! ? b : a)) : last;
  // 기간 증가량 = 첫 기록의 전날 기준값부터 마지막 기록까지. 첫날의 증가량을 알면(기준값이 있으면) 그것도 넣는다.
  const base = (k: keyof Delta, v: number | null) => (v != null ? v - (first.d?.[k] ?? 0) : null);
  const d: Delta = {
    view: sub(last.view, base('view', first.view)), like: sub(last.like, base('like', first.like)),
    fav: sub(last.fav, base('fav', first.fav)), eps: sub(last.eps, base('eps', first.eps)),
  };
  return { first, last, rankFirst: ranked[0] ?? null, rankLast: ranked[ranked.length - 1] ?? null, best, days: recs.length, total: points.length, d, ratio: d.view && d.view > 0 && d.like != null ? d.like / d.view : null };
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
