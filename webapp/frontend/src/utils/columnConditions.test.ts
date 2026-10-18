import { describe, expect, it } from 'vitest';
import { applyColumnConditions, contestColumns, describeCondition, type ColumnCondition } from './columnConditions';
import type { ContestNovel } from './contestNovels';

const n = (id: string, over: Partial<ContestNovel>): ContestNovel =>
  ({ ID: id, Rank: 1, Tags: [], Date: '2026-10-17', view_change: 0, like_to_view_ratio: 0, View: 100, daily_rank: 1, ...over });
const ids = (xs: ContestNovel[]) => xs.map(x => x.ID);

describe('applyColumnConditions (공모전 열 조건)', () => {
  const rows = [
    n('big', { View: 285055, EarlyRetentionRate: 0.45 }),
    n('small', { View: 1407, EarlyRetentionRate: 0.45 }),
    n('short', { View: 50000, EarlyRetentionRate: null }),   // 30화 미만 — 잔류율 없음
    n('gone', { View: -1 }),                                  // 삭제된 작품
  ];

  it('조건이 없으면 그대로', () => {
    expect(ids(applyColumnConditions(rows, [], true))).toEqual(['big', 'small', 'short', 'gone']);
  });

  it('조건은 모두 만족(AND) — 이상 · 이하', () => {
    const c: ColumnCondition[] = [{ key: 'View', op: 'gte', value: 1000 }, { key: 'View', op: 'lte', value: 100000 }];
    expect(ids(applyColumnConditions(rows, c, true))).toEqual(['small', 'short']);
  });

  it('퍼센트 열은 화면 단위(30 = 30%)로 비교한다', () => {
    expect(ids(applyColumnConditions(rows, [{ key: 'EarlyRetentionRate', op: 'gte', value: 30 }], true))).toEqual(['big', 'small']);
  });

  it('값이 없는 작품(잔류율 없음 · 삭제)은 그 조건에서 빠진다 — 이하 조건에서도', () => {
    expect(ids(applyColumnConditions(rows, [{ key: 'EarlyRetentionRate', op: 'lte', value: 100 }], true))).toEqual(['big', 'small']);
    expect(ids(applyColumnConditions(rows, [{ key: 'View', op: 'lte', value: 10 ** 9 }], true))).toEqual(['big', 'small', 'short']);
  });

  it('값을 아직 안 넣은 줄(null)은 무시한다', () => {
    expect(applyColumnConditions(rows, [{ key: 'View', op: 'gte', value: null }], true)).toHaveLength(4);
  });

  it('일간 순위가 없는 작품(2026)은 일간 조회도 값 없음 — 표에서 – 로 보이는 칸', () => {
    const r = [n('a', { daily_rank: null, view_change: 5000 }), n('b', { daily_rank: 3, view_change: 5000 })];
    expect(ids(applyColumnConditions(r, [{ key: 'view_change', op: 'gte', value: 1 }], true))).toEqual(['b']);
  });

  it('변동의 NEW 는 가장 큰 상승으로 친다(정렬과 같다)', () => {
    const r = [n('new', { daily_rank_change: 'New' }), n('up', { daily_rank_change: 3 }), n('down', { daily_rank_change: -2 })];
    expect(ids(applyColumnConditions(r, [{ key: 'daily_rank_change', op: 'gte', value: 1 }], true))).toEqual(['new', 'up']);
  });
});

describe('contestColumns / describeCondition', () => {
  it('2026(일간)은 일간 순위 · 잔류율, 2025 는 누적 순위만', () => {
    expect(contestColumns(true).map(c => c.key)).toEqual(['daily_rank', 'daily_rank_change', 'view_change', 'View', 'like_to_view_ratio', 'EarlyRetentionRate', 'RecentRetentionRate']);
    expect(contestColumns(false).map(c => c.key)).toEqual(['Rank', 'rank_change', 'view_change', 'View', 'like_to_view_ratio']);
  });
  it('표시: 누적 조회 ≥ 1,000회 · 초반 잔류 ≥ 30%', () => {
    expect(describeCondition({ key: 'View', op: 'gte', value: 1000 })).toBe('누적 조회 ≥ 1,000회');
    expect(describeCondition({ key: 'EarlyRetentionRate', op: 'gte', value: 30 })).toBe('초반 잔류 ≥ 30%');
    expect(describeCondition({ key: 'daily_rank', op: 'lte', value: 300 })).toBe('일간 순위 ≤ 300위');
  });
});
