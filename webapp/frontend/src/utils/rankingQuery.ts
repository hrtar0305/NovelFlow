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
}

export const EMPTY_FILTER: RankingFilter = {
  search: '', minEps: null, maxEps: null, tagMode: 'include-and', tags: [], rule: '',
};

export type SortKey = 'Ranking' | 'rank_change' | 'Score' | 'Eps' | 'like_to_view_ratio' | 'EarlyRetentionRate' | 'RecentRetentionRate';
export interface SortConfig { key: SortKey; direction: 'ascending' | 'descending'; }
export const DEFAULT_SORT: SortConfig = { key: 'Ranking', direction: 'ascending' };

export const normalizeNovels = (items: RankingNovel[]): RankingNovel[] => items.map(x => ({
  ...x,
  Tags: x.Tags || [],
  like_to_view_ratio: x.View && x.View > 0 ? (x.Like ?? 0) / x.View : (x.like_to_view_ratio ?? 0),
}));

export function applyRankingFilter(items: RankingNovel[], f: RankingFilter): { items: RankingNovel[]; error: string | null } {
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
    const has = (x: RankingNovel, t: string) => (x.Tags || []).includes(t);
    if (f.tagMode === 'include-and') out = out.filter(x => f.tags.every(t => has(x, t)));
    else if (f.tagMode === 'include-or') out = out.filter(x => f.tags.some(t => has(x, t)));
    else out = out.filter(x => !f.tags.some(t => has(x, t)));
  }

  const q = f.search.trim().toLowerCase();
  if (q) out = out.filter(x => x.Title.toLowerCase().includes(q) || x.AuthorName.toLowerCase().includes(q));
  if (f.minEps !== null) { const min = f.minEps; out = out.filter(x => x.Eps >= min); }
  if (f.maxEps !== null) { const max = f.maxEps; out = out.filter(x => x.Eps <= max); }
  return { items: out, error: null };
}

export function sortRankings(items: RankingNovel[], s: SortConfig): RankingNovel[] {
  const dir = s.direction === 'ascending' ? 1 : -1;
  return [...items].sort((a, b) => {
    if (s.key === 'rank_change') {
      const v = (x: RankingNovel['rank_change']) => (x === 'New' ? Infinity : typeof x === 'number' ? x : -Infinity);
      const va = v(a.rank_change);
      const vb = v(b.rank_change);
      if (va === vb) return a.Ranking - b.Ranking;
      if (va === -Infinity) return 1;
      if (vb === -Infinity) return -1;
      return va < vb ? -dir : dir;
    }
    const av = a[s.key];
    const bv = b[s.key];
    if (av == null) return 1;
    if (bv == null) return -1;
    if (av < bv) return -dir;
    if (av > bv) return dir;
    return a.Ranking - b.Ranking;
  });
}

export function nextSort(current: SortConfig, key: SortKey): SortConfig {
  if (current.key === key) return { key, direction: current.direction === 'ascending' ? 'descending' : 'ascending' };
  return { key, direction: key === 'Ranking' ? 'ascending' : 'descending' };
}

export function tagCounts(items: RankingNovel[]): Array<{ tag: string; count: number }> {
  const m = new Map<string, number>();
  for (const x of items) for (const t of new Set(x.Tags || [])) m.set(t, (m.get(t) ?? 0) + 1);
  return [...m].map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag, 'ko'));
}

export function activeFilterCount(f: RankingFilter): number {
  const tagPart = f.rule.trim() ? 1 : f.tags.length;
  const epsPart = f.minEps !== null || f.maxEps !== null ? 1 : 0;
  return tagPart + epsPart;
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
