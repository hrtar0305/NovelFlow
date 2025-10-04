import { useState, useEffect, lazy, Suspense } from 'react';
import { useParams } from 'react-router-dom';
import { Container, Spinner, Alert, Modal } from 'react-bootstrap';
import { getLatestContestNovelDetails, getContestNovelTrend, getContestAvailableDates } from '../services/api';
import ContestNovelDetailsCard from './ContestNovelDetailsCard';
import DateRangePicker from '../components/novel/DateRangePicker';
import { format, subDays } from 'date-fns';

const SmallMultiplesChart = lazy(() => import('../components/novel/SmallMultiplesChart'));

const metricConfigs: { [key: string]: { name: string } } = {
  Rank: { name: '랭킹' },
  View: { name: '조회수' },
  Like: { name: '추천' },
  Fav: { name: '선호' }
};

const ContestNovelDetailPage = () => {
  const { year, novelId } = useParams<{ year: string; novelId: string }>();
  
  const [details, setDetails] = useState<any>(null);
  const [trendData, setTrendData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [chartLoading, setChartLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [startDate, setStartDate] = useState<Date | null>(null);
  const [endDate, setEndDate] = useState<Date | null>(null);
  const [availableDates, setAvailableDates] = useState<Date[]>([]);
  const [novelAvailableDatesSet, setNovelAvailableDatesSet] = useState<Set<string>>(new Set());

  const [showModal, setShowModal] = useState(false);
  const [selectedMetric, setSelectedMetric] = useState<string | null>(null);

  useEffect(() => {
    if (!year || !novelId) return;

    const fetchInitialData = async () => {
      setLoading(true);
      setError(null);
      try {
        const yearNum = parseInt(year, 10);
        // 1. Fetch latest details for the card
        const detailsRes = await getLatestContestNovelDetails(yearNum, novelId);
        setDetails(detailsRes.data);

        // 2. Fetch all available dates for the contest
        const datesRes = await getContestAvailableDates(yearNum);
        const allDates = (datesRes.data.available_dates || []).map((d: string) => new Date(d));
        setAvailableDates(allDates);

        // 3. Set default date range and fetch trend data
        if (allDates.length > 0) {
          const lastDate = allDates[0]; // Assumes sorted descending
          const sevenDaysAgo = subDays(lastDate, 6);
          const firstAvailableDate = allDates[allDates.length - 1];
          
          const defaultStartDate = sevenDaysAgo < firstAvailableDate ? firstAvailableDate : sevenDaysAgo;
          const defaultEndDate = lastDate;

          setStartDate(defaultStartDate);
          setEndDate(defaultEndDate);
          
          fetchTrendData(defaultStartDate, defaultEndDate);
        }
      } catch (err: any) {
        setError(err.response?.data?.detail || 'Failed to load contest novel data.');
      } finally {
        setLoading(false);
      }
    };

    fetchInitialData();
  }, [year, novelId]);

  const fetchTrendData = async (start: Date, end: Date) => {
    if (!year || !novelId) return;
    setChartLoading(true);
    try {
      const trendRes = await getContestNovelTrend(parseInt(year, 10), novelId, format(start, 'yyyy-MM-dd'), format(end, 'yyyy-MM-dd'));
      setTrendData(trendRes.data);
      // Update available dates for this specific novel to highlight in calendar
      const novelDates = new Set<string>(trendRes.data.filter((d: any) => d.View !== null).map((d: any) => d.Date));
      setNovelAvailableDatesSet(novelDates);
    } catch (err) {
      setError('Failed to load trend data.');
    } finally {
      setChartLoading(false);
    }
  };

  const handleStartDateChange = (date: Date | null) => {
    setStartDate(date);
    setEndDate(null);
  };

  const handleEndDateChange = (date: Date | null) => {
    setEndDate(date);
    if (startDate && date) {
      fetchTrendData(startDate, date);
    }
  };

  const handleZoomClick = (metric: string) => {
    setSelectedMetric(metric);
    setShowModal(true);
  };

  const renderChartInModal = () => {
    if (!selectedMetric) return null;
    // Note: SmallMultiplesChart might need adjustments for contest data keys (e.g., 'rank' vs 'Ranking')
    return <SmallMultiplesChart data={trendData} hasBothPeriods={false} onZoomClick={() => {}} isModal={true} metricConfigs={metricConfigs} modalMetric={selectedMetric} />;
  };

  if (loading) {
    return <div className="text-center vh-100 d-flex align-items-center justify-content-center"><Spinner animation="border" /></div>;
  }
  if (error) {
    return <Container className="py-3 py-md-4"><Alert variant="danger" className="text-center">{error}</Alert></Container>;
  }

  return (
    <Container className="py-3 py-md-4">
      {details && <ContestNovelDetailsCard details={details} />}
      
      <div className="mt-1 date-range-picker-container">
        <h4 className="mb-2 fs-section-title-mobile">지표별 상세 추이</h4>
        <DateRangePicker startDate={startDate} endDate={endDate} minDate={availableDates[availableDates.length - 1]} maxDate={availableDates[0]} availableDates={availableDates} novelAvailableDatesSet={novelAvailableDatesSet} onStartDateChange={handleStartDateChange} onEndDateChange={handleEndDateChange} isNovelDetailPage={true} />
      </div>

      <div className="mt-2 position-relative">
        {chartLoading && <div className="position-absolute w-100 h-100 d-flex justify-content-center align-items-center" style={{ top: 0, left: 0, background: 'rgba(255, 255, 255, 0.7)', zIndex: 10 }}><Spinner animation="border" /></div>}
        <div style={{ opacity: chartLoading ? 0.5 : 1, transition: 'opacity 0.2s' }}>
          {trendData.length > 0 ? (
            <Suspense fallback={<div className="text-center p-5"><Spinner animation="border" /></div>}>
              <SmallMultiplesChart data={trendData} hasBothPeriods={false} onZoomClick={handleZoomClick} metricConfigs={metricConfigs} />
            </Suspense>
          ) : (!chartLoading && <Alert variant="info">선택된 기간에 대한 데이터가 없습니다.</Alert>)}
        </div>
      </div>

      <Modal show={showModal} onHide={() => setShowModal(false)} size="xl" centered animation={false}>
        <Modal.Header closeButton><Modal.Title>{selectedMetric ? `${metricConfigs[selectedMetric]?.name || selectedMetric} 상세 보기` : ''}</Modal.Title></Modal.Header>
        <Modal.Body style={{ height: '70vh' }}><Suspense fallback={<div className="text-center p-5"><Spinner animation="border" /></div>}>{renderChartInModal()}</Suspense></Modal.Body>
      </Modal>
    </Container>
  );
};

export default ContestNovelDetailPage;