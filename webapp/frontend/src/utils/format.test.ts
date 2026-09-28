import { describe, expect, it } from 'vitest';
import { DASH, formatDateDot, formatDateKo, formatInt, formatMan, formatRatio } from './format';

describe('formatInt', () => {
  it('천 단위 쉼표', () => expect(formatInt(7845354)).toBe('7,845,354'));
  it('없는 값은 대시', () => {
    expect(formatInt(null)).toBe(DASH);
    expect(formatInt(undefined)).toBe(DASH);
    expect(formatInt(Number.NaN)).toBe(DASH);
  });
});

describe('formatMan', () => {
  it('1만 미만은 그대로', () => expect(formatMan(9999)).toBe('9,999'));
  it('1만~100만은 소수 한 자리 만', () => {
    expect(formatMan(433801)).toBe('43.4만');
    expect(formatMan(100000)).toBe('10만');
  });
  it('100만 이상은 정수 만', () => expect(formatMan(7845354)).toBe('785만'));
  it('1억 이상은 억', () => {
    expect(formatMan(115510888)).toBe('1.2억');
    expect(formatMan(300000000)).toBe('3억');
  });
  it('없는 값은 대시', () => expect(formatMan(null)).toBe(DASH));
});

describe('formatRatio', () => {
  it('비율을 퍼센트로', () => {
    expect(formatRatio(0.06452, 2)).toBe('6.45%');
    expect(formatRatio(0.66)).toBe('66.0%');
  });
  it('없는 값은 대시', () => expect(formatRatio(null)).toBe(DASH));
});

describe('날짜', () => {
  it('점 표기', () => expect(formatDateDot('2026-09-27')).toBe('2026.09.27'));
  it('한국어 월일', () => expect(formatDateKo('2026-09-07')).toBe('9월 7일'));
});
