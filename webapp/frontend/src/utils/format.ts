/** 화면 표기 규칙(스펙 §3.3). 없는 값은 모두 DASH. */
export const DASH = '–';

const isNum = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
const trimZero = (s: string) => s.replace(/\.0$/, '');

export const formatInt = (n?: number | null): string => (isNum(n) ? n.toLocaleString('ko-KR') : DASH);

/** 표 밖(쇼케이스·한 줄 수치)에서 쓰는 큰 수 표기. 표 안에서는 formatInt. */
export const formatMan = (n?: number | null): string => {
  if (!isNum(n)) return DASH;
  if (n >= 1e8) return `${trimZero((n / 1e8).toFixed(1))}억`;
  if (n >= 1e6) return `${Math.round(n / 1e4).toLocaleString('ko-KR')}만`;
  if (n >= 1e4) return `${trimZero((n / 1e4).toFixed(1))}만`;
  return n.toLocaleString('ko-KR');
};

export const formatRatio = (v?: number | null, digits = 1): string => (isNum(v) ? `${(v * 100).toFixed(digits)}%` : DASH);

export const formatDateDot = (iso: string): string => iso.replaceAll('-', '.');

export const formatDateKo = (iso: string): string => {
  const [, m, d] = iso.split('-');
  return `${Number(m)}월 ${Number(d)}일`;
};
