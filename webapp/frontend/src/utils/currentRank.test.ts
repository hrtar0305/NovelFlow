import { describe, expect, it } from 'vitest';
import { describeCurrentRank } from './currentRank';

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
  it('전일 기록이 없으면 변동 없음이 아니라 null', () => {
    expect(describeCurrentRank({ detailDate: '2026-09-27', detailRank: 8, latestDate: '2026-09-27', series: [{ Date: '2026-09-27', Ranking: 8 }] }))
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
