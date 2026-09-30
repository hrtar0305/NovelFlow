import { describe, expect, it } from 'vitest';
import { formatSerialDays } from './novelFacts';

describe('formatSerialDays', () => {
  it('일곱 요일은 매일', () => expect(formatSerialDays('월/화/수/목/금/토/일')).toBe('매일 연재'));
  it('일부 요일은 가운뎃점으로', () => expect(formatSerialDays('월/수/금')).toBe('월·수·금 연재'));
  it('비정기', () => expect(formatSerialDays('비정기')).toBe('비정기 연재'));
  it('없으면 null', () => {
    expect(formatSerialDays(null)).toBeNull();
    expect(formatSerialDays('  ')).toBeNull();
  });
  it('모르는 표기는 원문 그대로', () => expect(formatSerialDays('격주 토요일')).toBe('격주 토요일'));
});
