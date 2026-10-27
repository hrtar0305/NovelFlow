import { describe, expect, it } from 'vitest';
import { deltaSpan } from './contest';

describe('deltaSpan — 그날 일간 값이 며칠치인가(직전 수집일부터)', () => {
  const dates = new Set(['2026-10-23', '2026-10-24', '2026-10-26']);
  it('전날 수집이 있으면 1일치', () => {
    expect(deltaSpan('2026-10-24', dates)).toEqual({ prev: '2026-10-23', days: 1 });
  });
  it('수집이 빠진 날 다음 날은 여러 날치 — 공모전은 실제 직전 수집일과 견준다', () => {
    expect(deltaSpan('2026-10-26', dates)).toEqual({ prev: '2026-10-24', days: 2 });
  });
  it('직전 수집이 없으면 null', () => {
    expect(deltaSpan('2026-10-23', dates)).toBeNull();
  });
});
