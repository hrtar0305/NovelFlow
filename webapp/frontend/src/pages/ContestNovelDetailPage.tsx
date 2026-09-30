import { useEffect, useMemo, useState, lazy, Suspense } from 'react';
import { useParams } from 'react-router-dom';
import { Modal } from 'react-bootstrap';
import { format, parseISO, subDays } from 'date-fns';
import { useContestNovelData } from '../hooks/useContestNovelData';
import { getContestNovelTrend } from '../services/api';
import NovelHeader, { NovelDetailSections } from '../components/novel/NovelHeader';
import DateRangePicker from '../components/novel/DateRangePicker';
import { describeContestRank } from '../utils/currentRank';
import { formatMan, formatRatio } from '../utils/format';

const SmallMultiplesChart = lazy(() => import('../components/novel/SmallMultiplesChart'));

const metricConfigs: { [key: string]: { name: string } } = {
  Ranking: { name: '랭킹' },
  View: { name: '조회수' },
  Like: { name: '추천' },
  Fav: { name: '선호' },
};

/**
 * 공모전 작품 상세(2026-09-30 개편) — 일간 작품 상세와 같은 머리·섹션 문법.
 * 공모전 이름·수상은 제목 위 눈썹 라벨이 아니라 작가 줄에 둔다. 공모전은 잔류율이 없어 한 줄 수치에서 뺀다.
 * 전일 대비는 실제 직전 수집일 기준이다(DECISIONS 2026-07-01).
 */
const ContestNovelDetailPage = () => {
  const { year = '2025', novelId } = useParams<{ year: string; novelId: string }>();
  const {
    startDate, endDate, setStartDate, setEndDate, trendData, details, loading, error,
    minDate, maxDate, novelAvailableDatesSet, fetchTrendData,
  } = useContestNovelData(year, novelId);

  const [showModal, setShowModal] = useState(false);
  const [selectedMetric, setSelectedMetric] = useState<string | null>(null);

  // 머리의 전일 대비는 차트 기간과 따로, 마지막 기록일까지 열흘치를 불러와 직전 수집일과 비교한다.
  const [head, setHead] = useState<{ id: string; series: Array<{ Date: string; Ranking: number | null }> } | null>(null);
  const detailDate = (details as { Date?: string } | null)?.Date;
  useEffect(() => {
    if (!novelId || !detailDate) return;
    let cancelled = false;
    const end = parseISO(detailDate);
    getContestNovelTrend(parseInt(year, 10), novelId, format(subDays(end, 10), 'yyyy-MM-dd'), detailDate)
      .then(r => { if (!cancelled) setHead({ id: novelId, series: (r.data || []).map((d: { Date: string; Rank: number | null }) => ({ Date: d.Date, Ranking: d.Rank })) }); })
      .catch(() => { /* 변동만 비워 둔다 */ });
    return () => { cancelled = true; };
  }, [year, novelId, detailDate]);
  const current = useMemo(() => describeContestRank({
    detailDate, detailRank: (details as { Ranking?: number } | null)?.Ranking,
    series: head && head.id === novelId ? head.series : [],
  }), [details, detailDate, head, novelId]);

  const novelLastDate = useMemo(() => {
    const last = [...novelAvailableDatesSet].sort().at(-1);
    return last ? parseISO(last) : null;
  }, [novelAvailableDatesSet]);
  const [rangeDays, setRangeDays] = useState<number | null>(7);
  useEffect(() => { setRangeDays(7); }, [novelId]);
  const pickRange = (n: number) => {
    if (!novelLastDate) return;
    const start = subDays(novelLastDate, n - 1);
    setRangeDays(n);
    setStartDate(start);
    setEndDate(novelLastDate);
    fetchTrendData(start, novelLastDate);
  };
  const handleStartDateChange = (date: Date | null) => { setRangeDays(null); setStartDate(date); setEndDate(null); };
  const handleEndDateChange = (date: Date | null) => {
    setRangeDays(null);
    setEndDate(date);
    if (startDate && date) fetchTrendData(startDate, date);
  };
  const handleZoomClick = (metric: string) => { setSelectedMetric(metric); setShowModal(true); };

  if (error) return <div className="page-shell"><p className="empty-line">{error}</p></div>;
  if (!details) return <div className="page-shell"><div className="rank-skeleton" aria-busy="true"><div /><div /><div /></div></div>;

  const ratio = details.View && details.View > 0 && details.Like != null ? details.Like / details.View : null;
  const award = details.award;

  return (
    <div>
      <NovelHeader
        details={details}
        current={current}
        backTo={{ to: `/contests/${year}`, label: `우주최강 공모전 ${year}` }}
        byExtra={<span className="detail-head__contest">우주최강 공모전 {year}{award ? <> <b className={award === '본선' ? undefined : 'award-text'}>{award}</b></> : null}</span>}
        nums={[
          { label: '조회', value: formatMan(details.View) },
          { label: '추천', value: formatMan(details.Like) },
          { label: '선호', value: formatMan(details.Fav) },
          { label: '추천비', value: formatRatio(ratio, 2) },
        ]}
      />

      <section className="detail-sec detail-chart-panel">
        <div className="detail-sec__head">
          <h2 className="detail-sec__h">지표 변화</h2>
          <div className="detail-sec__range">
            {[7, 30, 90].map(n => (
              <button key={n} type="button" className={rangeDays === n ? 'is-on' : ''} aria-pressed={rangeDays === n} onClick={() => pickRange(n)}>{n}일</button>
            ))}
            <DateRangePicker
              startDate={startDate} endDate={endDate} minDate={minDate} maxDate={maxDate}
              availableDates={Array.from(novelAvailableDatesSet).map(d => parseISO(d))} novelAvailableDatesSet={novelAvailableDatesSet}
              onStartDateChange={handleStartDateChange} onEndDateChange={handleEndDateChange}
              isNovelDetailPage={false} noMargin={true} showNovelDataIndicator={false}
            />
          </div>
        </div>
        <div className="detail-chart-area position-relative" aria-busy={loading}>
          <div style={{ opacity: loading ? 0.5 : 1, transition: 'opacity 0.2s' }}>
            {trendData.length > 0 ? (
              <Suspense fallback={<div className="rank-skeleton" aria-busy="true"><div /><div /><div /></div>}>
                <SmallMultiplesChart data={trendData} hasBothPeriods={false} onZoomClick={handleZoomClick} metricConfigs={metricConfigs} />
              </Suspense>
            ) : (!loading && <p className="empty-line">선택한 기간에 기록이 없습니다.</p>)}
          </div>
        </div>
      </section>

      <NovelDetailSections details={details} tagHref={t => `/contests/${year}?tag=${encodeURIComponent(t)}`} />

      <Modal show={showModal} onHide={() => setShowModal(false)} size="xl" centered animation={false} dialogClassName="detail-chart-modal">
        <Modal.Header closeButton><Modal.Title>{selectedMetric ? `${metricConfigs[selectedMetric]?.name || selectedMetric} 크게 보기` : ''}</Modal.Title></Modal.Header>
        <Modal.Body style={{ height: '76vh' }}>
          <Suspense fallback={<div className="rank-skeleton" aria-busy="true"><div /><div /><div /></div>}>
            {selectedMetric ? <SmallMultiplesChart data={trendData} hasBothPeriods={false} onZoomClick={() => {}} isModal={true} metricConfigs={metricConfigs} modalMetric={selectedMetric} /> : null}
          </Suspense>
        </Modal.Body>
      </Modal>
    </div>
  );
};

export default ContestNovelDetailPage;
