/** 공모전 태그 랭킹 한 행. 점수는 구 3-track(선형·역순위·로그) — 공모전만 유지한다(DECISIONS 2026-04). */
export interface ContestTag {
  Rank: number;
  tag: string;
  score_linear: number;
  score_inverse: number;
  score_log: number;
  count: number;
}

export interface ContestTagRow extends ContestTag {
  avg_linear: number;
  avg_inverse: number;
  avg_log: number;
}

export type ContestTagSortKey = 'score_linear' | 'avg_linear' | 'score_inverse' | 'avg_inverse' | 'score_log' | 'avg_log' | 'count';
export interface ContestTagSort { key: ContestTagSortKey; direction: 'ascending' | 'descending'; }

/** 평균(합계 ÷ 등장 횟수)을 붙이고, 지금 정렬 기준으로 순위를 매긴 뒤 검색으로 거른다.
 *  순위는 검색 전에 매긴다 — 거른 뒤에도 전체 안에서의 자리가 보여야 한다. */
export function buildContestTagRows(tags: ContestTag[], sort: ContestTagSort, search: string): ContestTagRow[] {
  const rows: ContestTagRow[] = tags.map(t => ({
    ...t,
    avg_linear: t.count > 0 ? t.score_linear / t.count : 0,
    avg_inverse: t.count > 0 ? t.score_inverse / t.count : 0,
    avg_log: t.count > 0 ? t.score_log / t.count : 0,
  }));
  const desc = sort.direction === 'descending';
  rows.sort((a, b) => {
    const d = a[sort.key] - b[sort.key];
    if (d !== 0) return desc ? -d : d;
    const byName = a.tag.localeCompare(b.tag, 'ko');
    return desc ? byName : -byName;
  });
  const ranked = rows.map((r, i) => ({ ...r, Rank: desc ? i + 1 : rows.length - i }));
  const q = search.trim().toLowerCase();
  return q ? ranked.filter(r => r.tag.toLowerCase().includes(q)) : ranked;
}
