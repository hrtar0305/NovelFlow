import type { ReactNode } from 'react';

interface PageTitleProps { title: ReactNode; nav?: ReactNode; aside?: ReactNode; meta?: ReactNode; }

/** 페이지 제목 줄. meta는 설명이 아니라 데이터 한 줄(예: 밤 9시 · 노벨피아 7일 조회순 상위 500). */
export default function PageTitle({ title, nav, aside, meta }: PageTitleProps) {
  return (
    <header className="page-title">
      <div className="page-title__row">
        <h1 className="page-title__h">{title}</h1>
        {nav ? <div className="page-title__nav">{nav}</div> : null}
        {aside ? <div className="page-title__aside">{aside}</div> : null}
      </div>
      {meta ? <p className="page-title__meta">{meta}</p> : null}
    </header>
  );
}
