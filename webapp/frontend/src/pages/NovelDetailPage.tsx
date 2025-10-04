import { useMemo, useState, useEffect, lazy, Suspense } from 'react';
import { useParams } from 'react-router-dom';
import { Container, Spinner, Alert, Modal } from 'react-bootstrap';
import { useNovelData } from '../hooks/useNovelData';
import NovelDetailsCard from '../components/novel/NovelDetailsCard';
import DateRangePicker from '../components/novel/DateRangePicker';
import { parseISO } from 'date-fns';
import { InfoCircle } from 'react-bootstrap-icons';

const SmallMultiplesChart = lazy(() => import('../components/novel/SmallMultiplesChart'));

const TOP_300_END_DATE = '2025-07-20';
const TOP_500_START_DATE = '2025-07-21';

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
        metricConfigs={metricConfigs}
        isModal={true}
        modalMetric={selectedMetric}
      />
    )
  }

  return (
    <Container className="py-3 py-md-4">
      {isInitialLoad ? (
        <div className="text-center vh-100 d-flex align-items-center justify-content-center">
          <Spinner animation="border" />
        </div>
      ) : error ? (
        <Alert variant="danger" className="text-center">{error}</Alert>
      ) : (
        <>
          {details && <NovelDetailsCard details={details} />}
          
          <div className="mt-1 date-range-picker-container">
            <h4 className="mb-2 fs-section-title-mobile">지표별 상세 추이</h4>
            <DateRangePicker
              startDate={startDate}
              endDate={endDate}
              minDate={minDate}
              maxDate={maxDate}
              availableDates={availableDates}
              novelAvailableDatesSet={novelAvailableDatesSet}
              onStartDateChange={handleStartDateChange}
              onEndDateChange={handleEndDateChange}
              isNovelDetailPage={true}
            />
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
                  <Suspense fallback={<div className="text-center p-5"><Spinner animation="border" /></div>}>
                    <SmallMultiplesChart data={novelData} hasBothPeriods={hasBothPeriods} onZoomClick={handleZoomClick} metricConfigs={metricConfigs} />
                  </Suspense>
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
              <Suspense fallback={<div className="text-center p-5"><Spinner animation="border" /></div>}>
                {renderChartInModal()}
              </Suspense>
            </Modal.Body>
          </Modal>
        </>
      )}
    </Container>
  );
};

export default NovelDetailPage;