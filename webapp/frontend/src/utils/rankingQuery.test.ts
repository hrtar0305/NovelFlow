import { describe, expect, it } from 'vitest';
import {
  EMPTY_FILTER, DEFAULT_SORT, activeFilterCount, applyRankingFilter, nextSort, normalizeNovels,
  sortRankings, tagCounts, toggleTag, type RankingNovel,
} from './rankingQuery';

const n = (o: Partial<RankingNovel> & { ID: string; Ranking: number }): RankingNovel => ({
  Title: `작품${o.ID}`, AuthorName: `작가${o.ID}`, Score: 1000 - o.Ranking, Eps: 100, Tags: [], ...o,
});
const rows = [
  n({ ID: '1', Ranking: 1, Tags: ['판타지', '하렘'], rank_change: 0, Eps: 121 }),
  n({ ID: '2', Ranking: 2, Tags: ['판타지'], rank_change: 'New', Eps: 26, Title: '초월자 티어표' }),
  n({ ID: '3', Ranking: 3, Tags: ['현대', 'BL'], rank_change: -1, Eps: 315, AuthorName: '쉼게지는꽃' }),
  n({ ID: '4', Ranking: 4, Tags: ['하렘'], rank_change: 12, Eps: 60, EarlyRetentionRate: null }),
];

describe('applyRankingFilter', () => {
  it('빈 필터는 그대로', () => expect(applyRankingFilter(rows, EMPTY_FILTER).items).toHaveLength(4));
  it('태그 모두 포함', () => {
    const r = applyRankingFilter(rows, { ...EMPTY_FILTER, tags: ['판타지', '하렘'] });
    expect(r.items.map(x => x.ID)).toEqual(['1']);
  });
  it('태그 하나라도 포함', () => {
    const r = applyRankingFilter(rows, { ...EMPTY_FILTER, tagMode: 'include-or', tags: ['현대', '하렘'] });
    expect(r.items.map(x => x.ID)).toEqual(['1', '3', '4']);
  });
  it('태그 제외', () => {
    const r = applyRankingFilter(rows, { ...EMPTY_FILTER, tagMode: 'exclude', tags: ['BL'] });
    expect(r.items.map(x => x.ID)).toEqual(['1', '2', '4']);
  });
  it('조건식이 있으면 태그 선택보다 우선', () => {
    const r = applyRankingFilter(rows, { ...EMPTY_FILTER, tags: ['BL'], rule: '판타지 AND NOT 하렘' });
    expect(r.items.map(x => x.ID)).toEqual(['2']);
    expect(r.error).toBeNull();
  });
  it('틀린 조건식은 빈 결과와 오류 문장', () => {
    const r = applyRankingFilter(rows, { ...EMPTY_FILTER, rule: '(판타지 AND 하렘' });
    expect(r.items).toEqual([]);
    expect(r.error).toMatch(/^조건식 오류/);
  });
  it('틀린 조건식은 목록이 비어 있어도 오류', () => {
    expect(applyRankingFilter([], { ...EMPTY_FILTER, rule: 'AND 판타지' }).error).toMatch(/^조건식 오류/);
  });
  it('검색은 제목·작가, 대소문자 무시', () => {
    expect(applyRankingFilter(rows, { ...EMPTY_FILTER, search: '티어표' }).items.map(x => x.ID)).toEqual(['2']);
    expect(applyRankingFilter(rows, { ...EMPTY_FILTER, search: '쉼게' }).items.map(x => x.ID)).toEqual(['3']);
  });
  it('회차 범위', () => {
    const r = applyRankingFilter(rows, { ...EMPTY_FILTER, minEps: 50, maxEps: 200 });
    expect(r.items.map(x => x.ID)).toEqual(['1', '4']);
  });
  it('급상승 보기는 상승한 작품만', () => {
    expect(applyRankingFilter(rows, { ...EMPTY_FILTER, view: 'rising' }).items.map(x => x.ID)).toEqual(['4']);
  });
  it('신규 보기는 NEW만', () => {
    expect(applyRankingFilter(rows, { ...EMPTY_FILTER, view: 'new' }).items.map(x => x.ID)).toEqual(['2']);
  });
});

describe('sortRankings', () => {
  it('기본은 순위 오름차순', () => expect(sortRankings([...rows].reverse(), DEFAULT_SORT).map(x => x.ID)).toEqual(['1', '2', '3', '4']));
  it('변동 내림차순: NEW가 맨 위, 기록 없음이 맨 아래', () => {
    const withNone = [...rows, n({ ID: '5', Ranking: 5 })];
    const r = sortRankings(withNone, { key: 'rank_change', direction: 'descending' });
    expect(r.map(x => x.ID)).toEqual(['2', '4', '1', '3', '5']);
  });
  it('값이 없는 행은 방향과 무관하게 맨 아래', () => {
    const r = sortRankings(rows, { key: 'EarlyRetentionRate', direction: 'ascending' });
    expect(r.at(-1)?.ID).toBe('4');
  });
});

describe('nextSort', () => {
  it('같은 열을 다시 누르면 방향이 바뀐다', () =>
    expect(nextSort({ key: 'Eps', direction: 'descending' }, 'Eps')).toEqual({ key: 'Eps', direction: 'ascending' }));
  it('새 열은 내림차순부터(순위만 오름차순)', () => {
    expect(nextSort(DEFAULT_SORT, 'Eps')).toEqual({ key: 'Eps', direction: 'descending' });
    expect(nextSort({ key: 'Eps', direction: 'descending' }, 'Ranking')).toEqual(DEFAULT_SORT);
  });
});

describe('보조 함수', () => {
  it('normalizeNovels가 추천비를 계산', () => {
    const [x] = normalizeNovels([n({ ID: '9', Ranking: 9, View: 1000, Like: 64 })]);
    expect(x.like_to_view_ratio).toBeCloseTo(0.064);
  });
  it('tagCounts는 많은 순, 같으면 가나다', () => {
    const r = tagCounts(rows);
    expect(r.slice(0, 2)).toEqual([{ tag: '판타지', count: 2 }, { tag: '하렘', count: 2 }]);
    expect(r.map(t => t.count)).toEqual([2, 2, 1, 1]);
  });
  it('activeFilterCount는 태그 수 + 회차 1', () => {
    expect(activeFilterCount(EMPTY_FILTER)).toBe(0);
    expect(activeFilterCount({ ...EMPTY_FILTER, tags: ['a', 'b'], minEps: 10 })).toBe(3);
    expect(activeFilterCount({ ...EMPTY_FILTER, tags: ['a'], rule: 'x OR y' })).toBe(1);
  });
  it('toggleTag는 조건식을 비우고 태그를 넣고 뺀다', () => {
    const f = toggleTag({ ...EMPTY_FILTER, rule: 'a' }, '판타지');
    expect(f).toMatchObject({ rule: '', tags: ['판타지'] });
    expect(toggleTag(f, '판타지').tags).toEqual([]);
  });
});
