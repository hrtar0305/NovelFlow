import { describe, expect, it } from 'vitest';
import { describeContestRank, describeCurrentRank } from './currentRank';

const series = [
  { Date: '2026-09-25', Ranking: 5 },
  { Date: '2026-09-26', Ranking: 7 },
  { Date: '2026-09-27', Ranking: 8 },
];

describe('describeCurrentRank', () => {
  it('최신 수집일에 순위가 있으면 순위와 전일 대비 변동', () => {
    expect(describeCurrentRank({ detailDate: '2026-09-27', detailRank: 8, latestDate: '2026-09-27', series }))
      .toEqual({ kind: 'ranked', rank: 8, change: -1 });
  });
  it('전일이 순위권 밖이면 NEW', () => {
    const s = [{ Date: '2026-09-26', Ranking: 501 }, { Date: '2026-09-27', Ranking: 480 }];
    expect(describeCurrentRank({ detailDate: '2026-09-27', detailRank: 480, latestDate: '2026-09-27', series: s }))
      .toEqual({ kind: 'ranked', rank: 480, change: 'New' });
  });
  it('처음 진입한 작품(전날 행 없음)은 NEW', () => {
    expect(describeCurrentRank({ detailDate: '2026-09-27', detailRank: 137, latestDate: '2026-09-27', series: [{ Date: '2026-09-27', Ranking: 137 }] }))
      .toEqual({ kind: 'ranked', rank: 137, change: 'New' });
  });
  it('전날은 달력 −1일이다 — 수집 공백이면 이전 수집일에 순위가 있어도 NEW(표의 rank_change와 같은 규칙)', () => {
    const s = [{ Date: '2026-09-25', Ranking: 5 }, { Date: '2026-09-27', Ranking: 8 }];
    expect(describeCurrentRank({ detailDate: '2026-09-27', detailRank: 8, latestDate: '2026-09-27', series: s }))
      .toEqual({ kind: 'ranked', rank: 8, change: 'New' });
  });
  it('추이를 아직 못 불러왔으면(빈 배열) 변동을 표시하지 않는다', () => {
    expect(describeCurrentRank({ detailDate: '2026-09-27', detailRank: 8, latestDate: '2026-09-27', series: [] }))
      .toEqual({ kind: 'ranked', rank: 8, change: null });
  });
  it('마지막 기록일이 최신 수집일이 아니면 순위권 밖', () => {
    expect(describeCurrentRank({ detailDate: '2026-09-12', detailRank: 45, latestDate: '2026-09-27', series }))
      .toEqual({ kind: 'out', lastDate: '2026-09-12', lastRank: 45 });
  });
  it('정보가 없으면 unknown', () => {
    expect(describeCurrentRank({ detailDate: null, detailRank: null, latestDate: '2026-09-27', series: [] })).toEqual({ kind: 'unknown' });
  });
});

describe('describeContestRank', () => {
  it('직전 수집일(달력 −1일이 아니라 실제 직전 기록)과 비교한다', () => {
    const s = [{ Date: '2026-09-26', Ranking: 5 }, { Date: '2026-09-28', Ranking: 3 }];
    expect(describeContestRank({ detailDate: '2026-09-28', detailRank: 3, series: s })).toEqual({ kind: 'ranked', rank: 3, change: 2 });
  });
  it('직전 기록이 없으면 변동을 비운다(공모전은 NEW가 없다)', () => {
    expect(describeContestRank({ detailDate: '2026-09-28', detailRank: 3, series: [{ Date: '2026-09-28', Ranking: 3 }] }))
      .toEqual({ kind: 'ranked', rank: 3, change: null });
  });
  it('순위가 없으면 unknown', () => expect(describeContestRank({ detailDate: null, detailRank: null, series: [] })).toEqual({ kind: 'unknown' }));
});
