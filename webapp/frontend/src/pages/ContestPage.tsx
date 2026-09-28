import React, { useState, useEffect, useMemo, useCallback, useTransition, useRef } from 'react';
import NovelCover from '../components/NovelCover';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useParams, Link, useNavigate, NavLink } from 'react-router-dom';
import { Table, Spinner, Alert, Card, Button, Dropdown, ButtonGroup, Form, Nav, Badge } from 'react-bootstrap';
import { Funnel, ChevronUp, ChevronDown, ArrowUpShort, ArrowDownShort } from 'react-bootstrap-icons';
import { getContestDataByDate, getContestAvailableDates, getContestShowcase } from '../services/api';
import ContestNovelFilterControls from '../components/ContestNovelFilterControls';
import CalendarPicker from '../components/CalendarPicker';
import { format, parseISO, isValid } from 'date-fns';
import TagFilter from '../components/TagFilter';
import { evaluateAdvancedRule } from '../utils/tagFilter';
import { useIsMobile } from '../hooks/useIsMobile';
import PageHero from '../components/ui/PageHero';
import PanelCard from '../components/ui/PanelCard';

// --- HELPER COMPONENTS ---
const RankChangeIndicator: React.FC<{ value: number | 'New' | undefined, isNew: boolean }> = ({ value, isNew }) => {
    const containerClasses = "d-inline-flex align-items-center justify-content-center rank-change-badge px-2";
    const commonStyle = { width: '42px', height: '25px', borderRadius: 'var(--np-radius-sm)' };

    return (
        <div style={{ margin: '0 auto' }}>
            {(() => {
                if (isNew) return <span className={`${containerClasses} rank-up`} style={commonStyle}>New</span>;
                if (value === undefined || value === 0 || typeof value !== 'number') {
                    return <span className={`${containerClasses} rank-same`} style={commonStyle}>-</span>;
                }
                // 백엔드에서 (이전 순위 - 현재 순위)로 계산하므로, 양수 값이 순위 상승입니다.
                if (value > 0) { // Rank Up
                    return <span className={`${containerClasses} rank-up`} style={commonStyle}>
                        <ArrowUpShort size={12} viewBox="3 3 10 10" className="flex-shrink-0" />
                        <span style={{ lineHeight: 1 }}>{value.toLocaleString()}</span>
                    </span>;
                }
                // 음수 값은 순위 하락입니다.
                return <span className={`${containerClasses} rank-down`} style={commonStyle}>
                        <ArrowDownShort size={12} viewBox="3 3 10 10" className="flex-shrink-0" />
                        <span style={{ lineHeight: 1 }}>{Math.abs(value).toLocaleString()}</span>
                    </span>;
            })()}
        </div>
    );
};

const renderAwardBadge = (award: string | null | undefined) => {
  if (!award) {
    return null;
  }

  const badgeMeta: Record<string, { label: string; variant: string }> = {
    '대상': { label: '대상', variant: 'grand' },
    '최우수상': { label: '최우수상', variant: 'excellent' },
    '탑툰상': { label: '탑툰상', variant: 'toptoon' },
    '우수상': { label: '우수상', variant: 'winner' },
    '특별상': { label: '특별상', variant: 'special' },
    '본선': { label: '본선', variant: 'finalist' },
  };

  if (!badgeMeta[award]) return null;
  const { label, variant } = badgeMeta[award];

  return (
    <Badge bg="" className={`contest-award-badge contest-award-badge--${variant} fw-bold d-inline-flex align-items-center`}>
      {label}
    </Badge>
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
  Date: string;
  Rank: number;
  view_change: number;
  like_to_view_ratio: number;
  rank_change?: number | 'New';
  is_new: boolean;
  award?: string | null;
  ThumbnailURL?: string | null;
}

const filterModeLabels: { [key: string]: string } = {
  'include-and': '태그 포함 (모두)',
  'include-or': '태그 포함 (일부)',
  'exclude': '태그 제외'
};

interface ContestMobileCardListProps {
  novels: ContestNovel[];
  year: string | undefined;
  selectedTags: string[];
  onTagSelect: (tag: string) => void;
}

const ContestMobileCardList = React.memo(({ novels, year, selectedTags, onTagSelect }: ContestMobileCardListProps) => {
  const parentRef = useRef<HTMLDivElement>(null);
  const rowVirtualizer = useVirtualizer({
    count: novels.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 156,
    overscan: 8,
  });

  if (novels.length === 0) {
    return <Alert variant="info" className="text-center m-1">현재 필터와 일치하는 결과가 없습니다.</Alert>;
  }

  const virtualItems = rowVirtualizer.getVirtualItems();

  return (
    <div ref={parentRef} className="virtual-card-scroll contest-mobile-virtual-list">
      <div style={{ height: rowVirtualizer.getTotalSize(), position: 'relative' }}>
        {virtualItems.map((virtualRow) => {
          const novel = novels[virtualRow.index];
          return (
            <div
              key={novel.ID}
              data-index={virtualRow.index}
              ref={rowVirtualizer.measureElement}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                transform: `translateY(${virtualRow.start}px)`,
                padding: '0 4px 4px',
              }}
            >
              <Card>
                <Card.Body className="p-2">
                  <div className="d-flex justify-content-between align-items-start mb-2">
                    <div className="flex-grow-1 me-2">
                      <div className="d-flex align-items-center gap-2">
                        <span className="fw-bold text-primary text-nowrap" style={{ fontSize: '1rem' }}>{novel.Rank}위</span>
                        <div className="d-flex align-items-center">{renderAwardBadge(novel.award)}</div>
                      </div>
                      <h5 className="mb-0 h6 mt-1" style={{ wordBreak: 'break-all' }}>
                        {novel.View === -1 ? (
                          <span className="text-muted">{`삭제된 소설 (${novel.ID})`}</span>
                        ) : (
                          <Link to={`/contests/${year}/novels/${novel.ID}`} className="text-decoration-none">{novel.Title || '(제목 없음)'}</Link>
                        )}
                      </h5>
                      <div className="text-muted small mt-1">
                        {novel.View !== -1 && (
                          <span>{novel.AuthorID && novel.AuthorID !== "0" ? <Link to={`/authors/${novel.AuthorID}`} className="text-muted text-decoration-none">{novel.AuthorName || '(작자 미상)'}</Link> : (novel.AuthorName || '(작자 미상)')}</span>
                        )}
                        {novel.View !== -1 && <span className="mx-1">·</span>}
                        <span>{novel.View === -1 ? '-' : `${novel.Eps}화`}</span>
                      </div>
                    </div>
                    <div className="flex-shrink-0 text-end"><RankChangeIndicator value={novel.rank_change} isNew={!!novel.is_new} /></div>
                  </div>
                  {novel.Tags && novel.Tags.length > 0 && (
                    <div className="pt-2 border-top">
                      <div className="d-flex flex-wrap gap-1">{(novel.Tags || []).map(tag => (<Button key={tag} variant={selectedTags.includes(tag) ? "primary" : "secondary"} size="sm" onClick={() => onTagSelect(tag)} className="rounded-pill tag-button-compact">{tag}</Button>))}</div>
                    </div>
                  )}
                </Card.Body>
              </Card>
            </div>
          );
        })}
      </div>
    </div>
  );
});

const ContestPage = () => {
  const { year, date: dateParam } = useParams<{ year: string; date?: string }>();
  const navigate = useNavigate();
  const isMobile = useIsMobile();

  const [novels, setNovels] = useState<ContestNovel[]>([]);
  const [latestContestNovels, setLatestContestNovels] = useState<ContestNovel[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sortConfig, setSortConfig] = useState<{ key: keyof ContestNovel; direction: 'ascending' | 'descending' } | null>({ key: 'View', direction: 'descending' });
  const [isPending, startTransition] = useTransition();
  const [currentDate, setCurrentDate] = useState<Date | null>(null);
  const [availableDates, setAvailableDates] = useState<Set<string>>(new Set());

  // --- FILTERING STATE ---
  const [showFilters, setShowFilters] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [activeMinEps, setActiveMinEps] = useState<number | null>(null);
  const [activeMaxEps, setActiveMaxEps] = useState<number | null>(null);
  const [allAvailableTags, setAllAvailableTags] = useState<string[]>([]);
  const [showOnlyWinners, setShowOnlyWinners] = useState(false);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [filterMode, setFilterMode] = useState<'include-or' | 'include-and' | 'exclude'>('include-and');
  const [isAdvancedMode, setIsAdvancedMode] = useState(false);
  const [activeFilterType, setActiveFilterType] = useState<'basic' | 'advanced'>('basic');
  const [advancedRule, setAdvancedRule] = useState('');
  const [activeAdvancedRule, setActiveAdvancedRule] = useState('');
  const [filterError, setFilterError] = useState<string | null>(null);
  const advancedRuleInputRef = useRef<HTMLTextAreaElement>(null);
  const tableScrollRef = useRef<HTMLDivElement>(null);
  const [shouldRenderFilters, setShouldRenderFilters] = useState(false);

  const fetchTracker = useRef({ dates: false, rankings: '' });

  const mapContestData = (items: ContestNovel[]) => items.map((novel: ContestNovel) => {
    const like_to_view_ratio = (novel.View && novel.View > 0) ? (novel.Like ?? 0) / novel.View : 0;
    const is_new = novel.rank_change === 'New';
    return { ...novel, like_to_view_ratio, is_new };
  });

  useEffect(() => {
    // 1. Fetch available dates only when the year changes.
    const yearNum = parseInt(year || '0', 10);
    if (!yearNum) return;

    if (fetchTracker.current.dates) return;
    fetchTracker.current.dates = true;

    const fetchAvailableDates = async () => {
      try {
        const datesResponse = await getContestAvailableDates(yearNum);
        const fetchedDates = new Set<string>(datesResponse.data.available_dates || []);
        setAvailableDates(fetchedDates);
      } catch (err) {
        setError("조회 가능한 공모전 날짜 목록을 불러오는 데 실패했습니다.");
      }
    };
    fetchAvailableDates();
  }, [year]);

  useEffect(() => {
    // 2. Set current date or redirect based on available dates and dateParam.
    if (availableDates.size === 0) return; // Wait until available dates are fetched.

    if (dateParam && isValid(parseISO(dateParam)) && availableDates.has(dateParam)) {
      setCurrentDate(parseISO(dateParam));
    } else {
      const latestDate = Array.from(availableDates).sort((a, b) => b.localeCompare(a))[0];
      if (latestDate) navigate(`/contests/${year}/${latestDate}`, { replace: true });
      else setError("조회 가능한 공모전 데이터가 없습니다.");
    }
  }, [year, dateParam, navigate, availableDates]); // availableDates dependency is necessary here

  useEffect(() => {
    if (!year || availableDates.size === 0) return;

    const latestDate = Array.from(availableDates).sort((a, b) => b.localeCompare(a))[0];
    if (!latestDate) return;

    getContestShowcase(parseInt(year, 10))
      .then((response) => {
        setLatestContestNovels(mapContestData(response.data.items || []));
      })
      .catch(() => {
        setLatestContestNovels([]);
      });
  }, [availableDates, year]);

  useEffect(() => {
    if (!currentDate || !year) return;

    const currentDateStr = format(currentDate, 'yyyy-MM-dd');
    // Prevent re-fetching for the same date
    if (fetchTracker.current.rankings === currentDateStr) return;
    fetchTracker.current.rankings = currentDateStr;

    const fetchContestDataForDate = async () => {
      setLoading(true);
      setError(null);
      try {
        const response = await getContestDataByDate(parseInt(year, 10), currentDateStr);
        const dataWithRatios = mapContestData(response.data);

        setNovels(dataWithRatios);

      } catch (err: any) {
        setError(err.response?.data?.detail || '공모전 데이터를 불러오는 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.');
        setNovels([]);
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

  const processedNovelsResult = useMemo(() => {
    let filteredItems = [...novels];
    let nextFilterError: string | null = null;

    // 0. Award Winner Filtering
    if (showOnlyWinners) {
      filteredItems = filteredItems.filter(novel => !!novel.award);
    }

    // 1. Tag Filtering
    if (activeFilterType === 'advanced') {
      if (activeAdvancedRule) {
        try {
          filteredItems = filteredItems.filter(novel => evaluateAdvancedRule(activeAdvancedRule, novel.Tags || []));
        } catch (e) {
          nextFilterError = `필터 오류: ${e instanceof Error ? e.message : '잘못된 구문입니다'}. 규칙을 확인해주세요.`;
          return { items: [], error: nextFilterError };
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
        const rankAscendingTieBreak = (a.Rank ?? Number.MAX_SAFE_INTEGER) - (b.Rank ?? Number.MAX_SAFE_INTEGER);
        const rankDirectionalTieBreak = direction === 'ascending'
          ? (b.Rank ?? -Number.MAX_SAFE_INTEGER) - (a.Rank ?? -Number.MAX_SAFE_INTEGER)
          : rankAscendingTieBreak;

        // 'New' (is_new: true) should be treated as the highest value in rank_change sort
        if (key === 'rank_change') {
            aValue = a.is_new ? Infinity : (aValue ?? -Infinity);
            bValue = b.is_new ? Infinity : (bValue ?? -Infinity);
        }

        // Deleted placeholder rows use View=-1 and render as "-"; treat them as
        // missing values whose position follows the accumulated-view sort direction.
        if (key === 'View') {
            aValue = a.View === -1 ? null : aValue;
            bValue = b.View === -1 ? null : bValue;
        }

        // Handle null/undefined values predictably. For accumulated views, "-" should
        // be first in ascending order and last in descending order.
        const aIsNull = aValue == null;
        const bIsNull = bValue == null;
        if (aIsNull && bIsNull) {
            return key === 'View' ? rankDirectionalTieBreak : ((b.View ?? -1) - (a.View ?? -1)) || rankAscendingTieBreak;
        }
        if (key === 'View') {
            if (aIsNull) return direction === 'ascending' ? -1 : 1;
            if (bIsNull) return direction === 'ascending' ? 1 : -1;
        }
        if (aIsNull) return 1; // a is null, should be at the bottom
        if (bIsNull) return -1; // b is null, should be at the bottom

        if (aValue! < bValue!) return direction === 'ascending' ? -1 : 1;
        if (aValue! > bValue!) return direction === 'ascending' ? 1 : -1;

        // 조회수 계열 정렬에서는 같은 값끼리 정렬 방향에 맞춰 순위 흐름을 보존한다.
        return (key === 'View' || key === 'view_change') ? rankDirectionalTieBreak : ((b.View ?? -1) - (a.View ?? -1)) || rankAscendingTieBreak;
      });
    }

    return { items: filteredItems, error: nextFilterError };
  }, [novels, sortConfig, activeFilterType, selectedTags, filterMode, activeAdvancedRule, searchTerm, activeMinEps, activeMaxEps, showOnlyWinners]);

  const processedNovels = processedNovelsResult.items;

  useEffect(() => {
    setFilterError(processedNovelsResult.error);
  }, [processedNovelsResult.error]);

  const tableVirtualizer = useVirtualizer({
    count: processedNovels.length,
    getScrollElement: () => tableScrollRef.current,
    estimateSize: () => 53,
    overscan: 5,
  });

  useEffect(() => {
    tableScrollRef.current?.scrollTo({ top: 0 });
  }, [processedNovels]);

  const unselectedTags = useMemo(() =>
    allAvailableTags.filter(tag => !selectedTags.includes(tag)),
    [allAvailableTags, selectedTags]
  );

  const contestShowcaseItems = useMemo(() => {
    const awardOrder: Record<string, number> = {
      '대상': 0,
      '최우수상': 1,
      '탑툰상': 2,
      '우수상': 3,
    };

    return [...latestContestNovels]
      .sort((a, b) => {
        const awardDelta = (awardOrder[a.award || ''] ?? 99) - (awardOrder[b.award || ''] ?? 99);
        if (awardDelta !== 0) return awardDelta;
        return (b.View ?? -1) - (a.View ?? -1);
      })
      .slice(0, 11);
  }, [latestContestNovels]);

  const renderContestShowcaseBadge = (novel: ContestNovel) => {
    return renderAwardBadge(novel.award);
  };

  /* 순위/수상 배지는 표지 안에 둔다 — 하단 글자 띠가 blur 레이어 때문에
     position: relative이라, 그 안에 두면 카드가 아니라 띠 기준으로 배치된다. */
  const renderContestCover = (novel: ContestNovel, badge?: React.ReactNode) => (
    <div className="media-rank-card__cover">
      <NovelCover
        url={novel.ThumbnailURL}
        title={novel.Title}
        imageClassName="media-rank-card__cover-image"
      />
      {badge ? <div className="media-rank-card__rank">{badge}</div> : null}
    </div>
  );

  const contestShowcaseSection = contestShowcaseItems.length > 0 ? (
    <section className="contest-award-showcase showcase-section">
      <div className="contest-award-showcase__grid">
        {contestShowcaseItems.map((novel, index) => (
          <Link
            key={`${novel.ID}-award-showcase`}
            to={`/contests/${year}/novels/${novel.ID}`}
            className={`media-rank-card media-rank-card--poster media-rank-card--link contest-award-poster contest-award-poster--podium-${index + 1}`}
            aria-label={`${novel.Title || '공모전 작품'} 상세 보기`}
          >
            {renderContestCover(novel, renderContestShowcaseBadge(novel))}
            <div className="media-rank-card__overlay">
              <div className="media-rank-card__title">{novel.Title || '(제목 없음)'}</div>
              <div className="media-rank-card__meta">
                <span className="mini-kpi">{novel.AuthorName || '(작자 미상)'}</span>
                <span className="mini-kpi">조회 {novel.View?.toLocaleString() ?? '-'}</span>
              </div>
            </div>
          </Link>
        ))}
      </div>
    </section>
  ) : null;

  const handleFilterChange = useCallback((filters: { searchTerm: string; minEps: number | null; maxEps: number | null }) => {
    startTransition(() => {
      setSearchTerm(filters.searchTerm);
      setActiveMinEps(filters.minEps);
      setActiveMaxEps(filters.maxEps);
    });
  }, []);

  const resetTagFilter = () => {
    startTransition(() => {
      setActiveFilterType(isAdvancedMode ? 'advanced' : 'basic');
      setAdvancedRule('');
      setActiveAdvancedRule('');
      setFilterError(null);
      setFilterMode('include-and');
      setSelectedTags([]);
    });
    if (advancedRuleInputRef.current) {
      advancedRuleInputRef.current.value = '';
    }
  };

  const handleTagSelect = useCallback((tag: string) => {
    startTransition(() => {
      setActiveFilterType('basic');
      setAdvancedRule('');
      setActiveAdvancedRule('');
      setSelectedTags(prev =>
        prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag]
      );
    });
  }, [startTransition]);

  const handleTagDeselect = (tag: string) => {
    startTransition(() => {
      setActiveFilterType('basic');
      setAdvancedRule('');
      setActiveAdvancedRule('');
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
        setActiveFilterType('advanced');
        setSelectedTags([]);
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
        setActiveFilterType('basic');
        setFilterMode(mode as 'include-or' | 'include-and' | 'exclude');
      });
    }
  };

  const handleSwitchToSimple = () => {
    setIsAdvancedMode(false);
  };

  const handleSwitchToAdvanced = () => {
    setIsAdvancedMode(true);
  };

  const requestSort = (key: keyof ContestNovel) => {
    const sortableKeys: (keyof ContestNovel)[] = ['rank_change', 'view_change', 'View', 'like_to_view_ratio', 'Eps'];
    if (!sortableKeys.includes(key)) {
      return;
    }

    startTransition(() => {
      let direction: 'ascending' | 'descending';
      if (sortConfig && sortConfig.key === key) {
        direction = sortConfig.direction === 'ascending' ? 'descending' : 'ascending';
      } else {
        direction = (['rank_change', 'View', 'view_change', 'like_to_view_ratio'].includes(key)) ? 'descending' : 'ascending';
      }
      setSortConfig({ key, direction });
    });
  };

  const handleDateChange = (newDate: Date | null) => {
    if (newDate && year) {
      navigate(`/contests/${year}/${format(newDate, 'yyyy-MM-dd')}`);
    }
  };

  const handleYearChange = (newYear: string | null) => {
    if (newYear && newYear !== year) {
      navigate(`/contests/${newYear}`);
    }
  };

  // CSS 필터 패널 애니메이션 - showFilters가 false가 되면 300ms 뒤 내부 컨텐츠 언마운트
  useEffect(() => {
    if (!showFilters) {
      const t = setTimeout(() => setShouldRenderFilters(false), 300);
      return () => clearTimeout(t);
    } else {
      startTransition(() => setShouldRenderFilters(true));
    }
  }, [showFilters]);

  const renderTagFilterModeControls = () => (
    <div className="tag-filter-mode-controls">
      <ButtonGroup size="sm">
        <Button variant={!isAdvancedMode ? 'primary' : 'outline-secondary'} onClick={handleSwitchToSimple}>기본</Button>
        <Button variant={isAdvancedMode ? 'primary' : 'outline-secondary'} onClick={handleSwitchToAdvanced}>고급</Button>
      </ButtonGroup>
      <Button variant="outline-secondary" size="sm" className="tag-filter-reset-button" onClick={resetTagFilter}>초기화</Button>
    </div>
  );

  const renderWinnerToggle = (id: string) => (
    <label className="contest-winner-toggle" htmlFor={id}>
      <input
        id={id}
        type="checkbox"
        checked={showOnlyWinners}
        onChange={(event) => startTransition(() => setShowOnlyWinners(event.target.checked))}
      />
      <span className="contest-winner-toggle__track" aria-hidden="true">
        <span className="contest-winner-toggle__thumb" />
      </span>
      <span className="contest-winner-toggle__label">수상작만 보기</span>
    </label>
  );

  // --- 태그 필터 콘텐츠 (사이드바/모바일 공통) ---
  const tagFilterContent = (idSuffix: string) => (
    <div className="tag-filter-content">
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
      {isAdvancedMode && (
        <div className="tag-filter-advanced-mode-pill">고급 쿼리 필터</div>
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
            ref={advancedRuleInputRef} defaultValue={advancedRule}
            onKeyDown={handleAdvancedInputKeyDown}
            isInvalid={!!filterError}
          />
          <div className="tag-filter-advanced-actions">
            <Button variant="primary" size="sm" className="tag-filter-apply-button" onClick={applyAdvancedFilter}>필터 적용</Button>
          </div>
          {filterError && <Alert variant="danger" className="p-2 small mb-0">{filterError}</Alert>}
        </>
      )}
    </div>
  );

  return (
    <div className="page-shell contest-page novel-rankings-page">
      <PageHero
        title="공모전"
        titleAction={
          <Dropdown onSelect={handleYearChange}>
            <Dropdown.Toggle variant="outline-secondary" id="dropdown-year-select" size="sm" className="year-dropdown-toggle contest-year-toggle">
              {year}년
            </Dropdown.Toggle>
            <Dropdown.Menu className="year-dropdown-menu">
              {['2025'].map(y => (
                <Dropdown.Item key={y} eventKey={y} active={y === year}>{y}년</Dropdown.Item>
              ))}
            </Dropdown.Menu>
          </Dropdown>
        }
      />

      {contestShowcaseSection}

      {/* 모바일 컨트롤 바 — page-layout 밖에 배치 */}
      {isMobile && (
        <div className="mobile-controls-bar d-flex align-items-center gap-2 px-2 py-2">
          <CalendarPicker selectedDate={currentDate} onDateChange={handleDateChange} availableDates={availableDates} />
          <Button
            onClick={() => setShowFilters(!showFilters)}
            variant="outline-secondary" size="sm"
            className="d-flex align-items-center gap-1"
          >
            <Funnel size={14} />
            <span>필터</span>
            {showFilters ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
          </Button>
        </div>
      )}

      {/* 모바일 필터 패널 — page-layout 밖에 배치 */}
      {isMobile && (
        <div className={`filter-panel px-2${showFilters ? ' filter-panel--open' : ''}`}>
          <div id="filters-collapse-mobile">
            {(showFilters || shouldRenderFilters) && (
              <div className="p-2 border rounded mt-2">
                <ContestNovelFilterControls onFilterChange={handleFilterChange} />
                <div className="contest-winner-filter contest-winner-filter--mobile">
                  {renderWinnerToggle('winner-switch-mobile')}
                </div>
                <hr className="my-2" />
                <div className="tag-filter-header mb-2">
                  <div className="sidebar-label">태그 필터</div>
                  {renderTagFilterModeControls()}
                </div>
                {tagFilterContent('mobile')}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Page Layout ── */}
      <div className="page-layout novel-rankings-layout contest-rankings-layout">

        {/* ── Desktop Sidebar ── */}
        {!isMobile && (
          <aside className="page-sidebar d-flex flex-column">
            <div className="sidebar-section contest-sidebar-nav-section">
              <Nav variant="pills" className="contest-rank-control-tabs contest-rank-control-tabs--sidebar">
                <Nav.Item>
                  <Nav.Link as={NavLink} to={`/contests/${year}/${dateParam || ''}`} end>소설 랭킹</Nav.Link>
                </Nav.Item>
                <Nav.Item>
                  <Nav.Link as={NavLink} to={`/contests/${year}/tags/rankings/${dateParam || ''}`} end>태그 랭킹</Nav.Link>
                </Nav.Item>
              </Nav>
            </div>

            <div className="sidebar-divider" />

            <div className="sidebar-section">
              <div className="sidebar-label">날짜 선택</div>
              <CalendarPicker selectedDate={currentDate} onDateChange={handleDateChange} availableDates={availableDates} />
            </div>

            <div className="sidebar-divider" />

            <div className="sidebar-section">
              <div className="sidebar-label">검색 / 회차</div>
              <ContestNovelFilterControls onFilterChange={handleFilterChange} />
              <div className="contest-winner-filter">
                {renderWinnerToggle('winner-switch-desktop')}
              </div>
            </div>

            <div className="sidebar-divider" />

            <div className="sidebar-section sidebar-section-tags">
              <div className="tag-filter-header mb-2">
                <div className="sidebar-label">태그 필터</div>
                {renderTagFilterModeControls()}
              </div>
              {tagFilterContent('desktop')}
            </div>

          </aside>
        )}

        {/* ── Main Content ── */}
        <div className="page-main novel-rankings-main">
          {isMobile && (
          <div className="contest-rank-tabs-row">
            <Nav variant="pills" className="contest-rank-control-tabs">
              <Nav.Item>
                <Nav.Link as={NavLink} to={`/contests/${year}/${dateParam || ''}`} end>소설 랭킹</Nav.Link>
              </Nav.Item>
              <Nav.Item>
                <Nav.Link as={NavLink} to={`/contests/${year}/tags/rankings/${dateParam || ''}`} end>태그 랭킹</Nav.Link>
              </Nav.Item>
            </Nav>
          </div>
          )}
          {error && <Alert variant="danger" className="mt-2 flex-shrink-0">{error}</Alert>}
          {loading && <div className="text-center py-5"><Spinner animation="border" /></div>}
          {!loading && !error && novels.length === 0 && <Alert variant="info">데이터가 없습니다.</Alert>}

          {!loading && !error && novels.length > 0 && (
            <div className="ranking-table-region d-flex flex-column" style={{ flex: '1 1 auto', minHeight: 0, position: 'relative', opacity: isPending ? 0.7 : 1 }}>
              {isPending && (
                <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', zIndex: 10 }}>
                  <Spinner animation="border" />
                </div>
              )}

              <PanelCard
                title="전체 랭킹"
                meta="선택한 날짜의 전체 랭킹을 필터와 정렬로 탐색합니다."
                className="ranking-table-panel"
                bodyClassName="ranking-table-panel__body"
              >
                {/* Desktop Table View */}
                {!isMobile && (
                <div ref={tableScrollRef} className="custom-table-wrapper ranking-table-scroll contest-table-scroll d-none d-md-block">
                  <Table hover className="custom-table novel-rankings-table contest-table" style={{ tableLayout: 'fixed' }}>
                  <colgroup>
                    <col style={{ width: '50px' }} />
                    <col style={{ width: '65px' }} />
                    <col style={{ width: '75px' }} />
                    <col style={{ width: '220px' }} />
                    <col style={{ width: '110px' }} />
                    <col style={{ width: '57px' }} />
                    <col style={{ width: '88px' }} />
                    <col style={{ width: '55px' }} />
                    <col style={{ width: '40px' }} />
                    <col style={{ width: '305px' }} />
                  </colgroup>
                  <thead>
                    <tr>
                      <th className="text-center" style={{ fontSize: '0.85rem' }}><div className="d-flex align-items-center justify-content-center"><span>순위</span></div></th>
                      <th onClick={() => requestSort('rank_change')} className="cursor-pointer sortable-header text-center" style={{ fontSize: '0.85rem' }}><div className="d-flex align-items-center justify-content-center"><span>변동</span></div></th>
                      <th style={{ fontSize: '0.85rem', textAlign: 'center' }}><span>수상</span></th>
                      <th style={{ fontSize: '0.85rem', whiteSpace: 'normal' }}><span>제목</span></th>
                      <th style={{ fontSize: '0.85rem', textAlign: 'left', whiteSpace: 'normal' }}><span>작가</span></th>
                      <th onClick={() => requestSort('view_change')} className="cursor-pointer sortable-header" style={{ fontSize: '0.85rem', textAlign: 'left' }}><div className="d-flex align-items-center"><span>조회수</span></div></th>
                      <th onClick={() => requestSort('View')} className="cursor-pointer sortable-header" style={{ fontSize: '0.85rem', textAlign: 'left' }}><div className="d-flex align-items-center"><span>누적 조회수</span></div></th>
                      <th onClick={() => requestSort('like_to_view_ratio')} className="cursor-pointer sortable-header" style={{ fontSize: '0.85rem', textAlign: 'left' }}><div className="d-flex align-items-center"><span>추천비</span></div></th>
                      <th onClick={() => requestSort('Eps')} className="cursor-pointer sortable-header" style={{ fontSize: '0.85rem', textAlign: 'left' }}><div className="d-flex align-items-center"><span>회차</span></div></th>
                      <th style={{ fontSize: '0.85rem', textAlign: 'left' }}>태그</th>
                    </tr>
                  </thead>
                  <tbody>
                    {processedNovels.length > 0 ? (() => {
                      const vItems = tableVirtualizer.getVirtualItems();
                      const paddingTop = vItems[0]?.start ?? 0;
                      const last = vItems[vItems.length - 1];
                      const paddingBottom = last ? tableVirtualizer.getTotalSize() - last.end : 0;
                      return (
                        <>
                          {paddingTop > 0 && <tr><td colSpan={10} style={{ height: paddingTop, padding: 0, border: 'none' }} /></tr>}
                          {vItems.map((vRow) => {
                            const novel = processedNovels[vRow.index];
                            return (
                              <tr key={novel.ID} data-index={vRow.index} ref={tableVirtualizer.measureElement} className={novel.View === -1 ? 'placeholder-row' : ''}>
                                <td className="text-center" style={{ fontSize: '0.9rem' }}>{novel.Rank}</td>
                                <td className="text-center" style={{ fontSize: '0.9rem' }}><RankChangeIndicator value={novel.rank_change} isNew={!!novel.is_new} /></td>
                                <td className="text-center align-middle">{renderAwardBadge(novel.award)}</td>
                                <td style={{ fontSize: '0.9rem', whiteSpace: 'normal', wordBreak: 'break-all' }} className="align-middle">
                                  {novel.View === -1 ? `삭제된 소설 (${novel.ID})` : (
                                    <Link to={`/contests/${year}/novels/${novel.ID}`} className="fw-bold">{novel.Title || '(제목 없음)'}</Link>
                                  )}
                                </td>
                                <td style={{ fontSize: '0.9rem', whiteSpace: 'normal', wordBreak: 'break-all' }}>
                                  {novel.View === -1 ? '-' : (novel.AuthorID && novel.AuthorID !== "0" ? <Link to={`/authors/${novel.AuthorID}`}>{novel.AuthorName || '(작자 미상)'}</Link> : (novel.AuthorName || '(작자 미상)'))}
                                </td>
                                <td style={{ fontSize: '0.9rem' }}>{novel.View === -1 ? '-' : novel.view_change.toLocaleString()}</td>
                                <td style={{ fontSize: '0.9rem' }}>{novel.View === -1 ? '-' : (novel.View != null ? novel.View.toLocaleString() : '-')}</td>
                                <td style={{ fontSize: '0.9rem' }}>{novel.View === -1 ? '-' : `${(novel.like_to_view_ratio * 100).toFixed(2)}%`}</td>
                                <td style={{ fontSize: '0.9rem' }}>{novel.View === -1 ? '-' : (novel.Eps?.toLocaleString() ?? '-')}</td>
                                <td style={{ fontSize: '0.9rem' }}>
                                  <div className="d-flex flex-wrap gap-1">
                                    {(novel.Tags || []).map(tag => (<Button key={tag} variant={selectedTags.includes(tag) ? "primary" : "secondary"} size="sm" className="rounded-pill" onClick={() => handleTagSelect(tag)}>{tag}</Button>))}
                                  </div>
                                </td>
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
                )}

                {/* Mobile Card View */}
                {isMobile && (
                  <div className="d-md-none">
                    <ContestMobileCardList
                      novels={processedNovels}
                      year={year}
                      selectedTags={selectedTags}
                      onTagSelect={handleTagSelect}
                    />
                  </div>
                )}
              </PanelCard>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default ContestPage;
