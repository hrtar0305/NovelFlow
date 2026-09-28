import { describe, expect, it } from 'vitest';
import { describeRankChange } from './rankChange';

describe('describeRankChange', () => {
  it('상승', () => expect(describeRankChange(135)).toEqual({ kind: 'up', text: '▲135', label: '135계단 상승' }));
  it('하락', () => expect(describeRankChange(-2)).toEqual({ kind: 'down', text: '▼2', label: '2계단 하락' }));
  it('변동 없음', () => expect(describeRankChange(0)).toEqual({ kind: 'same', text: '–', label: '변동 없음' }));
  it('신규', () => expect(describeRankChange('New')).toEqual({ kind: 'new', text: 'NEW', label: '신규 진입' }));
  it('기록 없음은 변동 없음과 다르다', () => {
    expect(describeRankChange(undefined)).toEqual({ kind: 'none', text: '', label: '비교할 전일 기록 없음' });
    expect(describeRankChange(null).kind).toBe('none');
  });
  it('큰 수는 쉼표', () => expect(describeRankChange(1200).text).toBe('▲1,200'));
});
