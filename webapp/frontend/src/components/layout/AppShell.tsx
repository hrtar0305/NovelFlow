import type { PropsWithChildren } from 'react';
import { Link } from 'react-router-dom';
import Header from '../Header';

function AppShell({ children }: PropsWithChildren) {
  return (
    <div className="app-shell">
      <Header />
      <main className="app-main">
        <div className="app-main-inner">{children}</div>
      </main>
      {/* 공개 기간 동안의 표시 제한을 알리는 최소 안내. 배너로 띄우지 않고
          페이지 맨 아래 한 줄로만 둔다 — 읽는 사람이 "그렇구나" 하고 넘어갈
          정도면 충분하고, 닫기 버튼도 두지 않는다. */}
      <footer className="app-footer">
        <div className="app-main-inner">
          공개 기간 동안 일부 등급 제한 작품은 목록에서 제외하고 있습니다. 수집·집계는 전체 순위를 대상으로 합니다.
          {' '}
          <Link to="/data-collection-info" className="app-footer__link">수집 및 랭킹 기준</Link>
        </div>
      </footer>
    </div>
  );
}

export default AppShell;
