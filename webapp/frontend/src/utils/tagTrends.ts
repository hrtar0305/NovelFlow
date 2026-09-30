/**
 * 태그 트렌드 — 기간 안의 모든 수집일 시계열(`/api/trends/tags/series`)에서 시작과 끝을 견준 목록들.
 * 2026-09-30 페이지에서 분리. 목록 정의는 그대로다:
 *  - 뜬·식은·치솟음·출렁임은 시작·끝 모두 작품 MIN_WORKS편 이상인 태그만(꼬리 태그가 변동 상위를 채우지 않게.
 *    실측: 하한 없을 때 최대 +93계단이 '1작품 → 7작품'짜리였다).
 *  - 정렬은 화면에 보이는 값(순위 변동) 우선, 동률은 인기 점수 변화율.
 *  - 치솟음은 고정 문턱 대신 3계단(관측 노이즈 경계) — 7일 창은 최대가 +6이라 큰 문턱이면 늘 빈 목록이 된다.
 *  - 출렁임은 기록 4일 이상 중 폭이 큰 10개. '꾸준한 태그'는 만들지 않는다(상위권은 폭이 전부 0).
 */

export const MIN_WORKS = 5;
export const SPIKE_MIN = 3;
export const SWING_DAYS = 4;
export const SWING_TOP = 10;

export type TagSeriesResponse = {
  dates: string[];
  tags: Record<string, { rank: (number | null)[]; count: (number | null)[]; score: (number | null)[]; lift: (number | null)[] }>;
};

export type TrendPoint = { date: string; rank: number; count: number; score: number; lift: number | null };

export interface TagTrend {
  tag: string;
  first: TrendPoint;
  last: TrendPoint;
  /** 인기 점수 변화율 (0.42 = +42%) */
  scoreChange: number;
  /** + 면 순위가 올랐다 */
  rankChange: number;
  bestRank: number;
  worstRank: number;
  /** 시작·끝 중 나은 쪽보다 기간 최고가 몇 계단 위였나 */
  spike: number;
  /** 최고~최저 폭 */
  swing: number;
  days: number;
}

export interface TagEdge { tag: string; rank: number; count: number; }

export interface Churn {
  /** 양쪽에 다 있는 태그의 평균 |순위 변동| */
  footrule: number;
  /** Kendall τ. 1 = 순서 그대로, 0 = 무작위 */
  tau: number | null;
  common: number;
  startTags: number;
  endTags: number;
}

export interface TagTrendLists {
  risers: TagTrend[];
  fallers: TagTrend[];
  entered: TagEdge[];
  left: TagEdge[];
  spikes: TagTrend[];
  swings: TagTrend[];
  churn: Churn | null;
}

/** 태그판 전체가 얼마나 갈렸나 — 소설 쪽 리포트와 같은 지표(평균 이동, Kendall τ). */
export function computeChurn(tags: TagSeriesResponse['tags'], lastIdx: number): Churn | null {
  const a = new Map<string, number>();
  const b = new Map<string, number>();
  for (const [tag, s] of Object.entries(tags)) {
    if (s.rank[0] != null) a.set(tag, s.rank[0]);
    if (s.rank[lastIdx] != null) b.set(tag, s.rank[lastIdx]!);
  }
  const common = [...b.keys()].filter(t => a.has(t));
  if (common.length < 2) return null;
  const footrule = common.reduce((acc, t) => acc + Math.abs(a.get(t)! - b.get(t)!), 0) / common.length;
  let con = 0;
  let dis = 0;
  for (let i = 0; i < common.length; i += 1) {
    for (let j = i + 1; j < common.length; j += 1) {
      const s2 = (a.get(common[i])! - a.get(common[j])!) * (b.get(common[i])! - b.get(common[j])!);
      if (s2 > 0) con += 1;
      else if (s2 < 0) dis += 1;
    }
  }
  return { footrule, tau: con + dis ? (con - dis) / (con + dis) : null, common: common.length, startTags: a.size, endTags: b.size };
}

export function buildTagTrends(series: TagSeriesResponse | null): TagTrendLists {
  const empty: TagTrendLists = { risers: [], fallers: [], entered: [], left: [], spikes: [], swings: [], churn: null };
  if (!series || series.dates.length < 2) return empty;
  const { dates, tags } = series;
  const lastIdx = dates.length - 1;
  const trends: TagTrend[] = [];
  const entered: TagEdge[] = [];
  const left: TagEdge[] = [];

  for (const [tag, s] of Object.entries(tags)) {
    const inFirst = s.rank[0] != null;
    const inLast = s.rank[lastIdx] != null;
    if (!inFirst && inLast) { entered.push({ tag, rank: s.rank[lastIdx]!, count: s.count[lastIdx] ?? 0 }); continue; }
    if (inFirst && !inLast) { left.push({ tag, rank: s.rank[0]!, count: s.count[0] ?? 0 }); continue; }
    if (!inFirst) continue;
    const points: TrendPoint[] = [];
    dates.forEach((date, i) => {
      if (s.rank[i] != null) points.push({ date, rank: s.rank[i]!, count: s.count[i] ?? 0, score: s.score[i] ?? 0, lift: s.lift[i] });
    });
    const first = points[0];
    const last = points[points.length - 1];
    const ranks = points.map(p => p.rank);
    const bestRank = Math.min(...ranks);
    const worstRank = Math.max(...ranks);
    trends.push({
      tag, first, last,
      scoreChange: first.score > 0 ? (last.score - first.score) / first.score : 0,
      rankChange: first.rank - last.rank,
      bestRank, worstRank,
      spike: Math.min(first.rank, last.rank) - bestRank,
      swing: worstRank - bestRank,
      days: points.length,
    });
  }

  const eligible = trends.filter(t => t.first.count >= MIN_WORKS && t.last.count >= MIN_WORKS);
  const byRise = (a: TagTrend, b: TagTrend) => (b.rankChange - a.rankChange) || (b.scoreChange - a.scoreChange) || a.tag.localeCompare(b.tag, 'ko');
  return {
    risers: eligible.filter(t => t.rankChange > 0).sort(byRise),
    fallers: eligible.filter(t => t.rankChange < 0).sort((a, b) => byRise(b, a)),
    entered: entered.sort((a, b) => a.rank - b.rank),
    left: left.sort((a, b) => a.rank - b.rank),
    spikes: eligible.filter(t => t.spike >= SPIKE_MIN).sort((a, b) => b.spike - a.spike || a.last.rank - b.last.rank),
    swings: eligible.filter(t => t.days >= SWING_DAYS).sort((a, b) => b.swing - a.swing || a.last.rank - b.last.rank).slice(0, SWING_TOP),
    churn: computeChurn(tags, lastIdx),
  };
}
