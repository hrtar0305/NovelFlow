import { NavLink } from 'react-router-dom';
import { Navbar, Nav, Container } from 'react-bootstrap';
import { Search } from './Search';

const Header = () => {
  return (
    <Navbar
      variant="dark"
      expand="lg"
      className="app-header"
    >
      <Container>
        <Navbar.Brand as={NavLink} to="/" className="fw-bold">
          노벨피아 랭킹
        </Navbar.Brand>
        <div className="header-search-wrapper mx-2">
          <Search />
        </div>
        <Navbar.Toggle aria-controls="basic-navbar-nav" />
        <Navbar.Collapse id="basic-navbar-nav">
          <Nav className="ms-auto align-items-lg-center align-items-end">
            <Nav.Link as={NavLink} to="/novels/rankings">소설 랭킹</Nav.Link>
            <Nav.Link as={NavLink} to="/tags/rankings">태그 랭킹</Nav.Link>
            <Nav.Link as={NavLink} to="/trends">데이터 분석</Nav.Link>
          </Nav>
        </Navbar.Collapse>
      </Container>
    </Navbar>
  );
};

export default Header;
