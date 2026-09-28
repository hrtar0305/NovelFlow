import React, { useState, useEffect, useTransition } from 'react';
import { Form, InputGroup } from 'react-bootstrap';
import { Search } from 'react-bootstrap-icons';

interface ContestNovelFilterControlsProps {
  onFilterChange: (filters: { searchTerm: string; minEps: number | null; maxEps: number | null }) => void;
}

const ContestNovelFilterControls = React.memo(({ onFilterChange }: ContestNovelFilterControlsProps) => {
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
          maxEps: currentMaxEps
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

      // Apply episode filter immediately
      onFilterChange({ 
        searchTerm: searchInput, 
        minEps: newMinEps,
        maxEps: newMaxEps
      });
    });
  };

  return (
    <div className="filter-controls mb-2">
      <div className="filter-control-group filter-control-group--search" style={{ minWidth: '150px' }}>
        <InputGroup className="filter-control-input-group">
          <InputGroup.Text><Search /></InputGroup.Text>
          <Form.Control 
            id="search-input"
            placeholder="검색어 입력"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
          />
        </InputGroup>
      </div>
      <div className="filter-control-group filter-control-group--range" style={{ minWidth: '180px' }}>
        <div className="episode-filter-grid">
          <input
            className="episode-filter-input"
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            placeholder="최소 회차"
            value={tempMinEps}
            onChange={(e) => setTempMinEps(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleApplyEpsFilter(); } }}
          />
          <input
            className="episode-filter-input"
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            placeholder="최대 회차"
            value={tempMaxEps}
            onChange={(e) => setTempMaxEps(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleApplyEpsFilter(); } }}
          />
          <button type="button" className="episode-filter-apply" onClick={handleApplyEpsFilter}>적용</button>
        </div>
      </div>
    </div>
  );
});

export default ContestNovelFilterControls;
