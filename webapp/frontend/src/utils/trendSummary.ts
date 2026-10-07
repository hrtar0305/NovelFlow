/** 순위권 밖 판정. 추이 API는 기록 없는 날을 Ranking: null로 보낸다. 예전 차트가 그 자리를 501위
 *  (2025-07-20 이전 수집분은 301위)로 채웠던 값도 순위권 밖으로 읽는다(방어용). */
const TOP_300_END_DATE = '2025-07-20';

export function isOutOfRank(rank: number | null | undefined, date: string): boolean {
  if (rank == null) return true;
  return date <= TOP_300_END_DATE ? rank >= 301 : rank >= 501;
}

export function windowOf(dates: Iterable<string>, end: string, size: number): string[] {
  const upTo = [...dates].filter(d => d <= end).sort();
  return upTo.slice(Math.max(0, upTo.length - size));
}
