import { useState } from 'react';
import { NavLink } from 'react-router-dom';
import { Navbar, Nav, Container } from 'react-bootstrap';
import { Search } from './Search';

const Header = () => {
  const [expanded, setExpanded] = useState(false);

  return (
    <Navbar
      variant="dark"
      expand="lg"
      className="app-header"
      expanded={expanded}
      onToggle={setExpanded}
      onSelect={() => setExpanded(false)}
    >
      <Container>
        <Navbar.Brand as={NavLink} to="/" className="fw-bold fs-5 me-lg-3 me-2 text-nowrap" onClick={() => setExpanded(false)}>
          노벨피아 랭킹
        </Navbar.Brand>
        <div className="header-search-wrapper me-lg-5 me-2">
          <Search />
        </div>
        <Navbar.Toggle aria-controls="basic-navbar-nav" className="custom-navbar-toggle" />
        <Navbar.Collapse id="basic-navbar-nav">
          <Nav className="ms-auto align-items-lg-center align-items-end">
            <Nav.Link as={NavLink} to="/novels/rankings" className="fs-6" onClick={() => setExpanded(false)}>소설 랭킹</Nav.Link>
            <Nav.Link as={NavLink} to="/tags/rankings" className="fs-6" onClick={() => setExpanded(false)}>태그 랭킹</Nav.Link>
            <Nav.Link as={NavLink} to="/trends" className="fs-6" onClick={() => setExpanded(false)}>데이터 분석</Nav.Link>
            <Nav.Link as={NavLink} to="/contests" className="fs-6" onClick={() => setExpanded(false)}>공모전</Nav.Link>
          </Nav>
        </Navbar.Collapse>
      </Container>
    </Navbar>
  );
};

export default Header;
