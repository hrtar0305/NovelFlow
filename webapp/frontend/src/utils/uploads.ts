/**
 * 연재 기록 API(`/api/uploads`)의 날짜별 올린 화 수 → 칸·요약. 회차 수 차이로 추정하지 않고 실제 회차 목록에서 센 값이다
 * (DECISIONS 2026-10-05). API 의 null = 그날을 셀 수 없음(마지막 확인 뒤, 다 받지 못한 앞부분, 본 시각이 든 날에 아직 안 보임).
 */
export interface UploadsResponse {
  days: Record<string, number | null>;
  known_from: string | null;
  known_until: string | null;
  /** 첫 회차 날짜(다 받은 기록만). 그 앞은 아직 없던 작품이다. */
  first_date?: string | null;
  /** 본 시각(행 펼침은 마감, 아니면 마지막 확인)이 든 날 — 그날은 다 지나지 않았다(데일리는 21시쯤 본다). */
  open_day?: string | null;
  /** 기록이 있는 작품인가(없으면 days 가 비어 있다) */
  tracked: boolean;
}

/** 칸 하나: 화 수(0 = 쉰 날) · 'pending' 미정(그날 아직 안 보임) · 'before' 첫 회차 앞(빈칸) · null 모름. */
export type UploadCell = number | 'pending' | 'before' | null;
export type UploadDays = Record<string, UploadCell>;

export function uploadDays(r: UploadsResponse): UploadDays {
  const first = r.first_date;
  return Object.fromEntries(Object.entries(r.days ?? {}).map(([d, v]): [string, UploadCell] =>
    [d, first && d < first ? 'before' : v == null && d === r.open_day ? 'pending' : v]));
}

/**
 * 아는 날 · 그중 올린 날. 연속 연재·연속 휴재는 세지 않는다(2026-10-05 사용자) — 칸으로 보이고, 연재 주기(주 3회 등)에 따라
 * 연속이 갈려 오히려 헷갈린다. 미정·모름·첫 회차 앞은 분모에서 뺀다.
 */
export function uploadSummary(days: UploadDays) {
  const known = Object.values(days).filter((v): v is number => typeof v === 'number');
  return { known: known.length, uploaded: known.filter(v => v > 0).length };
}
