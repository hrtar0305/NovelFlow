import { useMemo, useState, useEffect } from 'react';
import { ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, ReferenceLine, Label } from 'recharts';
import { format, parseISO } from 'date-fns';
import { Button } from 'react-bootstrap';

// --- CONSTANTS ---
const TOP_300_END_DATE = '2025-07-20';
const RANK_OUT_VALUE = 501;
const RANK_OUT_VALUE_300 = 301;

// --- TYPE DEFINITIONS ---
interface NovelData {
  Date: string;
  Ranking: number | null;
  Title: string;
  View: number | null;
  Like: number | null;
  Fav: number | null;
  Score: number | null;
  [key: string]: any;
}

interface SmallMultiplesChartProps {
  data: NovelData[];
  hasBothPeriods: boolean;
  onZoomClick: (metric: string) => void;
  isModal?: boolean;
  modalMetric?: string | null;
}

interface CustomizedDotProps {
  cx?: number;
  cy?: number;
  payload?: NovelData;
  dataKey?: string;
}

interface CustomCandleTooltipProps {
  active?: boolean;
  payload?: any[];
  label?: string;
  name: string;
  metric: string;
}

const metricConfigs: { [key: string]: { name: string } } = {
  Ranking: { name: '랭킹' },
  Score: { name: '점수' },
  View: { name: '조회수' },
  Like: { name: '추천' },
  Fav: { name: '선호' }
};

const formatNumberForMobile = (value: number): string => {
  if (value >= 100000000) { // 1억 이상
    return `${(value / 100000000).toFixed(1).replace(/\.0$/, '')}억`;
  }
  if (value >= 10000) { // 1만 이상
    return `${(value / 10000).toFixed(1).replace(/\.0$/, '')}만`;
  }
  return value.toLocaleString();
};

// --- Chart Components ---

const CenteredBar = (props: any) => {
  const { fill, x, y, width, height } = props;
  if (x === undefined || y === undefined || width === undefined || height === undefined) {
    return <g />;
  }
  const centeredX = x - width / 2;

  if (height < 0) {
    return <rect x={centeredX} y={y + height} width={width} height={-height} fill={fill} />;
  }

  return <rect x={centeredX} y={y} width={width} height={height} fill={fill} />;
};

const CustomizedDot = (props: CustomizedDotProps) => {
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

const CustomCandleTooltip = ({ active, payload, label, name, metric }: CustomCandleTooltipProps) => {
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

const ChartWrapper = ({ children, isModal }: { children: React.ReactNode, isModal: boolean }) => {
  if (isModal) {
    return <div className="h-100">{children}</div>;
  }

  return (
    <>
      <style>{`
        .charts-container {
          /* Mobile-first: horizontal scroll */
          display: flex;
          overflow-x: auto;
          scroll-snap-type: x mandatory;
          -webkit-overflow-scrolling: touch;
          scrollbar-width: none; /* Firefox */
        }
        .charts-container::-webkit-scrollbar {
          display: none; /* Chrome, Safari, Opera */
        }
        .charts-container > .chart-item-wrapper {
          flex: 0 0 95%;
          scroll-snap-align: start;
          padding-right: 1rem;
        }
        .charts-container > .chart-item-wrapper:last-child {
          padding-right: 0;
        }

        /* Desktop: vertical stack */
        @media (min-width: 768px) { /* Bootstrap's md breakpoint */
          .charts-container {
            display: grid;
            gap: 0.5rem; /* Replicates Bootstrap's g-2 */
          }
        }
      `}</style>
      <div className="d-md-none text-muted small text-center mb-2">↔ 좌우로 스크롤하여 다른 지표를 확인하세요</div>
      <div className="charts-container">{children}</div>
    </>
  );
};

const SmallMultiplesChart = ({ data, hasBothPeriods, onZoomClick, isModal = false, modalMetric = null }: SmallMultiplesChartProps) => {
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);

  useEffect(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth < 768);
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const processedData = useMemo(() => {
    return data.map((curr: NovelData, i: number) => {
      const entry: { [key: string]: any } = { ...curr };
      if (i > 0) {
        const prev: NovelData = data[i - 1];
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
    <ChartWrapper isModal={isModal}>
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
          <div key={metric} className={isModal ? "h-100" : "chart-item-wrapper"}>
            <div className="p-2 border rounded h-100 d-flex flex-column position-relative">
              <div className="flex-grow-1" style={{minHeight: isModal ? 'auto' : '180px'}}>
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={dataWithTooltipTarget} margin={{ top: 20, right: 20, left: isMobile ? -8 : 35, bottom: isMobile ? -14 : 5 }}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis 
                        dataKey="Date" 
                        tickFormatter={(dateStr) => format(parseISO(dateStr), 'd')}
                        tick={{ fontSize: isMobile ? 11 : undefined }}
                    />
                    <YAxis 
                        domain={yDomain}
                        reversed={metric === 'Ranking'} 
                        tickFormatter={(value) =>
                          isMobile && metric !== 'Ranking'
                            ? formatNumberForMobile(value)
                            : value.toLocaleString()}
                        allowDecimals={metric !== 'Ranking'}
                        tick={{ fontSize: isMobile ? 11 : undefined }}
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
    </ChartWrapper>
  );
};

export default SmallMultiplesChart;