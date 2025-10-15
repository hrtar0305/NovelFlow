import React, { useState, useEffect, useMemo, useCallback, useTransition, useRef } from 'react';
import { useParams, Link, useNavigate, NavLink } from 'react-router-dom';
import { Table, Spinner, Alert, Container, Card, Row, Col, Button, Collapse, Dropdown, ButtonGroup, InputGroup, Form, OverlayTrigger, Tooltip, Nav } from 'react-bootstrap';
import { Funnel, ChevronUp, ChevronDown, InfoCircle, ArrowUpShort, ArrowDownShort, ExclamationCircleFill } from 'react-bootstrap-icons';
import { getContestDataByDate, getContestLatestDate, getContestAvailableDates } from '../services/api';
import ContestNovelFilterControls from '../components/ContestNovelFilterControls';
import CalendarPicker from '../components/CalendarPicker';
import { format, parseISO, isValid } from 'date-fns';
import TagFilter from '../components/TagFilter';

// --- HELPER COMPONENTS ---
const ViewChangeIndicator: React.FC<{ value: number | 'New' | undefined, isNew: boolean }> = ({ value, isNew }) => {
    const containerClasses = "d-inline-flex align-items-center justify-content-center rank-change-badge px-2";
    const commonStyle = { width: '52px', height: '25px', borderRadius: '0.375rem' };

    return (
        <div style={{ margin: '0 auto' }}>
            {(() => {
                if (isNew) return <span className={`${containerClasses} rank-up`} style={commonStyle}>New</span>;
                if (typeof value !== 'number') return <span className={`${containerClasses} rank-same`} style={commonStyle}>-</span>;

                if (value > 0) {
                    return <span className={`${containerClasses} rank-up`} style={commonStyle}>
                        <ArrowUpShort size={12} viewBox="3 3 10 10" className="flex-shrink-0" />
                        <span style={{ lineHeight: 1 }}>{value.toLocaleString()}</span>
                    </span>;
                } else if (value < 0) {
                    return <span className={`${containerClasses} rank-down`} style={commonStyle}>
                        <ArrowDownShort size={12} viewBox="3 3 10 10" className="flex-shrink-0" />
                        <span style={{ lineHeight: 1 }}>{Math.abs(value).toLocaleString()}</span>
                    </span>;
                }
                return <span className={`${containerClasses} rank-same`} style={commonStyle}>-</span>;
            })()}
        </div>
    );
};

// --- TYPE DEFINITIONS ---
interface ContestNovel {
  ID: string;
  Title?: string;
  AuthorName?: string;
  AuthorID?: string;
  View?: number;
  Like?: number;
  Fav?: number;
  Eps?: number;
  Tags: string[];
  RetentionRate?: number;
  Date: string;
  Rank: number;
  view_change: number;
  rank_change: number;
  like_to_view_ratio: number;
  is_new: boolean;
}

// --- ADVANCED FILTER PARSER (from NovelRankingsPage) ---
const evaluateAdvancedRule = (rule: string, tags: string[]): boolean => {
  if (!rule.trim()) return true;
  const tokens = rule.match(/\(|\)|\bAND\b|\bOR\b|\bNOT\b|[^\s()]+/gi) || [];
  const outputQueue: string[] = [];
  const operatorStack: string[] = [];
  const precedence: { [key: string]: number } = { 'OR': 1, 'AND': 2, 'NOT': 3 };
  const associativity: { [key: string]: string | undefined } = { 'NOT': 'Right' };
  for (const token of tokens) {
    const upperToken = token.toUpperCase();
    if (upperToken === 'AND' || upperToken === 'OR' || upperToken === 'NOT') {
      while (
        operatorStack.length > 0 &&
        operatorStack[operatorStack.length - 1] !== '(' &&
        (precedence[operatorStack[operatorStack.length - 1].toUpperCase()] > precedence[upperToken] ||
         (precedence[operatorStack[operatorStack.length - 1].toUpperCase()] === precedence[upperToken] && associativity[upperToken] !== 'Right'))
      ) {
        outputQueue.push(operatorStack.pop()!);
      }
      operatorStack.push(token);
    } else if (token === '(') {
      operatorStack.push(token);
    } else if (token === ')') {
      while (operatorStack.length > 0 && operatorStack[operatorStack.length - 1] !== '(') {
        outputQueue.push(operatorStack.pop()!);
      }
      if (operatorStack.length === 0) throw new Error("Mismatched parentheses");
      operatorStack.pop();
    } else {
      outputQueue.push(token);
    }
  }
  while (operatorStack.length > 0) {
    if (operatorStack[operatorStack.length - 1] === '(') throw new Error("Mismatched parentheses");
    outputQueue.push(operatorStack.pop()!);
  }
  const evalStack: boolean[] = [];
  for (const token of outputQueue) {
    const upperToken = token.toUpperCase();
    if (upperToken === 'AND') {
      const b = evalStack.pop();
      const a = evalStack.pop();
      if (a === undefined || b === undefined) throw new Error("Invalid syntax");
      evalStack.push(a && b);
    } else if (upperToken === 'OR') {
      const b = evalStack.pop();
      const a = evalStack.pop();
      if (a === undefined || b === undefined) throw new Error("Invalid syntax");
      evalStack.push(a || b);
    } else if (upperToken === 'NOT') {
      const a = evalStack.pop();
      if (a === undefined) throw new Error("Invalid syntax");
      evalStack.push(!a);
    } else {
      evalStack.push(tags.some(t => t.toLowerCase() === token.toLowerCase()));
    }
  }
  if (evalStack.length !== 1) throw new Error("Invalid syntax");
  return evalStack[0];
};

const filterModeLabels: { [key: string]: string } = {
  'include-and': '태그 포함 (모두)',
  'include-or': '태그 포함 (일부)',
  'exclude': '태그 제외'
};

const ContestPage = () => {
  const { year, date: dateParam } = useParams<{ year: string; date?: string }>();
  const navigate = useNavigate();

  const [novels, setNovels] = useState<ContestNovel[]>([]);
  const [novelsWithViewChange, setNovelsWithViewChange] = useState<ContestNovel[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sortConfig, setSortConfig] = useState<{ key: keyof ContestNovel; direction: 'ascending' | 'descending' } | null>({ key: 'Rank', direction: 'ascending' });
  const [isPending, startTransition] = useTransition();
  const [currentDate, setCurrentDate] = useState<Date | null>(null);
  const [availableDates, setAvailableDates] = useState<Set<string>>(new Set());

  // --- FILTERING STATE ---
  const [showFilters, setShowFilters] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [activeMinEps, setActiveMinEps] = useState<number | null>(null);
  const [activeMaxEps, setActiveMaxEps] = useState<number | null>(null);
  const [allAvailableTags, setAllAvailableTags] = useState<string[]>([]);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [filterMode, setFilterMode] = useState<'include-or' | 'include-and' | 'exclude'>('include-and');
  const [isAdvancedMode, setIsAdvancedMode] = useState(false);
  const [advancedRule, setAdvancedRule] = useState('');
  const [activeAdvancedRule, setActiveAdvancedRule] = useState('');
  const [filterError, setFilterError] = useState<string | null>(null);
  const advancedRuleInputRef = useRef<HTMLTextAreaElement>(null);
  const [mobileViewMode, setMobileViewMode] = useState<'card' | 'table'>('card');
  const [shouldRenderFilters, setShouldRenderFilters] = useState(false);

  useEffect(() => {
    const yearNum = parseInt(year || '0', 10);
    if (!yearNum) return;

    const fetchInitialDate = async () => {
      try {
        const datesResponse = await getContestAvailableDates(yearNum);
        const fetchedDates = new Set<string>(datesResponse.data.available_dates || []);
        setAvailableDates(fetchedDates);

        if (dateParam && isValid(parseISO(dateParam)) && fetchedDates.has(dateParam)) {
          setCurrentDate(parseISO(dateParam));
        } else {
          const latestDateResponse = await getContestLatestDate(yearNum);
          const latestDateStr = latestDateResponse.data.latest_date;
          if (latestDateStr) {
            navigate(`/contests/${year}/${latestDateStr}`, { replace: true });
          } else {
            throw new Error("조회 가능한 공모전 데이터가 없습니다.");
          }
        }
      } catch (err) {
        setError("공모전 데이터를 불러오는 데 실패했습니다.");
        setLoading(false);
      }
    };
    fetchInitialDate();
  }, [year, dateParam, navigate]);

  useEffect(() => {
    if (!currentDate || !year) return;

    const fetchContestDataForDate = async () => {
      setLoading(true);
      setError(null);
      try {
        const currentDateStr = format(currentDate, 'yyyy-MM-dd');
        const currentDataPromise = getContestDataByDate(parseInt(year, 10), currentDateStr);

        const availableDatesArray = Array.from(availableDates).sort();
        const currentIndex = availableDatesArray.indexOf(currentDateStr);
        let previousDataPromise = Promise.resolve({ data: [] });
        if (currentIndex > 0) {
          const previousDateStr = availableDatesArray[currentIndex - 1];
          previousDataPromise = getContestDataByDate(parseInt(year, 10), previousDateStr);
        }

        const [currentResponse, previousResponse] = await Promise.all([currentDataPromise, previousDataPromise]);
        
        const currentData: ContestNovel[] = Array.isArray(currentResponse.data) ? currentResponse.data : [];
        const previousData: ContestNovel[] = Array.isArray(previousResponse.data) ? previousResponse.data : [];

        setNovels(currentData);

        const previousDataMap = new Map<string, ContestNovel>(previousData.map(n => [n.ID, n]));
        const processedData = currentData.map((novel: ContestNovel) => {
          const previousNovelData = previousDataMap.get(novel.ID);
          
          let view_change = 0;
          let rank_change = 0;
          let is_new = true;

          if (previousNovelData) {
            view_change = (novel.View ?? 0) - (previousNovelData.View ?? 0);
            rank_change = (previousNovelData.Rank ?? Infinity) - (novel.Rank ?? Infinity);
            is_new = false;
          } else {
            view_change = novel.View ?? 0;
            is_new = true;
          }

          const like_to_view_ratio = (novel.View && novel.View > 0) ? (novel.Like ?? 0) / novel.View : 0;

          return { ...novel, view_change, rank_change, is_new, like_to_view_ratio };
        });
        setNovelsWithViewChange(processedData);

      } catch (err: any) {
        setError(err.response?.data?.detail || '공모전 데이터를 불러오는 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.');
        setNovels([]);
        setNovelsWithViewChange([]);
      } finally {
        setLoading(false);
      }
    };

    fetchContestDataForDate();
  }, [currentDate, year]);

  useEffect(() => {
    if (novels.length > 0) {
      const allTags = new Set(novels.flatMap(novel => novel.Tags || []));
      setAllAvailableTags(Array.from(allTags).sort());
    } else {
      setAllAvailableTags([]);
    }
  }, [novels]);

  const processedNovels = useMemo(() => {
    let filteredItems = [...novelsWithViewChange];
    setFilterError(null);

    // 1. Tag Filtering
    if (isAdvancedMode) {
      if (activeAdvancedRule) {
        try {
          filteredItems = filteredItems.filter(novel => evaluateAdvancedRule(activeAdvancedRule, novel.Tags || []));
        } catch (e) {
          setFilterError(`필터 오류: ${e instanceof Error ? e.message : '잘못된 구문입니다'}. 규칙을 확인해주세요.`);
          return [];
        }
      }
    } else if (selectedTags.length > 0) {
      if (filterMode === 'include-and') {
        filteredItems = filteredItems.filter(novel => selectedTags.every(tag => (novel.Tags || []).includes(tag)));
      } else if (filterMode === 'include-or') {
        filteredItems = filteredItems.filter(novel => selectedTags.some(tag => (novel.Tags || []).includes(tag)));
      } else { // exclude
        filteredItems = filteredItems.filter(novel => !selectedTags.some(tag => (novel.Tags || []).includes(tag)));
      }
    }

    // 2. Text Search
    if (searchTerm) {
      const lowercasedTerm = searchTerm.toLowerCase();
      filteredItems = filteredItems.filter(novel =>
        novel.Title?.toLowerCase().includes(lowercasedTerm) ||
        novel.AuthorName?.toLowerCase().includes(lowercasedTerm)
      );
    }

    // 3. Episode Range
    if (activeMinEps !== null) {
      filteredItems = filteredItems.filter(novel => (novel.Eps ?? 0) >= activeMinEps);
    }
    if (activeMaxEps !== null) {
      filteredItems = filteredItems.filter(novel => (novel.Eps ?? 0) <= activeMaxEps);
    }

    // 4. Sorting
    if (sortConfig !== null) {
      filteredItems.sort((a, b) => {
        const { key, direction } = sortConfig;

        let aValue = a[key];
        let bValue = b[key];

        // 'New' (is_new: true) should be treated as the highest value in rank_change sort
        if (key === 'rank_change') {
            aValue = a.is_new ? Infinity : (aValue ?? -Infinity);
            bValue = b.is_new ? Infinity : (bValue ?? -Infinity);
        }

        // Handle null/undefined values to always place them at the bottom, regardless of sort direction.
        const aIsNull = aValue == null;
        const bIsNull = bValue == null;
        if (aIsNull && bIsNull) {
            // If both are null, sort by View (secondary sort)
            return (b.View ?? -1) - (a.View ?? -1);
        }
        if (aIsNull) return 1; // a is null, should be at the bottom
        if (bIsNull) return -1; // b is null, should be at the bottom

        if (aValue! < bValue!) return direction === 'ascending' ? -1 : 1;
        if (aValue! > bValue!) return direction === 'ascending' ? 1 : -1;

        // 2차 정렬: 같은 값이면 총 조회수(View)가 높은 순으로 정렬
        return (b.View ?? -1) - (a.View ?? -1);
      });
    }

    return filteredItems;
  }, [novelsWithViewChange, sortConfig, isAdvancedMode, selectedTags, filterMode, activeAdvancedRule, searchTerm, activeMinEps, activeMaxEps]);

  const unselectedTags = useMemo(() => 
    allAvailableTags.filter(tag => !selectedTags.includes(tag)),
    [allAvailableTags, selectedTags]
  );

  const handleFilterChange = useCallback((filters: { searchTerm: string; minEps: number | null; maxEps: number | null }) => {
    startTransition(() => {
      setSearchTerm(filters.searchTerm);
      setActiveMinEps(filters.minEps);
      setActiveMaxEps(filters.maxEps);
    });
  }, []);

  const clearAllTags = () => {
    startTransition(() => {
      setSelectedTags([]);
    });
  };

  const handleTagSelect = (tag: string) => {
    startTransition(() => {
      setSelectedTags(prev => 
        prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag]
      );
    });
  };

  const handleTagDeselect = (tag: string) => {
    startTransition(() => {
      setSelectedTags(prev => prev.filter(t => t !== tag));
    });
  };

  const applyAdvancedFilter = () => {
    startTransition(() => {
      if (advancedRuleInputRef.current) {
        const newRule = advancedRuleInputRef.current.value;
        setFilterError(null);
        setAdvancedRule(newRule);
        setActiveAdvancedRule(newRule);
      }
    });
  };

  const handleAdvancedInputKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      applyAdvancedFilter();
    }
  };

  const handleFilterModeChange = (mode: string | null) => {
    if (mode) {
      startTransition(() => {
        setFilterMode(mode as 'include-or' | 'include-and' | 'exclude');
      });
    }
  };

  const handleSwitchToSimple = () => {
    startTransition(() => {
      setIsAdvancedMode(false);
      setActiveAdvancedRule('');
    });
  };

  const handleSwitchToAdvanced = () => {
    startTransition(() => {
      setIsAdvancedMode(true);
      setSelectedTags([]);
    });
  };

  const requestSort = (key: keyof ContestNovel) => {
    const sortableKeys: (keyof ContestNovel)[] = ['Rank', 'rank_change', 'view_change', 'View', 'like_to_view_ratio', 'RetentionRate', 'Eps'];
    if (!sortableKeys.includes(key)) {
      return;
    }

    startTransition(() => {
      let direction: 'ascending' | 'descending';
      if (sortConfig && sortConfig.key === key) {
        direction = sortConfig.direction === 'ascending' ? 'descending' : 'ascending';
      } else {
        direction = (['rank_change', 'View', 'view_change', 'like_to_view_ratio', 'RetentionRate'].includes(key)) ? 'descending' : 'ascending';
      }
      setSortConfig({ key, direction });
    });
  };

  const handleDateChange = (newDate: Date | null) => {
    if (newDate && year) {
      setLoading(true);
      navigate(`/contests/${year}/${format(newDate, 'yyyy-MM-dd')}`);
    }
  };

  const handleYearChange = (newYear: string | null) => {
    if (newYear && newYear !== year) {
      navigate(`/contests/${newYear}`);
    }
  };

  const alertInfo = useMemo(() => {
    if (!currentDate) return null;
    const currentDateStr = format(currentDate, 'yyyy-MM-dd');
    
    if (currentDateStr < '2025-10-15') {
      return {
        text: '10월 15일 이전 랭킹 데이터는 연독률을 제공하지 않습니다.',
        variant: 'info' as const,
      };
    }
    return null;
  }, [currentDate]);

  return (
    <Container className="py-3 py-md-4 d-flex flex-column page-height-manager">
      <style type="text/css">{`
        .page-height-manager {
          height: calc(100dvh - 56px);
        }
        .novel-rankings-table thead th {
          position: sticky;
          top: 0;
          z-index: 1;
          background-color: white;
        }
        .year-dropdown-menu {
          min-width: auto;
        }
        .year-dropdown-toggle {
          padding: .2rem .4rem;
          font-size: 0.9rem;
        }
        @media (max-width: 767px) {
          .year-dropdown-toggle {
            padding: .1rem .3rem;
            font-size: 0.8rem;
          }
        }
        .placeholder-row td {
          color: #6c757d !important; /* Bootstrap's text-muted color */
          opacity: 0.7;
        }
        .placeholder-row a {
          color: inherit !important;
          text-decoration: none !important;
          pointer-events: none;
        }
      `}</style>

      <div className="d-flex align-items-center gap-2 mb-2">
        <h1 className="h2 mb-0 fs-page-title">우주최강 공모전</h1>
        <Dropdown onSelect={handleYearChange}>
          <Dropdown.Toggle variant="outline-secondary" id="dropdown-year-select" size="sm" className="year-dropdown-toggle">
            {year}년
          </Dropdown.Toggle>
          <Dropdown.Menu className="year-dropdown-menu">
            {['2025'].map(y => (
              <Dropdown.Item key={y} eventKey={y} active={y === year}>
                {y}년
              </Dropdown.Item>
            ))}
          </Dropdown.Menu>
        </Dropdown>
        <OverlayTrigger
          trigger="click"
          rootClose
          placement="bottom"
          overlay={
            <Tooltip id="contest-description-tooltip">
              우주최강 공모전 출품작 데이터를 보여줍니다. 데이터는 매일 오후 2시 집계됩니다.
            </Tooltip>
          }
        >
          <span className="d-md-none" style={{ cursor: 'pointer' }}>
            <InfoCircle />
          </span>
        </OverlayTrigger>
      </div>
      <p className="text-muted mb-3 d-none d-md-block">
        우주최강 공모전 출품작 데이터를 보여줍니다. 데이터는 매일 오후 2시 집계됩니다.
      </p>

      <Nav variant="tabs" className="mb-2">
        <Nav.Item>
          <Nav.Link as={NavLink} to={`/contests/${year}/${dateParam || ''}`} end>소설 랭킹</Nav.Link>
        </Nav.Item>
        <Nav.Item>
          <Nav.Link as={NavLink} to={`/contests/${year}/tags/rankings/${dateParam || ''}`} end>태그 랭킹</Nav.Link>
        </Nav.Item>
      </Nav>

      <Row className="mb-1 align-items-center mobile-ranking-controls-row">
        <Col className="d-flex align-items-center gap-2">
          <div className="flex-shrink-0">
            <CalendarPicker
              selectedDate={currentDate}
              onDateChange={handleDateChange}
              availableDates={availableDates}
            />
          </div>
          <div className="flex-shrink-0">
            <Button
              onClick={() => setShowFilters(!showFilters)}
              aria-controls="filters-collapse-content"
              aria-expanded={showFilters}
              variant="outline-secondary" size="sm"
              className="d-flex align-items-center"
            >
              <Funnel className="me-1" /><span className="d-none d-md-inline">필터</span>{showFilters ? <ChevronUp className="ms-1" /> : <ChevronDown className="ms-1" />}
            </Button>
          </div>
          {/* Desktop: Show alert to the right of the date picker */}
          <div className="d-none d-md-block">
            {alertInfo && (
              <Alert variant={alertInfo.variant} className="d-flex align-items-center text-start p-2 mb-0 small">
                <InfoCircle size={16} className="me-2 flex-shrink-0" style={{ minWidth: '16px' }} />
                <span><strong>참고:</strong> {alertInfo.text}</span>
              </Alert>
            )}
          </div>
          {/* Mobile: Show info icon with tooltip */}
          <div className="d-md-none">
            {alertInfo && (
              <OverlayTrigger
                trigger="click"
                rootClose
                placement="bottom-start"
                overlay={
                  <Tooltip id="retention-rate-warning-tooltip" className="small">
                    <strong>참고:</strong> {alertInfo.text}
                  </Tooltip>
                }
              >
                <span style={{ cursor: 'pointer' }} className="d-flex align-items-center text-info">
                  <ExclamationCircleFill />
                </span>
              </OverlayTrigger>
            )}
          </div>
        </Col>
        <Col xs="auto" className="d-md-none">
          <ButtonGroup size="sm">
            <Button variant={mobileViewMode === 'card' ? 'primary' : 'outline-secondary'} onClick={() => setMobileViewMode('card')}>요약</Button>
            <Button variant={mobileViewMode === 'table' ? 'primary' : 'outline-secondary'} onClick={() => setMobileViewMode('table')}>상세</Button>
          </ButtonGroup>
        </Col>
      </Row>

      <Collapse 
        in={showFilters}
        onExiting={() => setShouldRenderFilters(false)}
      >
        <div id="filters-collapse-content">
          {(showFilters || shouldRenderFilters) && (
            <div className="px-3 py-2 border rounded mb-1">
              <ContestNovelFilterControls onFilterChange={handleFilterChange} />
            <hr className="my-2"/>
            <div className="d-flex flex-wrap align-items-center justify-content-between mb-2">
              <div className="d-flex align-items-center gap-2">
                <span className="fw-bold">태그 선택</span>
                <ButtonGroup size="sm">
                  <Button variant={!isAdvancedMode ? 'primary' : 'outline-secondary'} onClick={handleSwitchToSimple} className="fw-bold">기본</Button>
                  <Button variant={isAdvancedMode ? 'primary' : 'outline-secondary'} onClick={handleSwitchToAdvanced} className="fw-bold">고급</Button>
                </ButtonGroup>
              </div>
              {isAdvancedMode && (
                <div className="d-md-none">
                  <Button variant="primary" size="sm" onClick={applyAdvancedFilter} className="fw-bold">필터 적용</Button>
                </div>
              )}
              {!isAdvancedMode && (
                <div className="d-flex align-items-center gap-2">
                  <div style={{ minWidth: '130px' }}>
                    <Dropdown onSelect={handleFilterModeChange}>
                      <Dropdown.Toggle variant="outline-secondary" id="dropdown-filter-mode" size="sm" className="w-100 d-flex justify-content-between align-items-center">
                        <span>{filterModeLabels[filterMode]}</span>
                      </Dropdown.Toggle>
                      <Dropdown.Menu className="w-100">
                        <Dropdown.Item eventKey="include-and">{filterModeLabels['include-and']}</Dropdown.Item>
                        <Dropdown.Item eventKey="include-or">{filterModeLabels['include-or']}</Dropdown.Item>
                        <Dropdown.Item eventKey="exclude">{filterModeLabels['exclude']}</Dropdown.Item>
                      </Dropdown.Menu>
                    </Dropdown>
                  </div>
                  {selectedTags.length > 0 && (
                    <Button variant="outline-danger" size="sm" onClick={clearAllTags} className="d-none d-md-inline-block">비우기</Button>
                  )}
                </div>
              )}
            </div>

            {!isAdvancedMode ? (
              <div>
                <div className="d-flex flex-wrap gap-1 p-2 bg-light border rounded" style={{ minHeight: '40px', maxHeight: '60px', overflowY: 'auto' }}>
                    {selectedTags.map(tag => (
                      <Button key={tag} variant={filterMode === 'exclude' ? 'danger' : 'primary'} size="sm" onClick={() => handleTagDeselect(tag)} className="rounded-pill tag-button-compact">{tag}</Button>
                    ))}
                </div>
                    <hr className="my-2" />
                    <TagFilter unselectedTags={unselectedTags} onTagSelect={handleTagSelect} />
              </div>
            ) : (
              <div>
                <InputGroup className="mb-0 mb-md-2">
                    <Form.Control
                        as="textarea" rows={2} placeholder="e.g. (하렘 AND 순애) OR (TS AND NOT BL)"
                        ref={advancedRuleInputRef} defaultValue={advancedRule} onKeyDown={handleAdvancedInputKeyDown} isInvalid={!!filterError}
                    />
                </InputGroup>
                <div className="d-none d-md-flex justify-content-between align-items-center">
                    <div><Button variant="primary" size="sm" onClick={applyAdvancedFilter} className="fw-bold">필터 적용</Button></div>
                    <Alert variant="light" className="p-1 m-0 d-flex align-items-center">
                        <InfoCircle size={15} className="me-1 flex-shrink-0"/>
                        <span>AND, OR, NOT 및 괄호()를 사용하여 태그를 조합할 수 있습니다.</span>
                    </Alert>
                </div>
              </div>
            )}
            </div>
          )}
          </div>
      </Collapse>

      {/* 작품 목록 테이블 */}
      <div className="d-flex flex-column" style={{ flex: '1 1 auto', minHeight: 0 }}>
        {loading && <div className="text-center py-5"><Spinner animation="border" /></div>}
        {error && <Alert variant="danger">{error}</Alert>}
        {!loading && !error && novels.length > 0 && (
          <>
            {/* Table View (Desktop or Mobile Table Mode) */}
            <div className={`${mobileViewMode === 'table' ? 'd-block' : 'd-none d-md-block'} h-100`}>
              <div className="custom-table-wrapper table-responsive border rounded h-100" style={{ overflow: 'auto', opacity: isPending ? 0.7 : 1 }}>
                {isPending && <div className="position-absolute w-100 h-100 d-flex justify-content-center align-items-center" style={{ zIndex: 10, backgroundColor: 'rgba(255,255,255,0.5)' }}><Spinner animation="border" /></div>}
                <Table hover className="custom-table novel-rankings-table contest-table">
                  <thead>
                    <tr>
                      <th onClick={() => requestSort('Rank')} className="cursor-pointer sortable-header text-center" style={{ fontSize: '0.85rem', width: '40px' }}>
                        <div className="d-flex align-items-center justify-content-center"><span>순위</span></div>
                      </th>
                      <th onClick={() => requestSort('rank_change')} className="cursor-pointer sortable-header text-center" style={{ fontSize: '0.85rem', width: '55px' }}>
                        <div className="d-flex align-items-center justify-content-center"><span>변동</span></div>
                      </th>
                      <th style={{ fontSize: '0.85rem', whiteSpace: 'normal', minWidth: '180px' }}>
                        <span>제목</span>
                      </th>
                      <th style={{ fontSize: '0.85rem', textAlign: 'left', whiteSpace: 'normal', minWidth: '90px' }}>
                        <span>작가</span>
                      </th>
                      <th onClick={() => requestSort('View')} className="cursor-pointer sortable-header" style={{ fontSize: '0.85rem', textAlign: 'left', minWidth: '70px' }}>
                        <div className="d-flex align-items-center"><span>총 조회수</span></div>
                      </th>
                      <th onClick={() => requestSort('view_change')} className="cursor-pointer sortable-header" style={{ fontSize: '0.85rem', textAlign: 'left', minWidth: '70px' }}>
                        <div className="d-flex align-items-center"><span>일간 조회수</span></div>
                      </th>
                      <th onClick={() => requestSort('like_to_view_ratio')} className="cursor-pointer sortable-header" style={{ fontSize: '0.85rem', textAlign: 'left', minWidth: '50px' }}>
                        <div className="d-flex align-items-center"><span>추천비</span></div>
                      </th>
                      <th onClick={() => requestSort('RetentionRate')} className="cursor-pointer sortable-header" style={{ fontSize: '0.85rem', textAlign: 'left', minWidth: '50px' }}>
                        <div className="d-flex align-items-center"><span>연독률</span></div>
                      </th>
                      <th onClick={() => requestSort('Eps')} className="cursor-pointer sortable-header" style={{ fontSize: '0.85rem', textAlign: 'left', minWidth: '30px' }}>
                        <div className="d-flex align-items-center"><span>회차</span></div>
                      </th>
                      <th style={{ fontSize: '0.85rem', textAlign: 'left', minWidth: '300px' }}>태그</th>
                    </tr>
                  </thead>
                  <tbody>
                    {processedNovels.length > 0 ? (
                      processedNovels.map((novel) => (
                        <tr key={novel.ID} className={novel.View === -1 ? 'placeholder-row' : ''}>
                          <td className="text-center" style={{ fontSize: '0.9rem' }}>{novel.Rank}</td>
                          <td className="text-center" style={{ fontSize: '0.9rem' }}><ViewChangeIndicator value={novel.rank_change} isNew={!!novel.is_new} /></td>
                          <td style={{ fontSize: '0.9rem', whiteSpace: 'normal', wordBreak: 'break-all' }}>
                            {novel.View === -1 ? `삭제된 소설 (${novel.ID})` : <Link to={`/contests/${year}/novels/${novel.ID}`} className="text-indigo-600 hover:text-indigo-900 fw-bold">{novel.Title || '(제목 없음)'}</Link>}
                          </td>
                          <td style={{ fontSize: '0.9rem', whiteSpace: 'normal', wordBreak: 'break-all' }}>
                            {novel.View === -1 ? '-' : (novel.AuthorID && novel.AuthorID !== "0" ? <Link to={`/authors/${novel.AuthorID}`}>{novel.AuthorName || '(작자 미상)'}</Link> : (novel.AuthorName || '(작자 미상)'))}
                          </td>
                          <td style={{ fontSize: '0.9rem' }}>
                            {novel.View === -1 ? '-' : (novel.View != null ? novel.View.toLocaleString() : '-')}
                          </td>
                          <td style={{ fontSize: '0.9rem' }}>
                            {novel.View === -1 ? '-' : novel.view_change.toLocaleString()}
                          </td>
                          <td style={{ fontSize: '0.9rem' }}>{novel.View === -1 ? '-' : `${(novel.like_to_view_ratio * 100).toFixed(2)}%`}</td>
                          <td style={{ fontSize: '0.9rem' }}>
                            {currentDate && format(currentDate, 'yyyy-MM-dd') < '2025-10-15'
                              ? '-'
                              : (typeof novel.RetentionRate === 'number' ? `${(novel.RetentionRate * 100).toFixed(1)}%` : '-')
                            }
                          </td>
                          <td style={{ fontSize: '0.9rem' }}>{novel.View === -1 ? '-' : (novel.Eps?.toLocaleString() ?? '-')}</td>
                          <td style={{ fontSize: '0.9rem' }}>
                            <div className="d-flex flex-wrap gap-1">
                              {(novel.Tags || []).map(tag => (<Button key={tag} variant={selectedTags.includes(tag) ? "primary" : "secondary"} size="sm" className="rounded-pill" onClick={() => handleTagSelect(tag)}>{tag}</Button>))}
                            </div>
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr><td colSpan={10} className="text-center py-4">현재 필터와 일치하는 결과가 없습니다.</td></tr>
                    )}
                  </tbody>
                </Table>
              </div>
            </div>

            {/* Mobile Card View */}
            <div className={`${mobileViewMode === 'card' ? 'd-block' : 'd-none'} d-md-none h-100 border rounded`} style={{ overflowY: 'auto', overflowX: 'hidden' }}>
              <div className="p-1">
                {processedNovels.length > 0 ? (
                  processedNovels.map((novel) => (
                  <Card key={novel.ID} className="mb-1 shadow-sm">
                    <Card.Body className="p-2">
                      <div className="d-flex justify-content-between align-items-start mb-2">
                        <div className="flex-grow-1 me-2">
                          <div className="d-flex align-items-baseline gap-2">
                            <span className="fw-bold text-primary text-nowrap" style={{ fontSize: '1rem' }}>{novel.Rank}위</span>
                            <h5 className="mb-0 h6">
                              {novel.View === -1 ? (
                                <span className="text-muted">{`삭제된 소설 (${novel.ID})`}</span>
                              ) : (
                                <Link to={`/contests/${year}/novels/${novel.ID}`} className="text-dark text-decoration-none">{novel.Title}</Link>
                              )}
                            </h5>
                          </div>
                          <div className="text-muted small mt-1">
                            {novel.View !== -1 && (
                              <span>{novel.AuthorID && novel.AuthorID !== "0" ? <Link to={`/authors/${novel.AuthorID}`} className="text-muted text-decoration-none">{novel.AuthorName || '(작자 미상)'}</Link> : (novel.AuthorName || '(작자 미상)')}</span>
                            )}
                            {novel.View !== -1 && <span className="mx-1">·</span>}
                            <span>{novel.View === -1 ? '-' : `${novel.Eps}화`}</span>
                          </div>
                        </div>
                        <div className="flex-shrink-0 text-end"><ViewChangeIndicator value={novel.rank_change} isNew={!!novel.is_new} /></div>
                      </div>
                      {novel.Tags && novel.Tags.length > 0 && (
                        <div className="pt-2 border-top">
                          <div className="d-flex flex-wrap gap-1">{(novel.Tags || []).map(tag => (<Button key={tag} variant={selectedTags.includes(tag) ? "primary" : "secondary"} size="sm" onClick={() => handleTagSelect(tag)} className="rounded-pill tag-button-compact">{tag}</Button>))}</div>
                        </div>
                      )}
                    </Card.Body>
                  </Card>
                  ))
                ) : (
                  <Alert variant="info" className="text-center m-0">현재 필터와 일치하는 결과가 없습니다.</Alert>
                )}
              </div>
            </div>
          </>
        )}
        {!loading && !error && novels.length === 0 && <Alert variant="info">데이터가 없습니다.</Alert>}
      </div>
    </Container>
  );
};

export default ContestPage;
