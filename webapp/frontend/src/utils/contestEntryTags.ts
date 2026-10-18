import { sortBy, type Sort } from './rankingQuery';

/**
 * 공모전 태그 '전체 참여작' 보기(2026-10-18) — 참여작들이 어떤 태그를 골랐고, 그 태그 작품이 얼마나 위로 올라가나.
 * 기본 보기(일간 500위 안 · 데일리와 같은 식)의 짝. 전체로 세면 100위 안이 2% 라 구역 · 지도를 두지 않고 표만 둔다.
 */
export interface EntryTag { tag: string; count: number; entered: number; entrants: number; pool: number }

/** 진입률을 내는 최소 참여작 수 — 5~9편은 0% · 50% 로 튀었다(전체에서는 데일리의 5편보다 높게). */
export const MIN_ENTRY = 10;

export const entryRate = (t: EntryTag): number | null => (t.count >= MIN_ENTRY ? t.entered / t.count : null);

export type EntrySortKey = 'count' | 'entered' | 'rate';
export type EntrySort = Sort<EntrySortKey>;
export const DEFAULT_ENTRY_SORT: EntrySort = { key: 'count', direction: 'descending' };

/** 값 없는 행(10편 미만의 진입률)은 끝, 같으면 참여작 많은 순 → 이름. */
export const sortEntryTags = (rows: EntryTag[], s: EntrySort): EntryTag[] => {
  const order = [...rows].sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag, 'ko'));
  const idx = new Map(order.map((r, i) => [r.tag, i]));
  return sortBy(order, r => (s.key === 'rate' ? entryRate(r) : r[s.key]), s.direction, r => idx.get(r.tag)!);
};
