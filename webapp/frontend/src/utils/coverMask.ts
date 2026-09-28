/** 표지 가림 판정. override는 그 표지에서 사용자가 직접 누른 결과(null = 누른 적 없음)다.
 *  개별 설정이 전체 설정(maskAll)보다 우선한다 — 전체 표시 상태에서도 한 장만 가릴 수 있어야 한다. */
export const isCoverMasked = (maskAll: boolean, override: boolean | null): boolean => override ?? maskAll;

/** 개별 버튼을 누른 뒤의 override: 지금 보이는 상태의 반대로 고정한다. */
export const nextOverride = (maskAll: boolean, override: boolean | null): boolean => !isCoverMasked(maskAll, override);
