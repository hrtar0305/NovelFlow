import React, { useState, useEffect, useTransition } from 'react';
import { Row, Col, Form, InputGroup, Button } from 'react-bootstrap';
import { Search } from 'react-bootstrap-icons';

interface NovelFilterControlsProps {
  onFilterChange: (filters: { searchTerm: string; minEps: number | null; maxEps: number | null }) => void;
}

const NovelFilterControls = React.memo(({ onFilterChange }: NovelFilterControlsProps) => {
  const [, startTransition] = useTransition();
  const [searchInput, setSearchInput] = useState('');
  const [tempMinEps, setTempMinEps] = useState(''); // For input field
  const [tempMaxEps, setTempMaxEps] = useState(''); // For input field

  const [currentMinEps, setCurrentMinEps] = useState<number | null>(null); // Applied filter value
  const [currentMaxEps, setCurrentMaxEps] = useState<number | null>(null); // Applied filter value

  // Debounce search input only
  useEffect(() => {
    const handler = setTimeout(() => {
      startTransition(() => {
        onFilterChange({ 
          searchTerm: searchInput, 
          minEps: currentMinEps, // Pass currently applied episode filters
          maxEps: currentMaxEps  // Pass currently applied episode filters
        });
      });
    }, 300);

    return () => {
      clearTimeout(handler);
    };
  }, [searchInput, onFilterChange]); // Only searchInput triggers this debounce

  const handleApplyEpsFilter = () => {
    startTransition(() => {
      const newMinEps = tempMinEps === '' ? null : Number(tempMinEps);
      const newMaxEps = tempMaxEps === '' ? null : Number(tempMaxEps);
      
      setCurrentMinEps(newMinEps);
      setCurrentMaxEps(newMaxEps);

      onFilterChange({ 
        searchTerm: searchInput, 
        minEps: newMinEps,
        maxEps: newMaxEps
      });
    });
  };

  return (
    <Row className="mb-2">
      <Col md={6}>
        <Form.Label htmlFor="search-input" className="fw-bold">제목/작가 검색</Form.Label>
        <InputGroup>
          <InputGroup.Text><Search /></InputGroup.Text>
          <Form.Control 
            id="search-input"
            placeholder="검색어 입력" // Changed placeholder
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
          />
        </InputGroup>
      </Col>
      <Col md={6}>
        <Form.Label className="fw-bold">회차 범위 필터</Form.Label>
        <InputGroup>
          <Form.Control 
            type="number" 
            placeholder="최소 회차" 
            value={tempMinEps} 
            onChange={(e) => setTempMinEps(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleApplyEpsFilter(); } }} // Added e.preventDefault()
          />
          <InputGroup.Text>-</InputGroup.Text>
          <Form.Control 
            type="number" 
            placeholder="최대 회차" 
            value={tempMaxEps} 
            onChange={(e) => setTempMaxEps(e.target.value)} 
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleApplyEpsFilter(); } }} // Added e.preventDefault()
          />
          <Button onClick={handleApplyEpsFilter}>적용</Button>
        </InputGroup>
      </Col>
    </Row>
  );
});

export default NovelFilterControls;