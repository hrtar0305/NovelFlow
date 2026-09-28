import { useState } from 'react';
import { NavLink } from 'react-router-dom';
import { Search } from './Search';
import ThemeToggle from './ThemeToggle';
import CoverMaskToggle from './CoverMaskToggle';
import { List } from 'react-bootstrap-icons';

const NAV_LINKS = [
  { to: '/novels/rankings', label: '소설 랭킹' },
  { to: '/tags/rankings',   label: '태그 랭킹' },
  { to: '/trends',          label: '데이터 분석' },
  { to: '/tags/trends',     label: '태그 트렌드' },
  { to: '/contests',        label: '공모전' },
];

const Header = () => {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <header className="app-header">
      <div className="app-header-inner">
        <NavLink to="/" className="app-header-brand" onClick={() => setMenuOpen(false)}>
          <span className="brand-icon">N</span>
          <span className="brand-copy">
            <span className="brand-text">노벨피아 랭킹</span>
          </span>
        </NavLink>

        <div className="app-header-center">
          <nav className="app-header-nav" aria-label="주요 이동">
            {NAV_LINKS.map(({ to, label }) => (
              <NavLink
                key={to}
                to={to}
                className={({ isActive }) =>
                  `app-header-link${isActive ? ' app-header-link--active' : ''}`
                }
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
          {NAV_LINKS.map(({ to, label }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                `mobile-nav-link${isActive ? ' mobile-nav-link--active' : ''}`
              }
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
