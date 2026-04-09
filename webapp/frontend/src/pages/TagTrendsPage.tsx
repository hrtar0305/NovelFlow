import React, { useState, useEffect } from 'react';
import { format, subDays, addDays, parseISO } from 'date-fns';
import { InfoCircle } from 'react-bootstrap-icons';
import { getAvailableDates, analyzeTagTrends } from '../services/api';
import { Alert, Spinner, Card, OverlayTrigger, Tooltip, Badge, Row, Col, ButtonGroup, Button } from 'react-bootstrap';
import DateRangePicker from '../components/novel/DateRangePicker';
import { LineChart, Line, XAxis, ResponsiveContainer, YAxis } from 'recharts';

// API 응답 데이터 타입 정의
interface TagAnalysisResult {
  tag: string;
  slope: number;
  period_local_lift: number | null;
  avg_daily_avg_score: number;
  avg_total_score: number;
  min_score: number;
  max_score: number;
  normalized_std_dev?: number;
  score_series: number[];
}

interface AnalysisReport {
  trend_leader: TagAnalysisResult[];
  broad_popular: TagAnalysisResult[];
  efficient_niche: TagAnalysisResult[];
  declining: TagAnalysisResult[];
}

const colorMap: Record<string, string> = {
  success: '#198754',
  danger: '#dc3545',
  primary: '#0d6efd',
  warning: '#ffc107',
  info: '#0dcaf0',
  secondary: '#6c757d',
};

const SelectedTagPanel: React.FC<{
  data: TagAnalysisResult;
  variant: string;
  dates: string[];
  onClose: () => void;
}> = ({ data, variant, dates, onClose }) => {
  const chartData = data.score_series.map((value, i) => ({
    date: dates[i] ? format(parseISO(dates[i]), 'MM/dd') : `D${i + 1}`,
    value,
  }));
  const strokeColor = colorMap[variant] ?? '#8884d8';

  const metrics = [
    { label: '추세선 기울기', value: (data.slope >= 0 ? '+' : '') + data.slope.toFixed(3) },
    { label: '로컬 리프트', value: data.period_local_lift != null ? data.period_local_lift.toFixed(2) : 'N/A' },
    { label: '평균 총합 점수', value: data.avg_total_score.toFixed(2) },
  ];

  return (
    <div className={`border border-${variant} rounded p-2 mt-2`}>
      <div className="d-flex justify-content-between align-items-center mb-2">
        <span className="fw-bold">{data.tag}</span>
        <Button size="sm" variant="link" className="p-0 text-muted" onClick={onClose}>×</Button>
      </div>
      <div className="d-flex flex-wrap gap-3 mb-2 small">
        {metrics.map(m => (
          <span key={m.label}><span className="text-muted">{m.label}:</span> <strong>{m.value}</strong></span>
        ))}
      </div>
      <ResponsiveContainer width="100%" height={80}>
        <LineChart data={chartData} margin={{ top: 5, right: 5, bottom: 5, left: 5 }}>
          <XAxis dataKey="date" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
          <YAxis hide />
          <Line type="monotone" dataKey="value" stroke={strokeColor} strokeWidth={2} dot={false} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
};

const TagCategoryCard: React.FC<{
  title: string;
  description: string;
  tags: TagAnalysisResult[];
  category: keyof AnalysisReport;
  variant: string;
  dates: string[];
}> = ({ title, description, tags, category, variant, dates }) => {
  const [topN, setTopN] = useState(5);
  const [selectedTag, setSelectedTag] = useState<TagAnalysisResult | null>(null);
  const topNOptions = [5, 10, 20];

  const handleTopNChange = (n: number) => {
    setTopN(n);
    setSelectedTag(null);
  };

  const displayedTags = (tags || []).slice(0, topN);

  return (
    <Card className="h-100 shadow-sm tag-category-card">
      <Card.Header className={`bg-${variant} bg-opacity-10 border-bottom-0 pt-3 pb-2`}>
        <div className="d-flex align-items-center mb-2">
          <h4 className="mb-0 h5 me-3">{title}</h4>
          <ButtonGroup size="sm">
            {topNOptions.map(n => (
              <Button
                key={n}
                variant={topN === n ? variant : 'outline-secondary'}
                onClick={() => handleTopNChange(n)}
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
      <Card.Body className="p-2 p-md-3">
        {displayedTags && displayedTags.length > 0 ? (
          <>
            <div className="d-flex flex-wrap gap-2">
              {displayedTags.map((tagData) => (
                <Badge
                  key={tagData.tag}
                  pill
                  bg={selectedTag?.tag === tagData.tag ? variant : 'secondary'}
                  className="p-2 px-3 fw-bold"
                  style={{ cursor: 'pointer' }}
                  onClick={() => setSelectedTag(selectedTag?.tag === tagData.tag ? null : tagData)}
                >
                  {tagData.tag}
                </Badge>
              ))}
            </div>
            {selectedTag && (
              <SelectedTagPanel
                data={selectedTag}
                variant={variant}
                dates={dates}
                onClose={() => setSelectedTag(null)}
              />
            )}
          </>
        ) : (
          <div className="d-flex align-items-center justify-content-center h-100 text-muted">
            <p className="mb-0">해당 태그가 없습니다.</p>
          </div>
        )}
      </Card.Body>
    </Card>
  );
};

const TagTrendsPage: React.FC = () => {
  const [startDate, setStartDate] = useState<Date | null>(null);
  const [endDate, setEndDate] = useState<Date | null>(null);
  const [availableDates, setAvailableDates] = useState<Set<string>>(new Set());
  const [analysisResult, setAnalysisResult] = useState<AnalysisReport | null>(null);
  const [analysisDates, setAnalysisDates] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleAnalysis = async () => {
    if (!startDate || !endDate) {
      setError('시작일과 종료일을 모두 선택해주세요.');
      return;
    }
    if (startDate > endDate) {
      setError('시작일은 종료일보다 이전 날짜여야 합니다.');
      return;
    }

    // 분석 기간 날짜 배열 생성 (차트 X축용)
    const dateArr: string[] = [];
    let cur = parseISO(format(startDate, 'yyyy-MM-dd'));
    const end = parseISO(format(endDate, 'yyyy-MM-dd'));
    while (cur <= end) {
      dateArr.push(format(cur, 'yyyy-MM-dd'));
      cur = addDays(cur, 1);
    }
    setAnalysisDates(dateArr);

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

  useEffect(() => {
    const fetchInitialData = async () => {
      try {
        const response = await getAvailableDates();
        const dates: string[] = response.data.available_dates || [];
        setAvailableDates(new Set(dates));

        if (dates.length > 0) {
          const lastDate = new Date(dates[0]);
          const sevenDaysAgo = subDays(lastDate, 6);
          const firstAvailableDate = new Date(dates[dates.length - 1]);

          const initialEndDate = lastDate;
          const initialStartDate = sevenDaysAgo < firstAvailableDate ? firstAvailableDate : sevenDaysAgo;

          setStartDate(initialStartDate);
          setEndDate(initialEndDate);
        }
      } catch (err) {
        setError('데이터 제공 날짜를 불러오는 데 실패했습니다.');
      }
    };
    fetchInitialData();
  }, []);

  useEffect(() => {
    if (startDate && endDate) {
      handleAnalysis();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startDate, endDate]);

  return (
    <div className="np-page-container">
      <div className="d-flex align-items-center gap-2 mb-2">
        <h1 className="h2 mb-0 fs-page-title">태그 트렌드</h1>
        <OverlayTrigger
          placement="bottom"
          overlay={
            <Tooltip id="tag-trends-description-tooltip">
              지정된 기간 동안의 태그 점수 변화를 분석하여, 작가 기획에 도움이 되는 장르 트렌드를 카테고리별로 보여줍니다.
            </Tooltip>
          }
        >
          <span className="d-md-none" style={{ cursor: 'pointer' }}>
            <InfoCircle />
          </span>
        </OverlayTrigger>
      </div>
      <p className="text-muted mb-3 d-none d-md-block">지정된 기간 동안의 태그 점수 변화를 분석하여, 작가 기획에 도움이 되는 장르 트렌드를 카테고리별로 보여줍니다.</p>
      <div className="d-flex align-items-center gap-2 mb-2 date-range-picker-container">
        <DateRangePicker
          startDate={startDate}
          endDate={endDate}
          onStartDateChange={(date) => {
            setStartDate(date);
            setEndDate(null);
          }}
          onEndDateChange={(date) => {
            setEndDate(date);
          }}
          availableDates={Array.from(availableDates).map(d => new Date(d))}
          novelAvailableDatesSet={new Set()}
          isNovelDetailPage={false}
          noMargin={true}
          showNovelDataIndicator={false}
        />
      </div>

      {error && <Alert variant="danger">{error}</Alert>}

      {isLoading && (
        <div className="text-center p-5">
          <Spinner animation="border" role="status">
            <span className="visually-hidden">Loading...</span>
          </Spinner>
          <p className="mt-2 text-muted">데이터를 분석하고 있습니다...</p>
        </div>
      )}

      {analysisResult && (
        <Row xs={1} lg={2} className="g-2 g-lg-3">
          <Col>
            <TagCategoryCard
              title="트렌드 주도"
              description="상승세이면서 상위 100위 집중도가 높은 태그. 지금 독자 수요가 늘고 있으며 상위권에 집중된 장르."
              tags={analysisResult.trend_leader}
              category="trend_leader"
              variant="success"
              dates={analysisDates}
            />
          </Col>
          <Col>
            <TagCategoryCard
              title="대중적 보편"
              description="상승세이나 전 순위 구간에 고루 분포. 경쟁이 치열하지만 독자층이 넓은 장르."
              tags={analysisResult.broad_popular}
              category="broad_popular"
              variant="primary"
              dates={analysisDates}
            />
          </Col>
          <Col>
            <TagCategoryCard
              title="고효율 틈새"
              description="전체 점수는 낮지만 상위 100위 집중도가 높은 태그. 경쟁은 적은데 상위권 진입 효율이 좋은 틈새 장르."
              tags={analysisResult.efficient_niche}
              category="efficient_niche"
              variant="warning"
              dates={analysisDates}
            />
          </Col>
          <Col>
            <TagCategoryCard
              title="하락세"
              description="기간 동안 추세선이 하락한 태그. 독자 관심이 식어가는 장르."
              tags={analysisResult.declining}
              category="declining"
              variant="danger"
              dates={analysisDates}
            />
          </Col>
        </Row>
      )}
    </div>
  );
};

export default TagTrendsPage;
