import { useState, useEffect, lazy, Suspense } from 'react';
import { useParams } from 'react-router-dom';
import { Spinner, Alert, Modal } from 'react-bootstrap';
import { useContestNovelData } from '../hooks/useContestNovelData';
import { parseISO } from 'date-fns';
import ContestNovelDetailsCard from '../components/ContestNovelDetailsCard';
import DateRangePicker from '../components/novel/DateRangePicker';

const SmallMultiplesChart = lazy(() => import('../components/novel/SmallMultiplesChart'));

const metricConfigs: { [key: string]: { name: string } } = {
  Ranking: { name: '랭킹' },
  View: { name: '조회수' },
  Like: { name: '추천' },
  Fav: { name: '선호' }
};

const ContestNovelDetailPage = () => {
  const { year, novelId } = useParams<{ year: string; novelId: string }>();
  const {
    startDate,
    endDate,
    setStartDate,
    setEndDate,
    trendData,
    details,
    loading,
    error,
    minDate,
    maxDate,
    novelAvailableDatesSet,
    fetchTrendData,
  } = useContestNovelData(year, novelId);

  const [isInitialLoad, setIsInitialLoad] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [selectedMetric, setSelectedMetric] = useState<string | null>(null);

  useEffect(() => {
    // This effect tracks the very first load cycle.
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

  if (isInitialLoad && loading) {
    return <div className="text-center vh-100 d-flex align-items-center justify-content-center"><Spinner animation="border" /></div>;
  }
  if (error) {
    return <div className="np-page-container"><Alert variant="danger" className="text-center">{error}</Alert></div>;
  }

  return (
    <div>
      {details && !isInitialLoad && (
        <>
          <ContestNovelDetailsCard details={details} />

          <div className="np-page-container pt-0">
            <div className="mt-0 date-range-picker-container">
              <h4 className="mb-2 fs-section-title-mobile">지표별 상세 추이</h4>
              <DateRangePicker
                startDate={startDate}
                endDate={endDate}
                minDate={minDate} maxDate={maxDate}
                availableDates={Array.from(novelAvailableDatesSet).map(d => parseISO(d))}
                novelAvailableDatesSet={novelAvailableDatesSet}
                onStartDateChange={handleStartDateChange} onEndDateChange={handleEndDateChange} isNovelDetailPage={true}
                showNovelDataIndicator={false} />
            </div>

            <div className="mt-2 position-relative">
              {loading && <div className="position-absolute w-100 h-100 d-flex justify-content-center align-items-center" style={{ top: 0, left: 0, background: 'rgba(11,22,34,0.6)', zIndex: 10 }}><Spinner animation="border" /></div>}
              <div style={{ opacity: loading ? 0.5 : 1, transition: 'opacity 0.2s' }}>
                {trendData.length > 0 ? (
                  <Suspense fallback={<div className="text-center p-5"><Spinner animation="border" /></div>}>
                    <SmallMultiplesChart data={trendData} hasBothPeriods={false} onZoomClick={handleZoomClick} metricConfigs={metricConfigs} />
                  </Suspense>
                ) : (!loading && <Alert variant="info">선택된 기간에 대한 데이터가 없습니다.</Alert>)}
              </div>
            </div>
          </div>

          <Modal show={showModal} onHide={() => setShowModal(false)} size="xl" centered animation={false}>
            <Modal.Header closeButton><Modal.Title>{selectedMetric ? `${metricConfigs[selectedMetric]?.name || selectedMetric} 상세 보기` : ''}</Modal.Title></Modal.Header>
            <Modal.Body style={{ height: '70vh' }}><Suspense fallback={<div className="text-center p-5"><Spinner animation="border" /></div>}>{renderChartInModal()}</Suspense></Modal.Body>
          </Modal>
        </>
      )}
    </div>
  );
};

export default ContestNovelDetailPage;