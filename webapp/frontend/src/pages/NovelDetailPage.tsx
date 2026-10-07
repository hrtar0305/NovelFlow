import { useMemo, useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { useNovelData } from '../hooks/useNovelData';
import NovelHeader from '../components/novel/NovelHeader';
import { describeCurrentRank, previousCalendarDay } from '../utils/currentRank';
import { getNovelTrend } from '../services/api';
import { format } from 'date-fns';
import MetricsSection from '../components/novel/MetricsSection';
import { buildMetricPoints } from '../utils/metricSeries';
import { useUploads } from '../hooks/useUploads';

// 같은 라우트에서 작품만 바뀌면(헤더 검색 등) 컴포넌트가 재사용돼 기간 버튼·표지 '보기' 같은 상태가
// 이전 작품 것으로 남는다. 작품 ID를 key로 줘 작품마다 본문을 새로 띄운다.
const NovelDetailPage = () => {
  const { novelId } = useParams<{ novelId: string }>();
  return <NovelDetailBody key={novelId} novelId={novelId} />;
};

const NovelDetailBody = ({ novelId }: { novelId: string | undefined }) => {
  const data = useNovelData(novelId);
  const { novelData, dataStart, details, error, maxDate } = data;

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

  const points = useMemo(() => buildMetricPoints(novelData, 'calendar', dataStart ?? undefined), [novelData, dataStart]);
  const uploads = useUploads(novelId, points[0]?.date, points.at(-1)?.date);

  if (error) return <div className="page-shell"><p className="empty-line">{error}</p></div>;
  if (!details) return <div className="page-shell"><div className="rank-skeleton" aria-busy="true"><div /><div /><div /></div></div>;

  return (
    <div>
      <NovelHeader details={details} backTo={{ to: '/novels/rankings', label: '일간 랭킹' }} current={current} />
      <MetricsSection {...data} fetchRange={data.fetchNovelData} kind="daily" points={points} uploads={uploads} />
    </div>
  );
};

export default NovelDetailPage;
