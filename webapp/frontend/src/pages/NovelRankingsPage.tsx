import React, { useState, useEffect, useMemo, useRef, useCallback, useTransition } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { Table, Spinner, Alert, Form, Button, ButtonGroup, Dropdown, OverlayTrigger, Tooltip, Card } from 'react-bootstrap';
import { InfoCircle, ArrowUpShort, ArrowDownShort, Funnel, ChevronUp, ChevronDown} from 'react-bootstrap-icons';
import { format, parseISO, isValid } from 'date-fns';
import { getNovelRankingsByDate, getAvailableDates } from '../services/api';
import CalendarPicker from '../components/CalendarPicker';
import NovelFilterControls from '../components/NovelFilterControls';
import TagFilter from '../components/TagFilter';
import { evaluateAdvancedRule } from '../utils/tagFilter';

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
  View?: number;
  Like?: number;
  EarlyRetentionRate?: number;
  RecentRetentionRate?: number;
  like_to_view_ratio?: number;
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
  const navigate = useNavigate();
  const { date: dateParam } = useParams();

  // --- FILTERING STATE ---
  const [isPending, startTransition] = useTransition();
  const [isAdvancedMode, setIsAdvancedMode] = useState(false);
  // activeFilterType: 실제로 테이블에 적용되는 필터 타입. UI 모드(isAdvancedMode)와 별개.
  // 기본 모드: 태그 선택 즉시 반영, 고급 모드: "필터 적용" 클릭 시에만 반영.
  const [activeFilterType, setActiveFilterType] = useState<'basic' | 'advanced'>('basic');
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [filterMode, setFilterMode] = useState<'include-or' | 'include-and' | 'exclude'>('include-and');
  const [advancedRule, setAdvancedRule] = useState('');
  const [activeAdvancedRule, setActiveAdvancedRule] = useState('');
  const [filterError, setFilterError] = useState<string | null>(null);
  const [allAvailableTags, setAllAvailableTags] = useState<string[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [activeMinEps, setActiveMinEps] = useState<number | null>(null);
  const [activeMaxEps, setActiveMaxEps] = useState<number | null>(null);

  const [showFilters, setShowFilters] = useState(false);
  const [shouldRenderFilters, setShouldRenderFilters] = useState(false);
  const hasFetchedDates = useRef(false);
  const tableScrollRef = useRef<HTMLDivElement>(null);

  // CSS 필터 패널 애니메이션 - showFilters가 false가 되면 300ms 뒤 내부 컨텐츠 언마운트
  useEffect(() => {
    if (!showFilters) {
      const t = setTimeout(() => setShouldRenderFilters(false), 300);
      return () => clearTimeout(t);
    } else {
      setShouldRenderFilters(true);
    }
  }, [showFilters]);

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

    if (activeFilterType === 'advanced') {
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

    if (searchTerm) {
        const lowercasedTerm = searchTerm.toLowerCase();
        filteredItems = filteredItems.filter(novel =>
            novel.Title.toLowerCase().includes(lowercasedTerm) ||
            novel.AuthorName.toLowerCase().includes(lowercasedTerm)
        );
    }

    if (activeMinEps !== null) {
        filteredItems = filteredItems.filter(novel => novel.Eps >= activeMinEps!);
    }
    if (activeMaxEps !== null) {
        filteredItems = filteredItems.filter(novel => novel.Eps <= activeMaxEps!);
    }

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
  }, [rankings, sortConfig, activeFilterType, selectedTags, filterMode, activeAdvancedRule, searchTerm, activeMinEps, activeMaxEps]);

  const tableVirtualizer = useVirtualizer({
    count: processedRankings.length,
    getScrollElement: () => tableScrollRef.current,
    estimateSize: () => 90,
    overscan: 10,
  });

  useEffect(() => {
    tableScrollRef.current?.scrollTo({ top: 0 });
  }, [processedRankings]);

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
      setActiveFilterType('basic');
      setAdvancedRule('');
      setActiveAdvancedRule('');
      setSelectedTags(prev =>
        prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag]
      );
    });
  };

  const handleTagDeselect = (tag: string) => {
    startTransition(() => {
      setActiveFilterType('basic');
      setAdvancedRule('');
      setActiveAdvancedRule('');
      setSelectedTags(prev => prev.filter(t => t !== tag));
    });
  };

  const clearAllTags = () => {
    startTransition(() => {
      setActiveFilterType('basic');
      setAdvancedRule('');
      setActiveAdvancedRule('');
      setSelectedTags([]);
    });
  }

  const applyAdvancedFilter = () => {
    startTransition(() => {
      setFilterError(null);
      setActiveAdvancedRule(advancedRule);
      setActiveFilterType('advanced');
      setSelectedTags([]);
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
        setActiveFilterType('basic');
        setFilterMode(mode as 'include-or' | 'include-and' | 'exclude');
      });
    }
  };

  const handleSwitchToSimple = () => {
    setIsAdvancedMode(false);
    setFilterError(null);
  };

  const handleSwitchToAdvanced = () => {
    setIsAdvancedMode(true);
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
    if (hasFetchedDates.current) return;
    hasFetchedDates.current = true;

    const fetchAvailableDates = async () => {
      try {
        const datesResponse = await getAvailableDates();
        const fetchedDates: string[] = datesResponse.data.available_dates || [];
        setAvailableDatesSet(new Set(fetchedDates));
      } catch (err) {
        console.error('Failed to fetch available dates:', err);
        setLoading(false);
      }
    };
    fetchAvailableDates();
  }, []);

  useEffect(() => {
    if (availableDatesSet.size === 0) return;

    if (dateParam && isValid(parseISO(dateParam)) && availableDatesSet.has(dateParam)) {
      const fetchRankings = async () => {
        setLoading(true);
        setError(null);
        try {
          const parsedDate = parseISO(dateParam);
          setDate(parsedDate);
          const response = await getNovelRankingsByDate(dateParam);
          const rawData: Novel[] = response.data.message ? [] : response.data;
          setRankings(rawData.map(n => ({
            ...n,
            like_to_view_ratio: (n.View && n.View > 0) ? (n.Like ?? 0) / n.View : 0,
          })));
        } catch (err) {
          setError('랭킹을 불러오는 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.');
          setRankings([]);
        } finally {
          setLoading(false);
        }
      };
      fetchRankings();
    } else {
      const latestDate = Array.from(availableDatesSet)[0];
      if (latestDate) {
        navigate(`/novels/rankings/${latestDate}`, { replace: true });
      } else {
        setError("랭킹 데이터가 아직 없습니다. 데이터 수집 후 다시 시도해주세요.");
        setRankings([]);
        setLoading(false);
      }
    }
  }, [dateParam, navigate, availableDatesSet]);

  const handleDateChange = async (newDate: Date | null) => {
    if (newDate && (!date || format(newDate, 'yyyy-MM-dd') !== format(date, 'yyyy-MM-dd'))) {
      setOptimisticDate(newDate);
      navigate(`/novels/rankings/${format(newDate, 'yyyy-MM-dd')}`);
    }
  };


  // --- Tag filter sidebar content (shared between desktop sidebar and mobile collapse) ---
  const tagFilterContent = (idSuffix: string) => (
    <div className="d-flex flex-column gap-2">
      {/* 첫 줄: 기본/고급 토글 + 비우기 */}
      <div className="d-flex align-items-center justify-content-between">
        <ButtonGroup size="sm">
          <Button variant={!isAdvancedMode ? 'primary' : 'outline-secondary'} onClick={handleSwitchToSimple}>기본</Button>
          <Button variant={isAdvancedMode ? 'primary' : 'outline-secondary'} onClick={handleSwitchToAdvanced}>고급</Button>
        </ButtonGroup>
        {!isAdvancedMode && selectedTags.length > 0 && (
          <Button variant="outline-danger" size="sm" onClick={clearAllTags}>비우기</Button>
        )}
      </div>
      {/* 둘째 줄: 필터 모드 드롭다운 (기본 모드일 때만) */}
      {!isAdvancedMode && (
        <Dropdown onSelect={handleFilterModeChange}>
          <Dropdown.Toggle variant="outline-secondary" id={`dropdown-filter-mode-${idSuffix}`} size="sm" className="w-100 d-flex justify-content-between align-items-center">
            {filterModeLabels[filterMode]}
          </Dropdown.Toggle>
          <Dropdown.Menu className="w-100">
            <Dropdown.Item eventKey="include-and">{filterModeLabels['include-and']}</Dropdown.Item>
            <Dropdown.Item eventKey="include-or">{filterModeLabels['include-or']}</Dropdown.Item>
            <Dropdown.Item eventKey="exclude">{filterModeLabels['exclude']}</Dropdown.Item>
          </Dropdown.Menu>
        </Dropdown>
      )}

      {!isAdvancedMode ? (
        <>
          <div className="selected-tags-box">
            {selectedTags.map(tag => (
              <Button key={tag} variant={filterMode === 'exclude' ? 'danger' : 'primary'} size="sm"
                onClick={() => handleTagDeselect(tag)} className="rounded-pill tag-button-compact">{tag}</Button>
            ))}
          </div>
          <TagFilter unselectedTags={unselectedTags} onTagSelect={handleTagSelect} />
        </>
      ) : (
        <>
          <Form.Control
            as="textarea" rows={2}
            placeholder="e.g. (하렘 AND 순애) OR (TS AND NOT BL)"
            value={advancedRule}
            onChange={e => setAdvancedRule(e.target.value)}
            onKeyDown={handleAdvancedInputKeyDown}
            isInvalid={!!filterError}
          />
          <div className="d-flex justify-content-between align-items-center">
            <Button variant="primary" size="sm" onClick={applyAdvancedFilter}>필터 적용</Button>
            <small className="text-muted">AND / OR / NOT / ()</small>
          </div>
          {filterError && <Alert variant="danger" className="p-2 small mb-0">{filterError}</Alert>}
        </>
      )}
    </div>
  );

  // --- RENDER ---
  return (
    <div className="page-height-manager">

      {/* ── Page Banner ── */}
      <div className="page-banner">
        <div className="page-banner-inner">
          <div className="d-flex flex-wrap align-items-center gap-1">
            <h1 className="page-banner-title">소설 랭킹</h1>
            <OverlayTrigger
              trigger="click" rootClose placement="bottom"
              overlay={
                <Tooltip id="ranking-description-tooltip">
                  매일 오후 9시, 7일 조회순 데이터를 기준으로 집계됩니다.
                  <Link to="/data-collection-info" className="ms-1 text-white-50">(자세히)</Link>
                </Tooltip>
              }
            >
              <span className="d-md-none page-banner-info-icon" style={{ cursor: 'pointer' }}><InfoCircle /></span>
            </OverlayTrigger>
          </div>
          <p className="page-banner-desc d-none d-md-block">
            매일 집계되는 노벨피아 소설 랭킹입니다. 날짜를 선택하여 과거 랭킹을 조회할 수 있습니다.{' '}
            노벨피아 실시간 랭킹의 7일 조회순 데이터를 사용합니다.
            <Link to="/data-collection-info" className="ms-2 subtle-link">(데이터 수집 방식)</Link>
          </p>
        </div>
      </div>

      {/* Mobile controls bar — page-layout 밖에 배치해 overflow:hidden 클리핑 방지 */}
      <div className="mobile-controls-bar d-md-none d-flex align-items-center gap-2 px-2 py-2">
        <CalendarPicker
          selectedDate={optimisticDate || date}
          onDateChange={handleDateChange}
          availableDates={availableDatesSet}
        />
        <Button
          onClick={() => setShowFilters(!showFilters)}
          aria-controls="filters-collapse-mobile"
          aria-expanded={showFilters}
          variant="outline-secondary" size="sm"
          className="d-flex align-items-center gap-1"
        >
          <Funnel size={14} />
          <span>필터</span>
          {showFilters ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
        </Button>
      </div>

      {/* Mobile filter panel — page-layout 밖에 배치 */}
      <div className={`filter-panel d-md-none px-2${showFilters ? ' filter-panel--open' : ''}`}>
        <div id="filters-collapse-mobile">
          {(showFilters || shouldRenderFilters) && (
            <div className="p-2 border rounded mt-2">
              <NovelFilterControls onFilterChange={handleFilterChange} />
              <hr className="my-2" />
              <div className="sidebar-label mb-2">태그 필터</div>
              {tagFilterContent('mobile')}
            </div>
          )}
        </div>
      </div>

      {/* ── Page Layout ── */}
      <div className="page-layout">

        {/* ── Desktop Sidebar ── */}
        <aside className="page-sidebar d-none d-md-flex flex-column">

          <div className="sidebar-section">
            <div className="sidebar-label">날짜 선택</div>
            <CalendarPicker
              selectedDate={optimisticDate || date}
              onDateChange={handleDateChange}
              availableDates={availableDatesSet}
            />
          </div>

          <div className="sidebar-divider" />

          <div className="sidebar-section">
            <div className="sidebar-label">검색 / 회차</div>
            <NovelFilterControls onFilterChange={handleFilterChange} />
          </div>

          <div className="sidebar-divider" />

          <div className="sidebar-section sidebar-section-tags">
            <div className="sidebar-label mb-2">태그 필터</div>
            {tagFilterContent('desktop')}
          </div>

        </aside>

        {/* ── Main Content ── */}
        <div className="page-main">

          {error && <Alert variant="danger" className="mt-2">{error}</Alert>}
          {loading && date && (
            <div className="d-flex justify-content-center p-5">
              <Spinner animation="border" />
            </div>
          )}
          {!loading && !error && rankings.length === 0 && date && (
            <Alert variant="info">해당 날짜의 랭킹 데이터가 없습니다.</Alert>
          )}

          {!loading && !error && rankings.length > 0 && (
            <div className="d-flex flex-column" style={{ flex: '1 1 auto', minHeight: 0, position: 'relative', opacity: isPending ? 0.7 : 1 }}>
              {isPending && (
                <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', zIndex: 10 }}>
                  <Spinner animation="border" />
                </div>
              )}

              {/* Desktop Table View */}
              <div ref={tableScrollRef} className="custom-table-wrapper border rounded h-100 d-none d-md-block" style={{ overflowY: 'auto', backgroundColor: 'var(--np-surface)' }}>
                <Table hover className="custom-table novel-rankings-table" style={{ tableLayout: 'fixed' }}>
                  <colgroup>
                    <col style={{ width: '50px' }} />
                    <col style={{ width: '55px' }} />
                    <col style={{ width: '260px' }} />
                    <col style={{ width: '105px' }} />
                    <col style={{ width: '65px' }} />
                    <col style={{ width: '50px' }} />
                    <col style={{ width: '75px' }} />
                    <col style={{ width: '100px' }} />
                    <col style={{ width: '100px' }} />
                    <col style={{ width: '270px' }} />
                  </colgroup>
                  <thead>
                    <tr>
                      <th onClick={() => requestSort('Ranking')} className="cursor-pointer sortable-header text-center" style={{ fontSize: '0.85rem' }}>순위</th>
                      <th onClick={() => requestSort('rank_change')} className="cursor-pointer sortable-header text-center" style={{ fontSize: '0.85rem' }}>변동</th>
                      <th style={{ fontSize: '0.85rem', whiteSpace: 'normal', textAlign: 'left' }}>제목</th>
                      <th style={{ fontSize: '0.85rem', textAlign: 'left' }}>작가</th>
                      <th style={{ fontSize: '0.85rem', textAlign: 'left' }}>점수</th>
                      <th onClick={() => requestSort('Eps')} className="cursor-pointer sortable-header" style={{ fontSize: '0.85rem', textAlign: 'left' }}>회차</th>
                      <th onClick={() => requestSort('like_to_view_ratio')} className="cursor-pointer sortable-header" style={{ fontSize: '0.85rem', textAlign: 'left' }}>추천비</th>
                      <th onClick={() => requestSort('EarlyRetentionRate')} className="cursor-pointer sortable-header" style={{ fontSize: '0.85rem', textAlign: 'left', whiteSpace: 'nowrap' }}>초반 잔류율</th>
                      <th onClick={() => requestSort('RecentRetentionRate')} className="cursor-pointer sortable-header" style={{ fontSize: '0.85rem', textAlign: 'left', whiteSpace: 'nowrap' }}>최신 잔류율</th>
                      <th style={{ fontSize: '0.85rem', textAlign: 'left' }}>태그</th>
                    </tr>
                  </thead>
                  <tbody>
                    {processedRankings.length > 0 ? (() => {
                      const vItems = tableVirtualizer.getVirtualItems();
                      const paddingTop = vItems[0]?.start ?? 0;
                      const last = vItems[vItems.length - 1];
                      const paddingBottom = last ? tableVirtualizer.getTotalSize() - last.end : 0;
                      return (
                        <>
                          {paddingTop > 0 && <tr><td colSpan={10} style={{ height: paddingTop, padding: 0, border: 'none' }} /></tr>}
                          {vItems.map((vRow) => {
                            const novel = processedRankings[vRow.index];
                            return (
                              <tr key={novel.ID} data-index={vRow.index} ref={tableVirtualizer.measureElement}>
                                <td className="text-center" style={{ fontSize: '0.9rem' }}>{novel.Ranking}</td>
                                <td className="text-center" style={{ fontSize: '0.9rem' }}><RankChangeIndicator value={novel.rank_change} /></td>
                                <td style={{ fontSize: '0.9rem', whiteSpace: 'normal' }}><Link to={`/novels/${novel.ID}`} className="fw-bold">{novel.Title || '(제목 없음)'}</Link></td>
                                <td style={{ fontSize: '0.9rem' }}>{novel.AuthorID ? (<Link to={`/authors/${novel.AuthorID}`}>{novel.AuthorName || '(작자 미상)'}</Link>) : (novel.AuthorName || '(작자 미상)')}</td>
                                <td style={{ fontSize: '0.9rem' }}>{novel.Score.toLocaleString()}</td>
                                <td style={{ fontSize: '0.9rem' }}>{novel.Eps}</td>
                                <td style={{ fontSize: '0.9rem' }}>{novel.like_to_view_ratio != null ? `${(novel.like_to_view_ratio * 100).toFixed(2)}%` : '-'}</td>
                                <td style={{ fontSize: '0.9rem' }}>{typeof novel.EarlyRetentionRate === 'number' ? `${(novel.EarlyRetentionRate * 100).toFixed(1)}%` : '-'}</td>
                                <td style={{ fontSize: '0.9rem' }}>{typeof novel.RecentRetentionRate === 'number' ? `${(novel.RecentRetentionRate * 100).toFixed(1)}%` : '-'}</td>
                                <td style={{ fontSize: '0.9rem' }}><div className="d-flex flex-wrap gap-1">{(novel.Tags || []).map((tag, index) => (<Button key={`${novel.ID}-${tag}-${index}`} variant={selectedTags.includes(tag) ? "primary" : "secondary"} size="sm" onClick={() => handleTagSelect(tag)} className="rounded-pill">{tag}</Button>))}</div></td>
                              </tr>
                            );
                          })}
                          {paddingBottom > 0 && <tr><td colSpan={10} style={{ height: paddingBottom, padding: 0, border: 'none' }} /></tr>}
                        </>
                      );
                    })() : (
                      <tr><td colSpan={10} className="text-center py-4">현재 필터와 일치하는 결과가 없습니다.</td></tr>
                    )}
                  </tbody>
                </Table>
              </div>

              {/* Mobile Card View */}
              <div className="d-md-none">
                {processedRankings.length > 0 ? (
                  processedRankings.map((novel) => (
                    <div key={novel.ID} style={{ padding: '0 0 4px' }}>
                      <Card className="shadow-sm">
                        <Card.Body className="p-2">
                          <div className="d-flex justify-content-between align-items-start mb-1">
                            <div className="flex-grow-1 me-2">
                              <div className="d-flex align-items-baseline gap-2">
                                <span className="fw-bold text-primary text-nowrap" style={{ fontSize: '1rem' }}>{novel.Ranking}위</span>
                                <h5 className="mb-0 h6"><Link to={`/novels/${novel.ID}`} className="text-decoration-none">{novel.Title}</Link></h5>
                              </div>
                              <div className="text-muted small mt-1">
                                <span>{novel.AuthorID ? (<Link to={`/authors/${novel.AuthorID}`} className="text-muted text-decoration-none">{novel.AuthorName || '(작자 미상)'}</Link>) : (novel.AuthorName || '(작자 미상)')}</span>
                                <span className="mx-1">·</span>
                                <span>{novel.Eps}화</span>
                              </div>
                              <div className="d-flex flex-wrap gap-2 mt-1" style={{ fontSize: '0.78rem', color: 'var(--np-text-secondary)' }}>
                                {novel.like_to_view_ratio != null && <span>추천비 {(novel.like_to_view_ratio * 100).toFixed(2)}%</span>}
                                {typeof novel.EarlyRetentionRate === 'number' && <span>초반 잔류율 {(novel.EarlyRetentionRate * 100).toFixed(1)}%</span>}
                                {typeof novel.RecentRetentionRate === 'number' && <span>최신 잔류율 {(novel.RecentRetentionRate * 100).toFixed(1)}%</span>}
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
                    </div>
                  ))
                ) : (
                  <Alert variant="info" className="text-center m-1">현재 필터와 일치하는 결과가 없습니다.</Alert>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default NovelRankingsPage;
