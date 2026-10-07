import { evaluateAdvancedRule } from './tagFilter';

/** 일간 랭킹 API(`/api/ranks/novels/{date}`) 한 행. 공모전은 계획 2에서 이것을 확장한다. */
export interface RankingNovel {
  ID: string;
  Ranking: number;
  Title: string;
  AuthorName: string;
  AuthorID?: number | string | null;
  Score: number;
  Eps: number;
  Tags: string[];
  rank_change?: number | 'New';
  View?: number;
  Like?: number;
  EarlyRetentionRate?: number | null;
  RecentRetentionRate?: number | null;
  like_to_view_ratio?: number;
  ThumbnailURL?: string | null;
  /** 그 날 스냅샷의 연재 상태. 기록 없는 날(2026-09-05 이전)은 null. 판정은 백엔드 _derive_serial_status. */
  serial_status?: string | null;
  Synopsis?: string | null;
}

export type TagMode = 'include-and' | 'include-or' | 'exclude';

/** 적용된 필터. `rule`이 비어 있지 않으면 `tags`/`tagMode` 대신 조건식으로 거른다. */
export interface RankingFilter {
  search: string;
  minEps: number | null;
  maxEps: number | null;
  tagMode: TagMode;
  tags: string[];
  rule: string;
  /** 고른 연재 상태(하나라도 맞으면 남김). 비면 조건 없음. */
  statuses: string[];
}

export const EMPTY_FILTER: RankingFilter = {
  search: '', minEps: null, maxEps: null, tagMode: 'include-and', tags: [], rule: '', statuses: [],
};

export type SortKey = 'Ranking' | 'rank_change' | 'Score' | 'Eps' | 'like_to_view_ratio' | 'EarlyRetentionRate' | 'RecentRetentionRate';
export type SortConfig = Sort<SortKey>;
export const DEFAULT_SORT: SortConfig = { key: 'Ranking', direction: 'ascending' };

export const normalizeNovels = (items: RankingNovel[]): RankingNovel[] => items.map(x => ({
  ...x,
  Tags: x.Tags || [],
  like_to_view_ratio: x.View && x.View > 0 ? (x.Like ?? 0) / x.View : (x.like_to_view_ratio ?? 0),
}));

/** 필터가 읽는 필드만 가진 행. 일간(RankingNovel)과 공모전 행이 같은 필터를 쓴다. */
export interface FilterableNovel {
  Title?: string | null;
  AuthorName?: string | null;
  Eps?: number | null;
  Tags?: string[];
  serial_status?: string | null;
}

export function applyRankingFilter<T extends FilterableNovel>(items: T[], f: RankingFilter): { items: T[]; error: string | null } {
  let out = items;

  if (f.rule.trim()) {
    try {
      // 구문 오류는 태그와 무관하므로 먼저 한 번 검사한다 — 목록이 비어 있어도 오류가 보인다.
      evaluateAdvancedRule(f.rule, []);
      out = out.filter(x => evaluateAdvancedRule(f.rule, x.Tags || []));
    } catch (e) {
      return { items: [], error: `조건식 오류: ${e instanceof Error ? e.message : '잘못된 구문입니다'}` };
    }
  } else if (f.tags.length > 0) {
    const has = (x: T, t: string) => (x.Tags || []).includes(t);
    if (f.tagMode === 'include-and') out = out.filter(x => f.tags.every(t => has(x, t)));
    else if (f.tagMode === 'include-or') out = out.filter(x => f.tags.some(t => has(x, t)));
    else out = out.filter(x => !f.tags.some(t => has(x, t)));
  }

  // ?? []: 개발 서버 fast refresh가 이 필드가 생기기 전의 필터 상태를 들고 있을 수 있다.
  const statuses = f.statuses ?? [];
  if (statuses.length > 0) out = out.filter(x => x.serial_status != null && statuses.includes(x.serial_status));

  const q = f.search.trim().toLowerCase();
  if (q) out = out.filter(x => (x.Title ?? '').toLowerCase().includes(q) || (x.AuthorName ?? '').toLowerCase().includes(q));
  if (f.minEps !== null) { const min = f.minEps; out = out.filter(x => (x.Eps ?? 0) >= min); }
  if (f.maxEps !== null) { const max = f.maxEps; out = out.filter(x => (x.Eps ?? 0) <= max); }
  return { items: out, error: null };
}

/** 표 정렬 상태. 일간·공모전·태그 표가 같이 쓴다. */
export interface Sort<K> { key: K; direction: 'ascending' | 'descending'; }

/** 변동의 정렬값: NEW는 가장 큰 상승, 비교 불가(기록 없음)는 null. */
export const changeValue = (v: unknown): number | null => (v === 'New' ? Infinity : typeof v === 'number' ? v : null);

/** 표 공통 정렬: 값 없는 행(null)은 방향과 무관하게 맨 아래, 같으면 순위순. */
export function sortBy<T>(items: T[], valueOf: (x: T) => number | null, direction: Sort<unknown>['direction'], rankOf: (x: T) => number): T[] {
  const dir = direction === 'ascending' ? 1 : -1;
  return [...items].sort((a, b) => {
    const va = valueOf(a);
    const vb = valueOf(b);
    if (va !== vb) {
      if (va === null) return 1;
      if (vb === null) return -1;
      return va < vb ? -dir : dir;
    }
    return rankOf(a) - rankOf(b);
  });
}

/** 같은 열은 방향을 뒤집고, 새 열은 '보고 싶은 쪽'부터 — 순위(ascKey)는 1위부터, 나머지는 큰 값부터. */
export function nextSortOf<K>(current: Sort<K>, key: K, ascKey: K): Sort<K> {
  if (current.key === key) return { key, direction: current.direction === 'ascending' ? 'descending' : 'ascending' };
  return { key, direction: key === ascKey ? 'ascending' : 'descending' };
}

export const finiteOrNull = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

export const sortRankings = (items: RankingNovel[], s: SortConfig): RankingNovel[] =>
  sortBy(items, x => (s.key === 'rank_change' ? changeValue(x.rank_change) : finiteOrNull(x[s.key])), s.direction, x => x.Ranking);

export const nextSort = (current: SortConfig, key: SortKey): SortConfig => nextSortOf(current, key, 'Ranking');

export function tagCounts(items: Array<{ Tags?: string[] }>): Array<{ tag: string; count: number }> {
  const m = new Map<string, number>();
  for (const x of items) for (const t of new Set(x.Tags || [])) m.set(t, (m.get(t) ?? 0) + 1);
  return [...m].map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag, 'ko'));
}

export function activeFilterCount(f: RankingFilter): number {
  const tagPart = f.rule.trim() ? 1 : f.tags.length;
  const epsPart = f.minEps !== null || f.maxEps !== null ? 1 : 0;
  const statusPart = (f.statuses ?? []).length > 0 ? 1 : 0;
  return tagPart + epsPart + statusPart;
}

export function toggleTag(f: RankingFilter, tag: string): RankingFilter {
  const tags = f.tags.includes(tag) ? f.tags.filter(t => t !== tag) : [...f.tags, tag];
  return { ...f, rule: '', tags };
}

/** 초기화: 검색어만 남기고 모든 조건을 푼다. 화면에 보이지 않는 조건을 남기지 않는다
 *  (예전의 급상승·신규 '보기' 조건이 초기화 뒤에도 남아 215편만 보인 적이 있다). */
export function resetFilter(f: RankingFilter): RankingFilter {
  return { ...EMPTY_FILTER, search: f.search };
}

/** 필터 선택지로 늘 보이는 연재 상태(사용자 지정 순서). 데이터에서 처음 보는 상태는 statusCounts가 뒤에 붙인다 —
 *  아는 값으로 좁히면 모르는 상태가 조용히 사라진다. */
export const SERIAL_STATUSES = ['완결', '연재중단', '연재지연', '연재중'];

export function statusCounts(items: RankingNovel[]): Array<{ status: string; count: number }> {
  const m = new Map<string, number>(SERIAL_STATUSES.map(s => [s, 0]));
  for (const x of items) if (x.serial_status) m.set(x.serial_status, (m.get(x.serial_status) ?? 0) + 1);
  return [...m].map(([status, count]) => ({ status, count }));
}

/** 그날 목록에 연재 상태 기록이 있는가. 없는 날(2026-09-05 이전)은 상태 조건을 적용할 수 없다. */
export const hasStatusData = (items: RankingNovel[]): boolean => items.some(x => x.serial_status != null);

/** 연재 상태 기록이 없는 날에 상태 조건을 골랐을 때 보이는 안내. 적용 가능 여부 판단은 날짜가 아니라 hasStatusData로 한다. */
export const SERIAL_STATUS_NOTICE = '연재 상태는 2026년 9월 5일 랭킹부터 기록돼 있어, 그 이전 날짜에는 적용할 수 없습니다.';

export function toggleStatus(f: RankingFilter, status: string): RankingFilter {
  const cur = f.statuses ?? [];
  const statuses = cur.includes(status) ? cur.filter(s => s !== status) : [...cur, status];
  return { ...f, statuses };
}
