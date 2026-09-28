/** 순위권 밖 판정. 추이 API는 기록 없는 날을 Ranking: null로 보내고, 차트는 그 자리를 501위
 *  (2025-07-20 이전 수집분은 301위)로 그린다(SmallMultiplesChart). 둘 다 순위권 밖이다. */
const TOP_300_END_DATE = '2025-07-20';

export interface TrendPoint { Date: string; Ranking: number | null; View?: number | null; }

export function isOutOfRank(rank: number | null | undefined, date: string): boolean {
  if (rank == null) return true;
  return date <= TOP_300_END_DATE ? rank >= 301 : rank >= 501;
}

export function windowOf(dates: Iterable<string>, end: string, size: number): string[] {
  const upTo = [...dates].filter(d => d <= end).sort();
  return upTo.slice(Math.max(0, upTo.length - size));
}

export function summarizeWindow(points: TrendPoint[], windowDates: string[]) {
  const byDate = new Map(points.map(p => [p.Date, p]));
  const ranks = windowDates.map(d => {
    const p = byDate.get(d);
    return p && !isOutOfRank(p.Ranking, d) ? p.Ranking : null;
  });
  const inRank = ranks.filter((r): r is number => r != null);
  const lastWithView = [...windowDates].reverse().map(d => byDate.get(d)).find(p => p?.View != null);
  return { ranks, days: inRank.length, peak: inRank.length ? Math.min(...inRank) : null, lastView: lastWithView?.View ?? null };
}
