/**
 * 연재 기록 API(`/api/uploads`)의 날짜별 올린 화 수 → 칸·요약. 회차 수 차이로 추정하지 않고 실제 회차 목록에서 센 값이다
 * (DECISIONS 2026-10-05). API 의 null = 그날을 확정할 수 없음(아직 안 끝난 날에 안 보임 · 마지막 확인 뒤 · 다 받지 못한 앞부분).
 */
export interface UploadsResponse {
  days: Record<string, number | null>;
  known_from: string | null;
  known_until: string | null;
  /** 첫 회차 날짜(다 받은 기록만). 그 앞은 아직 없던 작품이다. */
  first_date?: string | null;
  /** 기록이 있는 작품인가(없으면 days 가 비어 있다) */
  tracked: boolean;
}

/** 칸 하나: 화 수(≥1 올린 날, 0 쉰 날 확정) · 'before' 첫 회차 앞(빈칸) · null 확정할 수 없음(?). */
export type UploadCell = number | 'before' | null;
export type UploadDays = Record<string, UploadCell>;
/** 화면이 들고 있는 연재 기록: 받은 값 · 받는 중 · 실패. 받는 중·실패를 빈 값({})으로 두면 모든 칸이 ? 로 그려져 틀린 정보가 된다. */
export type UploadsState = UploadDays | 'loading' | 'error';

export function uploadDays(r: UploadsResponse): UploadDays {
  const first = r.first_date;
  return Object.fromEntries(Object.entries(r.days ?? {}).map(([d, v]): [string, UploadCell] =>
    [d, first && d < first ? 'before' : v]));
}

/**
 * 기간 일수 · 올린 날 · 미확인 날 · 아는 날. 분모는 **기간 일수로 고정**한다(2026-10-18 사용자) — 작품마다 '29일 중'·'30일 중'으로
 * 갈리면 견주기 어렵다. 올린 날은 실제 회차 목록에서 본 것이라 거짓 양성이 없고, 확정할 수 없는 날(?)은 '미확인 N일'로 따로 보여
 * 왜곡을 드러낸다. 첫 회차 앞은 아직 없던 작품이라 미확인이 아니다. 연속 연재·휴재는 세지 않는다(2026-10-05).
 * `episodes` = 칸의 화 수 합 — 기간에 올린 화 수는 이것으로 쓴다(21시 스냅샷의 총 회차 차이는 세는 구간이 달라 칸과 어긋난다, 2026-10-18).
 */
export function uploadSummary(days: UploadDays) {
  const vals = Object.values(days);
  const known = vals.filter((v): v is number => typeof v === 'number');
  return { days: vals.length, uploaded: known.filter(v => v > 0).length, episodes: known.reduce((a, v) => a + v, 0),
           unknown: vals.filter(v => v === null).length, known: known.length };
}
