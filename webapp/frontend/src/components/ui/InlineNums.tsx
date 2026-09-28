import type { ReactNode } from 'react';

export interface InlineNum { label: ReactNode; value: ReactNode; }

/** 큰 숫자 타일 대신 쓰는 한 줄 수치: 조회 72.2만 | 추천 3.6만 */
export default function InlineNums({ items }: { items: InlineNum[] }) {
  return (
    <p className="inline-nums">
      {items.map((it, i) => <span key={i} className="inline-nums__item">{it.label}<b>{it.value}</b></span>)}
    </p>
  );
}
