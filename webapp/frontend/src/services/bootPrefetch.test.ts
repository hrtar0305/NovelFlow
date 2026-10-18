import { describe, expect, it } from 'vitest';
import { bootPlan } from './bootPrefetch';

describe('bootPlan (앱 시작 때 미리 받을 데이터)', () => {
  it('데일리 랭킹 — 날짜가 없으면 최신 날짜를 날짜 목록에서', () => {
    expect(bootPlan('/novels/rankings', '')).toEqual({ kind: 'daily', page: 'novels', date: null });
    expect(bootPlan('/', '')).toEqual({ kind: 'daily', page: 'novels', date: null });
    expect(bootPlan('/novels/rankings/2026-10-18', '')).toEqual({ kind: 'daily', page: 'novels', date: '2026-10-18' });
  });
  it('태그 랭킹', () => {
    expect(bootPlan('/tags/rankings/2026-10-17', '')).toEqual({ kind: 'daily', page: 'tags', date: '2026-10-17' });
  });
  it('공모전 — 연도 · 작품/태그 · 날짜', () => {
    expect(bootPlan('/contests', '')).toEqual({ kind: 'contest', year: 2026, page: 'novels', date: null });
    expect(bootPlan('/contests/2026/2026-10-17', '')).toEqual({ kind: 'contest', year: 2026, page: 'novels', date: '2026-10-17' });
    expect(bootPlan('/contests/2026/tags/rankings', '')).toEqual({ kind: 'contest', year: 2026, page: 'tags', date: null });
    expect(bootPlan('/contests/2025', '')).toEqual({ kind: 'contest', year: 2025, page: 'novels', date: null });
  });
  it('분석 — ?days= (7/30/90, 그 밖은 30)', () => {
    expect(bootPlan('/trends', '?days=7')).toEqual({ kind: 'analysis', days: 7 });
    expect(bootPlan('/trends', '?days=12')).toEqual({ kind: 'analysis', days: 30 });
  });
  it('그 밖(상세 · 작가 · 트렌드 등)은 미리 받지 않는다', () => {
    expect(bootPlan('/novels/453091', '')).toBeNull();
    expect(bootPlan('/contests/2026/novels/455356', '')).toBeNull();
    expect(bootPlan('/tags/trends', '')).toBeNull();
  });
});
