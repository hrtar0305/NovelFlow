/**
 * 태그 트렌드 — 기간 안의 모든 수집일 시계열(`/api/trends/tags/series`)에서 시작과 끝을 견준 목록들.
 * 기간 동안의 흐름(떠오름 · 식음)은 여기가 맡는다 — 태그 랭킹은 그날 하루만 본다(DECISIONS 2026-10-06).
 *
 * **기준은 인기 점수(그날 랭킹 점수 점유율)의 변화다**(2026-10-07). 순위 변동으로 줄 세우면 100위 근처는 한 계단이 점유율
 * 0.01%p 라 작품 한두 편에 수십 계단이 움직였고(7일 뜬 태그 상위 13개가 전부 56~159위의 5~11편 태그), 순위가 그대로인 큰 태그의
 * 흐름(30일 집착 +4.6%p · 라이트노벨 −2.9%p)은 어느 목록에도 없었다. 순위 변동은 보조 열로 남긴다.
 *  - 상승 · 하락(옛 '뜬 · 식은 태그'): 첫날 → 마지막 날 점유율 변화 %p 순, ±SHARE_MIN_CHANGE 이상.
 *  - 반짝(옛 '치솟았다 돌아옴'): 기간 최고 점유율이 처음·끝보다 SPIKE_MIN_SHARE 이상 높고, 처음과 끝 차이가 그 폭의 절반 이하(= 돌아옴).
 *  - 대상은 뜬·식은·치솟음이 첫날과 마지막 날 모두, 들어옴은 끝날·빠짐은 첫날 작품 MIN_WORKS 편 이상(꼬리 태그 노이즈).
 *  - '많이 출렁임'은 없앴다 — 점유율로 재면 큰 태그일수록 하루 흔들림이 커서 사실상 태그 크기 순이었다.
 *  - 구역 이동: 첫날과 마지막 날의 구역(태그 랭킹과 같은 판정, tagZones.zoneOf)이 다른 태그. 어느 쪽이든 '경계'면 뺀다(2026-10-18).
 *  - 위 요약 줄(평균 순위 이동 · 순서 일치도)은 없앴다 — 시점과 무관하게 기간 길이로 거의 정해졌다(7일 5계단 · 0.91, 30일 9계단 · 0.83).
 */
import { DAILY_RULES, MIN_WORKS, zoneOf, type ZoneKey } from './tagZones';

export { MIN_WORKS };
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
  /** 날짜별 순위 작품 수 N(구역 판정의 기준). 없는 응답이면 구역을 판정하지 않는다. */
  ranked_total?: (number | null)[];
};

export type TrendPoint = { date: string; rank: number; count: number; score: number };

export interface TagTrend {
  tag: string;
  first: TrendPoint;
  last: TrendPoint;
  /** 점유율 변화(%p 의 소수: 0.012 = +1.2%p) */
  shareChange: number;
  /** 기간 최고 점유율 */
  peak: TrendPoint;
  /** 최고 점유율이 처음·끝 중 높은 쪽보다 얼마나 높았나 */
  spike: number;
}

export interface TagEdge { tag: string; rank: number; count: number; score: number; /** 빠짐: 마지막으로 집계된 날 */ lastSeen: string }

export interface ZoneEnd { count: number; top: number }
export interface ZoneMove { tag: string; from: ZoneKey | null; to: ZoneKey | null; first: ZoneEnd; last: ZoneEnd; lastRank: number }

export interface TagTrendLists {
  risers: TagTrend[];
  fallers: TagTrend[];
  entered: TagEdge[];
  left: TagEdge[];
  spikes: TagTrend[];
  zones: ZoneMove[];
}

/** 기간이 수집 범위 변경(2025-07-20 → 21)을 사이에 두는가 */
export const crossesSampleChange = (first: string, last: string) => first <= SAMPLE_CHANGE_LAST_300 && last > SAMPLE_CHANGE_LAST_300;

/** 첫날 → 마지막 날 구역이 바뀐 태그(양 끝 모두 집계된 태그만). 한쪽이라도 경계면 뺀다. */
function zoneMoves(series: TagSeriesResponse, lastIdx: number): ZoneMove[] {
  const N = series.ranked_total;
  if (!N || N[0] == null || N[lastIdx] == null) return [];
  const end = (count: number | null, top: number | null | undefined, n: number) => {
    const z = zoneOf({ count: count ?? 0, top100: top ?? null, ranked_total: n }, DAILY_RULES);
    return { ...z, count: count ?? 0, top: top ?? 0 };
  };
  const out: ZoneMove[] = [];
  for (const [tag, s] of Object.entries(series.tags)) {
    if (s.rank[0] == null || s.rank[lastIdx] == null) continue;
    const a = end(s.count[0], s.top?.[0], N[0]!);
    const b = end(s.count[lastIdx], s.top?.[lastIdx], N[lastIdx]!);
    if (a.zone === b.zone || a.edge || b.edge) continue;
    out.push({ tag, from: a.zone, to: b.zone, first: { count: a.count, top: a.top }, last: { count: b.count, top: b.top }, lastRank: s.rank[lastIdx]! });
  }
  return out.sort((x, y) => x.lastRank - y.lastRank || x.tag.localeCompare(y.tag, 'ko'));
}

export function buildTagTrends(series: TagSeriesResponse | null): TagTrendLists {
  const empty: TagTrendLists = { risers: [], fallers: [], entered: [], left: [], spikes: [], zones: [] };
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
    zones: zoneMoves(series, lastIdx),
  };
}
