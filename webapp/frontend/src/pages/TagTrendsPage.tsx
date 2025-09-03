/*
 * Copyright (c) 2025 Paohkin
 *
 * This software is released under the MIT License.
 * https://opensource.org/licenses/MIT
 */
import React, { useState, useEffect } from 'react';
import { format, subDays } from 'date-fns';
import { getAvailableDates, analyzeTagTrends } from '../services/api';
import { Alert, Spinner, Card, OverlayTrigger, Tooltip, Badge, Row, Col, ButtonGroup, Button } from 'react-bootstrap';
import DateRangePicker from '../components/novel/DateRangePicker';
import { LineChart, Line, ResponsiveContainer, YAxis } from 'recharts';

// API 응답 데이터 타입 정의
interface TagAnalysisResult {
  tag: string;
  slope: number;
  avg_daily_avg_score: number;
  avg_total_score: number;
  min_score: number;
  max_score: number;
  std_dev: number;
  score_series: number[];
  total_score_series?: number[]; // 스테디셀러/격동의 태그에만 존재
  normalized_std_dev?: number; // 백엔드에서 추가된 필드
}

interface AnalysisReport {
  stable_popular: TagAnalysisResult[];
  rising_trend: TagAnalysisResult[];
  falling_trend: TagAnalysisResult[];
  volatile_tags: TagAnalysisResult[];
  noteworthy: TagAnalysisResult[];
}

const TagCategoryCard: React.FC<{
  title: string;
  description: string;
  tags: TagAnalysisResult[];
  category: keyof AnalysisReport;
  variant: string;
  renderTooltip: (props: any, data: TagAnalysisResult, category: keyof AnalysisReport) => JSX.Element;
}> = ({ title, description, tags, category, variant, renderTooltip }) => {
  const [topN, setTopN] = useState(5);
  const topNOptions = [5, 10, 20];

  const displayedTags = tags.slice(0, topN);

  return (
    <Card className="h-100 shadow-sm">
      <Card.Header className={`bg-${variant} bg-opacity-10 border-bottom-0 pt-3 pb-2`}>
        <div className="d-flex align-items-center mb-2">
          <h4 className="mb-0 h5 me-3">{title}</h4>
          <ButtonGroup size="sm">
            {topNOptions.map(n => (
              <Button
                key={n}
                variant={topN === n ? variant : 'outline-secondary'}
                onClick={() => setTopN(n)}
                className="fw-bold"
                style={{ minWidth: '40px' }}
              >
                {n}
              </Button>
            ))}
          </ButtonGroup>
        </div>
        <p className="mb-0 text-muted small">{description}</p>
      </Card.Header>
      <Card.Body className="pt-2">
        {displayedTags && displayedTags.length > 0 ? (
          <div className="d-flex flex-wrap gap-2">
            {displayedTags.map((tagData) => (
              <OverlayTrigger key={tagData.tag} placement="top" delay={{ show: 250, hide: 400 }} overlay={(props) => renderTooltip(props, tagData, category)}>
                <Badge pill bg={variant} className="p-2 px-3 fs-6 fw-bold" style={{ cursor: 'pointer' }}>{tagData.tag}</Badge>
              </OverlayTrigger>
            ))}
          </div>
        ) : (<div className="d-flex align-items-center justify-content-center h-100 text-muted"><p className="mb-0">해당 태그가 없습니다.</p></div>)}
      </Card.Body>
    </Card>
  );
};

const TagTrendsPage: React.FC = () => {
  const [startDate, setStartDate] = useState<Date | null>(null);
  const [endDate, setEndDate] = useState<Date | null>(null);
  const [availableDates, setAvailableDates] = useState<Set<string>>(new Set());
  const [analysisResult, setAnalysisResult] = useState<AnalysisReport | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchAvailableDates = async () => {
      try {
        const response = await getAvailableDates();
        const dates: string[] = response.data.available_dates || [];
        setAvailableDates(new Set(dates));

        if (dates.length > 0) {
          const lastDate = new Date(dates[0]); // Assuming dates are sorted descending
          const sevenDaysAgo = subDays(lastDate, 6);
          const firstAvailableDate = new Date(dates[dates.length - 1]);

          setEndDate(lastDate);
          setStartDate(sevenDaysAgo < firstAvailableDate ? firstAvailableDate : sevenDaysAgo);
        }
      } catch (err) {
        setError('데이터 제공 날짜를 불러오는 데 실패했습니다.');
      }
    };
    fetchAvailableDates();
  }, []);

  useEffect(() => {
    if (startDate && endDate) {
      handleAnalysis();
    }
  }, [startDate, endDate]);

  const handleDateRangeChange = (start: Date | null, end: Date | null) => {
    setStartDate(start);
    setEndDate(end);
  };

  const handleAnalysis = async () => {
    if (!startDate || !endDate) {
      setError('시작일과 종료일을 모두 선택해주세요.');
      return;
    }
    if (startDate > endDate) {
        setError('시작일은 종료일보다 이전 날짜여야 합니다.');
        return;
    }

    setIsLoading(true);
    setError(null);
    setAnalysisResult(null);

    try {
      const response = await analyzeTagTrends(format(startDate, 'yyyy-MM-dd'), format(endDate, 'yyyy-MM-dd'));
      setAnalysisResult(response.data);
    } catch (err: any) {
        if (err.response && err.response.status === 404) {
            setError('해당 기간에 분석할 데이터가 충분하지 않습니다.');
        } else {
            setError('태그 트렌드 분석 중 오류가 발생했습니다.');
        }
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  };

  const renderTooltip = (props: any, data: TagAnalysisResult, category: keyof AnalysisReport) => {
    
    interface TooltipInfo {
        label: string;
        value: string;
        isKey?: boolean;
    }

    let info: TooltipInfo[] = [];

    switch (category) {
        case 'rising_trend':
        case 'falling_trend':
            info = [
                { label: '추세선 기울기', value: data.slope.toFixed(2), isKey: true },
                { label: '평균 총합 점수', value: data.avg_total_score.toFixed(2) },
                { label: '평균 일일 점수', value: data.avg_daily_avg_score.toFixed(2) },
                { label: '평균 일일 점수 범위', value: `${data.min_score.toFixed(2)} ~ ${data.max_score.toFixed(2)}` },
            ];
            break;
        case 'stable_popular':
            info = [
                { label: '상대 변동성', value: `${(data.normalized_std_dev ?? 0).toFixed(2)} (낮음)`, isKey: true },
                { label: '평균 총합 점수', value: data.avg_total_score.toFixed(2) },
                { label: '평균 일일 점수', value: data.avg_daily_avg_score.toFixed(2) },
                { label: '평균 일일 점수 범위', value: `${data.min_score.toFixed(2)} ~ ${data.max_score.toFixed(2)}` },
            ];
            break;
        case 'volatile_tags':
            info = [
                { label: '상대 변동성', value: `${(data.normalized_std_dev ?? 0).toFixed(2)} (높음)`, isKey: true },
                { label: '평균 총합 점수', value: data.avg_total_score.toFixed(2) },
                { label: '평균 일일 점수', value: data.avg_daily_avg_score.toFixed(2) },
                { label: '평균 일일 점수 범위', value: `${data.min_score.toFixed(2)} ~ ${data.max_score.toFixed(2)}` },
            ];
            break;
        case 'noteworthy':
            info = [
                { label: '평균 일일 점수 범위', value: `${data.min_score.toFixed(2)} ~ ${data.max_score.toFixed(2)}`, isKey: true },
                { label: '평균 총합 점수', value: data.avg_total_score.toFixed(2) },
                { label: '평균 일일 점수', value: data.avg_daily_avg_score.toFixed(2) },
                { label: '상대 변동성', value: (data.normalized_std_dev ?? 0).toFixed(2) },
            ];
            break;
    }

    let chartDataSource: number[];
    let chartStrokeColor = "#8884d8"; // Default color for avg score (purple)
    let chartTitle = "";

    switch (category) {
        case 'stable_popular':
        case 'volatile_tags':
            // 이 카테고리들은 '일일 총합 점수'의 변동성을 기준으로 하므로 해당 차트를 표시
            chartDataSource = data.total_score_series || [];
            chartStrokeColor = "#82ca9d"; // Green for total score based charts
            chartTitle = "일일 총합 점수";
            break;
        default: // rising_trend, falling_trend, noteworthy
            // 이 카테고리들은 '일일 평균 점수'를 기준으로 하므로 해당 차트를 표시
            chartDataSource = data.score_series;
            chartTitle = "일일 평균 점수";
            break;
    }

    // --- Dynamic Y-Axis Domain Calculation ---
    let yDomain: [number | 'auto', number | 'auto'] = ['auto', 'auto'];
    const PADDING_FACTOR = 0.1; // 10% padding for min/max based charts

    switch (category) {
        case 'stable_popular':
        case 'volatile_tags': {
            // 사용자의 요청에 따라, 변동성 차트도 최소/최대값 기준으로 동적 범위를 사용하도록 변경합니다.
            const scores = data.total_score_series || [];
            if (scores.length > 0) {
                const min = Math.min(...scores);
                const max = Math.max(...scores);
                if (min === max) {
                    const padding = max > 0 ? max * PADDING_FACTOR : 1;
                    yDomain = [max - padding, max + padding];
                } else {
                    const range = max - min;
                    const padding = range * PADDING_FACTOR;
                    yDomain = [min - padding, max + padding];
                }
                yDomain[0] = Math.max(0, Math.floor(yDomain[0] as number));
                yDomain[1] = Math.ceil(yDomain[1] as number);
            } else {
                yDomain = [0, 100]; // 데이터가 없을 경우 기본 범위
            }
            break;
        }
        default: { // rising_trend, falling_trend, noteworthy
            // For other charts, focus on showing the range of change.
            const min = data.min_score;
            const max = data.max_score;
            if (min === max) {
                const padding = max > 0 ? max * PADDING_FACTOR : 1;
                yDomain = [max - padding, max + padding];
            } else {
                const range = max - min;
                const padding = range * PADDING_FACTOR;
                yDomain = [min - padding, max + padding];
            }
            yDomain[0] = Math.max(0, Math.floor(yDomain[0] as number));
            yDomain[1] = Math.ceil(yDomain[1] as number);
            break;
        }
    }

    const chartData = chartDataSource.map((value, index) => ({ name: index, value }));

    // 차트의 최소/최대 지점에 라벨을 표시하기 위한 로직
    let minPoint = { value: chartDataSource.length > 0 ? chartDataSource[0] : 0, index: 0 };
    let maxPoint = { value: chartDataSource.length > 0 ? chartDataSource[0] : 0, index: 0 };

    if (chartDataSource.length > 0) {
        chartDataSource.forEach((value, index) => {
            // 데이터 시리즈에서 첫 번째로 나타나는 최소값을 찾습니다.
            if (value < minPoint.value) {
                minPoint = { value, index };
            }
            // 데이터 시리즈에서 첫 번째로 나타나는 최대값을 찾습니다.
            if (value > maxPoint.value) {
                maxPoint = { value, index };
            }
        });
    }

    const MinMaxLabel = (props: any) => {
        const { x, y, index, value } = props;

        // 최소값과 최대값이 같은 지점일 경우 하나만 표시
        if (minPoint.index === maxPoint.index) {
            if (index === minPoint.index) {
                return <text x={x} y={y} dy={-8} fill="#555" fontSize="0.75rem" textAnchor="middle">{value.toFixed(0)}</text>;
            }
        } else {
            // 최소값 지점에 라벨 표시 (아래쪽)
            if (index === minPoint.index) {
                return <text x={x} y={y} dy={14} fill="#555" fontSize="0.75rem" textAnchor="middle">{value.toFixed(0)}</text>;
            }
            // 최대값 지점에 라벨 표시 (위쪽)
            if (index === maxPoint.index) {
                return <text x={x} y={y} dy={-8} fill="#555" fontSize="0.75rem" textAnchor="middle">{value.toFixed(0)}</text>;
            }
        }
        return null;
    };

    return (
        <Tooltip {...props} className="tag-trend-tooltip">
            <div>
                {info.map((item, index) => (
                    <div key={index} className={`d-flex ${item.isKey ? 'fw-bold' : ''}`}>
                        <span style={{ width: '150px', flexShrink: 0 }}>{item.label}:</span>
                        <span>{item.value}</span>
                    </div>
                ))}
            </div>
            <hr className="my-2" />
            <div className="d-flex justify-content-between align-items-center mb-1">
                <span className="fw-bold text-dark">{chartTitle}</span>
            </div>
            <div style={{ height: '60px', marginLeft: '-10px', marginRight: '-10px' }}>
                <ResponsiveContainer>
                    <LineChart data={chartData} margin={{ top: 20, right: 20, bottom: 20, left: 20 }}>
                        <YAxis domain={yDomain} hide={true} />
                        <Line type="monotone" dataKey="value" stroke={chartStrokeColor} strokeWidth={2} dot={false} isAnimationActive={false} label={<MinMaxLabel />} />
                    </LineChart>
                </ResponsiveContainer>
            </div>
        </Tooltip>
    );
  };

  return (
    <div className="container-fluid p-4">
      <div className="mb-3">
        <h1 className="h2 mb-2">태그 트렌드</h1>
        <p className="text-muted">지정된 기간 동안의 태그 점수 변화를 분석하여, 주목할 만한 트렌드를 카테고리별로 보여줍니다.</p>
      </div>

      <div className="d-flex align-items-center gap-2 mb-3">
        <DateRangePicker
            startDate={startDate}
            endDate={endDate}
            onStartDateChange={(date) => handleDateRangeChange(date, null)}
            onEndDateChange={(date) => handleDateRangeChange(startDate, date)}
            availableDates={Array.from(availableDates).map(d => new Date(d))}
            novelAvailableDatesSet={new Set()} // TagTrendsPage에서는 필요 없으므로 빈 Set 전달
            isNovelDetailPage={false}
            noMargin={true}
            showNovelDataIndicator={false} // Hide novel data indicator
        />
        
      </div>

      {error && <Alert variant="danger">{error}</Alert>}

      {isLoading && (
         <div className="text-center p-5">
            <Spinner animation="border" role="status">
                <span className="visually-hidden">Loading...</span>
            </Spinner>
            <p className='mt-2'>데이터를 분석하고 있습니다...</p>
        </div>
      )}

      {analysisResult && (
        <Row xs={1} lg={2} className="g-3">
          <Col>
            <TagCategoryCard
              title="급상승 태그"
              description="기간 동안 일일 평균 점수의 추세선 기울기가 가장 가파르게 상승한 태그들입니다."
              tags={analysisResult.rising_trend}
              category="rising_trend"
              variant="success"
              renderTooltip={renderTooltip}
            />
          </Col>
          <Col>
            <TagCategoryCard
              title="하락세 태그"
              description="기간 동안 일일 평균 점수의 추세선 기울기가 가장 가파르게 하락한 태그들입니다."
              tags={analysisResult.falling_trend}
              category="falling_trend"
              variant="danger"
              renderTooltip={renderTooltip}
            />
          </Col>
          <Col>
            <TagCategoryCard
              title="스테디셀러 태그"
              description="기간 내 총점이 상위 10%에 속하는 인기 태그 중에서, 점수 변동성이 가장 낮은 태그들입니다."
              tags={analysisResult.stable_popular}
              category="stable_popular"
              variant="primary"
              renderTooltip={renderTooltip}
            />
          </Col>
          {analysisResult.volatile_tags && analysisResult.volatile_tags.length > 0 && (
            <Col>
              <TagCategoryCard title="격동의 태그" description="기간 내 총점이 상위 10%에 속하는 인기 태그 중에서, 점수 변동성이 가장 높은 태그들입니다." tags={analysisResult.volatile_tags} category="volatile_tags" variant="warning" renderTooltip={renderTooltip} />
            </Col>
          )}
          <Col>
            <TagCategoryCard title="주목할 만한 태그" description="다른 카테고리에 속하지 않으면서, 기간 내 높은 일일 평균 점수를 기록하며 주목받은 태그들입니다." tags={analysisResult.noteworthy} category="noteworthy" variant="info" renderTooltip={renderTooltip} />
          </Col>
        </Row>
      )}
    </div>
  );
};

export default TagTrendsPage;
