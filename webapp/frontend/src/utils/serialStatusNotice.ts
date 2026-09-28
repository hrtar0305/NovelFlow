import { SERIAL_STATUS_SINCE } from './rankingQuery';

const [y, m, d] = SERIAL_STATUS_SINCE.split('-').map(Number);

/** 연재 상태 기록이 없는 날에 상태 조건을 골랐을 때 보이는 안내. */
export const SERIAL_STATUS_NOTICE = `연재 상태는 ${y}년 ${m}월 ${d}일 랭킹부터 기록돼 있어, 그 이전 날짜에는 적용할 수 없습니다.`;
