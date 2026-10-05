import { useMemo, useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { Spinner, Alert } from 'react-bootstrap';
import { useNovelData } from '../hooks/useNovelData';
import NovelHeader from '../components/novel/NovelHeader';
import { describeCurrentRank, previousCalendarDay } from '../utils/currentRank';
import { getNovelTrend } from '../services/api';
import DateRangePicker from '../components/novel/DateRangePicker';
import { format, parseISO, subDays } from 'date-fns';
import MetricsPanel from '../components/novel/MetricsPanel';
import { buildMetricPoints } from '../utils/metricSeries';
import { useUploads } from '../hooks/useUploads';

// 같은 라우트에서 작품만 바뀌면(헤더 검색 등) 컴포넌트가 재사용돼 기간 버튼·표지 '보기' 같은 상태가
// 이전 작품 것으로 남는다. 작품 ID를 key로 줘 작품마다 본문을 새로 띄운다.
const NovelDetailPage = () => {
  const { novelId } = useParams<{ novelId: string }>();
  return <NovelDetailBody key={novelId} novelId={novelId} />;
};

const NovelDetailBody = ({ novelId }: { novelId: string | undefined }) => {
  const { 
    startDate,
    endDate,
    setStartDate,
    setEndDate,
    novelData,
    dataStart,
    details,
    loading,
    error,
    minDate,
    maxDate,
    novelAvailableDatesSet,
    fetchNovelData,
  } = useNovelData(novelId);

  const [isInitialLoad, setIsInitialLoad] = useState(true);

  // 머리의 전일 대비는 차트 기간과 따로, 달력 기준 전날~마지막 기록일 2일치를 불러와 계산한다.
  // 차트 창은 작품의 첫 기록일에서 잘리므로(처음 진입한 작품은 하루뿐) 거기서 계산하면 NEW가 빠진다.
  const latestDate = maxDate ? format(maxDate, 'yyyy-MM-dd') : null;
  const [head, setHead] = useState<{ id: string; series: Array<{ Date: string; Ranking: number | null }> } | null>(null);
  useEffect(() => {
    const lastDate = details?.Date;
    if (!novelId || !lastDate || details?.ID !== novelId) return;
    let cancelled = false;
    getNovelTrend(novelId, previousCalendarDay(lastDate), lastDate)
      .then(r => { if (!cancelled) setHead({ id: novelId, series: r.data }); })
      .catch(() => { /* 실패하면 변동만 비워 둔다(순위는 상세 API 값으로 보인다) */ });
    return () => { cancelled = true; };
  }, [novelId, details]);
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

  // 기간 바로가기. 끝은 작품의 마지막 기록일이다(maxDate는 전체 최신 수집일이라, 오늘 순위권 밖인
  // 작품은 빈 차트가 된다). 훅의 초기 기간이 이미 '마지막 기록일로 끝나는 7일'이라 초기값 7과 맞는다.
  const novelLastDate = useMemo(() => {
    const last = [...novelAvailableDatesSet].sort().at(-1);
    return last ? parseISO(last) : null;
  }, [novelAvailableDatesSet]);
  const [rangeDays, setRangeDays] = useState<number | null>(7);
  const pickRange = (n: number) => {
    if (!novelLastDate) return;
    const start = subDays(novelLastDate, n - 1);
    setRangeDays(n);
    setStartDate(start);
    setEndDate(novelLastDate);
    fetchNovelData(start, novelLastDate);
  };

  const handleStartDateChange = (date: Date | null) => {
    setRangeDays(null);
    setStartDate(date);
    setEndDate(null);
  };

  const handleEndDateChange = (date: Date | null) => {
    setRangeDays(null);
    setEndDate(date);
    if (startDate && date) {
      fetchNovelData(startDate, date);
    }
  };

  const points = useMemo(() => buildMetricPoints(novelData, 'calendar', dataStart ?? undefined), [novelData, dataStart]);
  const uploads = useUploads(novelId, points[0]?.date, points.at(-1)?.date);

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

          <section className="detail-sec detail-chart-panel">
            <div className="detail-sec__head">
              <h2 className="detail-sec__h">지표</h2>
              <div className="detail-sec__range">
                {[7, 30, 90].map(n => (
                  <button key={n} type="button" className={rangeDays === n ? 'is-on' : ''} aria-pressed={rangeDays === n} onClick={() => pickRange(n)}>{n}일</button>
                ))}
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
            </div>
            <div className="detail-chart-area" aria-busy={loading} style={{ opacity: loading ? 0.5 : 1, transition: 'opacity 0.2s' }}>
              {points.length > 0 ? <MetricsPanel points={points} kind="daily" uploads={uploads} status={(details as { serial_status?: string | null } | null)?.serial_status} />
                : (!loading && <p className="empty-line">선택한 기간에 기록이 없습니다.</p>)}
            </div>
          </section>
        </>
      )}
    </div>
  );
};

export default NovelDetailPage;
