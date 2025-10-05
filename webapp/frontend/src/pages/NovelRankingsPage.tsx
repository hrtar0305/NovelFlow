import React, { useState, useEffect, useMemo, useRef, useCallback, useTransition } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { Table, Spinner, Alert, Form, Row, Col, Button, InputGroup, ButtonGroup, Container, Dropdown, OverlayTrigger, Tooltip, Collapse, Card } from 'react-bootstrap';
import { InfoCircle, ArrowUp, ArrowDown, ArrowDownUp, ArrowUpShort, ArrowDownShort, Funnel, ChevronUp, ChevronDown} from 'react-bootstrap-icons';
import { format, parseISO, isValid } from 'date-fns';
import { getNovelRankingsByDate, getAvailableDates } from '../services/api';
import CalendarPicker from '../components/CalendarPicker';
import NovelFilterControls from '../components/NovelFilterControls';
import TagFilter from '../components/TagFilter';

// --- TYPE DEFINITIONS ---
interface Novel {
  ID: string;
  Ranking: number;
  Title: string;
  AuthorName: string;
  AuthorID: number;
  Score: number;
  Eps: number;
  Tags: string[];
  rank_change?: number | 'New';
}

// --- HELPER COMPONENTS ---
const RankChangeIndicator: React.FC<{ value: number | 'New' | undefined }> = ({ value }) => {
    const containerClasses = "d-inline-flex align-items-center justify-content-center rank-change-badge px-2";
    const commonStyle = { width: '42px', height: '25px', borderRadius: '0.375rem' };

    return (
        <div style={{ margin: '0 auto' }}>
            {(() => {
                if (value === 'New') return <span className={`${containerClasses} rank-up`} style={commonStyle}>New</span>;
                if (value === undefined || value === 0) {
                    return <span className={`${containerClasses} rank-same`} style={commonStyle}>-</span>;
                }
                if (value > 0) {
                    return <span className={`${containerClasses} rank-up`} style={commonStyle}>
                        <ArrowUpShort size={12} viewBox="3 3 10 10" className="flex-shrink-0" />
                        <span style={{ lineHeight: 1 }}>{value.toLocaleString()}</span>
                    </span>;
                }
                return <span className={`${containerClasses} rank-down`} style={commonStyle}>
                    <ArrowDownShort size={12} viewBox="3 3 10 10" className="flex-shrink-0" />
                    <span style={{ lineHeight: 1 }}>{Math.abs(value).toLocaleString()}</span>
                </span>;
            })()}
        </div>
    );
};

// --- ADVANCED FILTER PARSER ---
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


// --- MAIN COMPONENT ---
const NovelRankingsPage = () => {
  // --- STATE MANAGEMENT ---
  const [rankings, setRankings] = useState<Novel[]>([]);
  const [date, setDate] = useState<Date | null>(null);
  const [optimisticDate, setOptimisticDate] = useState<Date | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [availableDatesSet, setAvailableDatesSet] = useState<Set<string>>(new Set());
  const [sortConfig, setSortConfig] = useState<{ key: keyof Novel; direction: 'ascending' | 'descending' }>({ key: 'Ranking', direction: 'ascending' });
  const advancedRuleInputRef = useRef<HTMLTextAreaElement>(null);
  const navigate = useNavigate();
  const { date: dateParam } = useParams();

  // --- FILTERING STATE ---
  const [isPending, startTransition] = useTransition();
  const [isAdvancedMode, setIsAdvancedMode] = useState(false);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [filterMode, setFilterMode] = useState<'include-or' | 'include-and' | 'exclude'>('include-and');
  const [advancedRule, setAdvancedRule] = useState('');
  const [activeAdvancedRule, setActiveAdvancedRule] = useState('');
  const [filterError, setFilterError] = useState<string | null>(null);
  const [allAvailableTags, setAllAvailableTags] = useState<string[]>([]);
  // Active filter states (managed by NovelFilterControls callback)
  const [searchTerm, setSearchTerm] = useState('');
  const [activeMinEps, setActiveMinEps] = useState<number | null>(null);
  const [activeMaxEps, setActiveMaxEps] = useState<number | null>(null);

  const [showFilters, setShowFilters] = useState(window.innerWidth >= 768); // md breakpoint
  const [mobileViewMode, setMobileViewMode] = useState<'card' | 'table'>('card');

  // --- DATA DERIVATION & FILTERING LOGIC ---
  useEffect(() => {
    if (rankings.length > 0) {
      const allTags = new Set(rankings.flatMap(novel => novel.Tags || []));
      setAllAvailableTags(Array.from(allTags).sort());
    } else {
      setAllAvailableTags([]);
    }
  }, [rankings]);

  const processedRankings = useMemo(() => {
    let filteredItems = [...rankings];
    setFilterError(null);

    // 1. Tag Filtering
    if (isAdvancedMode) {
      if (activeAdvancedRule) {
        try {
            filteredItems = filteredItems.filter(novel => 
                evaluateAdvancedRule(activeAdvancedRule, novel.Tags || [])
            );
        } catch (e) {
            const errorMessage = e instanceof Error ? e.message : '잘못된 구문입니다';
            setFilterError(`필터 오류: ${errorMessage}. 규칙을 확인해주세요.`);
            return [];
        }
      }
    } else {
      if (selectedTags.length > 0) {
        if (filterMode === 'include-and') {
          filteredItems = filteredItems.filter(novel =>
            selectedTags.every(tag => (novel.Tags || []).includes(tag))
          );
        } else if (filterMode === 'include-or') {
          filteredItems = filteredItems.filter(novel =>
            selectedTags.some(tag => (novel.Tags || []).includes(tag))
          );
        } else {
          filteredItems = filteredItems.filter(novel =>
            !selectedTags.some(tag => (novel.Tags || []).includes(tag))
          );
        }
      }
    }

    // 2. Text Search Filtering
    if (searchTerm) {
        const lowercasedTerm = searchTerm.toLowerCase();
        filteredItems = filteredItems.filter(novel => 
            novel.Title.toLowerCase().includes(lowercasedTerm) ||
            novel.AuthorName.toLowerCase().includes(lowercasedTerm)
        );
    }

    // 3. Episode Range Filtering
    if (activeMinEps !== null) {
        filteredItems = filteredItems.filter(novel => novel.Eps >= activeMinEps!);
    }
    if (activeMaxEps !== null) {
        filteredItems = filteredItems.filter(novel => novel.Eps <= activeMaxEps!);
    }

    // 4. Sorting Logic
    if (sortConfig !== null) {
      filteredItems.sort((a, b) => {
        const aValue = a[sortConfig.key];
        const bValue = b[sortConfig.key];
        if (sortConfig.key === 'rank_change') {
          const getSortableValue = (val: typeof aValue) => {
            if (val === 'New') return Infinity;
            if (typeof val === 'number') return val;
            return -Infinity;
          };
          const valA = getSortableValue(aValue);
          const valB = getSortableValue(bValue);
          if (valA < valB) return sortConfig.direction === 'ascending' ? -1 : 1;
          if (valA > valB) return sortConfig.direction === 'ascending' ? 1 : -1;
          return 0;
        }
        if (aValue === undefined || aValue === null) return 1;
        if (bValue === undefined || bValue === null) return -1;
        if (aValue < bValue) return sortConfig.direction === 'ascending' ? -1 : 1;
        if (aValue > bValue) return sortConfig.direction === 'ascending' ? 1 : -1;
        return 0;
      });
    }
    return filteredItems;
  }, [rankings, sortConfig, isAdvancedMode, selectedTags, filterMode, activeAdvancedRule, searchTerm, activeMinEps, activeMaxEps]);

  const unselectedTags = useMemo(() => 
    allAvailableTags.filter(tag => !selectedTags.includes(tag)),
    [allAvailableTags, selectedTags]
  );

  // --- HANDLER FUNCTIONS ---
  const handleFilterChange = useCallback((filters: { searchTerm: string; minEps: number | null; maxEps: number | null }) => {
    startTransition(() => {
        setSearchTerm(filters.searchTerm);
        setActiveMinEps(filters.minEps);
        setActiveMaxEps(filters.maxEps);
    });
  }, []);

  const handleTagSelect = (tag: string) => {
    startTransition(() => {
      setSelectedTags(prev => prev.includes(tag) ? prev : [...prev, tag]);
    });
  };

  const handleTagDeselect = (tag: string) => {
    startTransition(() => {
      setSelectedTags(prev => prev.filter(t => t !== tag));
    });
  };

  const clearAllTags = () => {
    startTransition(() => {
      setSelectedTags([]);
    });
  }

  const applyAdvancedFilter = () => {
    startTransition(() => {
      if (advancedRuleInputRef.current) {
        const newRule = advancedRuleInputRef.current.value;
        setFilterError(null);
        setAdvancedRule(newRule);
        setActiveAdvancedRule(newRule);
      }
    });
  }

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
      setAdvancedRule('');
      setActiveAdvancedRule('');
      setFilterError(null);
      if (advancedRuleInputRef.current) {
        advancedRuleInputRef.current.value = '';
      }
    });
  };

  const handleSwitchToAdvanced = () => {
    startTransition(() => {
      setIsAdvancedMode(true);
      setSelectedTags([]);
    });
  };

  const requestSort = (key: keyof Novel) => {
    startTransition(() => {
        let direction: 'ascending' | 'descending';
        if (sortConfig.key === key) {
          direction = sortConfig.direction === 'ascending' ? 'descending' : 'ascending';
        } else {
          direction = (key === 'Ranking') ? 'ascending' : 'descending';
        }
        setSortConfig({ key, direction });
    });
  };

  // --- DATE HANDLING ---
  useEffect(() => {
    const fetchAndSetDate = async () => {
      try {
        const datesResponse = await getAvailableDates();

        const fetchedDates: string[] = datesResponse.data.available_dates || [];

        if (fetchedDates.length > 0) {
            setAvailableDatesSet(new Set(fetchedDates));
            if (dateParam) {
                const parsedDate = parseISO(dateParam);
                if (isValid(parsedDate) && fetchedDates.includes(dateParam)) {
                    setDate(parsedDate);
                } else {
                    const latestDate = fetchedDates[0];
                    if (latestDate) navigate(`/novels/rankings/${latestDate}`, { replace: true });
                }
            } else {
                const latestDate = fetchedDates[0];
                if (latestDate) navigate(`/novels/rankings/${latestDate}`, { replace: true });
            }
        } else {
            setError("랭킹 데이터가 아직 없습니다. 데이터 수집 후 다시 시도해주세요.");
            setLoading(false);
        }
      } catch (err) {
        setError('조회 가능한 날짜를 불러오는 데 실패했습니다.');
        setLoading(false);
      }
    };
    fetchAndSetDate();
  }, [dateParam, navigate]);

  useEffect(() => {
    if (!date) {
        return;
    }

    const fetchRankings = async () => {
      setLoading(true);
      setOptimisticDate(null);
      setError(null);
      setSelectedTags([]);
      setActiveAdvancedRule('');
      setAdvancedRule('');
      setSearchTerm('');
      setActiveMinEps(null);
      setActiveMaxEps(null);
      try {
        const formattedDate = format(date, 'yyyy-MM-dd');
        const response = await getNovelRankingsByDate(formattedDate);
        setRankings(response.data.message ? [] : response.data);
      } catch (err) {
        setError('랭킹을 불러오는 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.');
        setRankings([]);
      } finally {
        setLoading(false);
      }
    };

    fetchRankings();
  }, [date]);

  const handleDateChange = async (newDate: Date | null) => {
    if (newDate && (!date || format(newDate, 'yyyy-MM-dd') !== format(date, 'yyyy-MM-dd'))) {
      setLoading(true);
      try {
        const datesResponse = await getAvailableDates();
        const fetchedDates: string[] = datesResponse.data.available_dates || [];
        setAvailableDatesSet(new Set(fetchedDates));
      } catch (err) {
        // In case of error, we just proceed with navigation
      }
      setOptimisticDate(newDate);
      navigate(`/novels/rankings/${format(newDate, 'yyyy-MM-dd')}`);
    }
  };

  const getSortIndicator = (key: keyof Novel) => {
    if (sortConfig.key !== key) {
        return <ArrowDownUp size={14} className="text-muted" />;
    }
    if (key === 'Ranking') {
        return sortConfig.direction === 'ascending' ? <ArrowDown size={14} className="text-primary" /> : <ArrowUp size={14} className="text-primary" />;
    }
    return sortConfig.direction === 'ascending' ? <ArrowUp size={14} className="text-primary" /> : <ArrowDown size={14} className="text-primary" />;
  };

  // --- RENDER ---
  return (
    <Container className="py-3 py-md-4 d-flex flex-column page-height-manager">
      {/* Global styles for this page and components it uses */}
      <style type="text/css">{`
        .page-height-manager {
          /* Default height for PC, which user confirmed is good */
          height: calc(100dvh - 56px);
        }
      `}</style>
      <div className="d-flex align-items-center gap-2 mb-2">
        <h1 className="h2 mb-0 fs-page-title">소설 랭킹</h1>
        <OverlayTrigger
          trigger="click"
          rootClose
          placement="bottom"
          overlay={
            <Tooltip id="ranking-description-tooltip">
              매일 오후 9시, 7일 조회순 데이터를 기준으로 집계됩니다. 
              <Link to="/data-collection-info" className="ms-1 text-white-50">(자세히)</Link>
            </Tooltip>
          }
        >
          <span className="d-md-none" style={{ cursor: 'pointer' }}>
            <InfoCircle />
          </span>
        </OverlayTrigger>
      </div>
      <p className="text-muted mb-3 d-none d-md-block">
        매일 집계되는 노벨피아 소설 랭킹을 보여줍니다. 날짜를 선택하여 과거 랭킹을 조회할 수 있습니다. 랭킹은 매일 오후 9시를 기준으로 기록되며 노벨피아 실시간 랭킹의 7일 조회순 데이터를 사용합니다.
        <Link to="/data-collection-info" className="ms-2 subtle-link">(데이터 수집 방식)</Link>
      </p>

      <Row className="mb-1 align-items-center justify-content-between mobile-ranking-controls-row">
        <Col xs="auto">
          <CalendarPicker
            selectedDate={optimisticDate || date}
            onDateChange={handleDateChange}
            availableDates={availableDatesSet}
          />
        </Col>
        <Col xs="auto" className="d-md-none">
          <ButtonGroup size="sm">
            <Button variant={mobileViewMode === 'card' ? 'primary' : 'outline-secondary'} onClick={() => setMobileViewMode('card')}>요약</Button>
            <Button variant={mobileViewMode === 'table' ? 'primary' : 'outline-secondary'} onClick={() => setMobileViewMode('table')}>상세</Button>
          </ButtonGroup>
        </Col>
      </Row>

      <Button
        onClick={() => setShowFilters(!showFilters)}
        aria-controls="filters-collapse-content"
        aria-expanded={showFilters}
        variant="outline-secondary" size="sm"
        className="d-flex d-md-none justify-content-between align-items-center w-100"
      >
        <span className="d-inline-flex align-items-center"><Funnel className="me-2" />필터 및 검색 옵션</span>
        {showFilters ? <ChevronUp /> : <ChevronDown />}
      </Button>

      {/* --- Filter UI --- */}
      <div className="mb-1">
        <Collapse in={showFilters}>
          <div id="filters-collapse-content" className="px-3 py-2 border rounded">
          <NovelFilterControls onFilterChange={handleFilterChange} />
          <hr className="my-2"/>
          {/* Tag Filter Row */}
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
                      <Button key={tag} variant={filterMode === 'exclude' ? 'danger' : 'primary'} size="sm" onClick={() => handleTagDeselect(tag)} className="rounded-pill tag-button-compact">
                          {tag} <span className="fw-bold ms-1">X</span>
                      </Button>
                  ))}
              </div>
              <hr className="my-2"/>
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
        </Collapse>
      </div>

      {error && <Alert variant="danger" className="mt-2">{error}</Alert>}
      
      {/* Show loading spinner only when fetching rankings for a specific date */}
      {loading && date && <Spinner animation="border" />}
      {!loading && !error && rankings.length === 0 && date && (
          <Alert variant="info">해당 날짜의 랭킹 데이터가 없습니다.</Alert>
      )}
      {!loading && !error && rankings.length > 0 && (
        <div className="custom-table-wrapper" style={{ flex: '1 1 auto', minHeight: 0, position: 'relative', overflowY: 'auto', backgroundColor: 'white', opacity: isPending ? 0.7 : 1 }}>
          {isPending && (
            <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', zIndex: 10 }}>
              <Spinner animation="border" />
            </div>
          )}
          <>
            {/* Desktop & Mobile Table View */}
            <div className={mobileViewMode === 'table' ? 'd-block' : 'd-none d-md-block'}>
              <Table hover className="custom-table novel-rankings-table">
                <thead>
                  <tr>
                    <th onClick={() => requestSort('Ranking')} className="cursor-pointer sortable-header text-center" style={{ fontSize: '0.85rem', width: '40px' }}><div className="d-flex align-items-center justify-content-center gap-1"><span>순위</span>{getSortIndicator('Ranking')}</div></th>
                    <th onClick={() => requestSort('rank_change')} className="cursor-pointer sortable-header text-center" style={{ fontSize: '0.85rem', width: '40px' }}><div className="d-flex align-items-center justify-content-center gap-1"><span>변동</span>{getSortIndicator('rank_change')}</div></th>
                    <th style={{ fontSize: '0.85rem', minWidth: '300px', whiteSpace: 'normal', textAlign: 'left' }}>제목</th>
                    <th style={{ fontSize: '0.85rem', minWidth: '100px', textAlign: 'left' }}>작가</th>
                    <th style={{ fontSize: '0.85rem', minWidth: '60px', textAlign: 'left' }}>점수</th>
                    <th onClick={() => requestSort('Eps')} className="cursor-pointer sortable-header" style={{ fontSize: '0.85rem', minWidth: '40px', textAlign: 'left' }}><div className="d-flex align-items-center gap-1"><span>회차</span>{getSortIndicator('Eps')}</div></th>
                    <th style={{ fontSize: '0.85rem', minWidth: '320px', textAlign: 'left' }}>태그</th>
                  </tr>
                </thead>
                <tbody>
                  {processedRankings.length > 0 ? (
                    processedRankings.map((novel) => (
                      <tr key={novel.ID}>
                        <td className="text-center" style={{ fontSize: '0.9rem' }}>{novel.Ranking}</td>
                        <td className="text-center" style={{ fontSize: '0.9rem' }}><RankChangeIndicator value={novel.rank_change} /></td>
                        <td style={{ fontSize: '0.9rem', whiteSpace: 'normal' }}><Link to={`/novels/${novel.ID}`} className="text-indigo-600 hover:text-indigo-900 fw-bold">{novel.Title || '(제목 없음)'}</Link></td>
                        <td style={{ fontSize: '0.9rem' }}>{novel.AuthorID ? (<Link to={`/authors/${novel.AuthorID}`}>{novel.AuthorName || '(작자 미상)'}</Link>) : (novel.AuthorName || '(작자 미상)')}</td>
                        <td style={{ fontSize: '0.9rem' }}>{novel.Score.toLocaleString()}</td>
                        <td style={{ fontSize: '0.9rem' }}>{novel.Eps}</td>
                        <td style={{ fontSize: '0.9rem' }}><div className="d-flex flex-wrap gap-1">{(novel.Tags || []).map((tag, index) => (<Button key={`${novel.ID}-${tag}-${index}`} variant={selectedTags.includes(tag) ? "primary" : "secondary"} size="sm" onClick={() => handleTagSelect(tag)} className="rounded-pill">{tag}</Button>))}</div></td>
                      </tr>
                    ))
                  ) : (
                    <tr><td colSpan={7} className="text-center py-4">현재 필터와 일치하는 결과가 없습니다.</td></tr>
                  )}
                </tbody>
              </Table>
            </div>

            {/* Mobile Card View */}
            <div className={mobileViewMode === 'card' ? 'd-md-none' : 'd-none'}>
              <div className="p-1">
                {processedRankings.length > 0 ? (
                  processedRankings.map((novel) => (
                  <Card key={novel.ID} className="mb-1 shadow-sm">
                    <Card.Body className="p-2">
                      <div className="d-flex justify-content-between align-items-start mb-2">
                        <div className="flex-grow-1 me-2">
                          <div className="d-flex align-items-baseline gap-2">
                            <span className="fw-bold text-primary text-nowrap" style={{ fontSize: '1rem' }}>{novel.Ranking}위</span>
                            <h5 className="mb-0 h6"><Link to={`/novels/${novel.ID}`} className="text-dark text-decoration-none">{novel.Title}</Link></h5>
                          </div>
                          <div className="text-muted small mt-1">
                            <span>{novel.AuthorID ? (<Link to={`/authors/${novel.AuthorID}`} className="text-muted text-decoration-none">{novel.AuthorName || '(작자 미상)'}</Link>) : (novel.AuthorName || '(작자 미상)')}</span>
                            <span className="mx-1">·</span>
                            <span>{novel.Eps}화</span>
                          </div>
                        </div>
                        <div className="flex-shrink-0 text-end"><RankChangeIndicator value={novel.rank_change} /></div>
                      </div>
                      {novel.Tags && novel.Tags.length > 0 && (
                        <div className="pt-2 border-top">
                          <div className="d-flex flex-wrap gap-1">{(novel.Tags || []).map((tag, index) => (<Button key={`${novel.ID}-${tag}-${index}`} variant={selectedTags.includes(tag) ? "primary" : "secondary"} size="sm" onClick={() => handleTagSelect(tag)} className="rounded-pill tag-button-compact">{tag}</Button>))}</div>
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
        </div>
      )}
    </Container>
  );
};

export default NovelRankingsPage;