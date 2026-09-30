import { describe, expect, it } from 'vitest';
import { sortContestNovels, nextContestSort, CONTEST_DEFAULT_SORT, type ContestNovel } from './contestNovels';

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
