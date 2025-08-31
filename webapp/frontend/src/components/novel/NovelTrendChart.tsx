import React, { useMemo, memo, useState } from 'react';
import { Button, Modal } from 'react-bootstrap';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';

// --- TYPE DEFINITIONS ---
interface NovelData {
  Date: string;
  Ranking: number | null;
  View: number | null;
  Fav: number | null;
  Like: number | null;
  Score: number | null;
  [key: string]: any; // Index signature
}

interface ChartConfig {
  [key: string]: {
    name: string;
    color: string;
  };
}

// --- CONSTANTS ---
const RANK_OUT_VALUE = 501; // Value to assign for 'Rank Out'

const CHART_CONFIG: ChartConfig = {
  Ranking: { name: '랭킹', color: '#8884d8' },
  View: { name: '조회수', color: '#82ca9d' },
  Fav: { name: '선호작', color: '#ffc658' },
  Like: { name: '추천', color: '#ff7300' },
  Score: { name: '스코어', color: '#0088FE' },
};

// --- CUSTOM TOOLTIP ---
const CustomTooltip = ({ active, payload, label }: any) => {
  if (active && payload && payload.length) {
    const data = payload[0].payload;
    return (
      <div className="custom-tooltip" style={{ backgroundColor: 'rgba(255, 255, 255, 0.9)', border: '1px solid #ccc', padding: '10px', borderRadius: '5px' }}>
        <p className="label fw-bold">{`${label}`}</p>
        {payload.map((p: any) => {
          const originalKey = Object.keys(CHART_CONFIG).find(k => CHART_CONFIG[k].name === p.name);
          let value = 'N/A';
          if (data && originalKey && data[originalKey] !== null) {
            if (originalKey === 'Ranking' && data[originalKey] === RANK_OUT_VALUE) {
                 value = `Rank Out (300위 밖)`;
            } else {
                value = data[originalKey].toLocaleString();
            }
          } else if (originalKey === 'Ranking') {
            value = `Rank Out (300위 밖)`;
          }
          return (
            <p key={p.name} style={{ color: p.color }}>
              {`${p.name}: ${value}`}
            </p>
          );
        })}
      </div>
    );
  }
  return null;
};

// --- CUSTOM DOT FOR HOVERING ---
const CustomDot = (props: any) => {
  const { cx, cy, stroke, payload, dataKey } = props;
  
  if (!payload) return null;

  // Render a larger, transparent circle for hover detection on all points
  const hoverCircle = <circle cx={cx} cy={cy} r={7} fill="transparent" />;

  // Render a visible dot only if the data point is not null
  const dataValue = payload[dataKey];
  const isRankOut = dataKey === 'Ranking' && dataValue === RANK_OUT_VALUE;

  const visibleDot = dataValue !== null && !isRankOut
    ? <circle cx={cx} cy={cy} r={3} fill={stroke} /> 
    : null;

  return (
    <g>
      {hoverCircle}
      {visibleDot}
    </g>
  );
};


// --- CHART COMPONENT ---
const SingleChart = ({ data, metric, config, isModal = false }: { data: NovelData[], metric: string, config: ChartConfig[string], isModal?: boolean }) => (
  <ResponsiveContainer width="100%" height={isModal ? '100%' : 250}>
    <LineChart data={data} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
      <CartesianGrid strokeDasharray="3 3" />
      <XAxis dataKey="Date" />
      <YAxis 
        reversed={metric === 'Ranking'} 
        domain={['auto', 'auto']} 
        allowDecimals={false} 
      />
      <Tooltip content={<CustomTooltip />} />
      <Legend />
      <Line
        type="monotone"
        dataKey={metric}
        name={config.name}
        stroke={config.color}
        strokeWidth={2}
        dot={<CustomDot dataKey={metric} />}
        connectNulls={metric === 'Ranking'} // Only connect for Ranking
      />
    </LineChart>
  </ResponsiveContainer>
);

// --- MAIN COMPONENT ---
const NovelTrendChart: React.FC<{ trendData: NovelData[] }> = memo(({ trendData }) => {
  const [showModal, setShowModal] = useState(false);
  const [selectedChart, setSelectedChart] = useState<string | null>(null);

  const chartData = useMemo(() => {
    if (!trendData) return [];
    // Replace null rankings with RANK_OUT_VALUE for chart continuity
    // Other metrics remain null to create breaks in their lines
    return trendData.map(d => ({
      ...d,
      Ranking: d.Ranking === null ? RANK_OUT_VALUE : d.Ranking,
    }));
  }, [trendData]);

  const handleZoomClick = (metric: string) => {
    setSelectedChart(metric);
    setShowModal(true);
  };

  const renderChart = (metric: string) => {
    const config = CHART_CONFIG[metric];
    if (!config) return null;

    return (
      <div key={metric} className="mb-4 position-relative">
        <h5 className="mb-2 ps-2">{config.name}</h5>
        <SingleChart data={chartData} metric={metric} config={config} />
        <Button variant="light" size="sm" onClick={() => handleZoomClick(metric)} style={{position: 'absolute', top: '5px', right: '5px', zIndex: 100}}>
          확대
        </Button>
      </div>
    );
  };

  return (
    <>
      {Object.keys(CHART_CONFIG).map(metric => renderChart(metric))}

      <Modal show={showModal} onHide={() => setShowModal(false)} size="xl" centered>
        <Modal.Header closeButton>
          <Modal.Title>{selectedChart ? CHART_CONFIG[selectedChart].name : ''} Trend</Modal.Title>
        </Modal.Header>
        <Modal.Body style={{ height: '70vh' }}>
          {selectedChart && (
            <SingleChart 
              data={chartData} 
              metric={selectedChart} 
              config={CHART_CONFIG[selectedChart]} 
              isModal={true} 
            />
          )}
        </Modal.Body>
      </Modal>
    </>
  );
});

export default NovelTrendChart;