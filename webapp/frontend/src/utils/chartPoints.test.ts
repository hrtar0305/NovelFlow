import { describe, expect, it } from 'vitest';
import { isolatedIndices } from './chartPoints';

describe('isolatedIndices', () => {
  it('앞뒤가 모두 비어 선이 그려지지 않는 점', () => {
    expect(isolatedIndices([null, 480, null, 470, 460, null])).toEqual([1]);
  });
  it('양 끝은 바깥을 빈 것으로 본다', () => {
    expect(isolatedIndices([490, null, null, 495])).toEqual([0, 3]);
  });
  it('이어진 구간은 없다', () => {
    expect(isolatedIndices([1, 2, 3])).toEqual([]);
    expect(isolatedIndices([null, null])).toEqual([]);
  });
  it('점이 하나뿐이면 그 점', () => expect(isolatedIndices([7])).toEqual([0]));
});
