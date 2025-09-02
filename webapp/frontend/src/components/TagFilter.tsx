import React, { useState, useEffect, useMemo, useTransition } from 'react';
import { InputGroup, Form, Button } from 'react-bootstrap';
import { Search } from 'react-bootstrap-icons';

interface TagFilterProps {
  unselectedTags: string[];
  onTagSelect: (tag: string) => void;
}

const TagFilter = React.memo(({ unselectedTags, onTagSelect }: TagFilterProps) => {
  const [isPending, startTransition] = useTransition();
  const [tagSearchTerm, setTagSearchTerm] = useState('');
  const [debouncedTagSearchTerm, setDebouncedTagSearchTerm] = useState('');

  // Debounce tag search input
  useEffect(() => {
    const handler = setTimeout(() => {
      startTransition(() => {
        setDebouncedTagSearchTerm(tagSearchTerm);
      });
    }, 300);

    return () => {
      clearTimeout(handler);
    };
  }, [tagSearchTerm]);

  const filteredUnselectedTags = useMemo(() => {
    if (!debouncedTagSearchTerm.trim()) {
      return unselectedTags;
    }
    return unselectedTags.filter(tag =>
      tag.toLowerCase().includes(debouncedTagSearchTerm.toLowerCase())
    );
  }, [unselectedTags, debouncedTagSearchTerm]);

  const handleSelect = (tag: string) => {
    onTagSelect(tag);
    setTagSearchTerm(''); // Clear search term on selection
  };

  return (
    <>
      <InputGroup size="sm" className="my-2" style={{ maxWidth: '300px' }}>
        <InputGroup.Text><Search /></InputGroup.Text>
        <Form.Control placeholder="태그 검색" value={tagSearchTerm} onChange={(e) => setTagSearchTerm(e.target.value)} />
      </InputGroup>
      <div className="d-flex flex-wrap gap-1" style={{ minHeight: '40px', maxHeight: '80px', overflowY: 'auto', opacity: isPending ? 0.7 : 1 }}>
        {filteredUnselectedTags.map(tag => (<Button key={tag} variant="secondary" size="sm" onClick={() => handleSelect(tag)} className="rounded-pill tag-button-compact">{tag}</Button>))}
        {unselectedTags.length > 0 && filteredUnselectedTags.length === 0 && <span className="text-muted small">검색된 태그가 없습니다.</span>}
        {unselectedTags.length === 0 && <span className="text-muted small">모든 태그가 선택되었습니다.</span>}
      </div>
    </>
  );
});

export default TagFilter;