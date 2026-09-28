import React, { useMemo, useState, useEffect } from 'react';
import { ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, ReferenceLine, Brush } from 'recharts';
import { format, parseISO } from 'date-fns';
import { isOutOfRank } from '../../utils/trendSummary';
import { isolatedIndices } from '../../utils/chartPoints';

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
}

/** 차트 한 점: 원래 값 + 전일 대비 범위·방향·이전 값(`${metric}_range` 등) + 툴팁 트리거. */
type ChartRow = Record<string, unknown> & { Date: string };

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
/** 지표 이름(문자열)으로 행의 값을 읽는다. 공모전 추이처럼 다른 모양의 행도 받기 위해 인덱스 시그니처 대신 쓴다. */
const field = (row: object, key: string): unknown => (row as Record<string, unknown>)[key];

interface SmallMultiplesChartProps {
  data: NovelData[];
  hasBothPeriods: boolean;
  onZoomClick: (metric: string) => void;
  isModal?: boolean;
  metricConfigs: { [key: string]: { name: string } };
  modalMetric?: string | null;
  /** 일간 순위(500위 밖 = 501, 2025-07-20 이전 301)일 때 켠다: 순위권 밖 날은 선을 끊고 축에서 뺀다.
   *  공모전 순위는 전 작품 순위라 501이 '순위권 밖'이 아니므로 끈다. */
  breakOutOfRank?: boolean;
}

interface CustomizedDotProps {
  cx?: number;
  cy?: number;
  payload?: ChartRow;
  dataKey?: string;
  /** false면 isolated에 든 날만 찍는다(점 표시를 끈 긴 기간). */
  showAll?: boolean;
  isolated?: ReadonlySet<string>;
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

const getXAxisInterval = (pointCount: number, isModal: boolean, isMobile: boolean) => {
  const targetTicks = isModal ? (isMobile ? 8 : 14) : (isMobile ? 5 : 8);
  if (pointCount <= targetTicks) return 0;
  return Math.max(0, Math.ceil(pointCount / targetTicks) - 1);
};

// --- Chart Components ---

const CenteredBar = (props: unknown) => {
  const { fill, x, y, width, height } = props as { fill?: string; x?: number; y?: number; width?: number; height?: number };
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
  const { cx, cy, payload, dataKey, showAll = true, isolated } = props;
  if (!dataKey || !payload || payload[dataKey] === null || payload[dataKey] === undefined) return null;
  if (!showAll && !isolated?.has(payload.Date)) return null;
  
  const isRankOut = 
    dataKey.toLowerCase().includes('rank') && 
    (
      payload[dataKey] === RANK_OUT_VALUE || 
      (payload[dataKey] === RANK_OUT_VALUE_300 && payload.Date <= TOP_300_END_DATE)
    );

  if (isRankOut) {
    return (
      <g transform={`translate(${cx}, ${cy})`}>
        <path d="M-4,4L4,-4 M-4,-4L4,4" stroke="var(--np-text-faint)" strokeWidth="1.5" />
      </g>
    );
  }
  
  return <circle cx={cx} cy={cy} r={3} fill="var(--np-accent)" />;
});

const CustomCandleTooltip = ({ active, payload, label, name, metricKey }: { active?: boolean; payload?: Array<{ dataKey?: unknown; payload?: ChartRow }>; label?: string; name: string; metricKey: string; }) => {
  if (active && payload && payload.length && metricKey) {
    const itemPayload = payload.find(p => p.dataKey === 'tooltipTrigger')?.payload;
    if (!itemPayload) return null;

    let currValue: number | string | null = num(itemPayload[metricKey]);

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
    let changeColor = 'var(--np-text-secondary)';

    const prevValue = num(itemPayload[`${metricKey}_prevValue`]);
    if (prevValue !== null) {
      const actualCurrValue = num(itemPayload[metricKey]);

      if (actualCurrValue !== null) {
        const change = actualCurrValue - prevValue;
        const positiveChangeColor = metricKey.toLowerCase().includes('rank') ? 'var(--np-rank-down)' : 'var(--np-rank-up)';
        const negativeChangeColor = metricKey.toLowerCase().includes('rank') ? 'var(--np-rank-up)' : 'var(--np-rank-down)';
        if (change !== 0) {
          changeColor = change > 0 ? positiveChangeColor : negativeChangeColor;
          const displayChange = metricKey.toLowerCase().includes('rank') ? -change : change;
          changeString = `${displayChange > 0 ? '+' : ''}${displayChange.toLocaleString()}`;
        }
      }
    }

    return (
      <div className="custom-tooltip p-2 border rounded">
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

interface MetricPanelProps {
  metric: string;
  name: string;
  processedData: ChartRow[];
  hasBothPeriods: boolean;
  isModal: boolean;
  isMobile: boolean;
  onZoomClick: (metric: string) => void;
  breakOutOfRank: boolean;
}

/** 지표 하나의 차트. 지표마다 훅(yDomain 등)을 쓰므로 map 안이 아니라 컴포넌트여야 한다. */
const MetricPanel = ({ metric, name, processedData, hasBothPeriods, isModal, isMobile, onZoomClick, breakOutOfRank }: MetricPanelProps) => {
  const isRank = metric.toLowerCase().includes('rank');

  const yDomain = useMemo(() => {
    const values = processedData.map(d => num(field(d, metric))).filter((v): v is number => v !== null);

    if (values.length === 0) {
      return metric === 'Ranking' ? [1, 100] : [0, 100];
    }

    const min = Math.min(...values);
    const max = Math.max(...values);

    let domainMin, domainMax;

    if (min === max) {
      const padding = isRank ? 5 : Math.max(max * 0.1, 1);
      domainMin = min - padding;
      domainMax = max + padding;
    } else {
      const padding = (max - min) * 0.2; // 20% padding
      domainMin = min - padding;
      domainMax = max + padding;
    }

    domainMin = Math.max(isRank ? 1 : 0, Math.floor(domainMin));
    domainMax = Math.ceil(domainMax);

    if (domainMin >= domainMax) {
      domainMax = domainMin + 1;
    }

    return [domainMin, domainMax];
  }, [processedData, metric, isRank]);

  const chartData = useMemo<ChartRow[]>(
    () => processedData.map(d => ({ ...d, tooltipTrigger: [yDomain[0], yDomain[1]] })),
    [processedData, yDomain],
  );

  const upColor = isRank ? 'var(--np-rank-down)' : 'var(--np-rank-up)';
  const downColor = isRank ? 'var(--np-rank-up)' : 'var(--np-rank-down)';
  const pointCount = chartData.length;
  const firstDate = chartData[0]?.Date ? parseISO(chartData[0].Date) : null;
  const lastDate = chartData[pointCount - 1]?.Date ? parseISO(chartData[pointCount - 1].Date) : null;
  const spansYears = Boolean(firstDate && lastDate && firstDate.getFullYear() !== lastDate.getFullYear());
  const useMonthTicks = pointCount > (isModal ? 120 : 70);
  const xTickFormatter = (dateStr: string) => {
    const parsedDate = parseISO(dateStr);
    if (useMonthTicks) {
      return format(parsedDate, spansYears ? 'yy.MM' : 'M월');
    }
    return format(parsedDate, isModal ? 'MM.dd' : 'd');
  };
  const xAxisInterval = getXAxisInterval(pointCount, isModal, isMobile);
  const shouldShowDots = pointCount <= (isModal ? 140 : 60);
  // 선을 끊는 순위 차트에서 앞뒤가 순위권 밖인 하루는 선분이 없다 — 점 표시를 끈 긴 기간에도 그 점은 찍는다.
  const isolatedDates = useMemo(() => {
    if (!isRank || !breakOutOfRank) return new Set<string>();
    const values = chartData.map(d => num(field(d, metric)));
    return new Set(isolatedIndices(values).map(i => chartData[i].Date));
  }, [chartData, metric, isRank, breakOutOfRank]);
  const shouldRenderRangeBars = pointCount <= (isModal ? 260 : 140);
  const brushGap = Math.max(1, Math.floor(pointCount / 90));
  const chartMargin = isModal
    ? { top: 18, right: 34, left: isMobile ? 6 : 52, bottom: 28 }
    : { top: 8, right: 12, left: isMobile ? -8 : 30, bottom: isMobile ? -14 : 5 };

  return (
    <div className={isModal ? "h-100" : "chart-item-wrapper"}>
      <div className="chart-card h-100 d-flex flex-column">
        <div className="chart-card-header d-flex align-items-center justify-content-between">
          <span className="chart-card-title">{name}</span>
          {!isModal && (
            <button type="button" className="chart-zoom-link" onClick={() => onZoomClick(metric)}>크게 보기</button>
          )}
        </div>
        <div className="flex-grow-1" style={{minHeight: isModal ? 'auto' : '180px', padding: isModal ? '0.35rem 0.35rem 0.1rem' : '0 4px 4px'}}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={chartData} margin={chartMargin}>
              <CartesianGrid stroke="var(--np-border)" vertical={false} />
              <XAxis
                  dataKey="Date"
                  tickFormatter={xTickFormatter}
                  interval={xAxisInterval}
                  minTickGap={isModal ? 28 : 16}
                  tick={{ fontSize: isModal ? 12 : (isMobile ? 11 : 12), fill: 'var(--np-text-secondary)' }}
                  axisLine={{ stroke: 'var(--np-border)' }}
                  tickLine={{ stroke: 'var(--np-border)' }}
              />
              <YAxis
                  domain={yDomain}
                  reversed={isRank}
                  tickFormatter={(value) =>
                    isMobile && !isRank
                      ? formatNumberForMobile(value)
                      : value.toLocaleString()}
                  allowDecimals={!isRank}
                  tick={{ fontSize: isMobile ? 11 : 12, fill: 'var(--np-text-secondary)' }}
                  axisLine={{ stroke: 'var(--np-border)' }}
                  tickLine={{ stroke: 'var(--np-border)' }}
                  tickCount={isModal ? 6 : 5}
              />
              <Tooltip content={<CustomCandleTooltip name={name} metricKey={metric} />} isAnimationActive={false} />
              {hasBothPeriods && (
                <ReferenceLine x="2025-07-21" stroke="var(--np-text-faint)" strokeDasharray="3 3"
                  label={{ value: '300→500위 집계', position: 'insideTopRight', fill: 'var(--np-text-secondary)', fontSize: 11 }} />
              )}
              <Bar dataKey="tooltipTrigger" fill="transparent" isAnimationActive={false} />
              {shouldRenderRangeBars && (
                <Bar dataKey={`${metric}_range`} isAnimationActive={false} barSize={4} shape={CenteredBar}>
                  {chartData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry[`${metric}_changeType`] === 'up' ? upColor : entry[`${metric}_changeType`] === 'down' ? downColor : 'var(--np-border)'} />
                  ))}
                </Bar>
              )}
              <Line
                type="monotone"
                dataKey={metric}
                stroke="var(--np-accent)"
                strokeWidth={2}
                dot={shouldShowDots || isolatedDates.size > 0
                  ? <CustomizedDot dataKey={metric} showAll={shouldShowDots} isolated={isolatedDates} />
                  : false}
                activeDot={{ r: 4 }}
                connectNulls={isRank && !breakOutOfRank}
                isAnimationActive={false}
              />
              {isModal && (
                <Brush
                  dataKey="Date"
                  height={26}
                  gap={brushGap}
                  travellerWidth={10}
                  tickFormatter={(dateStr) => format(parseISO(dateStr), 'MM.dd')}
                  stroke="var(--np-accent)"
                  fill="var(--np-surface-alt)"
                />
              )}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
};

const SmallMultiplesChart = ({ data, hasBothPeriods, onZoomClick, isModal = false, metricConfigs, modalMetric = null, breakOutOfRank = false }: SmallMultiplesChartProps) => {
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);

  useEffect(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth < 768);
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const processedData = useMemo<ChartRow[]>(() => {
    // 순위권 밖 날은 값을 비워 선을 끊는다(이어 그리면 500위 밖으로 떨어졌다 돌아온 것처럼 보인다).
    const rows: NovelData[] = breakOutOfRank
      ? data.map(d => (isOutOfRank(d.Ranking, d.Date) ? { ...d, Ranking: null } : d))
      : data;
    return rows.map((curr, i) => {
      const entry: ChartRow = { ...curr };
      if (i > 0) {
        const prev = rows[i - 1];
        Object.keys(metricConfigs).forEach(metric => {
          const prevValue = num(field(prev, metric));
          const currValue = num(field(curr, metric));
          if (prevValue !== null && currValue !== null) {
            entry[`${metric}_range`] = [Math.min(prevValue, currValue), Math.max(prevValue, currValue)];
            entry[`${metric}_changeType`] = currValue > prevValue ? 'up' : (currValue < prevValue ? 'down' : 'same');
            entry[`${metric}_prevValue`] = prevValue;
          }
        });
      }
      return entry;
    });
  }, [data, metricConfigs, breakOutOfRank]);

  const metrics = isModal && modalMetric ? [modalMetric] : Object.keys(metricConfigs);

  const firstFullWidth = !isModal && metrics.length % 2 !== 0;

  return (
    <ChartWrapper isModal={isModal} firstFullWidth={firstFullWidth}>
      {metrics.map(metric => (
        <MetricPanel key={metric} metric={metric} name={metricConfigs[metric].name} processedData={processedData}
          hasBothPeriods={hasBothPeriods} isModal={isModal} isMobile={isMobile} onZoomClick={onZoomClick} breakOutOfRank={breakOutOfRank} />
      ))}
    </ChartWrapper>
  );
};

export default SmallMultiplesChart;
