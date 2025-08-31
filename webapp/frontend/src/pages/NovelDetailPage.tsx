import { useMemo, useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { Container, Spinner, Alert, Button, Modal } from 'react-bootstrap';
import { useNovelData } from '../hooks/useNovelData';
import NovelDetailsCard from '../components/novel/NovelDetailsCard';
import DateRangePicker from '../components/novel/DateRangePicker';
import { parseISO } from 'date-fns';
import { ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, ReferenceLine, Label } from 'recharts';
import { InfoCircle } from 'react-bootstrap-icons';

const TOP_300_END_DATE = '2025-07-20';
const TOP_500_START_DATE = '2025-07-21';
const RANK_OUT_VALUE = 501;
const RANK_OUT_VALUE_300 = 301;

const metricConfigs: { [key: string]: { name: string } } = {
  Ranking: { name: '랭킹' },
  Score: { name: '점수' },
  View: { name: '조회수' },
  Like: { name: '추천' },
  Fav: { name: '선호' }
};

const NovelDetailPage = () => {
  const { novelId } = useParams<{ novelId: string }>();
  const { 
    startDate,
    endDate,
    setStartDate,
    setEndDate,
    novelData,
    details,
    loading,
    error,
    minDate,
    maxDate,
    availableDates,
    novelAvailableDatesSet,
    fetchNovelData,
  } = useNovelData(novelId);

  const [isInitialLoad, setIsInitialLoad] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [selectedMetric, setSelectedMetric] = useState<string | null>(null);

  useEffect(() => {
    if (isInitialLoad && !loading) {
      setIsInitialLoad(false);
    }
  }, [loading, isInitialLoad]);

  const handleStartDateChange = (date: Date | null) => {
    setStartDate(date);
    setEndDate(null);
  };

  const handleEndDateChange = (date: Date | null) => {
    setEndDate(date);
    if (startDate && date) {
      fetchNovelData(startDate, date);
    }
  };

  const handleZoomClick = (metric: string) => {
    setSelectedMetric(metric);
    setShowModal(true);
  };

  const hasBothPeriods = useMemo(() => {
    if (!novelData) return false;
    const hasBefore300 = novelData.some(d => parseISO(d.Date) <= parseISO(TOP_300_END_DATE));
    const hasAfter500 = novelData.some(d => parseISO(d.Date) >= parseISO(TOP_500_START_DATE));
    return hasBefore300 && hasAfter500;
  }, [novelData]);

  const renderChartInModal = () => {
    if (!selectedMetric) return null;
    return (
      <SmallMultiplesChart 
        data={novelData} 
        hasBothPeriods={hasBothPeriods} 
        onZoomClick={() => {}} 
        isModal={true}
        modalMetric={selectedMetric}
      />
    )
  }

  return (
    <Container className="p-4">
      {isInitialLoad ? (
        <div className="text-center vh-100 d-flex align-items-center justify-content-center">
          <Spinner animation="border" />
        </div>
      ) : error ? (
        <Alert variant="danger" className="text-center">{error}</Alert>
      ) : (
        <>
          {details && <NovelDetailsCard details={details} />}
          
          <div className="mt-3">
            <h4 className="mb-2">지표별 상세 추이</h4>
            <DateRangePicker {...{startDate, endDate, minDate, maxDate, availableDates, novelAvailableDatesSet, onStartDateChange: handleStartDateChange, onEndDateChange: handleEndDateChange}} />
          </div>

          <div className="mt-2 position-relative">
            {loading && (
              <div className="position-absolute w-100 h-100 d-flex justify-content-center align-items-center" style={{ top: 0, left: 0, background: 'rgba(255, 255, 255, 0.7)', zIndex: 10 }}>
                <Spinner animation="border" />
              </div>
            )}
            <div style={{ opacity: loading ? 0.5 : 1, transition: 'opacity 0.2s' }}>
              {novelData.length > 0 ? (
                <>
                  {hasBothPeriods && (
                    <Alert variant="info" className="d-flex align-items-center text-center p-2 mb-2 small">
                      <InfoCircle size={16} className="me-2 flex-shrink-0" />
                      <span>참고: <strong>2025-07-21</strong>부터 집계 기준이 300위에서 500위로 변경되었습니다.</span>
                    </Alert>
                  )}
                  <SmallMultiplesChart data={novelData} hasBothPeriods={hasBothPeriods} onZoomClick={handleZoomClick} />
                </>
              ) : (
                !loading && <Alert variant="info">선택된 기간에 대한 데이터가 없습니다.</Alert>
              )}
            </div>
          </div>

          <Modal show={showModal} onHide={() => setShowModal(false)} size="xl" centered animation={false}>
            <Modal.Header closeButton>
              <Modal.Title>{selectedMetric ? `${metricConfigs[selectedMetric]?.name || selectedMetric} 상세 보기` : ''}</Modal.Title>
            </Modal.Header>
            <Modal.Body style={{ height: '70vh' }}>
              {renderChartInModal()}
            </Modal.Body>
          </Modal>
        </>
      )}
    </Container>
  );
};

// --- Chart Components ---

const CenteredBar = (props: any) => {
  const { fill, x, y, width, height } = props;
  const centeredX = x - width / 2;

  if (height < 0) {
    return <rect x={centeredX} y={y + height} width={width} height={-height} fill={fill} />;
  }

  return <rect x={centeredX} y={y} width={width} height={height} fill={fill} />;
};

const CustomizedDot = (props: any) => {
  const { cx, cy, payload, dataKey } = props;
  if (!dataKey || !payload || payload[dataKey] === null || payload[dataKey] === undefined) return null;
  
  const isRankOut = 
    dataKey === 'Ranking' && 
    (
      payload.Ranking === RANK_OUT_VALUE || 
      (payload.Ranking === RANK_OUT_VALUE_300 && payload.Date <= TOP_300_END_DATE)
    );

  if (isRankOut) {
    return (
      <g transform={`translate(${cx}, ${cy})`}>
        <path d="M-4,4L4,-4 M-4,-4L4,4" stroke="#d9534f" strokeWidth="1.5" />
      </g>
    );
  }
  
  return <circle cx={cx} cy={cy} r={3} fill="#8884d8" />;
};

const CustomCandleTooltip = ({ active, payload, label, name, metric }: any) => {
  if (active && payload && payload.length && metric) {
    const itemPayload = payload.find(p => p.dataKey === 'tooltipTrigger')?.payload;
    if (!itemPayload) return null;

    let currValue = itemPayload[metric];

    const isRankOut = 
      metric === 'Ranking' && 
      (
        currValue === RANK_OUT_VALUE || 
        (currValue === RANK_OUT_VALUE_300 && itemPayload.Date <= TOP_300_END_DATE)
      );

    if (currValue === undefined || currValue === null || isRankOut) {
      currValue = '순위권 밖';
    }

    let changeString = '-';
    let changeColor = '#6c757d';

    if (itemPayload[`${metric}_prevValue`] !== undefined && itemPayload[`${metric}_prevValue`] !== null) {
      const prevValue = itemPayload[`${metric}_prevValue`];
      const actualCurrValue = itemPayload[metric];

      if (actualCurrValue !== null && prevValue !== null) {
        const change = actualCurrValue - prevValue;
        const positiveChangeColor = metric === 'Ranking' ? '#0d6efd' : '#d9534f';
        const negativeChangeColor = metric === 'Ranking' ? '#d9534f' : '#0d6efd';
        if (change !== 0) {
          changeColor = change > 0 ? positiveChangeColor : negativeChangeColor;
          const displayChange = metric === 'Ranking' ? -change : change;
          changeString = `${displayChange > 0 ? '+' : ''}${displayChange.toLocaleString()}`;
        }
      }
    }

    return (
      <div className="custom-tooltip bg-light p-2 border rounded shadow-sm">
        <p className="label fw-bold mb-1">{`날짜: ${label}`}</p>
        <p className="mb-0">
          {`${name}: ${typeof currValue === 'number' ? currValue.toLocaleString() : currValue}`}
          <span style={{ color: changeColor }}>{` (${changeString})`}</span>
        </p>
      </div>
    );
  }
  return null;
};

const SmallMultiplesChart = ({ data, hasBothPeriods, onZoomClick, isModal = false, modalMetric = null }: any) => {
  const processedData = useMemo(() => {
    return data.map((curr: any, i: number) => {
      const entry: { [key: string]: any } = { ...curr };
      if (i > 0) {
        const prev = data[i - 1];
        ['Ranking', 'Score', 'View', 'Like', 'Fav'].forEach(metric => {
          const prevValue = prev[metric];
          const currValue = curr[metric];
          if (prevValue != null && currValue != null) {
            entry[`${metric}_range`] = [Math.min(prevValue, currValue), Math.max(prevValue, currValue)];
            entry[`${metric}_changeType`] = currValue > prevValue ? 'up' : (currValue < prevValue ? 'down' : 'same');
            entry[`${metric}_prevValue`] = prevValue;
          }
        });
      }
      return entry;
    });
  }, [data]);

  const metrics = isModal && modalMetric ? [modalMetric] : ['Ranking', 'Score', 'View', 'Like', 'Fav'];

  return (
    <div className={isModal ? "h-100" : "row g-2"}>
      {metrics.map((metric) => {
        const config = metricConfigs[metric];
        
        const yDomain = useMemo(() => {
            const values = data.map((d: any) => d[metric]).filter((v: any) => v != null) as number[];
            
            if (values.length === 0) {
                return metric === 'Ranking' ? [1, 100] : [0, 100];
            }

            const min = Math.min(...values);
            const max = Math.max(...values);

            let domainMin, domainMax;

            if (min === max) {
                if (metric === 'Ranking') {
                    const padding = 5;
                    domainMin = min - padding;
                    domainMax = max + padding;
                } else {
                    const padding = Math.max(max * 0.1, 1);
                    domainMin = min - padding;
                    domainMax = max + padding;
                }
            } else {
                const range = max - min;
                const padding = range * 0.2; // 20% padding
                domainMin = min - padding;
                domainMax = max + padding;
            }

            if (metric === 'Ranking') {
                domainMin = Math.max(1, Math.floor(domainMin));
                domainMax = Math.ceil(domainMax);
            } else {
                domainMin = Math.max(0, Math.floor(domainMin));
                domainMax = Math.ceil(domainMax);
            }
            
            if (domainMin >= domainMax) {
                domainMax = domainMin + 1;
            }

            return [domainMin, domainMax];
        }, [data, metric]);

        const dataWithTooltipTarget = useMemo(() => 
            processedData.map(d => ({...d, tooltipTrigger: [yDomain[0], yDomain[1]]}))
        , [processedData, yDomain]);

        const upColor = metric === 'Ranking' ? '#0d6efd' : '#d9534f';
        const downColor = metric === 'Ranking' ? '#d9534f' : '#0d6efd';

        return (
          <div key={metric} className={isModal ? "h-100" : "col-12"}>
            <div className="p-2 border rounded h-100 d-flex flex-column position-relative">
              <div className="flex-grow-1" style={{minHeight: isModal ? 'auto' : '180px'}}>
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={dataWithTooltipTarget} margin={{ top: 20, right: 20, left: 35, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="Date" tickFormatter={(dateStr) => parseISO(dateStr).getDate().toString()} />
                    <YAxis 
                        domain={yDomain}
                        reversed={metric === 'Ranking'} 
                        tickFormatter={(value) => value.toLocaleString()} 
                        allowDecimals={metric !== 'Ranking'} 
                    />
                    <Tooltip content={<CustomCandleTooltip name={config.name} metric={metric} />} isAnimationActive={false} />
                    {hasBothPeriods && <ReferenceLine x="2025-07-21" stroke="red" strokeDasharray="3 3" strokeWidth={2} />}
                    <Label value={config.name} position="insideTopLeft" offset={10} style={{fill: '#666', fontSize: '0.9rem', fontWeight: 'bold'}} />
                    <Bar dataKey="tooltipTrigger" fill="transparent" isAnimationActive={false} />
                    <Bar dataKey={`${metric}_range`} isAnimationActive={false} barSize={4} shape={CenteredBar}>
                      {dataWithTooltipTarget.map((entry: any, index: number) => (
                        <Cell key={`cell-${index}`} fill={entry[`${metric}_changeType`] === 'up' ? upColor : entry[`${metric}_changeType`] === 'down' ? downColor : '#e0e0e0'} />
                      ))}
                    </Bar>
                    <Line type="monotone" dataKey={metric} stroke="#343a40" dot={<CustomizedDot />} connectNulls={metric === 'Ranking'} isAnimationActive={false} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
              {!isModal && (
                <Button variant="outline-secondary" size="sm" onClick={() => onZoomClick(metric)} style={{position: 'absolute', top: '5px', right: '5px'}}>확대</Button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
};

export default NovelDetailPage;