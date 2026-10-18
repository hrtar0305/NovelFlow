import { describe, expect, it } from 'vitest';
import { entryRate, sortEntryTags, type EntryTag } from './contestEntryTags';

const t = (tag: string, count: number, entered: number): EntryTag => ({ tag, count, entered, entrants: 4666, pool: 500 });

describe('contestEntryTags (전체 참여작 태그)', () => {
  it('진입률 = 500위 진입 ÷ 참여작, 참여작 10편 미만은 null', () => {
    expect(entryRate(t('a', 100, 17))).toBeCloseTo(0.17);
    expect(entryRate(t('b', 9, 5))).toBeNull();
  });
  it('진입률 정렬에서 10편 미만 태그는 끝 — 2편 중 1편(50%)이 맨 위를 차지하지 않게', () => {
    const rows = [t('big', 3034, 258), t('tiny', 2, 1), t('mid', 40, 13)];
    expect(sortEntryTags(rows, { key: 'rate', direction: 'descending' }).map(r => r.tag)).toEqual(['mid', 'big', 'tiny']);
  });
  it('기본 정렬은 참여작 많은 순, 같으면 이름', () => {
    expect(sortEntryTags([t('나', 5, 0), t('가', 5, 0), t('다', 9, 0)], { key: 'count', direction: 'descending' }).map(r => r.tag)).toEqual(['다', '가', '나']);
  });
});
