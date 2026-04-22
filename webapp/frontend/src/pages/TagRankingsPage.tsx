import React, { useState, useEffect, useMemo, useCallback, useRef, useTransition } from 'react';
import { Table, Button, Spinner, OverlayTrigger, Tooltip as BootstrapTooltip, Card, ButtonGroup, Alert, Badge } from 'react-bootstrap';
import { InfoCircle } from 'react-bootstrap-icons';
import { useParams, useNavigate } from 'react-router-dom';
import { format, parseISO, isValid } from 'date-fns';
import { getTagRankingsByDate, getAvailableDates } from '../services/api';
import CalendarPicker from '../components/CalendarPicker';
import TagSearchControl from '../components/TagSearchControl';
import { useIsMobile } from '../hooks/useIsMobile';
import { ResponsiveContainer, ScatterChart, Scatter, XAxis, YAxis, ZAxis, CartesianGrid, Tooltip as RechartsTooltip } from 'recharts';

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
const RankChangeBadge = ({ rankChange }: { rankChange?: number | 'New' | null }) => {
  if (rankChange === null || rankChange === undefined) return null;
  if (rankChange === 'New') return <Badge bg="success" style={{ fontSize: '0.75rem' }}>NEW</Badge>;
  if (rankChange === 0) return <span className="text-muted" style={{ fontSize: '0.9rem' }}>-</span>;
  if (rankChange > 0) return <span className="text-success fw-bold" style={{ fontSize: '0.9rem' }}>▲{rankChange}</span>;
  return <span className="text-danger fw-bold" style={{ fontSize: '0.9rem' }}>▼{Math.abs(rankChange as number)}</span>;
};

const getRankChangeColor = (rankChange?: number | 'New' | null) => {
  if (rankChange === 'New') return '#0d6efd';
  if (rankChange === null || rankChange === undefined || rankChange === 0) return '#6c757d';
  return rankChange > 0 ? '#198754' : '#dc3545';
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

const CustomScatterTooltip = ({ active, payload }: any) => {
  if (active && payload && payload.length) {
    const data = payload[0].payload;
    const rc = data.rank_change;
    const rcText = rc === 'New' ? 'NEW'
      : rc === null || rc === undefined ? '-'
      : rc === 0 ? '-'
      : rc > 0 ? `▲${rc}` : `▼${Math.abs(rc)}`;
    return (
      <div className="custom-tooltip" style={{ fontSize: '0.85rem', background: 'var(--bs-body-bg)', border: '1px solid var(--bs-border-color)', padding: '0.5rem 0.75rem', borderRadius: '0.25rem' }}>
        <p className="fw-bold mb-1">{data.tag}</p>
        <p className="mb-0 text-muted">인기 점수: {data.power_score.toFixed(2)}</p>
        <p className="mb-0 text-muted">상위권 집중도: {data.local_lift != null ? data.local_lift.toFixed(2) : '-'}</p>
        <p className="mb-0 text-muted">등장 횟수: {data.count}회</p>
        <p className="mb-0 text-muted">변동: {rcText}</p>
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
  const [searchTerm, setSearchTerm] = useState('');
  const [isPending, startTransition] = useTransition();
  const [scatterTopN, setScatterTopN] = useState<number>(50);
  const hasFetchedDates = useRef(false);
  const activeTagRef = useRef<string | null>(null);
  const scatterContainerRef = useRef<HTMLDivElement | null>(null);

  const { date: dateParam } = useParams();
  const navigate = useNavigate();
  const isMobile = useIsMobile();

  // 하이라이트를 React state가 아닌 DOM 직접 조작으로 처리 (차트 리렌더 방지 → x축 flicker 제거)
  const highlightScatterPoint = (tag: string | null) => {
    const root = scatterContainerRef.current;
    if (!root) return;
    // 이전 하이라이트 원복
    const prev = root.querySelector<SVGCircleElement>('circle[data-tag-hovered="true"]');
    if (prev) {
      prev.setAttribute('data-tag-hovered', 'false');
      prev.setAttribute('stroke', 'rgba(0,0,0,0.15)');
      prev.setAttribute('fill-opacity', '0.6');
    }
    if (tag) {
      const selector = `circle[data-tag="${CSS.escape(tag)}"]`;
      const next = root.querySelector<SVGCircleElement>(selector);
      if (next) {
        next.setAttribute('data-tag-hovered', 'true');
        next.setAttribute('stroke', '#e5eaf0');
        next.setAttribute('fill-opacity', '0.85');
      }
    }
  };

  const handleMouseEnter = useCallback((event: React.MouseEvent<HTMLTableRowElement>) => {
    const tag = event.currentTarget.dataset.tag;
    if (!tag || tag === activeTagRef.current) return;
    if (activeTagRef.current) {
      document.querySelector(`tr[data-tag="${CSS.escape(activeTagRef.current)}"]`)?.classList.remove('highlight-row');
    }
    event.currentTarget.classList.add('highlight-row');
    activeTagRef.current = tag;
    highlightScatterPoint(tag);
  }, []);

  const handleTableMouseLeave = useCallback(() => {
    if (activeTagRef.current) {
      document.querySelector(`tr[data-tag="${CSS.escape(activeTagRef.current)}"]`)?.classList.remove('highlight-row');
      activeTagRef.current = null;
    }
    highlightScatterPoint(null);
  }, []);

  const requestSort = (key: keyof Tag) => {
    startTransition(() => {
      const allowedSortKeys: (keyof Tag)[] = ['power_score', 'local_lift', 'count', 'rank_change'];
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
        if (sortConfig.key === 'rank_change') {
          const getSortableValue = (val: Tag['rank_change']) => {
            if (val === 'New') return Infinity;
            if (typeof val === 'number') return val;
            return -Infinity;
          };
          const valA = getSortableValue(a.rank_change);
          const valB = getSortableValue(b.rank_change);
          if (valA < valB) return sortConfig.direction === 'ascending' ? -1 : 1;
          if (valA > valB) return sortConfig.direction === 'ascending' ? 1 : -1;
          const tieBreaker = a.tag.localeCompare(b.tag);
          return sortConfig.direction === 'ascending' ? -tieBreaker : tieBreaker;
        }
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

  // 산점도 데이터: local_lift 있는 태그 중 power_score 상위 N개
  const scatterData = useMemo(() => {
    return tags
      .filter(t => t.local_lift != null)
      .sort((a, b) => b.power_score - a.power_score)
      .slice(0, scatterTopN)
      .map(t => ({
        ...t,
        lift: t.local_lift as number,
      }));
  }, [tags, scatterTopN]);

  const countDomain = useMemo(() => {
    if (scatterData.length === 0) return [1, 1] as [number, number];
    const counts = scatterData.map(d => d.count);
    return [Math.min(...counts), Math.max(...counts)] as [number, number];
  }, [scatterData]);

  // 커스텀 shape: 의존성 없는 stable 함수. data-tag 속성으로 DOM에서 직접 하이라이트 조작
  const scatterShape = useCallback((props: any) => {
    const { cx, cy, payload, node } = props;
    if (cx == null || cy == null || !payload) return <g />;
    const rawSize = (props.size ?? node?.z ?? 200) as number;
    const r = Math.max(3, Math.sqrt(Math.abs(rawSize) / Math.PI));
    return (
      <circle
        cx={cx}
        cy={cy}
        r={r}
        fill={getRankChangeColor(payload.rank_change)}
        fillOpacity={0.6}
        stroke="rgba(0,0,0,0.15)"
        strokeWidth={1.5}
        data-tag={payload.tag}
        data-tag-hovered="false"
      />
    );
  }, []);

  const scatterTopNOptions = [30, 50, 100];

  return (
    <div className="page-height-manager">
      <div className="page-banner">
        <div className="page-banner-inner">
          <div className="d-flex align-items-center gap-2">
            <h1 className="page-banner-title mb-0">태그 랭킹</h1>
            <OverlayTrigger
              placement="bottom"
              overlay={<BootstrapTooltip id="ranking-description-tooltip">소설 랭킹을 기반으로 태그별 인기 점수와 상위권 집중도를 계산하여 랭킹을 보여줍니다.</BootstrapTooltip>}
            >
              <span className="d-md-none page-banner-info-icon" style={{ cursor: 'pointer' }}>
                <InfoCircle />
              </span>
            </OverlayTrigger>
          </div>
          <p className="page-banner-desc d-none d-md-block">소설 랭킹을 기반으로 태그별 인기 점수와 상위권 집중도를 계산하여 랭킹을 보여줍니다.</p>
        </div>
      </div>

      {isMobile && (
        <>
          <div className="mobile-controls-bar d-flex align-items-center gap-2 px-2 py-2">
            <CalendarPicker selectedDate={date} onDateChange={handleDateChange} availableDates={availableDatesSet} />
          </div>
          <div className="tag-ranking-mobile-search">
            <TagSearchControl onSearchChange={handleSearchChange} />
          </div>
        </>
      )}

      {loading && <div className="text-center py-5"><Spinner animation="border" /></div>}
      {error && <div className="page-banner-inner mt-3"><Alert variant="danger">{error}</Alert></div>}

      {!loading && !error && (
        tags.length > 0 ? (
          <>
            {!isMobile && (
              <div className="page-layout">
                <aside className="page-sidebar d-flex flex-column">
                  <div className="sidebar-section">
                    <div className="sidebar-label">날짜 선택</div>
                    <CalendarPicker selectedDate={date} onDateChange={handleDateChange} availableDates={availableDatesSet} />
                  </div>

                  <div className="sidebar-divider" />

                  <div className="sidebar-section sidebar-section-tags">
                    <div className="sidebar-label">태그 검색</div>
                    <TagSearchControl onSearchChange={handleSearchChange} />
                  </div>
                </aside>

                <div className="page-main tag-rankings-main">
                  <div className="tag-rankings-grid">
                    <section className="tag-ranking-panel tag-ranking-panel--left">
                      <div className="tag-ranking-panel__header">
                        <div className="tag-ranking-panel__header-row d-flex justify-content-between gap-3 w-100">
                          <h5 className="tag-ranking-panel__title mb-0">태그 랭킹</h5>
                        </div>
                      </div>
                      <div className="tag-ranking-panel__body">
                        <div className="tag-ranking-column-guide" role="note" aria-label="태그 랭킹 컬럼 설명">
                          <div className="tag-ranking-column-guide__item">
                            <strong>인기 점수</strong>
                            <span>상위권 등장 빈도와 순위 품질을 함께 반영한 점수</span>
                          </div>
                          <div className="tag-ranking-column-guide__item">
                            <strong>상위권 집중도</strong>
                            <span>상위 100위 쏠림 정도, 5회 미만은 표시 제외</span>
                          </div>
                          <div className="tag-ranking-column-guide__item">
                            <strong>등장 횟수</strong>
                            <span>상위 500위 안에서 관측된 총 등장 수</span>
                          </div>
                          <div className="tag-ranking-column-guide__subnote">
                            수집 기준상 2회 미만 등장한 태그는 랭킹에서 제외됩니다.
                          </div>
                        </div>
                        <div className="tag-ranking-table-wrapper" style={{ opacity: isPending ? 0.7 : 1 }}>
                          {isPending && <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', zIndex: 10 }}><Spinner animation="border" /></div>}
                          <Table responsive="md" hover className="custom-table mb-0">
                            <thead>
                              <tr>
                                <th style={{ fontSize: '0.85rem', width: '60px' }}>순위</th>
                                <th style={{ fontSize: '0.85rem' }}>태그</th>
                                <th onClick={() => requestSort('rank_change')} className="cursor-pointer sortable-header" style={{ fontSize: '0.85rem', width: '80px' }}>변동</th>
                                <th
                                  onClick={() => requestSort('power_score')}
                                  className="cursor-pointer sortable-header"
                                  style={{ fontSize: '0.85rem', width: '100px' }}
                                >
                                  인기 점수
                                </th>
                                <th
                                  onClick={() => requestSort('local_lift')}
                                  className="cursor-pointer sortable-header"
                                  style={{ fontSize: '0.85rem', width: '110px' }}
                                >
                                  상위권 집중도
                                </th>
                                <th
                                  onClick={() => requestSort('count')}
                                  className="cursor-pointer sortable-header"
                                  style={{ fontSize: '0.85rem', width: '90px' }}
                                >
                                  등장 횟수
                                </th>
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
                      </div>
                    </section>

                    <section className="tag-ranking-panel">
                      <div className="tag-ranking-panel__header tag-ranking-panel__header--chart">
                        <div className="tag-ranking-panel__header-row tag-ranking-panel__header-row--chart d-flex justify-content-between gap-3 w-100">
                          <h5 className="tag-ranking-panel__title tag-ranking-panel__title--chart mb-0">태그 분포 지도</h5>
                          <ButtonGroup size="sm">
                            {scatterTopNOptions.map(n => (
                              <Button
                                key={n}
                                variant={scatterTopN === n ? 'primary' : 'outline-secondary'}
                                onClick={() => setScatterTopN(n)}
                              >{`Top ${n}`}</Button>
                            ))}
                          </ButtonGroup>
                        </div>
                      </div>
                      <div className="tag-ranking-panel__body tag-ranking-panel__body--chart">
                        <div ref={scatterContainerRef} className="tag-ranking-chart-area">
                          {scatterData.length > 0 ? (
                            <ResponsiveContainer width="100%" height="100%">
                              <ScatterChart margin={{ top: 8, right: 10, bottom: 2, left: 2 }}>
                                <CartesianGrid stroke="var(--np-border-subtle)" strokeDasharray="3 3" />
                                <XAxis
                                  type="number"
                                  dataKey="power_score"
                                  name="인기 점수"
                                  stroke="var(--np-text-secondary)"
                                  tick={{ fontSize: 11, fill: 'var(--np-text-secondary)' }}
                                />
                                <YAxis
                                  type="number"
                                  dataKey="lift"
                                  name="상위권 집중도"
                                  stroke="var(--np-text-secondary)"
                                  tick={{ fontSize: 11, fill: 'var(--np-text-secondary)' }}
                                />
                                <ZAxis type="number" dataKey="count" range={[120, 900]} domain={countDomain} name="등장 횟수" />
                                <RechartsTooltip content={<CustomScatterTooltip />} cursor={{ strokeDasharray: '3 3' }} isAnimationActive={false} />
                                <Scatter data={scatterData} isAnimationActive={false} shape={scatterShape} />
                              </ScatterChart>
                            </ResponsiveContainer>
                          ) : (
                            <div className="text-center text-muted py-4" style={{ fontSize: '0.9rem' }}>
                              상위권 집중도가 계산된 태그가 없어 산점도를 표시할 수 없습니다.
                            </div>
                          )}
                        </div>
                        <div className="tag-ranking-panel__footer">
                          <div className="tag-chart-meta-item">
                            <strong>가로축</strong>
                            <span>인기 점수</span>
                          </div>
                          <div className="tag-chart-meta-item">
                            <strong>세로축</strong>
                            <span>상위권 집중도</span>
                          </div>
                          <div className="tag-chart-meta-item">
                            <strong>원 크기</strong>
                            <span>등장 횟수</span>
                          </div>
                          <div className="tag-chart-meta-item">
                            <strong>점 색상</strong>
                            <span>순위 변동</span>
                          </div>
                        </div>
                      </div>
                    </section>
                  </div>
                </div>
              </div>
            )}

            {isMobile && (
            <div className="tag-ranking-mobile-list">
              <div className="p-2">
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
                          <div className="text-muted small">인기 점수</div>
                          <div className="fw-bold">{tag.power_score.toFixed(1)}</div>
                        </div>
                        <div className="flex-shrink-0 text-end ms-3" style={{ minWidth: '60px' }}>
                          <div className="text-muted small">등장 횟수</div>
                          <div className="fw-bold">{tag.count}회</div>
                        </div>
                      </div>
                      {tag.local_lift != null && (
                        <div className="mt-1 pt-1 border-top text-muted" style={{ fontSize: '0.78rem' }}>
                          상위권 집중도 <span className={tag.local_lift >= 1.5 ? 'text-success fw-bold' : tag.local_lift >= 1.0 ? 'fw-bold' : 'text-danger fw-bold'}>{tag.local_lift.toFixed(2)}</span>
                        </div>
                      )}
                    </Card.Body>
                  </Card>
                ))}
              </div>
            </div>
            )}
          </>
        ) : (
          <div className="page-banner-inner mt-3">
            <Alert variant="info" className="text-center">해당 날짜에 대한 태그 랭킹 데이터가 없습니다.</Alert>
          </div>
        )
      )}
    </div>
  );
};

export default TagRankingsPage;
