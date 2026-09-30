import { DASH } from './format';

/**
 * 일간 태그 랭킹의 구역 분류와 정렬(2026-09-30 페이지에서 분리).
 *
 * 사용량(등장 작품 수) × 성과(상위권 집중도)로 네 구역을 나눈다.
 *  - 사용량 경계: 그날 집중도가 있는 태그들의 작품 수 P75 — 고정 숫자는 표본이 300→500으로
 *    바뀐 과거 날짜에서 깨진다.
 *  - 성과 경계: 집중도 1.0(상위 100위 안/밖 등장 비율이 같은 지점).
 *  - 집중도가 없는 태그(등장 5작품 미만, 적재 단계에서 계산하지 않음)는 구역이 없다.
 */
export type ZoneKey = 'mainstream' | 'gem' | 'saturated' | 'cold';

/** 지도의 사분면과 같은 읽기 순서가 아니라, 필터 줄에서 '대세 → 약세' 순으로 읽힌다. */
export const ZONE_ORDER: ZoneKey[] = ['mainstream', 'gem', 'saturated', 'cold'];

export const ZONE_LABEL: Record<ZoneKey, string> = {
  mainstream: '오늘의 대세',
  gem: '숨은 강자',
  saturated: '과포화',
  cold: '오늘 약세',
};

export interface DailyTag {
  Rank: number;
  tag: string;
  power_score: number;
  local_lift?: number | null;
  count: number;
  rank_change?: number | 'New' | null;
}

export type ZonedTag<T extends DailyTag = DailyTag> = T & { zone: ZoneKey | null };

/** 집중도가 있는 태그들의 작품 수 P75. 그런 태그가 없으면(구 수집분) null. */
export function mainstreamCut(tags: DailyTag[]): number | null {
  const counts = tags.filter(t => t.local_lift != null).map(t => t.count).sort((a, b) => a - b);
  if (counts.length === 0) return null;
  return counts[Math.min(counts.length - 1, Math.floor(counts.length * 0.75))];
}

export function zoneOf(count: number, lift: number | null | undefined, cut: number | null): ZoneKey | null {
  if (lift == null || cut == null) return null;
  if (count >= cut) return lift >= 1 ? 'mainstream' : 'saturated';
  return lift >= 1 ? 'gem' : 'cold';
}

export function withZones<T extends DailyTag>(tags: T[]): ZonedTag<T>[] {
  const cut = mainstreamCut(tags);
  return tags.map(t => ({ ...t, zone: zoneOf(t.count, t.local_lift, cut) }));
}

export function zoneCounts(rows: { zone: ZoneKey | null }[]): Record<ZoneKey, number> {
  const out: Record<ZoneKey, number> = { mainstream: 0, gem: 0, saturated: 0, cold: 0 };
  for (const r of rows) if (r.zone) out[r.zone] += 1;
  return out;
}

export type TagSortKey = 'Rank' | 'rank_change' | 'count' | 'local_lift' | 'power_score';
export interface TagSort { key: TagSortKey; direction: 'ascending' | 'descending'; }
export const DEFAULT_TAG_SORT: TagSort = { key: 'Rank', direction: 'ascending' };

/** 처음 누르면 '보고 싶은 쪽'이 위로 온다 — 순위는 1위부터, 나머지는 큰 값부터. */
export function nextTagSort(s: TagSort, key: TagSortKey): TagSort {
  if (s.key === key) return { key, direction: s.direction === 'ascending' ? 'descending' : 'ascending' };
  return { key, direction: key === 'Rank' ? 'ascending' : 'descending' };
}

/** 정렬용 값. 변동의 NEW는 일간 작품 표와 같이 가장 큰 상승으로 친다(내림차순 = NEW → 상승 폭 순). */
const sortValue = (t: DailyTag, key: TagSortKey): number | null => {
  if (key === 'rank_change') {
    if (t.rank_change === 'New') return Infinity;
    return typeof t.rank_change === 'number' ? t.rank_change : null;
  }
  const v = t[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
};

/** 값이 없는 행은 방향과 무관하게 늘 끝 — 집중도 없는 태그가 내림차순 맨 위를 차지하지 않게. 동점은 순위 순. */
export function sortTags<T extends DailyTag>(rows: T[], sort: TagSort): T[] {
  const sign = sort.direction === 'ascending' ? 1 : -1;
  return [...rows].sort((a, b) => {
    const va = sortValue(a, sort.key);
    const vb = sortValue(b, sort.key);
    if (va === null && vb === null) return a.Rank - b.Rank;
    if (va === null) return 1;
    if (vb === null) return -1;
    if (va !== vb) return va > vb ? sign : -sign;
    return a.Rank - b.Rank;
  });
}

export const formatLift = (v?: number | null): string => (v != null && Number.isFinite(v) ? `${v.toFixed(1)}×` : DASH);
