const WEEK = ['월', '화', '수', '목', '금', '토', '일'];

/** 작가가 정한 연재 요일 원문('월/화/수/목/금/토/일' · '비정기' · '월/수/금')을 짧은 표기로.
 *  일곱 요일이면 '매일 연재', 비정기는 '비정기 연재', 그 밖은 '월·수·금 연재'. 모르는 표기는 원문 그대로 둔다. */
export function formatSerialDays(raw?: string | null): string | null {
  const s = raw?.trim();
  if (!s) return null;
  if (s === '비정기') return '비정기 연재';
  const parts = s.split('/').map(p => p.trim()).filter(Boolean);
  if (parts.length > 0 && parts.every(p => WEEK.includes(p))) {
    return parts.length === 7 ? '매일 연재' : `${parts.join('·')} 연재`;
  }
  return s;
}
