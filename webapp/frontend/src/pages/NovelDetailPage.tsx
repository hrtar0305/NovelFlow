import { useMemo, useState, useEffect, lazy, Suspense } from 'react';
import { useParams } from 'react-router-dom';
import { Spinner, Alert, Modal } from 'react-bootstrap';
import { useNovelData } from '../hooks/useNovelData';
import NovelHeader, { NovelDetailSections } from '../components/novel/NovelHeader';
import { describeCurrentRank } from '../utils/currentRank';
import DateRangePicker from '../components/novel/DateRangePicker';
import { format, parseISO } from 'date-fns';
import { InfoCircle } from 'react-bootstrap-icons';
import PanelCard from '../components/ui/PanelCard';

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
    novelAvailableDatesSet,
    fetchNovelData,
  } = useNovelData(novelId);

  const [isInitialLoad, setIsInitialLoad] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [selectedMetric, setSelectedMetric] = useState<string | null>(null);

  // 머리의 전일 대비는 '마지막 기록일과 그 전날'이 들어 있는 추이로 계산하고 작품 ID와 함께 붙잡아 둔다.
  // 차트 기간을 과거로 옮기면 novelData에서 마지막 기록일이 빠지는데, 그때도 머리 값은 그대로여야 한다.
  // 작품을 옮겨 가는 동안 남아 있는 이전 작품의 추이는 ID로 걸러낸다.
  const latestDate = maxDate ? format(maxDate, 'yyyy-MM-dd') : null;
  const [head, setHead] = useState<{ id: string; series: Array<{ Date: string; Ranking: number | null }> } | null>(null);
  useEffect(() => {
    const lastDate = details?.Date;
    if (!novelId || !lastDate || details?.ID !== novelId || novelData[0]?.ID !== novelId) return;
    if (novelData.some(d => d.Date === lastDate) && novelData.some(d => d.Date < lastDate)) {
      setHead({ id: novelId, series: novelData });
    }
  }, [novelId, details, novelData]);
  const current = useMemo(
    () => describeCurrentRank({
      detailDate: details?.Date, detailRank: details?.Ranking, latestDate,
      series: head && head.id === novelId ? head.series : [],
    }),
    [details, latestDate, head, novelId],
  );

  useEffect(() => {
    if (isInitialLoad && !loading) {
      setIsInitialLoad(false);
    }
  }, [loading, isInitialLoad, error]);

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
    <div>
      {isInitialLoad ? (
        <div className="text-center vh-100 d-flex align-items-center justify-content-center">
          <Spinner animation="border" />
        </div>
    ) : error ? (
      <div className="np-page-container"><Alert variant="danger" className="text-center">{error}</Alert></div>
    ) : (
      <>
          {details ? <NovelHeader details={details} backTo={{ to: '/novels/rankings', label: '일간 랭킹' }} current={current} /> : null}

          <div className="page-shell detail-chart-shell">
            <PanelCard
              title="지표별 상세 추이"
              meta="기간을 선택해 랭킹·점수·조회 흐름을 비교합니다."
              className="detail-chart-panel"
              actions={(
                <div className="detail-chart-controls">
                  <DateRangePicker
                    startDate={startDate}
                    endDate={endDate}
                    minDate={minDate}
                    maxDate={maxDate}
                    availableDates={Array.from(novelAvailableDatesSet).map(d => parseISO(d))}
                    novelAvailableDatesSet={novelAvailableDatesSet}
                    onStartDateChange={handleStartDateChange}
                    onEndDateChange={handleEndDateChange}
                    isNovelDetailPage={false}
                    noMargin={true}
                    showNovelDataIndicator={false}
                  />
                </div>
              )}
            >
              <div className="detail-chart-area position-relative">
                {loading && (
                  <div className="position-absolute w-100 h-100 d-flex justify-content-center align-items-center" style={{ top: 0, left: 0, background: 'rgba(16,17,20,0.55)', zIndex: 10 }}>
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
            </PanelCard>
          </div>
          {details ? <NovelDetailSections details={details} /> : null}
          <Modal show={showModal} onHide={() => setShowModal(false)} size="xl" centered animation={false} dialogClassName="detail-chart-modal">
            <Modal.Header closeButton>
              <Modal.Title>{selectedMetric ? `${metricConfigs[selectedMetric]?.name || selectedMetric} 상세 보기` : ''}</Modal.Title>
            </Modal.Header>
            <Modal.Body style={{ height: '76vh' }}>
              <Suspense fallback={<div className="text-center p-5"><Spinner animation="border" /></div>}>
                {renderChartInModal()}
              </Suspense>
            </Modal.Body>
          </Modal>
        </>
      )}
    </div>
  );
};

export default NovelDetailPage;
