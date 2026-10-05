/**
 * 연재 기록 API(`/api/uploads`)의 날짜별 올린 화 수 → 요약. 회차 수 차이로 추정하지 않고 실제 회차 목록에서 센 값이다
 * (DECISIONS 2026-10-05). null = 모름(마지막 확인 뒤, 또는 다 받지 못한 기록의 앞부분).
 */
export type UploadDays = Record<string, number | null>;

export interface UploadsResponse {
  days: UploadDays;
  known_from: string | null;
  known_until: string | null;
  /** 첫 회차 날짜(다 받은 기록만). 그 앞은 쉰 날이 아니라 아직 없던 작품이다. */
  first_date?: string | null;
  /** 기록이 있는 작품인가(없으면 days 가 비어 있다) */
  tracked: boolean;
}

/** 응답 → 칸에 그릴 날짜별 값. 첫 회차 앞은 null(모름과 같이 그린다 — 0 이면 '쉰 날'로 칠해진다). */
export function uploadDays(r: UploadsResponse): UploadDays {
  const first = r.first_date;
  return Object.fromEntries(Object.entries(r.days ?? {}).map(([d, v]) => [d, first && d < first ? null : v]));
}

/** 알 수 있는 날 · 그중 올린 날 · 끝에서 거꾸로 센 연속 연재일 / 연속 휴재일(둘 중 하나만 0이 아니다). 끝의 모름은 건너뛰고, 중간의 모름에서 끊는다. */
export function uploadSummary(days: UploadDays) {
  const dates = Object.keys(days).sort();
  const known = dates.filter(d => days[d] != null);
  const uploaded = known.filter(d => (days[d] ?? 0) > 0).length;
  let streak = 0;
  let resting = 0;
  for (let i = dates.length - 1; i >= 0; i--) {
    const v = days[dates[i]];
    if (v == null) { if (streak || resting) break; continue; }  // 끝의 모름(아직 안 끝난 날)은 건너뛴다
    if (v > 0) { if (resting) break; streak++; } else { if (streak) break; resting++; }
  }
  return { known: known.length, uploaded, streak, resting };
}
