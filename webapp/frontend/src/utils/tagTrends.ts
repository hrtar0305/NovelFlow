/**
 * 태그 트렌드 — 기간 안의 모든 수집일 시계열(`/api/trends/tags/series`)에서 시작과 끝을 견준 목록들.
 * 기간 동안의 흐름(떠오름 · 식음)은 여기가 맡는다 — 태그 랭킹은 그날 하루만 본다(DECISIONS 2026-10-06).
 *
 * **기준은 인기 점수(그날 랭킹 점수 점유율)의 변화다**(2026-10-07). 순위 변동으로 줄 세우면 100위 근처는 한 계단이 점유율
 * 0.01%p 라 작품 한두 편에 수십 계단이 움직였고(7일 뜬 태그 상위 13개가 전부 56~159위의 5~11편 태그), 순위가 그대로인 큰 태그의
 * 흐름(30일 집착 +4.6%p · 라이트노벨 −2.9%p)은 어느 목록에도 없었다. 순위 변동은 보조 열로 남긴다.
 *  - 뜬 · 식은: 첫날 → 마지막 날 점유율 변화 %p 순, ±SHARE_MIN_CHANGE 이상.
 *  - 치솟았다 돌아옴: 기간 최고 점유율이 처음·끝보다 SPIKE_MIN_SHARE 이상 높고, 처음과 끝 차이가 그 폭의 절반 이하(= 돌아옴).
 *  - 대상은 뜬·식은·치솟음이 첫날과 마지막 날 모두, 들어옴은 끝날·빠짐은 첫날 작품 MIN_WORKS 편 이상(꼬리 태그 노이즈).
 *  - '많이 출렁임'은 없앴다 — 점유율로 재면 큰 태그일수록 하루 흔들림이 커서 사실상 태그 크기 순이었다.
 */

export const MIN_WORKS = 5;
/** 뜬·식은 태그의 최소 변화(0.2%p). 7일 창에서 24·28개, 30일 창에서 38·38개(2026-10-07 실측) */
export const SHARE_MIN_CHANGE = 0.002;
/** 치솟았다 돌아옴의 최소 폭(0.5%p) */
export const SPIKE_MIN_SHARE = 0.005;
/** 데일리 수집 범위가 300 → 500편으로 바뀐 날(이날까지 300편). 작품 수는 이 경계를 넘어 견줄 수 없다. */
export const SAMPLE_CHANGE_LAST_300 = '2025-07-20';

export type TagSeriesResponse = {
  dates: string[];
  /** score = 그날 인기 점수(점유율 0~1), top = 100위 안 작품 수 */
  tags: Record<string, { rank: (number | null)[]; count: (number | null)[]; score: (number | null)[]; top?: (number | null)[] }>;
};

export type TrendPoint = { date: string; rank: number; count: number; score: number };

export interface TagTrend {
  tag: string;
  first: TrendPoint;
  last: TrendPoint;
  /** 점유율 변화(%p 의 소수: 0.012 = +1.2%p) */
  shareChange: number;
  /** + 면 순위가 올랐다 */
  rankChange: number;
  /** 기간 최고 점유율 */
  peak: TrendPoint;
  /** 최고 점유율이 처음·끝 중 높은 쪽보다 얼마나 높았나 */
  spike: number;
}

export interface TagEdge { tag: string; rank: number; count: number; score: number; /** 빠짐: 마지막으로 집계된 날 */ lastSeen: string }

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
  churn: Churn | null;
}

/** 기간이 수집 범위 변경(2025-07-20 → 21)을 사이에 두는가 */
export const crossesSampleChange = (first: string, last: string) => first <= SAMPLE_CHANGE_LAST_300 && last > SAMPLE_CHANGE_LAST_300;

/** 태그판 전체가 얼마나 갈렸나(평균 이동, Kendall τ) — 아래 목록과 같은 모집단(양 끝 작품 MIN_WORKS 편 이상)으로 센다. */
export function computeChurn(tags: TagSeriesResponse['tags'], lastIdx: number): Churn | null {
  const a = new Map<string, number>();
  const b = new Map<string, number>();
  for (const [tag, s] of Object.entries(tags)) {
    if (s.rank[0] != null && (s.count[0] ?? 0) >= MIN_WORKS) a.set(tag, s.rank[0]);
    if (s.rank[lastIdx] != null && (s.count[lastIdx] ?? 0) >= MIN_WORKS) b.set(tag, s.rank[lastIdx]!);
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
  const empty: TagTrendLists = { risers: [], fallers: [], entered: [], left: [], spikes: [], churn: null };
  if (!series || series.dates.length < 2) return empty;
  const { dates, tags } = series;
  const lastIdx = dates.length - 1;
  const trends: TagTrend[] = [];
  const entered: TagEdge[] = [];
  const left: TagEdge[] = [];

  for (const [tag, s] of Object.entries(tags)) {
    const inFirst = s.rank[0] != null;
    const inLast = s.rank[lastIdx] != null;
    if (!inFirst && inLast) {
      if ((s.count[lastIdx] ?? 0) >= MIN_WORKS) entered.push({ tag, rank: s.rank[lastIdx]!, count: s.count[lastIdx] ?? 0, score: s.score[lastIdx] ?? 0, lastSeen: dates[lastIdx] });
      continue;
    }
    if (inFirst && !inLast) {
      if ((s.count[0] ?? 0) >= MIN_WORKS) {
        let seen = 0;
        s.rank.forEach((r, i) => { if (r != null) seen = i; });
        left.push({ tag, rank: s.rank[0]!, count: s.count[0] ?? 0, score: s.score[0] ?? 0, lastSeen: dates[seen] });
      }
      continue;
    }
    if (!inFirst) continue;
    const points: TrendPoint[] = [];
    dates.forEach((date, i) => {
      if (s.rank[i] != null) points.push({ date, rank: s.rank[i]!, count: s.count[i] ?? 0, score: s.score[i] ?? 0 });
    });
    const first = points[0];
    const last = points[points.length - 1];
    const peak = points.reduce((m, p) => (p.score > m.score ? p : m), first);
    trends.push({
      tag, first, last, peak,
      shareChange: last.score - first.score,
      rankChange: first.rank - last.rank,
      spike: peak.score - Math.max(first.score, last.score),
    });
  }

  const eligible = trends.filter(t => t.first.count >= MIN_WORKS && t.last.count >= MIN_WORKS);
  const byName = (a: { tag: string }, b: { tag: string }) => a.tag.localeCompare(b.tag, 'ko');
  return {
    risers: eligible.filter(t => t.shareChange >= SHARE_MIN_CHANGE - 1e-12).sort((a, b) => b.shareChange - a.shareChange || byName(a, b)),
    fallers: eligible.filter(t => t.shareChange <= -SHARE_MIN_CHANGE + 1e-12).sort((a, b) => a.shareChange - b.shareChange || byName(a, b)),
    entered: entered.sort((a, b) => a.rank - b.rank),
    left: left.sort((a, b) => a.rank - b.rank),
    spikes: eligible.filter(t => t.spike >= SPIKE_MIN_SHARE - 1e-12 && Math.abs(t.shareChange) <= t.spike / 2)
      .sort((a, b) => b.spike - a.spike || byName(a, b)),
    churn: computeChurn(tags, lastIdx),
  };
}
