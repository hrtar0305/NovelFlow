import { describe, expect, it } from 'vitest';
import { coverPlaceholder } from './coverPlaceholder';

describe('coverPlaceholder (작은 표지의 흐린 자리)', () => {
  it('같은 표지면 늘 같은 색 — 다시 그려도 깜빡이지 않게', () => {
    expect(coverPlaceholder('https://images.novelpia.com/a_1_ori.file')).toBe(coverPlaceholder('https://images.novelpia.com/a_1_ori.file'));
  });
  it('표지마다 색이 다르다', () => {
    const urls = Array.from({ length: 20 }, (_, i) => `https://images.novelpia.com/cover_${i}_ori.file`);
    expect(new Set(urls.map(coverPlaceholder)).size).toBe(20);
  });
  it('흐린 표지처럼 한 가지 색조 · 낮은 채도 — 여러 색이 섞이면 어색했다(사용자)', () => {
    for (let i = 0; i < 50; i += 1) {
      const bg = coverPlaceholder(`cover-${i}`);
      const hsl = [...bg.matchAll(/hsl\((\d+) (\d+)% (\d+)%/g)].map(m => m.slice(1).map(Number));
      expect(new Set(hsl.map(([h]) => h)).size).toBe(1);          // 색조 하나
      expect(Math.max(...hsl.map(([, sat]) => sat))).toBeLessThanOrEqual(25);   // 바랜 색
    }
  });
});
