import React, { useState, useEffect } from 'react';
import { Form, InputGroup } from 'react-bootstrap';
import { Search } from 'react-bootstrap-icons';

interface TagSearchControlProps {
  onSearchChange: (searchTerm: string) => void;
}

const TagSearchControl = React.memo(({ onSearchChange }: TagSearchControlProps) => {
  const [searchInput, setSearchInput] = useState('');

  useEffect(() => {
    const handler = setTimeout(() => {
      onSearchChange(searchInput);
    }, 300);

    return () => {
      clearTimeout(handler);
    };
  }, [searchInput, onSearchChange]);

  return (
    <InputGroup>
      <InputGroup.Text id="tag-search-addon"><Search /></InputGroup.Text>
      <Form.Control
        placeholder="태그 검색"
        aria-label="태그 검색"
        value={searchInput}
        onChange={(e) => setSearchInput(e.target.value)}
      />
    </InputGroup>
  );
});

export default TagSearchControl;