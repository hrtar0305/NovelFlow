import { isOutOfRank } from './trendSummary';

export type CurrentRank =
  | { kind: 'ranked'; rank: number; change: number | 'New' | null }
  | { kind: 'out'; lastDate: string; lastRank: number }
  | { kind: 'unknown' };

/** 상세 API는 '마지막으로 기록된 날'의 순위를 준다. 그 날이 최신 수집일이 아니면
 *  오늘은 순위권 밖이다 — 그대로 크게 띄우면 오늘 순위로 읽힌다. */
export function describeCurrentRank({ detailDate, detailRank, latestDate, series }: {
  detailDate?: string | null; detailRank?: number | null; latestDate?: string | null;
  series: Array<{ Date: string; Ranking: number | null }>;
}): CurrentRank {
  if (!detailDate || detailRank == null) return { kind: 'unknown' };
  if (latestDate && detailDate !== latestDate) return { kind: 'out', lastDate: detailDate, lastRank: detailRank };
  const sorted = [...series].sort((a, b) => a.Date.localeCompare(b.Date));
  const i = sorted.findIndex(p => p.Date === detailDate);
  const prev = i > 0 ? sorted[i - 1] : null;
  if (!prev) return { kind: 'ranked', rank: detailRank, change: null };
  if (isOutOfRank(prev.Ranking, prev.Date)) return { kind: 'ranked', rank: detailRank, change: 'New' };
  return { kind: 'ranked', rank: detailRank, change: (prev.Ranking as number) - detailRank };
}
