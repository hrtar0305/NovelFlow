import { describe, expect, it } from 'vitest';
import { isCoverMasked, nextOverride } from './coverMask';

describe('isCoverMasked', () => {
  it('개별 설정이 없으면 전체 설정을 따른다', () => {
    expect(isCoverMasked(true, null)).toBe(true);
    expect(isCoverMasked(false, null)).toBe(false);
  });
  it('전체 가림에서 개별로 보기', () => expect(isCoverMasked(true, false)).toBe(false));
  it('전체 표시에서 개별로 가리기', () => expect(isCoverMasked(false, true)).toBe(true));
});

describe('nextOverride', () => {
  it('누르면 지금 보이는 상태의 반대로 고정한다', () => {
    expect(nextOverride(false, null)).toBe(true);
    expect(nextOverride(true, null)).toBe(false);
    expect(nextOverride(false, true)).toBe(false);
  });
});
