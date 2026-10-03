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
  /** 2026~: 일간 순위(직전 수집일 대비 누적 조회 증가 순, 적재 때 확정). 비교할 직전 기록이 없으면 null. */
  daily_rank?: number | null;
  daily_rank_change?: number | 'New' | null;
  /** 2026~: 기성 작가(공모전 시작 전 작품이 있음). 모르면 null. */
  is_veteran?: boolean | null;
  serial_status?: string | null;
  /** 2026~: 잔류율(회차 30 이상만, 백엔드 `_compute_retention_rates`). 없으면 null → '–'. */
  EarlyRetentionRate?: number | null;
  RecentRetentionRate?: number | null;
}

export type ContestSortKey = 'daily_rank' | 'daily_rank_change' | 'rank_change' | 'view_change' | 'View' | 'like_to_view_ratio' | 'Eps'
  | 'EarlyRetentionRate' | 'RecentRetentionRate';
export interface ContestSort { key: ContestSortKey; direction: 'ascending' | 'descending'; }
export const CONTEST_DEFAULT_SORT: ContestSort = { key: 'View', direction: 'descending' };
/** 2026~ 기본: 일간 순위 1위부터. 첫날처럼 일간 순위가 없으면 값 없는 행끼리 누적 순위순으로 선다. */
export const CONTEST_DAILY_SORT: ContestSort = { key: 'daily_rank', direction: 'ascending' };

/** 삭제되거나 비공개가 된 작품은 View = -1 자리표시로 온다 — 모든 지표를 '값 없음'으로 본다. */
export const isDeletedContestNovel = (x: ContestNovel) => x.View === -1;

const valueOf = (x: ContestNovel, key: ContestSortKey): number | null => {
  if (isDeletedContestNovel(x)) return null;
  if (key === 'rank_change') return x.rank_change === 'New' ? Infinity : typeof x.rank_change === 'number' ? x.rank_change : null;
  if (key === 'daily_rank_change') return x.daily_rank_change === 'New' ? Infinity : typeof x.daily_rank_change === 'number' ? x.daily_rank_change : null;
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
  // 순위는 1위부터, 나머지는 큰 값부터.
  return { key, direction: key === 'daily_rank' ? 'ascending' : 'descending' };
}

/** 수상 표시 순서(쇼케이스 배치). 순서에 없는 작품(본선·수상 없음)은 그 뒤에 조회수 순으로 선다. */
export const AWARD_ORDER: Record<string, number> = { 대상: 0, 최우수상: 1, 탑툰상: 2, 우수상: 3, 특별상: 4 };

/** 공모전 추이 API(`/api/trends/contests/:year/novels/:id/...`)의 한 행. */
export interface ContestTrendRow {
  Date: string;
  Rank?: number | null;
  DailyRank?: number | null;
  View?: number | null;
  Like?: number | null;
  Fav?: number | null;
  Eps?: number | null;
  Alr?: number | null;
  Synopsis?: string | null;
}

/**
 * 공모전 추이 한 행 → 지표 계열(`MetricRow`) 모양. 대표 순위는 2025 누적(`Rank`), 2026~ 일간(`DailyRank`).
 * **삭제·비공개 자리표시(View = -1)는 '기록 없음'으로 바꾼다** — 그대로 두면 -1 이 실제 값으로 들어가 그날과 다음 날의
 * 증가량이 수천만으로 튄다(공모전은 일시 비공개 뒤 재공개가 실제로 있다).
 */
export function contestTrendRow(d: ContestTrendRow, daily: boolean) {
  const placeholder = typeof d.View === 'number' && d.View < 0;
  const v = (x: number | null | undefined) => (placeholder || x == null || x < 0 ? null : x);
  return {
    ...d,
    Ranking: placeholder ? null : (daily ? (d.DailyRank ?? null) : (d.Rank ?? null)),
    Score: null,
    View: v(d.View), Like: v(d.Like), Fav: v(d.Fav), Eps: v(d.Eps), Alr: v(d.Alr),
  };
}
