import { describe, expect, it } from 'vitest';
import { sortContestNovels, nextContestSort, contestTrendRow, CONTEST_DEFAULT_SORT, type ContestNovel, CONTEST_DAILY_SORT } from './contestNovels';

const c = (ID: string, Rank: number, o: Partial<ContestNovel> = {}): ContestNovel =>
  ({ ID, Rank, Title: ID, AuthorName: 'a', View: 1000 - Rank, view_change: 10, like_to_view_ratio: 0.05, Eps: 10, Tags: [], Date: 'd', ...o });
const rows = [
  c('a', 1, { View: 900, view_change: 5, rank_change: 0 }),
  c('b', 2, { View: 800, view_change: 50, rank_change: 'New' }),
  c('c', 3, { View: -1, view_change: 0 }),               // 삭제된 작품 자리표시
  c('d', 4, { View: 700, view_change: 50, rank_change: 3 }),
];

describe('sortContestNovels', () => {
  it('기본은 누적 조회수 내림차순, 삭제된 작품은 맨 아래', () => {
    expect(sortContestNovels(rows, CONTEST_DEFAULT_SORT).map(x => x.ID)).toEqual(['a', 'b', 'd', 'c']);
  });
  it('오름차순이어도 삭제된 작품은 맨 아래', () => {
    expect(sortContestNovels(rows, { key: 'View', direction: 'ascending' }).map(x => x.ID)).toEqual(['d', 'b', 'a', 'c']);
  });
  it('변동 내림차순은 NEW가 먼저, 값 없는 행은 맨 아래', () => {
    expect(sortContestNovels(rows, { key: 'rank_change', direction: 'descending' }).map(x => x.ID)).toEqual(['b', 'd', 'a', 'c']);
  });
  it('값이 같으면 순위순', () => {
    expect(sortContestNovels(rows, { key: 'view_change', direction: 'descending' }).map(x => x.ID).slice(0, 2)).toEqual(['b', 'd']);
  });
});

describe('nextContestSort', () => {
  it('같은 열은 방향을 뒤집고 새 열은 내림차순부터', () => {
    expect(nextContestSort(CONTEST_DEFAULT_SORT, 'View')).toEqual({ key: 'View', direction: 'ascending' });
    expect(nextContestSort(CONTEST_DEFAULT_SORT, 'Eps')).toEqual({ key: 'Eps', direction: 'descending' });
  });
});

describe('2026 일간 순위 정렬', () => {
  const n = (ID: string, Rank: number, daily_rank: number | null, extra: Partial<ContestNovel> = {}): ContestNovel =>
    ({ ID, Rank, daily_rank, Tags: [], Date: '2026-10-02', view_change: 0, like_to_view_ratio: 0, View: 10, ...extra });
  it('일간 순위 오름차순, 없는 행은 끝에서 누적 순위순', () => {
    const rows = [n('a', 1, null), n('b', 2, 2), n('c', 3, 1), n('d', 4, null)];
    expect(sortContestNovels(rows, CONTEST_DAILY_SORT).map(r => r.ID)).toEqual(['c', 'b', 'a', 'd']);
  });
  it('첫날처럼 전부 없으면 누적 순위순', () => {
    expect(sortContestNovels([n('x', 2, null), n('y', 1, null)], CONTEST_DAILY_SORT).map(r => r.ID)).toEqual(['y', 'x']);
  });
  it('일간 순위 열은 처음 누르면 1위부터', () => {
    expect(nextContestSort({ key: 'View', direction: 'descending' }, 'daily_rank')).toEqual({ key: 'daily_rank', direction: 'ascending' });
  });
});

describe('contestTrendRow', () => {
  it('2026 은 일간 순위, 2025 는 누적 순위', () => {
    expect(contestTrendRow({ Date: '2026-10-02', Rank: 30, DailyRank: 4, View: 100 }, true).Ranking).toBe(4);
    expect(contestTrendRow({ Date: '2025-10-02', Rank: 30, View: 100 }, false).Ranking).toBe(30);
    expect(contestTrendRow({ Date: '2026-10-01', Rank: 30, View: 100 }, true).Ranking).toBeNull();   // 일간 순위가 없는 날
  });
  it('자리표시(View -1)는 기록 없음', () => {
    const r = contestTrendRow({ Date: '2026-10-05', Rank: 900, DailyRank: 3, View: -1, Like: -1, Fav: -1, Eps: -1 }, true);
    expect(r).toMatchObject({ Ranking: null, View: null, Like: null, Fav: null, Eps: null });
  });
});
