import type { ReactNode } from 'react';

interface EmptyStateProps {
  title: string;
  description?: ReactNode;
  /** 제목 위 작은 라벨. 기본값은 '결과 없음'이고, 검색·필터 결과가 비었을 때를 뜻한다.
   *  아직 만들지 않은 화면처럼 뜻이 다르면 다른 말을 넣거나 null로 끈다. */
  eyebrow?: ReactNode;
}

function EmptyState({ title, description, eyebrow = '결과 없음' }: EmptyStateProps) {
  return (
    <div className="empty-state">
      {eyebrow ? <div className="empty-state__eyebrow">{eyebrow}</div> : null}
      <h3 className="empty-state__title">{title}</h3>
      {description ? <p className="empty-state__description">{description}</p> : null}
    </div>
  );
}

export default EmptyState;
