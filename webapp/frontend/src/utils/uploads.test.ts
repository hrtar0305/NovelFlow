import { describe, expect, it } from 'vitest';
import { uploadDays, uploadSummary, type UploadsResponse } from './uploads';

const res = (days: UploadsResponse['days'], extra: Partial<UploadsResponse> = {}): UploadsResponse =>
  ({ days, known_from: null, known_until: '2026-10-05', first_date: null, tracked: true, ...extra });

describe('uploadDays', () => {
  it('첫 회차 앞은 빈칸(아직 없던 작품) — 쉰 날도 모름도 아니다', () => {
    expect(uploadDays(res({ '2026-09-30': 0, '2026-10-01': 5, '2026-10-02': 0 }, { first_date: '2026-10-01' })))
      .toEqual({ '2026-09-30': 'before', '2026-10-01': 5, '2026-10-02': 0 });
  });
  it('그 밖의 null 은 모름(아직 안 끝난 날 · 마지막 확인 뒤 · 다 받지 못한 앞부분 — 칸은 모두 ?)', () => {
    expect(uploadDays(res({ '2026-10-04': 1, '2026-10-05': null }))).toEqual({ '2026-10-04': 1, '2026-10-05': null });
  });
});

describe('uploadSummary', () => {
  it('분모는 기간 일수로 고정 — 올린 날은 확정(거짓 양성 없음), 모름(?)은 미확인으로 따로 센다', () => {
    expect(uploadSummary({ '2026-09-30': 'before', '2026-10-01': 1, '2026-10-02': 0, '2026-10-03': 2, '2026-10-04': null, '2026-10-05': null }))
      .toEqual({ days: 6, uploaded: 2, unknown: 2, known: 3 });
  });
  it('첫 회차 앞은 미확인이 아니다(아직 없던 작품)', () => {
    expect(uploadSummary({ '2026-10-01': 'before', '2026-10-02': 'before', '2026-10-03': 1 })).toEqual({ days: 3, uploaded: 1, unknown: 0, known: 1 });
    expect(uploadSummary({})).toEqual({ days: 0, uploaded: 0, unknown: 0, known: 0 });
  });
});
