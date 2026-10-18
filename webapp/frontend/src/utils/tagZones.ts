import { DASH } from './format';
import { finiteOrNull, nextSortOf, sortBy, type Sort } from './rankingQuery';

/**
 * 태그 랭킹의 구역 판정과 정렬 — **그날 하루의 데이터로만** 판단한다(DECISIONS 2026-10-06, 흐름은 태그 트렌드 몫).
 *
 * N = 그날 순위 작품 수(데일리 500), p0 = 100/N = 평균 100위 안 비율(데일리 20%), cut = ceil(cutShare·N)(데일리 30편).
 *  - 대세: n ≥ cut, 100위 안 비율 ≥ p0 / 과포화: n ≥ cut, 비율 < p0 — 비율이 평균의 ±edge 안이면 '경계'(데일리 ±2%p).
 *  - 숨은 강자: 5 ≤ n < cut, 100위 안 gemMinTop 편 이상, 비율 ≥ gemMult·p0.
 *  - 그 밖은 구역 없음(지도에서는 이름 없는 회색 바탕 — 하루 자료로 '시들어 감'을 말할 수 없어 '오늘 약세'는 없앴다).
 * 측정·근거: scripts/measure_tag_zones.py(같은 규칙 — 바꾸면 둘 다). 데일리 14일 하루 구역 바뀜 약 2개.
 */
export type ZoneKey = 'mainstream' | 'gem' | 'saturated';

/** 이보다 작품이 적은 태그는 100위 안 비율을 내지 않는다(구역 없음 · 지도에 안 그림 · 비율 정렬 끝). 2편 중 2편(100%)처럼
 *  작품 한두 편이 비율을 정해 '100위 안' 정렬 맨 위를 이런 태그가 차지했다(2026-10-17: 15위까지 중 14개가 5편 이하). */
export const MIN_WORKS = 5;

/** 필터 줄·칩의 읽기 순서 */
export const ZONE_ORDER: ZoneKey[] = ['mainstream', 'gem', 'saturated'];

export const ZONE_LABEL: Record<ZoneKey, string> = {
  mainstream: '대세',
  gem: '숨은 강자',
  saturated: '과포화',
};

export interface ZoneRules { cutShare: number; gemMult: number; gemMinTop: number; edge: number }
export const DAILY_RULES: ZoneRules = { cutShare: 0.06, gemMult: 1.5, gemMinTop: 4, edge: 0.1 };
/** 공모전(N 약 3,000)은 100위가 전체의 3% 라 100위 안 편수가 작다 — 숨은 강자에 6편(개막 5일 측정: 하루 바뀜 8.5 → 4.2개). */
export const CONTEST_RULES: ZoneRules = { ...DAILY_RULES, gemMinTop: 6 };

export interface DailyTag {
  Rank: number;
  tag: string;
  power_score: number;
  local_lift?: number | null;
  count: number;
  /** 100위 안 작품 수 */
  top100?: number | null;
  /** 인기 점수 = 그날 전체 랭킹 점수(공모전은 조회 증가) 중 이 태그 작품들의 몫(0~1) */
  score_share?: number | null;
  /** 그날 순위 작품 수 N */
  ranked_total?: number | null;
  /** 대표 작품: 이 태그에서 그날 순위가 가장 높은 작품 */
  top_novel?: { id: string; title: string | null; rank: number } | null;
}

export type ZonedTag<T extends DailyTag = DailyTag> = T & { zone: ZoneKey | null; edge: boolean };

/** 평균 100위 안 비율 p0 와 흔한 태그 기준 cut. N 이 100 이하면(비율 판정이 무의미) null. */
export function zoneLines(N: number | null | undefined, rules: ZoneRules = DAILY_RULES): { p0: number; cut: number; gemShare: number } | null {
  if (!N || N <= 100) return null;
  const p0 = 100 / N;
  return { p0, cut: Math.ceil(rules.cutShare * N), gemShare: rules.gemMult * p0 };
}

export function zoneOf(
  t: { count: number; top100?: number | null; ranked_total?: number | null },
  rules: ZoneRules = DAILY_RULES,
): { zone: ZoneKey | null; edge: boolean } {
  const lines = zoneLines(t.ranked_total, rules);
  if (!lines || t.top100 == null || t.count < MIN_WORKS) return { zone: null, edge: false };
  const share = t.top100 / t.count;
  if (t.count >= lines.cut) {
    return { zone: share >= lines.p0 ? 'mainstream' : 'saturated', edge: Math.abs(share / lines.p0 - 1) <= rules.edge + 1e-9 };
  }
  if (t.top100 >= rules.gemMinTop && share >= lines.gemShare - 1e-9) return { zone: 'gem', edge: false };
  return { zone: null, edge: false };
}

export function withZones<T extends DailyTag>(tags: T[], rules: ZoneRules = DAILY_RULES): ZonedTag<T>[] {
  return tags.map(t => ({ ...t, ...zoneOf(t, rules) }));
}

export function zoneCounts(rows: { zone: ZoneKey | null }[]): Record<ZoneKey, number> {
  const out: Record<ZoneKey, number> = { mainstream: 0, gem: 0, saturated: 0 };
  for (const r of rows) if (r.zone) out[r.zone] += 1;
  return out;
}

export type TagSortKey = 'Rank' | 'count' | 'score_share' | 'top100' | 'top_share';
export type TagSort = Sort<TagSortKey>;
export const DEFAULT_TAG_SORT: TagSort = { key: 'Rank', direction: 'ascending' };

/** 처음 누르면 '보고 싶은 쪽'이 위로 온다 — 순위는 1위부터, 나머지는 큰 값부터. */
export const nextTagSort = (s: TagSort, key: TagSortKey): TagSort => nextSortOf(s, key, 'Rank');

/** 정렬용 값 */
const sortValue = (t: DailyTag, key: TagSortKey): number | null => {
  if (key === 'top_share') return t.top100 != null && t.count >= MIN_WORKS ? t.top100 / t.count : null;
  return finiteOrNull(t[key]);
};

/** 값이 없는 행은 방향과 무관하게 늘 끝 — 집중도 없는 태그가 내림차순 맨 위를 차지하지 않게. 동점은 순위 순. */
export const sortTags = <T extends DailyTag>(rows: T[], sort: TagSort): T[] => sortBy(rows, t => sortValue(t, sort.key), sort.direction, t => t.Rank);

/** 100위 안 비율 → 비율 소수 자리. 평균(100/N)이 10% 아래면(공모전 3% 대) 한 자리 — 정수로 자르면 평균 근처 태그가 모두 같은 숫자였다. */
export const sharePct = (share: number, N: number | null | undefined): string =>
  (N && 100 / N < 0.1 ? `${(share * 100).toFixed(1)}%` : `${Math.round(share * 100)}%`);

type TopLike = { count: number; top100?: number | null; ranked_total?: number | null };

/** 100위 안 비율(100위 안 ÷ 작품 수). 작품 5편 미만은 –. */
export const formatTopShare = (t: TopLike): string =>
  (t.top100 == null || t.count < MIN_WORKS ? DASH : sharePct(t.top100 / t.count, t.ranked_total));

/** 100위 안 'N편 · x%'(설명창·폰 한 줄용). 작품 5편 미만은 편수만. */
export const formatTop = (t: TopLike): string =>
  (t.top100 == null || t.count <= 0 ? DASH
    : t.count < MIN_WORKS ? `${t.top100}편`
    : `${t.top100}편 · ${formatTopShare(t)}`);


/**
 * 지형 지도 세로축(100위 안 비율). 위 끝은 평균 3배(구역선이 다 보이는 높이)와 '가장 높은 점보다 한 칸 위' 중 큰 쪽 — 평균 3배에
 * 고정했더니 거기 딱 걸린 점(5편 중 3편 = 60%)이 테두리에 붙어 잘 안 보이고 누르기 어려웠고, 그보다 높은 점은 잘렸다(2026-10-18).
 * 아래 끝도 0 보다 조금 내려 0% 점이 축선에 겹치지 않게 한다(눈금은 0 부터).
 */
export function shareAxis(p0: number, maxShare: number) {
  const want = Math.max(p0 * 3, maxShare * 1.08);
  const step = [0.01, 0.02, 0.05, 0.1, 0.2].find(st => want / st <= 7) ?? 0.2;
  const n = Math.ceil(want / step - 1e-9);
  const ticks = Array.from({ length: n + 1 }, (_, i) => Math.round(i * step * 1000) / 1000);
  return { top: ticks[n], bottom: -step * 0.25, ticks };
}
