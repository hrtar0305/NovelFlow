export type RankChangeValue = number | 'New' | null | undefined;
export type RankChangeKind = 'up' | 'down' | 'same' | 'new' | 'none';

export interface RankChangeView {
  kind: RankChangeKind;
  text: string;
  /** 화면 읽기·툴팁용 문장 */
  label: string;
}

/** `rank_change`(전일 순위 − 오늘 순위, 양수 = 상승)를 표기로 바꾼다.
 *  0(변동 없음)과 값 없음(전일 기록 없음)을 구분한다 — 같은 기호로 뭉뚱그리지 않는다. */
export function describeRankChange(value: RankChangeValue): RankChangeView {
  if (value === 'New') return { kind: 'new', text: 'NEW', label: '신규 진입' };
  if (typeof value !== 'number' || !Number.isFinite(value)) return { kind: 'none', text: '', label: '비교할 전일 기록 없음' };
  if (value === 0) return { kind: 'same', text: '–', label: '변동 없음' };
  const n = Math.abs(value).toLocaleString('ko-KR');
  return value > 0
    ? { kind: 'up', text: `▲${n}`, label: `${n}계단 상승` }
    : { kind: 'down', text: `▼${n}`, label: `${n}계단 하락` };
}
