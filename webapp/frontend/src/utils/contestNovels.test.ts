import { describe, expect, it } from 'vitest';
import { sortContestNovels, nextContestSort, contestTrendRow, withDebutBaseline, CONTEST_DEFAULT_SORT, type ContestNovel, CONTEST_DAILY_SORT } from './contestNovels';
import { buildMetricPoints, summarizeMetrics } from './metricSeries';

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

describe('sortContestNovels — 2026(일간 순위가 대표)', () => {
  const d = (ID: string, daily_rank: number | null, view_change: number, Rank: number) => c(ID, Rank, { daily_rank, view_change });
  const t = [d('p', 5, 10, 1), d('q', 3, 10, 9), d('r', null, 0, 2), d('s', 1, 30, 3)];
  it('일간 조회가 같으면 일간 순위순, 역순이면 그 반대 — 누적 순위(Rank)가 아니다', () => {
    expect(sortContestNovels(t, { key: 'view_change', direction: 'descending' }, true).map(x => x.ID)).toEqual(['s', 'q', 'p', 'r']);
    expect(sortContestNovels(t, { key: 'view_change', direction: 'ascending' }, true).map(x => x.ID)).toEqual(['p', 'q', 's', 'r']);
  });
  it('일간 순위가 없는 작품(화면 –)은 일간 조회를 0 이 아니라 값 없음으로 — 방향과 무관하게 맨 아래', () => {
    expect(sortContestNovels(t, { key: 'view_change', direction: 'ascending' }, true).at(-1)!.ID).toBe('r');
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

describe('withDebutBaseline(공모전 신작 첫날의 증가량)', () => {
  const row = (Date: string, Eps: number | null, View: number | null, extra = {}) => contestTrendRow({ Date, Eps, View, Like: View, Fav: 0, ...extra }, true);
  it('접수 시작일이 첫 기록이면 전날 = 0 — 첫날도 증가량이 잡히고 기간 증가량은 0부터, 기준 행은 결과에 없다', () => {
    const rows = withDebutBaseline([row('2026-10-01', 1, 500), row('2026-10-02', 2, 900)], '2026');
    const pts = buildMetricPoints(rows, 'collection', '2026-10-01');
    expect(pts.map(p => p.date)).toEqual(['2026-10-01', '2026-10-02']);
    expect(pts[0].d).toMatchObject({ eps: 1, view: 500 });
    expect(summarizeMetrics(pts)!.d).toMatchObject({ view: 900, eps: 2 });
  });
  it('기간 시작이 기준 행보다 앞이어도 기준 행(0)은 점으로 나오지 않는다', () => {
    const pts = buildMetricPoints(withDebutBaseline([row('2026-10-01', 1, 500), row('2026-10-02', 2, 900)], '2026'), 'collection', '2026-09-28');
    expect(pts.map(p => p.date)).toEqual(['2026-10-01', '2026-10-02']);
  });
  it('나중에 등록된 신작(IsNew)도 첫 기록 전날 = 0', () => {
    const pts = buildMetricPoints(withDebutBaseline([row('2026-10-03', 2, 300, { IsNew: true }), row('2026-10-04', 3, 700)], '2026'), 'collection');
    expect(pts[0].d).toMatchObject({ eps: 2, view: 300 });
  });
  it('늦게 찾은 작품(IsNew 아님, 시작일도 아님)·앞선 기록이 있는 기간·2025 에는 붙이지 않는다', () => {
    expect(withDebutBaseline([row('2026-10-03', 5, 300), row('2026-10-04', 6, 700)], '2026').some(r => 'Baseline' in r)).toBe(false);
    expect(withDebutBaseline([row('2026-10-01', 1, 500), row('2026-10-02', 2, 900, { IsNew: true })], '2026').filter(r => 'Baseline' in r).map(r => r.Date)).toEqual(['2026-09-30']);
    expect(withDebutBaseline([row('2025-09-01', 5, 300)], '2025').some(r => 'Baseline' in r)).toBe(false);
  });
  it('기준 행이 실제 수집일(기록 없음)과 겹쳐도 그 날짜 칸은 남는다', () => {
    const empty = contestTrendRow({ Date: '2026-10-02', Eps: null, View: null, Like: null, Fav: null }, true);
    const pts = buildMetricPoints(withDebutBaseline([row('2026-10-01', null, null), empty, row('2026-10-03', 2, 300, { IsNew: true }), row('2026-10-04', 3, 700)], '2026'), 'collection');
    expect(pts.map(p => p.date)).toEqual(['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04']);
    expect(pts[1].rec).toBe(false);
    expect(pts[2]).toMatchObject({ d: { eps: 2, view: 300 } });
  });
});
