import { describe, expect, it } from 'vitest';
import { uploadDays, uploadSummary } from './uploads';

describe('uploadSummary', () => {
  it('끝에서 센 연속 연재, 모름에서 끊는다', () => {
    expect(uploadSummary({ '2026-10-01': 1, '2026-10-02': 2, '2026-10-03': 1 })).toEqual({ known: 3, uploaded: 3, streak: 3, resting: 0 });
    expect(uploadSummary({ '2026-10-01': 1, '2026-10-02': null, '2026-10-03': 1 })).toEqual({ known: 2, uploaded: 2, streak: 1, resting: 0 });
    expect(uploadSummary({ '2026-10-01': 1, '2026-10-02': 0, '2026-10-03': 0 })).toEqual({ known: 3, uploaded: 1, streak: 0, resting: 2 });
  });
  it('끝이 모름이면 연속을 세지 않는다', () => {
    expect(uploadSummary({ '2026-10-01': 1, '2026-10-02': null })).toEqual({ known: 1, uploaded: 1, streak: 0, resting: 0 });
  });
});

describe('uploadDays', () => {
  it('첫 회차 앞은 쉰 날이 아니라 모름(아직 없던 작품)', () => {
    const r = { days: { '2026-09-30': 0, '2026-10-01': 5, '2026-10-02': 0 }, known_from: null, known_until: '2026-10-02', first_date: '2026-10-01', tracked: true };
    expect(uploadDays(r)).toEqual({ '2026-09-30': null, '2026-10-01': 5, '2026-10-02': 0 });
    expect(uploadDays({ ...r, first_date: null })).toEqual(r.days);
  });
});
