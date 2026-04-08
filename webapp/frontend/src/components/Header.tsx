import { useState } from 'react';
import { NavLink } from 'react-router-dom';
import { Search } from './Search';
import ThemeToggle from './ThemeToggle';

const NAV_LINKS = [
  { to: '/novels/rankings', label: '소설 랭킹' },
  { to: '/tags/rankings',   label: '태그 랭킹' },
  { to: '/trends',          label: '데이터 분석' },
  { to: '/contests',        label: '공모전' },
];

const Header = () => {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <header className="app-header">
      <div className="app-header-inner">

        {/* Brand */}
        <NavLink to="/" className="app-header-brand" onClick={() => setMenuOpen(false)}>
          <span className="brand-icon">N</span>
          <span className="brand-text">노벨피아 랭킹</span>
        </NavLink>

        {/* Desktop nav */}
        <nav className="app-header-nav d-none d-lg-flex">
          {NAV_LINKS.map(({ to, label }) => (
            <NavLink key={to} to={to} className={({ isActive }) =>
              `app-header-link${isActive ? ' app-header-link--active' : ''}`
            }>
              {label}
            </NavLink>
          ))}
        </nav>

        {/* Search */}
        <div className="header-search-wrapper">
          <Search />
        </div>

        {/* Theme toggle */}
        <ThemeToggle />

        {/* Mobile hamburger */}
        <button
          className="app-header-hamburger d-lg-none"
          onClick={() => setMenuOpen(o => !o)}
          aria-label="메뉴 열기"
        >
          <span className={`hamburger-line ${menuOpen ? 'open-1' : ''}`} />
          <span className={`hamburger-line ${menuOpen ? 'open-2' : ''}`} />
          <span className={`hamburger-line ${menuOpen ? 'open-3' : ''}`} />
        </button>
      </div>

      {/* Mobile dropdown menu */}
      <div className={`app-header-mobile-menu ${menuOpen ? 'is-open' : ''}`}>
        {NAV_LINKS.map(({ to, label }) => (
          <NavLink key={to} to={to}
            className={({ isActive }) =>
              `mobile-nav-link${isActive ? ' mobile-nav-link--active' : ''}`
            }
            onClick={() => setMenuOpen(false)}
          >
            {label}
          </NavLink>
        ))}
      </div>
    </header>
  );
};

export default Header;
