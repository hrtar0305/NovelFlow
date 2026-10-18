import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { differenceInCalendarDays, format, parseISO, subDays } from 'date-fns';
import { getAvailableDates, getTagSeries } from '../services/api';
import { SkeletonRows, Stale } from '../components/ui/Loading';
import PageTitle from '../components/ui/PageTitle';
import ViewSwitch from '../components/ui/ViewSwitch';
import InlineNums from '../components/ui/InlineNums';
import TabBar from '../components/ui/TabBar';
import ChangeMark from '../components/ui/ChangeMark';
import Footnotes, { FootnoteRef } from '../components/ui/Footnotes';
import RankTable, { type RankColumn } from '../components/ranking/RankTable';
import TagRowExpand from '../components/tag/TagRowExpand';
import DateRangePicker from '../components/novel/DateRangePicker';
import { MIN_WORKS, SHARE_MIN_CHANGE, SPIKE_MIN_SHARE, buildTagTrends, crossesSampleChange, type TagEdge, type TagSeriesResponse, type TagTrend } from '../utils/tagTrends';

/** 점유율 차이 → '+1.2%p'(0 은 부호 없이) */
const pctp = (v: number) => { const r = Math.round(v * 1000) / 10; return r === 0 ? '0%p' : `${r > 0 ? '+' : '−'}${Math.abs(r).toFixed(1)}%p`; };
import { formatDateKo, formatInt, formatRatio } from '../utils/format';

/**
 * 태그 트렌드(2026-09-30 개편) — 정한 기간 동안 무엇이 바뀌었나. 태그 랭킹이 '오늘의 지형'을 맡고
 * 여기는 '기간 동안의 변화'만 맡는다. 요약 상자·칩 패널 여섯 개를 한 줄 수치 + 탭 여섯 개 + 탭별 표로 바꿨다.
 * 패널 밑 해명 문구 두 개는 탭 이름과 주석으로 대신한다. 목록 정의는 utils/tagTrends.
 */

const RANGES = [7, 14, 30];
const DEFAULT_DAYS = 7;
/** 백엔드 /api/trends/tags/series 의 기간 상한(main.py `TAG_RANGE_MAX_DAYS`, 첫날~마지막 날 차이). 넘기면 400이다. */
const MAX_SPAN_DAYS = 180;

type Tab = 'risers' | 'fallers' | 'entered' | 'left' | 'spikes';
const TAB_LABEL: Record<Tab, string> = {
  risers: '뜬 태그', fallers: '식은 태그', entered: '새로 들어옴', left: '빠짐', spikes: '치솟았다 돌아옴',
};
const EMPTY_TEXT: Record<Tab, string> = {
  risers: `이 기간에 인기 점수가 ${pctp(SHARE_MIN_CHANGE)} 이상 오른 태그가 없습니다.`,
  fallers: `이 기간에 인기 점수가 ${pctp(SHARE_MIN_CHANGE)} 이상 내린 태그가 없습니다.`,
  entered: '이 기간에 새로 들어온 태그가 없습니다.',
  left: '이 기간에 빠진 태그가 없습니다.',
  spikes: '이 기간에 치솟았다 돌아온 태그가 없습니다.',
};

const NOTES = [
  { id: 'score', content: <>인기 점수 = 그날 순위 작품(500편)이 받은 랭킹 점수 가운데 이 태그가 달린 작품들이 차지하는 몫 — 태그 랭킹과 같은 값입니다. 한 작품에 태그가 여럿이라 태그끼리 더하면 100%를 넘습니다. 순위도 이 값 순입니다.</> },
  { id: 'tau', content: <>순서 일치도 = 첫날과 마지막 날에 다 있는 태그 두 개씩 짝지어, 두 날의 앞뒤가 같으면 +1 · 뒤집히면 −1로 센 평균(Kendall τ). 1이면 순서 그대로, 0이면 무작위입니다.</> },
  { id: 'elig', content: <>작품 {MIN_WORKS}편 이상인 태그만 봅니다(뜬 · 식은 · 치솟음과 위 요약은 첫날과 마지막 날 모두, 새로 들어옴은 마지막 날, 빠짐은 첫날). 뜬 · 식은은 인기 점수가 {pctp(SHARE_MIN_CHANGE)} 이상 바뀐 태그, 치솟았다 돌아옴은 기간 최고가 처음 · 끝보다 {pctp(SPIKE_MIN_SHARE)} 이상 높았다가 그 폭의 절반 안으로 돌아온 태그입니다.</> },
];

type SortKey = 'share' | 'rank' | 'count';
const rank = (n: number) => `${formatInt(n)}위`;
const strong = (v: ReactNode) => <b className="rank-strong">{v}</b>;
const tagCell = (tag: string) => <span className="rank-title">{tag}</span>;
const shares = (a: number, b: number) => <>{formatRatio(a)} → {formatRatio(b)}</>;

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
  const [sort, setSort] = useState<{ key: SortKey; direction: 'ascending' | 'descending' }>({ key: 'share', direction: 'descending' });

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
  // '빠짐'은 마지막 날에 그 태그가 없다 — 작품 보기는 마지막으로 집계된 날로 보낸다.
  const expand = (tag: string, at = last) => (series && last
    ? <TagRowExpand tag={tag} date={last} series={series} novelsHref={`/novels/rankings/${at}?tag=${encodeURIComponent(tag)}`} />
    : null);
  const eligAside = <FootnoteRef id="elig" n={3} />;
  const scoreAside = <FootnoteRef id="score" n={1} />;

  // 뜬 · 식은은 변화 · 순위 변동 · 작품 수로 다시 볼 수 있다(기본: 변화 — 뜬은 큰 순, 식은은 작은 순).
  const onSort = (k: string) => setSort(cur => (cur.key === k ? { key: cur.key, direction: cur.direction === 'ascending' ? 'descending' : 'ascending' } : { key: k as SortKey, direction: 'descending' }));
  const sortVal = (t: TagTrend) => (sort.key === 'share' ? t.shareChange : sort.key === 'rank' ? t.rankChange : t.last.count);
  const sorted = (rows: TagTrend[], defaultDesc: boolean) => {
    // 식은 태그의 '변화'는 내림차순 = 많이 내린 순(값이 작은 순)으로 읽힌다.
    const invert = sort.key === 'share' && !defaultDesc;
    const dir = (sort.direction === 'descending') !== invert ? -1 : 1;
    return [...rows].sort((a, b) => (sortVal(a) - sortVal(b)) * dir || a.tag.localeCompare(b.tag, 'ko'));
  };

  const trendCols: RankColumn<TagTrend>[] = [
    { key: 'tag', header: '태그', aside: eligAside, width: 'minmax(0,1fr)', render: t => tagCell(t.tag) },
    { key: 'score', header: '인기 점수', aside: scoreAside, width: '136px', align: 'right', render: t => shares(t.first.score, t.last.score) },
    { key: 'chg', header: '변화', width: '84px', align: 'right', sortKey: 'share', render: t => strong(pctp(t.shareChange)) },
    { key: 'rank', header: '순위', width: '160px', align: 'right', sortKey: 'rank', render: t => <>{rank(t.first.rank)} → {rank(t.last.rank)} <ChangeMark value={t.rankChange} /></> },
    { key: 'count', header: '작품 수', width: '96px', align: 'right', sortKey: 'count', render: t => <>{formatInt(t.first.count)} → {formatInt(t.last.count)}</> },
  ];
  const spikeCols: RankColumn<TagTrend>[] = [
    { key: 'tag', header: '태그', aside: eligAside, width: 'minmax(0,1fr)', render: t => tagCell(t.tag) },
    { key: 'first', header: '첫날', aside: scoreAside, width: '84px', align: 'right', render: t => formatRatio(t.first.score) },
    { key: 'peak', header: '기간 최고', width: '132px', align: 'right', render: t => <>{formatRatio(t.peak.score)} <small className="rank-sub">{formatDateKo(t.peak.date)}</small></> },
    { key: 'last', header: '마지막 날', width: '88px', align: 'right', render: t => formatRatio(t.last.score) },
    { key: 'spike', header: '치솟은 폭', width: '96px', align: 'right', render: t => strong(pctp(t.spike)) },
  ];
  const edgeCols = (which: 'entered' | 'left'): RankColumn<TagEdge>[] => [
    { key: 'tag', header: '태그', width: 'minmax(0,1fr)', render: e => tagCell(e.tag) },
    { key: 'rank', header: which === 'entered' ? '마지막 날 순위' : '첫날 순위', width: '120px', align: 'right', render: e => strong(rank(e.rank)) },
    { key: 'score', header: '인기 점수', aside: scoreAside, width: '96px', align: 'right', render: e => formatRatio(e.score) },
    { key: 'count', header: '작품 수', width: '88px', align: 'right', render: e => formatInt(e.count) },
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
        return <RankTable<TagTrend> {...common} ariaLabel={TAB_LABEL[tab]} rows={sorted(lists[tab], tab === 'risers')} columns={trendCols}
          sort={sort} onSort={onSort}
          onToggleRow={t => toggle(t.tag)} renderExpanded={t => expand(t.tag)}
          renderMobileRow={t => trendRow(t, <>인기 {shares(t.first.score, t.last.score)} <b>{pctp(t.shareChange)}</b> · {rank(t.first.rank)} → {rank(t.last.rank)} <ChangeMark value={t.rankChange} /> · 작품 {t.first.count} → {t.last.count}</>)} />;
      case 'spikes':
        return <RankTable<TagTrend> {...common} ariaLabel={TAB_LABEL[tab]} rows={lists.spikes} columns={spikeCols}
          onToggleRow={t => toggle(t.tag)} renderExpanded={t => expand(t.tag)}
          renderMobileRow={t => trendRow(t, <>{formatRatio(t.first.score)} → 최고 {formatRatio(t.peak.score)}({formatDateKo(t.peak.date)}) → {formatRatio(t.last.score)} · <b>{pctp(t.spike)}</b></>)} />;
      default:
        return <RankTable<TagEdge> {...common} ariaLabel={TAB_LABEL[tab]} rows={lists[tab]} columns={edgeCols(tab)}
          onToggleRow={e => toggle(e.tag)} renderExpanded={e => expand(e.tag, e.lastSeen)}
          renderMobileRow={e => (
            <div className="rank-mrow rank-mrow--plain"><div className="rank-mrow__main">{tagCell(e.tag)}<p><b>{rank(e.rank)}</b> · 인기 {formatRatio(e.score)} · 작품 {e.count}</p></div></div>
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
              availableDates={available.map(d => parseISO(d))}
              onStartDateChange={d => { setRangeDays(null); setStartDate(d); }}
              onEndDateChange={d => { setRangeDays(null); setEndDate(d); }} />
          </div>
        }
        aside={<ViewSwitch label="태그 보기" items={[
          { to: '/tags/rankings', label: '오늘', on: false },
          { to: '/tags/trends', label: '기간 트렌드', on: true },
        ]} />}
        meta={first && last && first !== last ? `수집일 ${windowDates.length}일 · 첫날과 마지막 날의 인기 점수(랭킹 점수 점유율)를 견줌` : '첫날과 마지막 날의 인기 점수(랭킹 점수 점유율)를 견줌'} />

      {first && last && crossesSampleChange(first, last) ? (
        <p className="period-warn">이 기간 중 수집 범위가 300편 → 500편으로 바뀌어(2025-07-21) 작품 수와 순위는 그대로 견줄 수 없습니다. 인기 점수(점유율)는 비율이라 비교적 견줄 만합니다.</p>
      ) : null}

      {/* 처음 받는 동안에도 같은 줄을 값만 '–'로 둔다 — 줄 수가 폭마다 달라 빈 틀로는 높이를 맞출 수 없다. */}
      {churn || loading ? (
        <Stale loading={loading}><InlineNums items={[
          { label: '평균 순위 이동', value: churn ? `${churn.footrule.toFixed(1)}계단` : '–' },
          { label: <>순서 일치도<FootnoteRef id="tau" n={2} /></>, value: churn?.tau != null ? churn.tau.toFixed(2) : '–' },
          { label: <>태그({MIN_WORKS}편 이상)</>, value: churn ? `${formatInt(churn.startTags)} → ${formatInt(churn.endTags)}개` : '–' },
          { label: '양쪽에 다 있음', value: churn ? `${formatInt(churn.common)}개` : '–' },
        ]} /></Stale>
      ) : null}

      <TabBar<Tab> ariaLabel="목록" value={tab} onChange={t => { setTab(t); setOpenTag(null); }}
        items={(Object.keys(TAB_LABEL) as Tab[]).map(k => ({ key: k, label: TAB_LABEL[k], count: series ? lists[k].length : undefined }))} />

      {error ? <p className="empty-line">{error} <button type="button" className="link-button" onClick={() => setRetry(n => n + 1)}>다시 시도</button></p>
        : loading && !series ? <SkeletonRows />
        : tooLong ? <p className="empty-line">기간은 첫날과 마지막 날이 {MAX_SPAN_DAYS}일 이내로 떨어지게 골라 주세요.</p>
        : tooShort ? <p className="empty-line">기간 안에 수집일이 2일 이상 있어야 견줄 수 있습니다.</p>
        : <Stale loading={loading}>{table()}</Stale>}

      {!error && series ? <Footnotes notes={NOTES} /> : null}
    </div>
  );
}
