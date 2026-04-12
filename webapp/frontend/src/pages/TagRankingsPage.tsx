import React, { useState, useEffect, useMemo, useCallback, useRef, useTransition } from 'react';
import { Table, Button, Spinner, OverlayTrigger, Tooltip as BootstrapTooltip, Row, Col, Card, ButtonGroup, Alert, Badge } from 'react-bootstrap';
import { ArrowUp, ArrowDown, ArrowDownUp, InfoCircle, GraphUp } from 'react-bootstrap-icons';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { format, parseISO, isValid } from 'date-fns';
import { getTagRankingsByDate, getAvailableDates } from '../services/api';
import CalendarPicker from '../components/CalendarPicker';
import TagSearchControl from '../components/TagSearchControl';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, Cell, LabelList } from 'recharts';

// --- TYPE DEFINITIONS ---
interface Tag {
  Rank: number;
  tag: string;
  power_score: number;
  local_lift?: number | null;
  count: number;
  rank_change?: number | 'New' | null;
}

// --- HELPER FUNCTIONS & CONSTANTS ---
const RANK_COLORS = [
  '#fb8072', '#fdb462', '#ffed6f', '#b3de69', '#80b1d3',
  '#bebada', '#fccde5', '#8dd3c7', '#ccebc5', '#bc80bd'
];

const getColorByRank = (rank: number) => {
  const index = Math.floor((rank - 1) / 10);
  return RANK_COLORS[index] || RANK_COLORS[RANK_COLORS.length - 1];
};

const RankChangeBadge = ({ rankChange }: { rankChange?: number | 'New' | null }) => {
  if (rankChange === null || rankChange === undefined) return null;
  if (rankChange === 'New') return <Badge bg="success" style={{ fontSize: '0.75rem' }}>NEW</Badge>;
  if (rankChange === 0) return <span className="text-muted" style={{ fontSize: '0.8rem' }}>-</span>;
  if (rankChange > 0) return <span className="text-success fw-bold" style={{ fontSize: '0.85rem' }}>▲{rankChange}</span>;
  return <span className="text-danger fw-bold" style={{ fontSize: '0.85rem' }}>▼{Math.abs(rankChange as number)}</span>;
};

const LocalLiftCell = ({ lift }: { lift?: number | null }) => {
  if (lift === null || lift === undefined) {
    return (
      <OverlayTrigger placement="top" overlay={<BootstrapTooltip>등장 5회 미만이거나 이전 수집 데이터입니다.</BootstrapTooltip>}>
        <span className="text-muted">-</span>
      </OverlayTrigger>
    );
  }
  // 1.0 기준으로 색상 구분: 상위권 집중(green), 평균(muted), 하위권 분산(red)
  const color = lift >= 1.5 ? 'text-success fw-bold' : lift >= 1.0 ? '' : 'text-danger';
  return <span className={color}>{lift.toFixed(2)}</span>;
};

const CustomBarTooltip = ({ active, payload }: any) => {
  if (active && payload && payload.length) {
    const data = payload[0].payload;
    return (
      <div className="custom-tooltip" style={{ fontSize: '0.9rem' }}>
        <p className="fw-bold mb-1">{data.tag} ({data.Rank}위)</p>
        <p className="mb-0 text-muted">파워 스코어: {data.power_score.toFixed(2)}</p>
        <p className="mb-0 text-muted">등장 횟수: {data.count}회</p>
        {data.local_lift != null && (
          <p className="mb-0 text-muted">로컬 리프트: {data.local_lift.toFixed(2)}</p>
        )}
      </div>
    );
  }
  return null;
};

// --- MAIN COMPONENT ---
const TagRankingsPage = () => {
  const [tags, setTags] = useState<Tag[]>([]);
  const [date, setDate] = useState<Date | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [availableDatesSet, setAvailableDatesSet] = useState<Set<string>>(new Set());
  const [sortConfig, setSortConfig] = useState<{ key: keyof Tag; direction: 'ascending' | 'descending' }>({ key: 'power_score', direction: 'descending' });
  const [topN, setTopN] = useState<number>(20);
  const [searchTerm, setSearchTerm] = useState('');
  const [mobileViewMode, setMobileViewMode] = useState<'card' | 'table'>('card');
  const [isPending, startTransition] = useTransition();
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);
  const [chartHeight, setChartHeight] = useState(400);
  const hasFetchedDates = useRef(false);
  const activeTagRef = useRef<string | null>(null);

  const { date: dateParam } = useParams();
  const navigate = useNavigate();

  useEffect(() => {
    const handleResize = () => {
      const mobile = window.innerWidth < 768;
      setIsMobile(mobile);
      setChartHeight(mobile ? 180 : Math.max(200, Math.min(500, window.innerHeight * 0.30)));
    };
    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const handleMouseEnter = useCallback((event: React.MouseEvent<HTMLTableRowElement>) => {
    const tag = event.currentTarget.dataset.tag;
    if (!tag || tag === activeTagRef.current) return;
    if (activeTagRef.current) {
      document.querySelector(`tr[data-tag="${CSS.escape(activeTagRef.current)}"]`)?.classList.remove('highlight-row');
    }
    event.currentTarget.classList.add('highlight-row');
    activeTagRef.current = tag;
  }, []);

  const handleTableMouseLeave = useCallback(() => {
    if (activeTagRef.current) {
      document.querySelector(`tr[data-tag="${CSS.escape(activeTagRef.current)}"]`)?.classList.remove('highlight-row');
      activeTagRef.current = null;
    }
  }, []);

  const requestSort = (key: keyof Tag) => {
    startTransition(() => {
      const allowedSortKeys: (keyof Tag)[] = ['power_score', 'local_lift', 'count'];
      if (!allowedSortKeys.includes(key)) return;
      let direction: 'ascending' | 'descending' = 'descending';
      if (sortConfig.key === key && sortConfig.direction === 'descending') direction = 'ascending';
      setSortConfig({ key, direction });
    });
  };

  const handleSearchChange = useCallback((term: string) => {
    startTransition(() => setSearchTerm(term));
  }, []);

  const handleDateChange = (newDate: Date | null) => {
    if (newDate && (!date || format(newDate, 'yyyy-MM-dd') !== format(date, 'yyyy-MM-dd'))) {
      navigate(`/tags/rankings/${format(newDate, 'yyyy-MM-dd')}`);
    }
  };

  useEffect(() => {
    if (hasFetchedDates.current) return;
    hasFetchedDates.current = true;
    const fetchAvailableDates = async () => {
      try {
        const response = await getAvailableDates();
        const fetchedDates: string[] = response.data.available_dates || [];
        setAvailableDatesSet(new Set(fetchedDates));
      } catch (err) {
        setError("조회 가능한 날짜 목록을 불러오는 데 실패했습니다.");
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
          setDate(parseISO(dateParam));
          const response = await getTagRankingsByDate(dateParam);
          setTags(response.data || []);
        } catch (_err) {
          setError('태그 랭킹을 불러오는 데 실패했습니다.');
          setTags([]);
        } finally {
          setLoading(false);
        }
      };
      fetchRankings();
    } else {
      const latestDate = Array.from(availableDatesSet)[0];
      if (latestDate) navigate(`/tags/rankings/${latestDate}`, { replace: true });
    }
  }, [dateParam, navigate, availableDatesSet]);

  const processedTags = useMemo(() => {
    let sortableItems = [...tags];
    if (sortConfig.key) {
      sortableItems.sort((a, b) => {
        const aValue = (a[sortConfig.key] ?? -Infinity) as number;
        const bValue = (b[sortConfig.key] ?? -Infinity) as number;
        if (aValue < bValue) return sortConfig.direction === 'ascending' ? -1 : 1;
        if (aValue > bValue) return sortConfig.direction === 'ascending' ? 1 : -1;
        const tieBreaker = a.tag.localeCompare(b.tag);
        return sortConfig.direction === 'ascending' ? -tieBreaker : tieBreaker;
      });
    }
    let rankedItems = sortableItems.map((item, index) => ({
      ...item,
      Rank: sortConfig.direction === 'descending' ? index + 1 : sortableItems.length - index,
    }));
    if (searchTerm) {
      const lowercasedTerm = searchTerm.toLowerCase();
      rankedItems = rankedItems.filter(item => item.tag.toLowerCase().includes(lowercasedTerm));
    }
    return rankedItems;
  }, [tags, sortConfig, searchTerm]);

  // 바 차트용: power_score 기준 상위 N개 (역순으로 slice — 차트는 아래→위 방향)
  const chartData = useMemo(() => {
    const sorted = [...tags].sort((a, b) => b.power_score - a.power_score || a.tag.localeCompare(b.tag));
    const ranked = sorted.map((tag, index) => ({ ...tag, Rank: index + 1 }));
    return ranked.slice(0, topN).reverse();
  }, [tags, topN]);

  const getSortIndicator = (key: keyof Tag) => {
    if (sortConfig.key !== key) return <ArrowDownUp size={14} className="text-muted" />;
    return sortConfig.direction === 'ascending' ? <ArrowUp size={14} className="text-primary" /> : <ArrowDown size={14} className="text-primary" />;
  };

  const topNOptions = [20, 50, 100];
  const yAxisWidth = isMobile ? 70 : 90;
  const barChartHeight = Math.max(200, chartData.length * 24);

  return (
    <>
      <div className="np-page-container d-flex flex-column" style={{ height: 'calc(100dvh - 56px)' }}>
        <div className="d-flex align-items-center gap-2 mb-2">
          <h1 className="h2 mb-0 fs-page-title">태그 랭킹</h1>
          <OverlayTrigger
            placement="bottom"
            overlay={<BootstrapTooltip id="ranking-description-tooltip">소설 랭킹 데이터를 기반으로 태그별 점수를 계산합니다.</BootstrapTooltip>}
          >
            <span className="d-md-none page-banner-info-icon" style={{ cursor: 'pointer' }}>
              <InfoCircle />
            </span>
          </OverlayTrigger>
        </div>
        <p className="text-muted mb-3 d-none d-md-block">소설 랭킹을 기반으로 태그별 파워 스코어와 로컬 리프트를 계산하여 랭킹을 보여줍니다.</p>

        <Row className="mb-1 align-items-center justify-content-between mobile-ranking-controls-row">
          <Col xs="auto" className="d-flex align-items-center gap-2">
            <CalendarPicker selectedDate={date} onDateChange={handleDateChange} availableDates={availableDatesSet} />
            <Link to="/trends/tags" className="btn btn-sm btn-outline-secondary d-none d-md-inline-flex align-items-center gap-1">
              <GraphUp size={14} />
              트렌드 분석
            </Link>
          </Col>
          <Col xs="auto" className="d-md-none">
            <ButtonGroup size="sm">
              <Button variant={mobileViewMode === 'card' ? 'primary' : 'outline-secondary'} onClick={() => setMobileViewMode('card')}>요약</Button>
              <Button variant={mobileViewMode === 'table' ? 'primary' : 'outline-secondary'} onClick={() => setMobileViewMode('table')}>상세</Button>
            </ButtonGroup>
          </Col>
        </Row>

        <div className="mb-1" style={{ maxWidth: '400px' }}>
          <TagSearchControl onSearchChange={handleSearchChange} />
        </div>

        {loading && <div className="text-center py-5"><Spinner animation="border" /></div>}
        {error && <Alert variant="danger">{error}</Alert>}

        {!loading && !error && (
          tags.length > 0 ? (
            <div className="d-flex flex-column" style={{ flex: '1 1 auto', minHeight: 0 }}>

              {/* Mobile Card View */}
              <div className="d-md-none">
                {mobileViewMode === 'card' && (
                  <div className="p-1">
                    {processedTags.map((tag) => (
                      <Card key={tag.tag} className="mb-2 shadow-sm">
                        <Card.Body className="p-2">
                          <div className="d-flex justify-content-between align-items-center">
                            <div className="flex-grow-1 me-2">
                              <div className="d-flex align-items-baseline gap-2">
                                <span className="fw-bold text-primary text-nowrap" style={{ fontSize: '1rem' }}>{tag.Rank}위</span>
                                <h5 className="mb-0 h6">{tag.tag}</h5>
                                <RankChangeBadge rankChange={tag.rank_change} />
                              </div>
                            </div>
                            <div className="flex-shrink-0 text-end" style={{ minWidth: '65px' }}>
                              <div className="text-muted small">파워 스코어</div>
                              <div className="fw-bold">{tag.power_score.toFixed(1)}</div>
                            </div>
                            <div className="flex-shrink-0 text-end ms-3" style={{ minWidth: '60px' }}>
                              <div className="text-muted small">등장 횟수</div>
                              <div className="fw-bold">{tag.count}회</div>
                            </div>
                          </div>
                        </Card.Body>
                      </Card>
                    ))}
                  </div>
                )}
              </div>

              <div className={`${mobileViewMode === 'table' ? 'd-flex' : 'd-none d-md-flex'} flex-column flex-grow-1`} style={{ minHeight: 0 }}>
                {/* Table */}
                <div className="custom-table-wrapper mb-2" style={{ position: 'relative', flex: '1 1 auto', minHeight: 0, overflowY: 'auto', opacity: isPending ? 0.7 : 1, display: 'flex', flexDirection: 'column' }}>
                  {isPending && <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', zIndex: 10 }}><Spinner animation="border" /></div>}
                  <Table responsive="md" hover className="custom-table">
                    <thead>
                      <tr>
                        <th style={{ fontSize: '0.85rem', width: '80px' }}>순위</th>
                        <th style={{ fontSize: '0.85rem' }}>태그</th>
                        <th style={{ fontSize: '0.85rem', width: '70px' }}>변동</th>
                        <OverlayTrigger placement="top" overlay={<BootstrapTooltip>Σ 1/ln(순위+1) — 빈도와 순위 품질이 결합된 시장 지배력 지표입니다.</BootstrapTooltip>}>
                          <th onClick={() => requestSort('power_score')} className="cursor-pointer sortable-header" style={{ fontSize: '0.85rem', width: '130px' }}>
                            <div className="d-flex align-items-center gap-1"><span>파워 스코어</span>{getSortIndicator('power_score')}</div>
                          </th>
                        </OverlayTrigger>
                        <OverlayTrigger placement="top" overlay={<BootstrapTooltip>상위 100위 비율 ÷ 하위 400위 비율. 1.0 초과면 상위권에 집중된 태그, 1.5 이상이면 강한 신흥 트렌드 신호입니다. 등장 5회 미만이거나 이전 수집 데이터는 표시되지 않습니다.</BootstrapTooltip>}>
                          <th onClick={() => requestSort('local_lift')} className="cursor-pointer sortable-header" style={{ fontSize: '0.85rem', width: '120px' }}>
                            <div className="d-flex align-items-center gap-1"><span>로컬 리프트</span>{getSortIndicator('local_lift')}</div>
                          </th>
                        </OverlayTrigger>
                        <OverlayTrigger placement="top" overlay={<BootstrapTooltip>순위와 무관하게 상위 500위 내에 등장한 횟수입니다.</BootstrapTooltip>}>
                          <th onClick={() => requestSort('count')} className="cursor-pointer sortable-header" style={{ fontSize: '0.85rem', width: '110px' }}>
                            <div className="d-flex align-items-center gap-1"><span>등장 횟수</span>{getSortIndicator('count')}</div>
                          </th>
                        </OverlayTrigger>
                      </tr>
                    </thead>
                    <tbody onMouseLeave={handleTableMouseLeave}>
                      {processedTags.map((tag: Tag) => (
                        <tr key={tag.tag} data-tag={tag.tag} onMouseEnter={handleMouseEnter} style={{ cursor: 'pointer' }}>
                          <td style={{ fontSize: '0.9rem' }}>{tag.Rank}</td>
                          <td className="fw-bold" style={{ fontSize: '0.9rem' }}>{tag.tag}</td>
                          <td style={{ fontSize: '0.9rem' }}><RankChangeBadge rankChange={tag.rank_change} /></td>
                          <td style={{ fontSize: '0.9rem' }}>{tag.power_score.toFixed(2)}</td>
                          <td style={{ fontSize: '0.9rem' }}><LocalLiftCell lift={tag.local_lift} /></td>
                          <td style={{ fontSize: '0.9rem' }}>{tag.count}회</td>
                        </tr>
                      ))}
                    </tbody>
                  </Table>
                </div>

                {/* 가로 막대 차트 */}
                <div style={{ flexShrink: 0 }}>
                  <Card>
                    <Card.Header>
                      <Row className="align-items-center g-2">
                        <Col><h5 className={`mb-0 ${isMobile ? 'h6' : ''}`}>태그 인기 순위</h5></Col>
                        {!isMobile && <Col xs="auto"><span className="text-muted" style={{ fontSize: '0.875rem' }}>*파워 스코어 기준</span></Col>}
                        <Col xs="auto">
                          <ButtonGroup size="sm">
                            {topNOptions.map(option => (
                              <Button
                                key={option}
                                variant={topN === option ? 'primary' : 'outline-secondary'}
                                onClick={() => setTopN(option)}
                                style={{ fontSize: isMobile ? '0.75rem' : undefined, padding: isMobile ? '0.2rem 0.4rem' : undefined }}
                              >{`Top ${option}`}</Button>
                            ))}
                          </ButtonGroup>
                        </Col>
                      </Row>
                    </Card.Header>
                    <Card.Body style={{ overflowY: 'auto', maxHeight: `${chartHeight}px` }}>
                      <ResponsiveContainer width="100%" height={barChartHeight}>
                        <BarChart
                          data={chartData}
                          layout="vertical"
                          margin={isMobile ? { top: 0, right: 40, bottom: 0, left: 0 } : { top: 0, right: 60, bottom: 0, left: 0 }}
                        >
                          <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                          <XAxis type="number" tick={{ fontSize: isMobile ? 11 : 12 }} />
                          <YAxis type="category" dataKey="tag" width={yAxisWidth} tick={{ fontSize: isMobile ? 11 : 12 }} />
                          <RechartsTooltip content={<CustomBarTooltip />} cursor={{ fill: 'rgba(200,200,200,0.15)' }} />
                          <Bar dataKey="power_score" name="파워 스코어" isAnimationActive={false}>
                            <LabelList
                              dataKey="count"
                              position="right"
                              formatter={(v: number) => `${v}회`}
                              style={{ fontSize: isMobile ? 10 : 11, fill: 'var(--bs-secondary)' }}
                            />
                            {chartData.map((entry) => (
                              <Cell key={`cell-${entry.tag}`} fill={getColorByRank(entry.Rank)} />
                            ))}
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    </Card.Body>
                  </Card>
                </div>
              </div>
            </div>
          ) : (
            <Alert variant="info" className="text-center mt-3">해당 날짜에 대한 태그 랭킹 데이터가 없습니다.</Alert>
          )
        )}
      </div>
    </>
  );
};

export default TagRankingsPage;
