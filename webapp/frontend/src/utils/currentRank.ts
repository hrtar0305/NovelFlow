import { isOutOfRank } from './trendSummary';

export type CurrentRank =
  | { kind: 'ranked'; rank: number; change: number | 'New' | null }
  | { kind: 'out'; lastDate: string; lastRank: number }
  | { kind: 'unknown' };

/** 달력 기준 전날(YYYY-MM-DD). 데일리의 rank_change도 캘린더 −1일로 계산한다(DECISIONS 2026-07-01). */
export function previousCalendarDay(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/** 상세 API는 '마지막으로 기록된 날'의 순위를 준다. 그 날이 최신 수집일이 아니면
 *  오늘은 순위권 밖이다 — 그대로 크게 띄우면 오늘 순위로 읽힌다.
 *  series는 전날~마지막 기록일 추이다. 비어 있으면 아직 못 불러온 것이라 변동을 비워 두고,
 *  전날 행이 없거나 순위권 밖이면 NEW(표의 rank_change와 같은 규칙)다. */
export function describeCurrentRank({ detailDate, detailRank, latestDate, series }: {
  detailDate?: string | null; detailRank?: number | null; latestDate?: string | null;
  series: Array<{ Date: string; Ranking: number | null }>;
}): CurrentRank {
  if (!detailDate || detailRank == null) return { kind: 'unknown' };
  if (latestDate && detailDate !== latestDate) return { kind: 'out', lastDate: detailDate, lastRank: detailRank };
  if (series.length === 0) return { kind: 'ranked', rank: detailRank, change: null };
  const prevDate = previousCalendarDay(detailDate);
  const prev = series.find(p => p.Date === prevDate);
  if (!prev || isOutOfRank(prev.Ranking, prev.Date)) return { kind: 'ranked', rank: detailRank, change: 'New' };
  return { kind: 'ranked', rank: detailRank, change: (prev.Ranking as number) - detailRank };
}
