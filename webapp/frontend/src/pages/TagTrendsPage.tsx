import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { differenceInCalendarDays, format, parseISO, subDays } from 'date-fns';
import { getAvailableDates, getTagSeries } from '../services/api';
import PageTitle from '../components/ui/PageTitle';
import ViewSwitch from '../components/ui/ViewSwitch';
import InlineNums from '../components/ui/InlineNums';
import TabBar from '../components/ui/TabBar';
import ChangeMark from '../components/ui/ChangeMark';
import Footnotes, { FootnoteRef } from '../components/ui/Footnotes';
import RankTable, { type RankColumn } from '../components/ranking/RankTable';
import TagRowExpand from '../components/tag/TagRowExpand';
import DateRangePicker from '../components/novel/DateRangePicker';
import { MIN_WORKS, SPIKE_MIN, SWING_DAYS, SWING_TOP, buildTagTrends, type TagEdge, type TagSeriesResponse, type TagTrend } from '../utils/tagTrends';
import { formatInt } from '../utils/format';

/**
 * 태그 트렌드(2026-09-30 개편) — 정한 기간 동안 무엇이 바뀌었나. 태그 랭킹이 '오늘의 지형'을 맡고
 * 여기는 '기간 동안의 변화'만 맡는다. 요약 상자·칩 패널 여섯 개를 한 줄 수치 + 탭 여섯 개 + 탭별 표로 바꿨다.
 * 패널 밑 해명 문구 두 개는 탭 이름과 주석으로 대신한다. 목록 정의는 utils/tagTrends.
 */

const RANGES = [7, 14, 30];
const DEFAULT_DAYS = 7;
/** 백엔드 /api/trends/tags/series 의 기간 상한(main.py `TAG_RANGE_MAX_DAYS`, 첫날~마지막 날 차이). 넘기면 400이다. */
const MAX_SPAN_DAYS = 180;

type Tab = 'risers' | 'fallers' | 'entered' | 'left' | 'spikes' | 'swings';
const TAB_LABEL: Record<Tab, string> = {
  risers: '뜬 태그', fallers: '식은 태그', entered: '새로 들어옴', left: '빠짐', spikes: '치솟았다 돌아옴', swings: '많이 출렁임',
};
const EMPTY_TEXT: Record<Tab, string> = {
  risers: '이 기간에 순위가 오른 태그가 없습니다.',
  fallers: '이 기간에 순위가 내린 태그가 없습니다.',
  entered: '이 기간에 새로 들어온 태그가 없습니다.',
  left: '이 기간에 빠진 태그가 없습니다.',
  spikes: '이 기간에 치솟았다 돌아온 태그가 없습니다.',
  swings: '이 기간에 출렁인 태그가 없습니다.',
};

const NOTES = [
  { id: 'tau', content: <>순서 일치도 = 첫날과 마지막 날에 다 있는 태그 두 개씩 짝지어, 두 날의 앞뒤가 같으면 +1 · 뒤집히면 −1로 센 평균(Kendall τ). 1이면 순서 그대로, 0이면 무작위입니다.</> },
  { id: 'elig', content: <>뜬 태그 · 식은 태그 · 치솟았다 돌아옴 · 많이 출렁임은 첫날과 마지막 날 모두, 새로 들어옴은 마지막 날 · 빠짐은 첫날 작품 {MIN_WORKS}편 이상인 태그만 봅니다. 치솟았다 돌아옴은 첫날·마지막 날 중 나은 순위보다 {SPIKE_MIN}계단 이상 위로 갔던 태그, 많이 출렁임은 기록이 {SWING_DAYS}일 이상인 태그 중 최고~최저 폭이 큰 {SWING_TOP}개입니다.</> },
];

const rank = (n: number) => `${formatInt(n)}위`;
const pct = (v: number) => `${v >= 0 ? '+' : '−'}${Math.abs(Math.round(v * 100))}%`;
const strong = (v: ReactNode) => <b className="rank-strong">{v}</b>;
const tagCell = (tag: string) => <span className="rank-title">{tag}</span>;

export default function TagTrendsPage() {
  const [available, setAvailable] = useState<string[]>([]);
  const [startDate, setStartDate] = useState<Date | null>(null);
  const [endDate, setEndDate] = useState<Date | null>(null);
  const [rangeDays, setRangeDays] = useState<number | null>(DEFAULT_DAYS);
  const [series, setSeries] = useState<TagSeriesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('risers');
  const [openTag, setOpenTag] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);

  const latest = useMemo(() => (available.length ? parseISO([...available].sort().at(-1)!) : null), [available]);

  useEffect(() => {
    getAvailableDates()
      .then(r => {
        const ds: string[] = r.data.available_dates ?? [];
        setAvailable(ds);
        if (ds.length) {
          const last = parseISO([...ds].sort().at(-1)!);
          setEndDate(last);
          setStartDate(subDays(last, DEFAULT_DAYS - 1));
        } else setLoading(false);
      })
      .catch(() => { setError('수집일 목록을 불러오지 못했습니다.'); setLoading(false); });
  }, []);

  const windowDates = useMemo(() => {
    if (!startDate || !endDate) return [];
    const s = format(startDate, 'yyyy-MM-dd');
    const e = format(endDate, 'yyyy-MM-dd');
    return available.filter(d => d >= s && d <= e).sort();
  }, [available, startDate, endDate]);
  const hasDates = available.length > 0;
  const first = windowDates[0];
  const last = windowDates.at(-1);
  // 사용자 지정 기간이 상한을 넘으면 부르지 않고 안내한다 — 부르면 400이 '불러오지 못했습니다'로만 보이고 다시 시도해도 같다.
  const tooLong = !!first && !!last && differenceInCalendarDays(parseISO(last), parseISO(first)) > MAX_SPAN_DAYS;

  useEffect(() => {
    if (tooLong) { setSeries(null); setError(null); setLoading(false); return; }
    if (!first || !last || first === last) { setSeries(null); if (hasDates) setLoading(false); return; }
    let cancelled = false;
    setLoading(true);
    setError(null);
    setOpenTag(null);
    // 기간 전체를 한 번에 받는다(백엔드 batch_get_item — 날짜마다 부르면 30일에 12초, 묶으면 3초).
    getTagSeries(first, last)
      .then(r => { if (!cancelled) setSeries(r.data as TagSeriesResponse); })
      .catch(() => { if (!cancelled) { setSeries(null); setError('태그 데이터를 불러오지 못했습니다.'); } })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [first, last, hasDates, tooLong, retry]);

  const lists = useMemo(() => buildTagTrends(series), [series]);
  const { churn } = lists;

  const pickRange = (n: number) => {
    if (!latest) return;
    setRangeDays(n);
    setStartDate(subDays(latest, n - 1));
    setEndDate(latest);
  };
  const toggle = (tag: string) => setOpenTag(cur => (cur === tag ? null : tag));
  const expand = (tag: string) => (series && last
    ? <TagRowExpand tag={tag} date={last} series={series} novelsHref={`/novels/rankings/${last}?tag=${encodeURIComponent(tag)}`} />
    : null);
  const eligAside = <FootnoteRef id="elig" n={2} />;

  const trendCols: RankColumn<TagTrend>[] = [
    { key: 'tag', header: '태그', aside: eligAside, width: 'minmax(0,1fr)', render: t => tagCell(t.tag) },
    { key: 'first', header: '첫날', width: '76px', render: t => rank(t.first.rank) },
    { key: 'last', header: '마지막 날', width: '84px', render: t => rank(t.last.rank) },
    { key: 'chg', header: '변동', width: '72px', render: t => strong(<ChangeMark value={t.rankChange} />) },
    { key: 'best', header: '기간 최고', width: '84px', render: t => rank(t.bestRank) },
    { key: 'count', header: '작품 수', width: '104px', render: t => <>{formatInt(t.first.count)} → {formatInt(t.last.count)}</> },
    { key: 'score', header: '인기 점수', width: '88px', render: t => pct(t.scoreChange) },
  ];
  const spikeCols: RankColumn<TagTrend>[] = [
    { key: 'tag', header: '태그', aside: eligAside, width: 'minmax(0,1fr)', render: t => tagCell(t.tag) },
    { key: 'first', header: '첫날', width: '84px', render: t => rank(t.first.rank) },
    { key: 'best', header: '기간 최고', width: '88px', render: t => rank(t.bestRank) },
    { key: 'last', header: '마지막 날', width: '88px', render: t => rank(t.last.rank) },
    { key: 'spike', header: '치솟은 폭', width: '96px', render: t => strong(`${formatInt(t.spike)}계단`) },
  ];
  const swingCols: RankColumn<TagTrend>[] = [
    { key: 'tag', header: '태그', aside: eligAside, width: 'minmax(0,1fr)', render: t => tagCell(t.tag) },
    { key: 'best', header: '최고', width: '84px', render: t => rank(t.bestRank) },
    { key: 'worst', header: '최저', width: '84px', render: t => rank(t.worstRank) },
    { key: 'swing', header: '폭', width: '88px', render: t => strong(`${formatInt(t.swing)}계단`) },
    { key: 'last', header: '마지막 날', width: '88px', render: t => rank(t.last.rank) },
  ];
  const edgeCols = (which: 'entered' | 'left'): RankColumn<TagEdge>[] => [
    { key: 'tag', header: '태그', width: 'minmax(0,1fr)', render: e => tagCell(e.tag) },
    { key: 'rank', header: which === 'entered' ? '마지막 날 순위' : '첫날 순위', width: '120px', render: e => strong(rank(e.rank)) },
    { key: 'count', header: '작품 수', width: '88px', render: e => formatInt(e.count) },
  ];

  const trendRow = (t: TagTrend, facts: ReactNode) => (
    <div className="rank-mrow rank-mrow--plain">
      <div className="rank-mrow__main">{tagCell(t.tag)}<p>{facts}</p></div>
    </div>
  );
  const common = { rowKey: (r: { tag: string }) => r.tag, rowHeight: 52, expandedKey: openTag, expandOnMobile: true, emptyText: EMPTY_TEXT[tab] };

  const table = () => {
    switch (tab) {
      case 'risers':
      case 'fallers':
        return <RankTable<TagTrend> {...common} ariaLabel={TAB_LABEL[tab]} rows={lists[tab]} columns={trendCols}
          onToggleRow={t => toggle(t.tag)} renderExpanded={t => expand(t.tag)}
          renderMobileRow={t => trendRow(t, <>{rank(t.first.rank)} → <b>{rank(t.last.rank)}</b> <ChangeMark value={t.rankChange} /> · 작품 {t.first.count} → {t.last.count} · 점수 {pct(t.scoreChange)}</>)} />;
      case 'spikes':
        return <RankTable<TagTrend> {...common} ariaLabel={TAB_LABEL[tab]} rows={lists.spikes} columns={spikeCols}
          onToggleRow={t => toggle(t.tag)} renderExpanded={t => expand(t.tag)}
          renderMobileRow={t => trendRow(t, <>{rank(t.first.rank)} → 최고 {rank(t.bestRank)} → {rank(t.last.rank)} · <b>{t.spike}계단</b></>)} />;
      case 'swings':
        return <RankTable<TagTrend> {...common} ariaLabel={TAB_LABEL[tab]} rows={lists.swings} columns={swingCols}
          onToggleRow={t => toggle(t.tag)} renderExpanded={t => expand(t.tag)}
          renderMobileRow={t => trendRow(t, <>{rank(t.bestRank)} ~ {rank(t.worstRank)} · <b>{t.swing}계단</b> · 마지막 날 {rank(t.last.rank)}</>)} />;
      default:
        return <RankTable<TagEdge> {...common} ariaLabel={TAB_LABEL[tab]} rows={lists[tab]} columns={edgeCols(tab)}
          onToggleRow={e => toggle(e.tag)} renderExpanded={e => expand(e.tag)}
          renderMobileRow={e => (
            <div className="rank-mrow rank-mrow--plain"><div className="rank-mrow__main">{tagCell(e.tag)}<p><b>{rank(e.rank)}</b> · 작품 {e.count}</p></div></div>
          )} />;
    }
  };

  const tooShort = !loading && !error && windowDates.length > 0 && windowDates.length < 2;

  return (
    <div className="page-shell tag-trends-page">
      <PageTitle title="태그 트렌드"
        nav={
          <div className="period-pick">
            {RANGES.map(n => (
              <button key={n} type="button" className={rangeDays === n ? 'is-on' : undefined} aria-pressed={rangeDays === n} onClick={() => pickRange(n)}>{n}일</button>
            ))}
            <DateRangePicker startDate={startDate} endDate={endDate}
              availableDates={available.map(d => parseISO(d))} novelAvailableDatesSet={new Set(available)}
              onStartDateChange={d => { setRangeDays(null); setStartDate(d); }}
              onEndDateChange={d => { setRangeDays(null); setEndDate(d); }}
              noMargin showNovelDataIndicator={false} />
          </div>
        }
        aside={<ViewSwitch label="태그 보기" items={[
          { to: '/tags/rankings', label: '오늘', on: false },
          { to: '/tags/trends', label: '기간 트렌드', on: true },
        ]} />}
        meta={first && last && first !== last ? `수집일 ${windowDates.length}일 · 첫날과 마지막 날의 태그 순위를 견줌` : '첫날과 마지막 날의 태그 순위를 견줌'} />

      {churn && !loading ? (
        <InlineNums items={[
          { label: '평균 순위 이동', value: `${churn.footrule.toFixed(1)}계단` },
          { label: <>순서 일치도<FootnoteRef id="tau" n={1} /></>, value: churn.tau != null ? churn.tau.toFixed(2) : '–' },
          { label: '태그', value: `${formatInt(churn.startTags)} → ${formatInt(churn.endTags)}개` },
          { label: '양쪽에 다 있음', value: `${formatInt(churn.common)}개` },
        ]} />
      ) : null}

      <TabBar<Tab> ariaLabel="목록" value={tab} onChange={t => { setTab(t); setOpenTag(null); }}
        items={(Object.keys(TAB_LABEL) as Tab[]).map(k => ({ key: k, label: TAB_LABEL[k], count: series ? lists[k].length : undefined }))} />

      {error ? <p className="empty-line">{error} <button type="button" className="link-button" onClick={() => setRetry(n => n + 1)}>다시 시도</button></p>
        : loading ? <div className="rank-skeleton" aria-busy="true">{Array.from({ length: 8 }, (_, i) => <div key={i} />)}</div>
        : tooLong ? <p className="empty-line">기간은 첫날과 마지막 날이 {MAX_SPAN_DAYS}일 이내로 떨어지게 골라 주세요.</p>
        : tooShort ? <p className="empty-line">기간 안에 수집일이 2일 이상 있어야 견줄 수 있습니다.</p>
        : table()}

      {!error && !loading && series ? <Footnotes notes={NOTES} /> : null}
    </div>
  );
}
