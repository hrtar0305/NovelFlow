import React, { useState, useEffect, useMemo, useCallback, useRef, useTransition } from 'react';
import { Table, Button, Spinner, OverlayTrigger, Tooltip as BootstrapTooltip, Row, Col, Card, ButtonGroup, Alert, Form, InputGroup } from 'react-bootstrap';
import { ArrowUp, ArrowDown, ArrowDownUp } from 'react-bootstrap-icons';
import { useParams, useNavigate } from 'react-router-dom';
import { format, parseISO, isValid } from 'date-fns';
import { getTagRankingsByDate, getAvailableDates } from '../services/api';
import CalendarPicker from '../components/CalendarPicker';
import TagSearchControl from '../components/TagSearchControl';
import { ResponsiveContainer, ScatterChart, CartesianGrid, XAxis, YAxis, Tooltip as RechartsTooltip, Scatter, Cell } from 'recharts';

// --- TYPE DEFINITIONS ---
interface Tag {
  rank: number;
  tag: string;
  score_linear: number;
  score_inverse: number;
  score_log: number;
  count: number;
  avg_linear: number;
  avg_inverse: number;
  avg_log: number;
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

const ColorLegend = () => (
  <div className="d-flex flex-wrap justify-content-center align-items-center">
    {RANK_COLORS.map((color, index) => (
      <div key={color} className="d-flex align-items-center me-3 mb-2">
        <div style={{ width: '20px', height: '20px', backgroundColor: color, marginRight: '8px', border: '1px solid #ccc' }}></div>
        <span className="text-muted" style={{ fontSize: '0.9rem' }}>{`${index * 10 + 1}-${(index + 1) * 10}위`}</span>
      </div>
    ))}
  </div>
);

const CustomTooltip = ({ active, payload, yAxisKey, yAxisName }: any) => {
  if (active && payload && payload.length) {
    const data = payload[0].payload;
    return (
      <div className="custom-tooltip bg-white p-3 border rounded shadow-sm" style={{ fontSize: '0.9rem' }}>
        <p className="fw-bold mb-1">{data.tag} (랭킹: {data.rank})</p>
        <p className="mb-0 text-muted">등장 횟수: {data.count}</p>
        <p className="mb-2 text-muted">{yAxisName}: {data[yAxisKey].toFixed(2)}</p>
        <hr className="my-1" />
        <p className="mb-0 text-muted small">선형 점수: {data.score_linear.toFixed(2)}</p>
        <p className="mb-0 text-muted small">역순위 점수: {data.score_inverse.toFixed(2)}</p>
        <p className="mb-0 text-muted small">로그 점수: {data.score_log.toFixed(2)}</p>
      </div>
    );
  }
  return null;
};

const CustomScatterShape = React.memo((props: any) => {
    const { cx, cy, fill, payload } = props;
    if (isNaN(cx) || isNaN(cy)) return null;
    
    const className = `scatter-point scatter-point-${CSS.escape(payload.tag)}`;

    return (
        <g className={className}>
            {/* Invisible circle for larger hover area */}
            <circle cx={cx} cy={cy} r={12} fill="transparent" />
            {/* Visible circle */}
            <circle cx={cx} cy={cy} r={6} fill={fill} stroke="rgba(255, 255, 255, 0.7)" strokeWidth={1} />
        </g>
    );
});


// --- MAIN COMPONENT ---
const TagRankingsPage = () => {
  const [tags, setTags] = useState<Tag[]>([]);
  const [date, setDate] = useState<Date | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [availableDatesSet, setAvailableDatesSet] = useState<Set<string>>(new Set());
  const [sortConfig, setSortConfig] = useState<{ key: keyof Tag; direction: 'ascending' | 'descending' }>({ key: 'score_linear', direction: 'descending' });
  const [topN, setTopN] = useState<number>(20);  
  const [searchTerm, setSearchTerm] = useState(''); // Debounced search term
  const activeTagRef = useRef<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const { date: dateParam } = useParams();
  const navigate = useNavigate();

  const handleMouseEnter = useCallback((event: React.MouseEvent<HTMLTableRowElement>) => {
    const tag = event.currentTarget.dataset.tag;
    if (!tag || tag === activeTagRef.current) return;

    if (activeTagRef.current) {
        const prevRow = document.querySelector(`tr[data-tag="${CSS.escape(activeTagRef.current)}"]`);
        if (prevRow) prevRow.classList.remove('highlight-row');
        
        const prevPoint = document.querySelector(`.scatter-point.highlight`);
        if (prevPoint) prevPoint.classList.remove('highlight');
    }
    
    event.currentTarget.classList.add('highlight-row');
    const safeSelector = CSS.escape(tag);
    const point = document.querySelector(`.scatter-point-${safeSelector}`);
    if (point) {
        point.classList.add('highlight');
    }

    activeTagRef.current = tag;
  }, []);

  const handleTableMouseLeave = useCallback(() => {
    if (activeTagRef.current) {
        const prevRow = document.querySelector(`tr[data-tag="${CSS.escape(activeTagRef.current)}"]`);
        if (prevRow) prevRow.classList.remove('highlight-row');

        const prevPoint = document.querySelector(`.scatter-point.highlight`);
        if (prevPoint) prevPoint.classList.remove('highlight');
        
        activeTagRef.current = null;
    }
  }, []);

  const requestSort = (key: keyof Tag) => {
    startTransition(() => {
        const allowedSortKeys: (keyof Tag)[] = ['score_linear', 'avg_linear', 'score_inverse', 'avg_inverse', 'score_log', 'avg_log', 'count'];
        if (!allowedSortKeys.includes(key)) return;
        let direction: 'ascending' | 'descending' = 'descending';
        if (sortConfig.key === key && sortConfig.direction === 'descending') {
          direction = 'ascending';
        }
        setSortConfig({ key, direction });
    });
  };

  const handleSearchChange = useCallback((term: string) => {
    startTransition(() => {
      setSearchTerm(term);
    });
  }, []); // startTransition is stable

  const handleDateChange = (newDate: Date | null) => {
    if (newDate && (!date || format(newDate, 'yyyy-MM-dd') !== format(date, 'yyyy-MM-dd'))) {
      setLoading(true);
      navigate(`/tags/rankings/${format(newDate, 'yyyy-MM-dd')}`);
    }
  };

  useEffect(() => {
    getAvailableDates().then(response => {
      const fetchedDates: string[] = response.data.available_dates || [];
      setAvailableDatesSet(new Set(fetchedDates));
      if (!dateParam && fetchedDates.length > 0) {
        const latestDate = fetchedDates.sort().pop();
        if (latestDate) navigate(`/tags/rankings/${latestDate}`, { replace: true });
      }
    });
  }, [dateParam, navigate]);

  useEffect(() => {
    if (dateParam && isValid(parseISO(dateParam))) {
      setDate(parseISO(dateParam));
    } else if (dateParam) {
        navigate('/tags/rankings', {replace: true});
    }
  }, [dateParam, navigate]);

  useEffect(() => {
    if (!date) return;
    setLoading(true);
    setError(null);
    getTagRankingsByDate(format(date, 'yyyy-MM-dd')).then(response => {
      const data = response.data;
      if (Array.isArray(data)) {
        setTags(data);
      } else {
        setTags([]);
        if (data && data.message) {
          // 데이터가 없다는 메시지는 에러는 아니므로 콘솔에만 표시
          console.log(data.message);
        } else if (data && data.error) {
          setError('태그 랭킹을 불러오는 데 실패했습니다.');
        }
      }
    }).catch(_err => {
      setError('Failed to fetch tag rankings.');
      setTags([]);
    }).finally(() => setLoading(false));
  }, [date]);

  const processedTags = useMemo(() => {
    let sortableItems = tags.map(tag => ({
      ...tag,
      avg_linear: tag.count > 0 ? tag.score_linear / tag.count : 0,
      avg_inverse: tag.count > 0 ? tag.score_inverse / tag.count : 0,
      avg_log: tag.count > 0 ? tag.score_log / tag.count : 0,
    }));
    if (sortConfig.key) {
      sortableItems.sort((a, b) => {
        const aValue = a[sortConfig.key];
        const bValue = b[sortConfig.key];
        if (aValue < bValue) return sortConfig.direction === 'ascending' ? -1 : 1;
        if (aValue > bValue) return sortConfig.direction === 'ascending' ? 1 : -1;
        
        // Secondary sort for stability. To ensure items with the same score have a consistent
        // rank regardless of the sort direction (asc/desc), the tie-breaker sort
        // must be in the opposite direction of the primary sort.
        const tieBreaker = a.tag.localeCompare(b.tag); // A-Z
        return sortConfig.direction === 'ascending' ? -tieBreaker : tieBreaker;
      });
    }
    let rankedItems = sortableItems.map((item, index) => ({
      ...item,
      rank: sortConfig.direction === 'descending' ? index + 1 : sortableItems.length - index,
    }));

    if (searchTerm) {
      const lowercasedTerm = searchTerm.toLowerCase();
      rankedItems = rankedItems.filter(item =>
        item.tag.toLowerCase().includes(lowercasedTerm)
      );
    }

    return rankedItems;
  }, [tags, sortConfig, searchTerm]);

  const chartData = useMemo(() => {
    // 차트 데이터는 항상 '선형 점수'를 기준으로 생성합니다.
    const itemsWithAvgs = tags.map(tag => ({ ...tag, avg_linear: tag.count > 0 ? tag.score_linear / tag.count : 0 }));
    const sortedForChart = [...itemsWithAvgs].sort((a, b) => {
      const aValue = a.score_linear;
      const bValue = b.score_linear;
      if (aValue < bValue) return 1;
      if (aValue > bValue) return -1;
      return a.tag.localeCompare(b.tag);
    });
    const rankedForChart = sortedForChart.map((tag, index) => ({ ...tag, rank: index + 1 }));
    return rankedForChart.slice(0, topN);
  }, [tags, topN]);

  const getSortIndicator = (key: keyof Tag) => {
    if (sortConfig.key !== key) return <ArrowDownUp size={14} className="text-muted" />;
    return sortConfig.direction === 'ascending' ? <ArrowUp size={14} className="text-primary" /> : <ArrowDown size={14} className="text-primary" />;
  };

  const getAxisDomain = (data: number[], padding = 0.1) => {
      if (data.length === 0) return [0, 1];
      const min = Math.min(...data);
      const max = Math.max(...data);
      const pad = (max - min) * padding;
      return [Math.max(0, min - pad), max + pad];
  };

  const topNOptions = [20, 50, 100];

  const xDomain = useMemo(() => getAxisDomain(chartData.map(d => d.count)), [chartData]);
  const yDomain = useMemo(() => getAxisDomain(chartData.map(d => d.avg_linear)), [chartData]);

  return (
    <>
      <style>{`
        .scatter-point > circle {
            transition: r 0.15s ease-in-out, stroke-width 0.15s ease-in-out;
        }
        .scatter-point.highlight > circle {
            r: 10px;
            stroke: black;
            stroke-width: 2.5px;
        }
        tr.highlight-row {
            background-color: #e9ecef !important;
        }
      `}</style>
      <div className="p-4 lg:container mx-auto">
        <div className="mb-3">
          <h1 className="h2 mb-2 ps-0">일간 태그 랭킹</h1>
          <p className="text-muted mb-0">소설 랭킹을 기반으로 태그별 점수를 계산하여 랭킹을 보여줍니다. 날짜를 선택하여 과거 랭킹을 조회할 수 있습니다.</p>
        </div>
        
        <Row className="mb-2 align-items-center">
          <Col sm="auto"><CalendarPicker selectedDate={date} onDateChange={handleDateChange} availableDates={availableDatesSet} /></Col>
          <Col>
            <TagSearchControl onSearchChange={handleSearchChange} />
          </Col>
        </Row>

        {loading && <div className="text-center py-5"><Spinner animation="border" /></div>}
        {error && <Alert variant="danger">{error}</Alert>}
        
        {!loading && !error && (
          <>
            {tags.length > 0 ? (
              <>
                <div className="custom-table-wrapper mb-2" style={{ position: 'relative', backgroundColor: 'white', maxHeight: '500px', overflowY: 'auto', opacity: isPending ? 0.7 : 1 }}>
                  {isPending && (
                    <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', zIndex: 10 }}>
                      <Spinner animation="border" />
                    </div>
                  )}
                  <Table hover className="custom-table">
                    <thead style={{ position: 'sticky', top: 0, zIndex: 1, backgroundColor: 'white' }}>
                      <tr>
                        <th style={{ fontSize: '0.85rem', width: '100px' }}>
                          <div className="d-flex align-items-center justify-content-start gap-1"><span>순위</span></div>
                        </th>
                        <th style={{ fontSize: '0.85rem' }}>태그</th>
                        <OverlayTrigger placement="top" overlay={<BootstrapTooltip>'전체 순위 - 순위 + 1'로 계산하여, 모든 순위에 동등한 가중치를 부여하는 방식입니다.</BootstrapTooltip>}><th onClick={() => requestSort('score_linear')} className="cursor-pointer sortable-header" style={{ fontSize: '0.85rem', width: '160px' }}>
                          <div className="d-flex align-items-center justify-content-start gap-1"><span>선형 점수</span>{getSortIndicator('score_linear')}</div>
                        </th></OverlayTrigger>
                        <OverlayTrigger placement="top" overlay={<BootstrapTooltip>'선형 점수 / 등장 횟수'로 계산하여, 평균적인 값을 보여주는 방식입니다.</BootstrapTooltip>}><th onClick={() => requestSort('avg_linear')} className="cursor-pointer sortable-header" style={{ fontSize: '0.85rem', width: '160px' }}>
                          <div className="d-flex align-items-center justify-content-start gap-1"><span>평균 선형 점수</span>{getSortIndicator('avg_linear')}</div>
                        </th></OverlayTrigger>
                        <OverlayTrigger placement="top" overlay={<BootstrapTooltip>'1 / 순위'로 계산하여, 1위에 가까울수록 기하급수적으로 높은 가중치를 부여하는 방식입니다.</BootstrapTooltip>}><th onClick={() => requestSort('score_inverse')} className="cursor-pointer sortable-header" style={{ fontSize: '0.85rem', width: '160px' }}>
                          <div className="d-flex align-items-center justify-content-start gap-1"><span>역순위 점수</span>{getSortIndicator('score_inverse')}</div>
                        </th></OverlayTrigger>
                        <OverlayTrigger placement="top" overlay={<BootstrapTooltip>'역순위 점수 / 등장 횟수'로 계산하여, 평균적인 값을 보여주는 방식입니다.</BootstrapTooltip>}><th onClick={() => requestSort('avg_inverse')} className="cursor-pointer sortable-header" style={{ fontSize: '0.85rem', width: '160px' }}>
                          <div className="d-flex align-items-center justify-content-start gap-1"><span>평균 역순위 점수</span>{getSortIndicator('avg_inverse')}</div>
                        </th></OverlayTrigger>
                        <OverlayTrigger placement="top" overlay={<BootstrapTooltip>'1 / ln(순위 + 1)'로 계산하여, 상위권에 완만한 가중치를 부여해 점수 격차를 줄인 방식입니다.</BootstrapTooltip>}><th onClick={() => requestSort('score_log')} className="cursor-pointer sortable-header" style={{ fontSize: '0.85rem', width: '160px' }}>
                          <div className="d-flex align-items-center justify-content-start gap-1"><span>로그 점수</span>{getSortIndicator('score_log')}</div>
                        </th></OverlayTrigger>
                        <OverlayTrigger placement="top" overlay={<BootstrapTooltip>'로그 점수 / 등장 횟수'로 계산하여, 평균적인 값을 보여주는 방식입니다.</BootstrapTooltip>}><th onClick={() => requestSort('avg_log')} className="cursor-pointer sortable-header" style={{ fontSize: '0.85rem', width: '160px' }}>
                          <div className="d-flex align-items-center justify-content-start gap-1"><span>평균 로그 점수</span>{getSortIndicator('avg_log')}</div>
                        </th></OverlayTrigger>
                        <OverlayTrigger placement="top" overlay={<BootstrapTooltip>순위와 무관하게, 랭킹 내에 등장한 횟수를 그대로 집계하는 방식입니다.</BootstrapTooltip>}><th onClick={() => requestSort('count')} className="cursor-pointer sortable-header" style={{ fontSize: '0.85rem', width: '160px' }}>
                          <div className="d-flex align-items-center justify-content-start gap-1"><span>등장 횟수</span>{getSortIndicator('count')}</div>
                        </th></OverlayTrigger>
                      </tr>
                    </thead>
                    <tbody onMouseLeave={handleTableMouseLeave}>
                      {processedTags.length > 0 ? (
                        processedTags.map((tag: Tag) => (
                            <tr key={tag.tag} data-tag={tag.tag} onMouseEnter={handleMouseEnter} style={{ cursor: 'pointer' }}>
                              <td style={{ fontSize: '0.9rem' }}>{tag.rank}</td>
                              <td className="fw-bold" style={{ fontSize: '0.9rem' }}>{tag.tag}</td>
                              <td style={{ fontSize: '0.9rem' }}>{tag.score_linear.toFixed(2)}</td>
                              <td style={{ fontSize: '0.9rem' }}>{tag.avg_linear.toFixed(2)}</td>
                              <td style={{ fontSize: '0.9rem' }}>{tag.score_inverse.toFixed(2)}</td>
                              <td style={{ fontSize: '0.9rem' }}>{tag.avg_inverse.toFixed(2)}</td>
                              <td style={{ fontSize: '0.9rem' }}>{tag.score_log.toFixed(2)}</td>
                              <td style={{ fontSize: '0.9rem' }}>{tag.avg_log.toFixed(2)}</td>
                              <td style={{ fontSize: '0.9rem' }}>{tag.count}</td>
                            </tr>
                          ))
                      ) : (
                        <tr><td colSpan={9} className="text-center py-4">검색 결과가 없습니다.</td></tr>
                      )}
                    </tbody>
                  </Table>
                </div>
    
                <Card>
                  <Card.Header>
                    <Row className="align-items-center">
                      <Col><h5 className="mb-0">태그 포지셔닝 맵</h5></Col>
                      <Col xs="auto"><span className="text-muted small">*선형 점수 기준</span></Col>
                      <Col xs="auto">
                        <ButtonGroup size="sm">
                          {topNOptions.map((option: number) => (
                            <Button key={option} variant={topN === option ? 'primary' : 'outline-secondary'} onClick={() => setTopN(option)}>{`Top ${option}`}</Button>
                          ))}
                        </ButtonGroup>
                      </Col>
                    </Row>
                  </Card.Header>
                  <Card.Body>
                    <ResponsiveContainer width="100%" height={400}>
                        <ScatterChart margin={{ top: 20, right: 20, bottom: 20, left: 0 }}>
                            <CartesianGrid />
                            <XAxis type="number" dataKey="count" name="등장 횟수" unit="회" domain={xDomain} allowDecimals={false} />
                            <YAxis type="number" dataKey="avg_linear" name="평균 선형 점수" domain={yDomain} allowDecimals={false} />
                            <RechartsTooltip cursor={{ strokeDasharray: '3 3' }} content={<CustomTooltip yAxisKey="avg_linear" yAxisName="평균 선형 점수" />} />
                            <Scatter name="Tags" data={chartData} shape={<CustomScatterShape />} isAnimationActive={false}>
                                {chartData.map((entry) => <Cell key={`cell-${entry.tag}`} fill={getColorByRank(entry.rank)} />)}
                            </Scatter>
                        </ScatterChart>
                    </ResponsiveContainer>
                    <ColorLegend />
                  </Card.Body>
                </Card>
              </>
            ) : (
              <Alert variant="info" className="text-center mt-3">해당 날짜에 대한 태그 랭킹 데이터가 없습니다.</Alert>
            )}
          </>
        )}
      </div>
    </>
  );
};

export default TagRankingsPage;