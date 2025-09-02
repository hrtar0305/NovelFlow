import { NavLink } from 'react-router-dom';
import { Search } from './Search';

const Header = () => {
  return (
    <header className="app-header">
      <div className="app-header-container">
        <div className="app-header-left">
          <NavLink to="/" className="app-header-brand">
            노벨피아 랭킹 사이트
          </NavLink>
        </div>
        <div className="app-header-center">
          <Search />
        </div>
        <nav className="app-header-right">
          <NavLink to="/novels/rankings" className="app-header-link" style={{ fontSize: '1.05rem' }}>
            소설 랭킹
          </NavLink>
          <NavLink to="/tags/rankings" className="app-header-link" style={{ fontSize: '1.05rem' }}>
            태그 랭킹
          </NavLink>
          <NavLink to="/trends" className="app-header-link" style={{ fontSize: '1.05rem' }}>
            데이터 분석
          </NavLink>
        </nav>
      </div>
    </header>
  );
};

export default Header;
