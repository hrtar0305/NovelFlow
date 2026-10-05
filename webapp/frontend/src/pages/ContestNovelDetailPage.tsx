import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useParams } from 'react-router-dom';
import { format, parseISO, subDays } from 'date-fns';
import { useContestNovelData } from '../hooks/useContestNovelData';
import { getContestNovelTrend } from '../services/api';
import NovelHeader from '../components/novel/NovelHeader';
import AwardText from '../components/contest/AwardText';
import DateRangePicker from '../components/novel/DateRangePicker';
import { describeContestRank } from '../utils/currentRank';
import { formatDateKo, formatInt, formatMan, formatRatio } from '../utils/format';
import { LATEST_CONTEST_YEAR, contestConfig } from '../utils/contest';
import MetricsPanel from '../components/novel/MetricsPanel';
import { buildMetricPoints } from '../utils/metricSeries';
import { useUploads } from '../hooks/useUploads';

/**
 * 공모전 작품 상세(2026-09-30 개편) — 일간 작품 상세와 같은 머리·섹션 문법.
 * 공모전 이름·수상은 제목 위 눈썹 라벨이 아니라 작가 줄에 둔다. 한 줄 수치는 공모전용으로 바꾼다 — 2025 는 잔류율이 없고,
 * 2026~ 은 목록 표처럼 초반·최신 잔류를 근거 조회수와 함께 붙인다.
 * 전일 대비는 실제 직전 수집일 기준이다(DECISIONS 2026-07-01).
 */
/** 이 공모전 참가작이면 모두 다는 배지 — 공모전 상세에서는 걸러 낸다(배지 이름은 백엔드 `_badge_labels`).
 *  '자유연재'는 지금은 모두에게 있지만 PLUS 로 옮기는 작품이 생기면 갈라지는 값이라 남긴다(2026-10-04 사용자). */
const CONTEST_COMMON_BADGES = new Set(['우주최강']);

const ok = (v?: number | null): v is number => typeof v === 'number' && v >= 0;
/** 잔류율 옆 근거 '1화 6,609 → 30화 2,223' — 일간 상세 머리(NovelHeader)와 같은 표기. */
const basis = (aNum?: number | null, aView?: number | null, bNum?: number | null, bView?: number | null) => (
  ok(aNum) && ok(aView) && ok(bNum) && ok(bView)
    ? <span className="detail-head__basis">{formatInt(aNum)}화 {formatInt(aView)} → {formatInt(bNum)}화 {formatInt(bView)}</span>
    : null
);

// 같은 라우트에서 작품·연도만 바뀌면 컴포넌트가 재사용돼 기간·표지 상태와 늦게 온 이전 작품 응답이 남는다 — 작품마다 새로 띄운다
// (일간 상세 NovelDetailPage 와 같은 방식).
const ContestNovelDetailPage = () => {
  const { year = LATEST_CONTEST_YEAR, novelId } = useParams<{ year: string; novelId: string }>();
  return <ContestNovelDetailBody key={`${year}/${novelId}`} />;
};

const ContestNovelDetailBody = () => {
  const { year = LATEST_CONTEST_YEAR, novelId } = useParams<{ year: string; novelId: string }>();
  const daily = contestConfig(year).headline === 'daily';
  const {
    startDate, endDate, setStartDate, setEndDate, trendData, dataStart, details, loading, error,
    minDate, maxDate, novelAvailableDatesSet, fetchTrendData,
  } = useContestNovelData(year, novelId);


  // 머리의 전일 대비는 차트 기간과 따로, 마지막 기록일까지 열흘치를 불러와 직전 수집일과 비교한다.
  const [head, setHead] = useState<{ id: string; series: Array<{ Date: string; Ranking: number | null }> } | null>(null);
  const detailDate = (details as { Date?: string } | null)?.Date;
  useEffect(() => {
    if (!novelId || !detailDate) return;
    let cancelled = false;
    const end = parseISO(detailDate);
    getContestNovelTrend(parseInt(year, 10), novelId, format(subDays(end, 10), 'yyyy-MM-dd'), detailDate)
      .then(r => { if (!cancelled) setHead({ id: novelId, series: (r.data || []).map((d: { Date: string; Rank: number | null; DailyRank?: number | null }) => ({ Date: d.Date, Ranking: daily ? (d.DailyRank ?? null) : d.Rank })) }); })
      .catch(() => { /* 변동만 비워 둔다 */ });
    return () => { cancelled = true; };
  }, [year, novelId, detailDate, daily]);
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
  // 공모전은 전날 = 실제 직전 수집일(DECISIONS 2026-07-01).
  const points = useMemo(() => buildMetricPoints(trendData, 'collection', dataStart ?? undefined), [trendData, dataStart]);
  // 연재 기록은 2026 공모전부터(2025 는 넣지 않는다 — 연재 줄을 숨긴다).
  const uploads = useUploads(novelId, points[0]?.date, points.at(-1)?.date, year !== '2025');

  if (error) return <div className="page-shell"><p className="empty-line">{error}</p></div>;
  if (!details) return <div className="page-shell"><div className="rank-skeleton" aria-busy="true"><div /><div /><div /></div></div>;

  const ratio = details.View && details.View > 0 && details.Like != null ? details.Like / details.View : null;
  const award = details.award;
  const veteran = (details as { is_veteran?: boolean | null }).is_veteran;
  const byExtraParts: ReactNode[] = [
    award ? <AwardText award={award} /> : null,
    veteran === true ? '기성 작가' : veteran === false ? '신인 작가' : null,
    // 최신 수집이 자리표시(삭제·비공개 등)면 알린다 — 수치는 직전 정상 수집일 것이거나 비어 있다.
    details.is_unavailable ? `최근 수집에서 열리지 않음${details.values_date ? `(수치는 ${formatDateKo(details.values_date)} 기준)` : ''}` : null,
  ].filter(Boolean);
  // 참가작이면 모두 다는 공모전 배지는 이 화면에서 정보가 아니다.
  const headDetails = { ...details, badges: (details.badges ?? []).filter(b => !CONTEST_COMMON_BADGES.has(b)) };

  return (
    <div>
      <NovelHeader
        details={headDetails}
        current={current}
        backTo={{ to: `/contests/${year}`, label: `우주최강 공모전 ${year}` }}
        tagHref={t => `/contests/${year}?tag=${encodeURIComponent(t)}`}
        // 공모전 이름은 위 '‹ 우주최강 공모전 {year}' 링크에 이미 있다 — 작가 줄에는 수상·기성/신인·열리지 않음만.
        byExtra={byExtraParts.length ? <span className="detail-head__contest">{byExtraParts.map((p, i) => <span key={i}>{i ? ' · ' : ''}{p}</span>)}</span> : undefined}
        nums={[
          { label: '조회', value: formatMan(details.View) },
          { label: '추천', value: formatMan(details.Like) },
          { label: '선호', value: formatMan(details.Fav) },
          { label: '추천비', value: formatRatio(ratio, 2) },
          // 2026~ 목록 표에 있는 잔류율은 상세에도 둔다(유효 회차 30 미만이면 '–' — 대체 계산으로 채우지 않는다).
          ...(daily ? [
            { label: '초반 잔류', value: <>{formatRatio(details.EarlyRetentionRate ?? null, 0)}{details.EarlyRetentionRate != null ? basis(details.FirstEpNum, details.FirstEpView, details.Ep30Num, details.Ep30View) : null}</> },
            { label: '최신 잔류', value: <>{formatRatio(details.RecentRetentionRate ?? null, 0)}{details.RecentRetentionRate != null ? basis(details.RecentBaseNum, details.RecentBaseView, details.TargetLatestEpNum, details.TargetLatestEpView) : null}</> },
          ] : []),
        ]}
      />

      <section className="detail-sec detail-chart-panel">
        <div className="detail-sec__head">
          <h2 className="detail-sec__h">지표</h2>
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
        <div className="detail-chart-area" aria-busy={loading} style={{ opacity: loading ? 0.5 : 1, transition: 'opacity 0.2s' }}>
          {points.length > 0 ? <MetricsPanel points={points} kind="contest" uploads={uploads} />
            : (!loading && <p className="empty-line">선택한 기간에 기록이 없습니다.</p>)}
        </div>
      </section>

    </div>
  );
};

export default ContestNovelDetailPage;
