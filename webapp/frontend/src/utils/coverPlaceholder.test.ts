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
  it('흐린 그림처럼 겹친 그라데이션', () => {
    const bg = coverPlaceholder('x');
    expect(bg.match(/radial-gradient/g)?.length).toBe(2);
    expect(bg).toContain('linear-gradient');
  });
});
