import type { PropsWithChildren } from 'react';
import { Link } from 'react-router-dom';
import Header from '../Header';
import ScrollTop from '../ui/ScrollTop';

const REPO_URL = 'https://github.com/hrtar0305/NovelFlow';

function AppShell({ children }: PropsWithChildren) {
  return (
    <div className="app-shell">
      <Header />
      <main className="app-main">
        <div className="app-main-inner">{children}</div>
      </main>
      <footer className="app-footer">
        <div className="app-main-inner app-footer__inner">
          <p className="app-footer__links">
            <Link to="/data-collection-info" className="app-footer__link">수집 및 랭킹 기준</Link>
            <a href={REPO_URL} className="app-footer__link" target="_blank" rel="noopener noreferrer">소스 코드 (MIT 라이선스)</a>
          </p>
          {/* 코드는 MIT(LICENSE.md)지만 크롤링한 작품 정보는 우리 것이 아니라 라이선스 대상이 아니다 — 둘을 분리해 적는다. */}
          <p>
            작품 제목·줄거리·표지·태그의 권리는 노벨피아와 각 작가에게 있으며 코드 라이선스에 포함되지 않습니다.
            권리자 요청은 <a href={`${REPO_URL}/issues`} className="app-footer__link" target="_blank" rel="noopener noreferrer">GitHub 이슈</a>로 받습니다.
          </p>
          <p>© 2024–{new Date().getFullYear()} NovelFlow</p>
        </div>
      </footer>
      <ScrollTop />
    </div>
  );
}

export default AppShell;
