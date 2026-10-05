import { describe, expect, it } from 'vitest';
import { uploadDays, uploadSummary, type UploadsResponse } from './uploads';

const res = (days: UploadsResponse['days'], extra: Partial<UploadsResponse> = {}): UploadsResponse =>
  ({ days, known_from: null, known_until: '2026-10-05', first_date: null, open_day: null, tracked: true, ...extra });

describe('uploadDays', () => {
  it('첫 회차 앞은 빈칸(아직 없던 작품) — 쉰 날도 모름도 아니다', () => {
    expect(uploadDays(res({ '2026-09-30': 0, '2026-10-01': 5, '2026-10-02': 0 }, { first_date: '2026-10-01' })))
      .toEqual({ '2026-09-30': 'before', '2026-10-01': 5, '2026-10-02': 0 });
  });
  it('본 시각이 든 날(데일리 21시 확인)에 아직 안 보였으면 미정, 보였으면 그 수', () => {
    expect(uploadDays(res({ '2026-10-04': 1, '2026-10-05': null }, { open_day: '2026-10-05' }))).toEqual({ '2026-10-04': 1, '2026-10-05': 'pending' });
    expect(uploadDays(res({ '2026-10-04': 1, '2026-10-05': 2 }, { open_day: '2026-10-05' }))).toEqual({ '2026-10-04': 1, '2026-10-05': 2 });
  });
  it('그 밖의 null 은 모름(마지막 확인 뒤 · 다 받지 못한 앞부분)', () => {
    expect(uploadDays(res({ '2026-10-04': null, '2026-10-05': null }, { open_day: '2026-10-03' }))).toEqual({ '2026-10-04': null, '2026-10-05': null });
  });
});

describe('uploadSummary', () => {
  it('아는 날 중 올린 날 — 미정·모름·첫 회차 앞은 세지 않는다', () => {
    expect(uploadSummary({ '2026-09-30': 'before', '2026-10-01': 1, '2026-10-02': 0, '2026-10-03': 2, '2026-10-04': null, '2026-10-05': 'pending' }))
      .toEqual({ known: 3, uploaded: 2 });
    expect(uploadSummary({})).toEqual({ known: 0, uploaded: 0 });
  });
});
