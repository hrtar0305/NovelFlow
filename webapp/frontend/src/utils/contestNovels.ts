/** 공모전 작품 한 행(`/api/contests/:year/:date`). 순위는 누적 조회수 순으로 백엔드가 매긴다. */
export interface ContestNovel {
  ID: string;
  Rank: number;
  Title?: string | null;
  AuthorName?: string | null;
  AuthorID?: string | null;
  View?: number | null;
  Like?: number | null;
  Fav?: number | null;
  Eps?: number | null;
  Tags: string[];
  Date: string;
  /** 직전 수집일 대비 누적 조회수 증가량(공모전은 달력이 아니라 실제 직전 수집일 기준 — DECISIONS 2026-07-01). */
  view_change: number;
  like_to_view_ratio: number;
  rank_change?: number | 'New';
  award?: string | null;
  ThumbnailURL?: string | null;
}

export type ContestSortKey = 'rank_change' | 'view_change' | 'View' | 'like_to_view_ratio' | 'Eps';
export interface ContestSort { key: ContestSortKey; direction: 'ascending' | 'descending'; }
export const CONTEST_DEFAULT_SORT: ContestSort = { key: 'View', direction: 'descending' };

/** 삭제되거나 비공개가 된 작품은 View = -1 자리표시로 온다 — 모든 지표를 '값 없음'으로 본다. */
export const isDeletedContestNovel = (x: ContestNovel) => x.View === -1;

const valueOf = (x: ContestNovel, key: ContestSortKey): number | null => {
  if (isDeletedContestNovel(x)) return null;
  if (key === 'rank_change') return x.rank_change === 'New' ? Infinity : typeof x.rank_change === 'number' ? x.rank_change : null;
  const v = x[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
};

/** 일간과 같은 규칙: 값 없는 행은 방향과 무관하게 맨 아래, 같으면 순위순. */
export function sortContestNovels(items: ContestNovel[], s: ContestSort): ContestNovel[] {
  const dir = s.direction === 'ascending' ? 1 : -1;
  return [...items].sort((a, b) => {
    const va = valueOf(a, s.key);
    const vb = valueOf(b, s.key);
    if (va === null && vb === null) return a.Rank - b.Rank;
    if (va === null) return 1;
    if (vb === null) return -1;
    if (va !== vb) return va < vb ? -dir : dir;
    return a.Rank - b.Rank;
  });
}

export function nextContestSort(current: ContestSort, key: ContestSortKey): ContestSort {
  if (current.key === key) return { key, direction: current.direction === 'ascending' ? 'descending' : 'ascending' };
  return { key, direction: 'descending' };
}

/** 수상 표시 순서(쇼케이스 배치). 순서에 없는 작품(본선·수상 없음)은 그 뒤에 조회수 순으로 선다. */
export const AWARD_ORDER: Record<string, number> = { 대상: 0, 최우수상: 1, 탑툰상: 2, 우수상: 3, 특별상: 4 };
