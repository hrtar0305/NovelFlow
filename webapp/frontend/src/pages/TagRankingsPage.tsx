import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { format, isValid, parseISO, subDays } from 'date-fns';
import { getAvailableDates, getTagRankingsByDate, getTagSeries } from '../services/api';
import PageTitle from '../components/ui/PageTitle';
import DateNav from '../components/ui/DateNav';
import ViewSwitch from '../components/ui/ViewSwitch';
import TagRowExpand from '../components/tag/TagRowExpand';
import type { TagSeriesResponse } from '../utils/tagTrends';
import DailyTagBoard from '../components/tag/DailyTagBoard';
import type { DailyTag } from '../utils/tagZones';

/**
 * 태그 랭킹(2026-09-30 개편). 요약 카드·선택 패널·구역 칩 패널·변동 카드를 걷고
 * 표 하나 + 구역 필터 + 행 펼침(14일 순위선) + 지형 지도로 줄였다(판은 `DailyTagBoard` — 2026 공모전 태그와 공유).
 * 뜬·식은·새로 진입 탭은 두지 않는다 — 일간 작품 표와 같이 변동 열 정렬이 그 목록이다.
 */

const HISTORY_DAYS = 14;

export default function TagRankingsPage() {
  const { date: dateParam } = useParams();
  const navigate = useNavigate();

  const [dates, setDates] = useState<Set<string>>(new Set());
  const [tags, setTags] = useState<DailyTag[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openTag, setOpenTag] = useState<string | null>(null);
  const [series, setSeries] = useState<{ date: string; data: TagSeriesResponse | 'loading' | 'error' } | null>(null);

  useEffect(() => {
    getAvailableDates()
      .then(r => setDates(new Set<string>(r.data.available_dates || [])))
      .catch(() => { setError('수집일 목록을 불러오지 못했습니다.'); setLoading(false); });
  }, []);

  useEffect(() => {
    if (dates.size === 0) return;
    if (!dateParam || !isValid(parseISO(dateParam)) || !dates.has(dateParam)) {
      navigate(`/tags/rankings/${[...dates].sort().at(-1)}`, { replace: true });
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    setOpenTag(null);
    getTagRankingsByDate(dateParam)
      .then(r => { if (!cancelled) setTags(Array.isArray(r.data) ? r.data : []); })
      .catch(() => { if (!cancelled) { setTags([]); setError('태그 랭킹을 불러오지 못했습니다.'); } })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [dateParam, dates, navigate]);

  // 행을 처음 펼칠 때 14일치를 한 번 받는다. 응답에 그 기간의 모든 태그가 들어 있어 다른 행은 추가 호출이 없다.
  // 요청한 날짜는 ref로 기억한다 — series를 의존성에 넣으면 'loading'으로 바꾸는 순간 정리 함수가 돌아 응답을 버린다.
  const requested = useRef<string | null>(null);
  useEffect(() => {
    if (!openTag || !dateParam || requested.current === dateParam) return;
    requested.current = dateParam;
    const key = dateParam;
    setSeries({ date: key, data: 'loading' });
    getTagSeries(format(subDays(parseISO(key), HISTORY_DAYS - 1), 'yyyy-MM-dd'), key)
      .then(r => setSeries(cur => (cur?.date === key ? { date: key, data: r.data as TagSeriesResponse } : cur)))
      .catch(() => {
        if (requested.current === key) requested.current = null;   // 다음에 펼칠 때 다시 시도
        setSeries(cur => (cur?.date === key ? { date: key, data: 'error' } : cur));
      });
  }, [openTag, dateParam]);

  return (
    <div className="page-shell tag-rankings-page">
      <PageTitle title="태그 랭킹"
        nav={<DateNav value={dateParam ?? null} availableDates={dates} onChange={d => navigate(`/tags/rankings/${d}`)} />}
        aside={<ViewSwitch label="태그 보기" items={[
          { to: `/tags/rankings${dateParam ? `/${dateParam}` : ''}`, label: '오늘', on: true },
          { to: '/tags/trends', label: '기간 트렌드', on: false },
        ]} />}
        meta={`일간 랭킹 ${tags[0]?.ranked_total ? `${tags[0].ranked_total}편` : '작품'}에 달린 태그 · 인기 점수(랭킹 점수 점유율) 순`} />

      <DailyTagBoard tags={tags} loading={loading} error={error} resetKey={dateParam}
        scoreLabel="랭킹 점수"
        ariaLabel="태그 순위" emptyText="이 날짜의 태그 랭킹이 없습니다."
        onOpenTag={setOpenTag}
        renderExpanded={t => (
          <TagRowExpand tag={t.tag} date={dateParam!}
            series={series && series.date === dateParam ? series.data : 'loading'}
            novelsHref={`/novels/rankings/${dateParam}?tag=${encodeURIComponent(t.tag)}`} />
        )} />
    </div>
  );
}
