import { describe, expect, it } from 'vitest';
import { pendingCount, subscribePending, trackPending } from './loadingSignal';

describe('loadingSignal (전역 로딩 막대의 재료)', () => {
  it('요청이 끝날 때까지 센다 — 실패해도 내린다', async () => {
    const seen: number[] = [];
    const off = subscribePending(n => seen.push(n));
    let ok!: () => void;
    let bad!: (e: Error) => void;
    const a = trackPending(new Promise<void>(r => { ok = r; }));
    const b = trackPending(new Promise<void>((_, j) => { bad = j; }));
    expect(pendingCount()).toBe(2);
    ok(); await a;
    bad(new Error('x')); await b.catch(() => {});
    expect(pendingCount()).toBe(0);
    expect(seen).toEqual([1, 2, 1, 0]);
    off();
  });
});
