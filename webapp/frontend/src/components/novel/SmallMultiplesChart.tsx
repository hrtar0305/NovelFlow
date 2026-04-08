import React, { useMemo, useState, useEffect } from 'react';
import { ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, ReferenceLine } from 'recharts';
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
  metricConfigs: { [key: string]: { name: string } };
  modalMetric?: string | null;
}

interface CustomizedDotProps {
  cx?: number;
  cy?: number;
  payload?: NovelData;
  dataKey?: string;
}

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

const CustomizedDot = React.memo((props: CustomizedDotProps) => {
  const { cx, cy, payload, dataKey } = props;
  if (!dataKey || !payload || payload[dataKey] === null || payload[dataKey] === undefined) return null;
  
  const isRankOut = 
    dataKey.toLowerCase().includes('rank') && 
    (
      payload[dataKey] === RANK_OUT_VALUE || 
      (payload[dataKey] === RANK_OUT_VALUE_300 && payload.Date <= TOP_300_END_DATE)
    );

  if (isRankOut) {
    return (
      <g transform={`translate(${cx}, ${cy})`}>
        <path d="M-4,4L4,-4 M-4,-4L4,4" stroke="#d9534f" strokeWidth="1.5" />
      </g>
    );
  }
  
  return <circle cx={cx} cy={cy} r={3} fill="#8884d8" />;
});

const CustomCandleTooltip = ({ active, payload, label, name, metricKey }: { active?: boolean; payload?: any[]; label?: string; name: string; metricKey: string; }) => {
  if (active && payload && payload.length && metricKey) {
    const itemPayload = payload.find(p => p.dataKey === 'tooltipTrigger')?.payload;
    if (!itemPayload) return null;

    let currValue = itemPayload[metricKey];

    const isRankOut = 
      metricKey.toLowerCase().includes('rank') && 
      (
        currValue === RANK_OUT_VALUE || 
        (currValue === RANK_OUT_VALUE_300 && itemPayload.Date <= TOP_300_END_DATE)
      );

    if (currValue === undefined || currValue === null || isRankOut) {
      currValue = '순위권 밖';
    }

    let changeString = '-';
    let changeColor = '#6c757d';

    if (itemPayload[`${metricKey}_prevValue`] !== undefined && itemPayload[`${metricKey}_prevValue`] !== null) {
      const prevValue = itemPayload[`${metricKey}_prevValue`];
      const actualCurrValue = itemPayload[metricKey];

      if (actualCurrValue !== null && prevValue !== null) {
        const change = actualCurrValue - prevValue;
        const positiveChangeColor = metricKey.toLowerCase().includes('rank') ? '#0d6efd' : '#d9534f';
        const negativeChangeColor = metricKey.toLowerCase().includes('rank') ? '#d9534f' : '#0d6efd';
        if (change !== 0) {
          changeColor = change > 0 ? positiveChangeColor : negativeChangeColor;
          const displayChange = metricKey.toLowerCase().includes('rank') ? -change : change;
          changeString = `${displayChange > 0 ? '+' : ''}${displayChange.toLocaleString()}`;
        }
      }
    }

    return (
      <div className="custom-tooltip p-2 border rounded shadow-sm">
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

const ChartWrapper = ({ children, isModal, firstFullWidth }: { children: React.ReactNode, isModal: boolean, firstFullWidth: boolean }) => {
  if (isModal) {
    return <div className="h-100">{children}</div>;
  }

  return (
    <>
      <style>{`
        /* Mobile: vertical stack */
        .charts-container {
          display: flex;
          flex-direction: column;
          gap: 0.75rem;
        }
        .charts-container > .chart-item-wrapper {
          width: 100%;
          height: 240px;
        }

        /* Desktop: 2-column grid */
        @media (min-width: 768px) {
          .charts-container {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 0.75rem;
            flex-direction: unset;
          }
          .charts-container > .chart-item-wrapper {
            width: auto;
            min-height: 240px;
          }
          .charts-container.first-full-width > .chart-item-wrapper:first-child {
            grid-column: 1 / -1;
            min-height: 200px;
          }
        }
      `}</style>
      <div className={`charts-container${firstFullWidth ? ' first-full-width' : ''}`}>{children}</div>
    </>
  );
};

const SmallMultiplesChart = ({ data, hasBothPeriods, onZoomClick, isModal = false, metricConfigs, modalMetric = null }: SmallMultiplesChartProps) => {
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
        Object.keys(metricConfigs).forEach(metric => {
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
  }, [data, metricConfigs]);

  const metrics = isModal && modalMetric ? [modalMetric] : Object.keys(metricConfigs);

  const firstFullWidth = !isModal && metrics.length % 2 !== 0;

  return (
    <ChartWrapper isModal={isModal} firstFullWidth={firstFullWidth}>
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
                if (metric.toLowerCase().includes('rank')) {
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

            if (metric.toLowerCase().includes('rank')) {
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

        const upColor = metric.toLowerCase().includes('rank') ? '#0d6efd' : '#d9534f';
        const downColor = metric.toLowerCase().includes('rank') ? '#d9534f' : '#0d6efd';

        return (
          <div key={metric} className={isModal ? "h-100" : "chart-item-wrapper"}>
            <div className="chart-card border rounded h-100 d-flex flex-column">
              <div className="chart-card-header d-flex align-items-center justify-content-between">
                <span className="chart-card-title">{config.name}</span>
                {!isModal && (
                  <Button variant="outline-secondary" size="sm" onClick={() => onZoomClick(metric)} className="chart-zoom-btn">확대</Button>
                )}
              </div>
              <div className="flex-grow-1" style={{minHeight: isModal ? 'auto' : '180px', padding: '0 4px 4px'}}>
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={dataWithTooltipTarget} margin={{ top: 8, right: 12, left: isMobile ? -8 : 30, bottom: isMobile ? -14 : 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--np-border)" />
                    <XAxis
                        dataKey="Date"
                        tickFormatter={(dateStr) => format(parseISO(dateStr), 'd')}
                        tick={{ fontSize: isMobile ? 11 : 12, fill: 'var(--np-text-secondary)' }}
                        axisLine={{ stroke: 'var(--np-border)' }}
                        tickLine={{ stroke: 'var(--np-border)' }}
                    />
                    <YAxis
                        domain={yDomain}
                        reversed={metric.toLowerCase().includes('rank')}
                        tickFormatter={(value) =>
                          isMobile && !metric.toLowerCase().includes('rank')
                            ? formatNumberForMobile(value)
                            : value.toLocaleString()}
                        allowDecimals={!metric.toLowerCase().includes('rank')}
                        tick={{ fontSize: isMobile ? 11 : 12, fill: 'var(--np-text-secondary)' }}
                        axisLine={{ stroke: 'var(--np-border)' }}
                        tickLine={{ stroke: 'var(--np-border)' }}
                    />
                    <Tooltip content={<CustomCandleTooltip name={config.name} metricKey={metric} />} isAnimationActive={false} />
                    {hasBothPeriods && <ReferenceLine x="2025-07-21" stroke="var(--np-rank-down)" strokeDasharray="3 3" strokeWidth={2} />}
                    <Bar dataKey="tooltipTrigger" fill="transparent" isAnimationActive={false} />
                    <Bar dataKey={`${metric}_range`} isAnimationActive={false} barSize={4} shape={CenteredBar}>
                      {dataWithTooltipTarget.map((entry: any, index: number) => (
                        <Cell key={`cell-${index}`} fill={entry[`${metric}_changeType`] === 'up' ? upColor : entry[`${metric}_changeType`] === 'down' ? downColor : 'var(--np-border)'} />
                      ))}
                    </Bar>
                    <Line type="monotone" dataKey={metric} stroke="var(--np-accent)" strokeWidth={2} dot={<CustomizedDot dataKey={metric} />} connectNulls={metric.toLowerCase().includes('rank')} isAnimationActive={false} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>
        );
      })}
    </ChartWrapper>
  );
};

export default SmallMultiplesChart;