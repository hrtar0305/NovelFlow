import { useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { Search } from './Search';
import ThemeToggle from './ThemeToggle';
import CoverMaskToggle from './CoverMaskToggle';
import { List } from 'react-bootstrap-icons';

// '태그'는 태그 랭킹과 태그 트렌드 두 경로에서 모두 켜진다 — 트렌드는 태그 페이지 안에서 전환한다.
const NAV_LINKS = [
  { to: '/novels/rankings', label: '랭킹', match: ['/novels'] },
  { to: '/tags/rankings', label: '태그', match: ['/tags'] },
  { to: '/contests', label: '공모전', match: ['/contests'] },
  { to: '/trends', label: '분석', match: ['/trends'] },
];

const Header = () => {
  const [menuOpen, setMenuOpen] = useState(false);
  const { pathname } = useLocation();
  const isOn = (match: string[]) => match.some(m => pathname === m || pathname.startsWith(m + '/'));

  return (
    <header className="app-header">
      <div className="app-header-inner">
        <NavLink to="/" className="app-header-brand" onClick={() => setMenuOpen(false)}>NovelFlow</NavLink>

        <div className="app-header-center">
          <nav className="app-header-nav" aria-label="주요 이동">
            {NAV_LINKS.map(({ to, label, match }) => (
              <NavLink
                key={to}
                to={to}
                className={`app-header-link${isOn(match) ? ' app-header-link--active' : ''}`}
                onClick={() => setMenuOpen(false)}
              >
                {label}
              </NavLink>
            ))}
          </nav>
          <div className="app-header-search">
            <Search />
          </div>
        </div>

        <div className="app-header-actions">
          <CoverMaskToggle />
          <ThemeToggle />
          <button
            type="button"
            className="app-header-menu-button"
            onClick={() => setMenuOpen((open) => !open)}
            aria-label="메뉴 열기"
            aria-expanded={menuOpen}
          >
            <List size={20} />
          </button>
        </div>
      </div>

      {menuOpen ? (
        <div className="app-header-mobile-menu">
          <div className="app-header-search">
            <Search />
          </div>
          {NAV_LINKS.map(({ to, label, match }) => (
            <NavLink
              key={to}
              to={to}
              className={`mobile-nav-link${isOn(match) ? ' mobile-nav-link--active' : ''}`}
              onClick={() => setMenuOpen(false)}
            >
              {label}
            </NavLink>
          ))}
        </div>
      ) : null}
    </header>
  );
};

export default Header;
