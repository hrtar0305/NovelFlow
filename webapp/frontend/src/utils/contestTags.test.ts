import { describe, expect, it } from 'vitest';
import { buildContestTagRows, type ContestTag } from './contestTags';

const t = (tag: string, lin: number, inv: number, log: number, count: number): ContestTag =>
  ({ Rank: 0, tag, score_linear: lin, score_inverse: inv, score_log: log, count });
const tags = [t('판타지', 5000, 5.5, 220, 1000), t('현대', 2000, 2.2, 100, 500), t('하렘', 2000, 3.3, 80, 400), t('로맨스', 900, 0.9, 40, 300)];

describe('buildContestTagRows', () => {
  it('평균 = 합계 ÷ 등장 횟수', () => {
    const r = buildContestTagRows(tags, { key: 'score_linear', direction: 'descending' }, '');
    expect(r[0]).toMatchObject({ tag: '판타지', avg_linear: 5, avg_inverse: 0.0055, avg_log: 0.22 });
  });
  it('순위는 지금 정렬 기준으로 매긴다(내림차순 1위부터, 같으면 가나다)', () => {
    const r = buildContestTagRows(tags, { key: 'score_linear', direction: 'descending' }, '');
    expect(r.map(x => [x.Rank, x.tag])).toEqual([[1, '판타지'], [2, '하렘'], [3, '현대'], [4, '로맨스']]);
  });
  it('오름차순이면 순위 숫자도 뒤집힌다(가장 작은 값이 꼴찌)', () => {
    const r = buildContestTagRows(tags, { key: 'score_inverse', direction: 'ascending' }, '');
    expect(r.map(x => [x.Rank, x.tag])).toEqual([[4, '로맨스'], [3, '현대'], [2, '하렘'], [1, '판타지']]);
  });
  it('검색은 순위를 바꾸지 않고 거르기만 한다', () => {
    const r = buildContestTagRows(tags, { key: 'score_linear', direction: 'descending' }, '현');
    expect(r.map(x => [x.Rank, x.tag])).toEqual([[3, '현대']]);
  });
  it('등장 0회면 평균 0', () => {
    expect(buildContestTagRows([t('빈', 0, 0, 0, 0)], { key: 'count', direction: 'descending' }, '')[0].avg_linear).toBe(0);
  });
});
