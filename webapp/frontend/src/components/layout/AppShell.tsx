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
      <footer className="app-footer">
        <div className="app-main-inner">
          <Link to="/data-collection-info" className="app-footer__link">수집 및 랭킹 기준</Link>
        </div>
      </footer>
    </div>
  );
}

export default AppShell;
