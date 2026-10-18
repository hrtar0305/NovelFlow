import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { differenceInCalendarDays, format, parseISO, subDays } from 'date-fns';
import { getAvailableDates, getTagSeries } from '../services/api';
import { SkeletonRows, Stale } from '../components/ui/Loading';
import PageTitle from '../components/ui/PageTitle';
import ViewSwitch from '../components/ui/ViewSwitch';
import TabBar from '../components/ui/TabBar';
import Footnotes, { FootnoteRef } from '../components/ui/Footnotes';
import RankTable, { type RankColumn } from '../components/ranking/RankTable';
import TagRowExpand from '../components/tag/TagRowExpand';
import { ZoneName } from '../components/tag/DailyTagBoard';
import { sharePct, shareNoteText, zoneNoteText } from '../utils/tagZones';
import DateRangePicker from '../components/novel/DateRangePicker';
import { MIN_WORKS, SHARE_MIN_CHANGE, SPIKE_MIN_SHARE, buildTagTrends, crossesSampleChange, type TagEdge, type TagSeriesResponse, type TagTrend, type ZoneMove } from '../utils/tagTrends';

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

type Tab = 'risers' | 'fallers' | 'entered' | 'left' | 'spikes' | 'zones';
const TAB_LABEL: Record<Tab, string> = {
  // 짝이 보이는 두 글자 명사로 통일(사용자 2026-10-18) — 예전엔 '뜬 태그' · '빠짐' · '치솟았다 돌아옴'처럼 꼴이 섞였다.
  risers: '상승', fallers: '하락', entered: '진입', left: '이탈', spikes: '반짝', zones: '구역 이동',
};
const EMPTY_TEXT: Record<Tab, string> = {
  risers: `이 기간에 인기 점수가 ${pctp(SHARE_MIN_CHANGE).slice(1)} 이상 오른 태그가 없습니다.`,
  fallers: `이 기간에 인기 점수가 ${pctp(SHARE_MIN_CHANGE).slice(1)} 이상 내린 태그가 없습니다.`,
  entered: '이 기간에 진입한 태그가 없습니다.',
  left: '이 기간에 이탈한 태그가 없습니다.',
  spikes: '이 기간에 반짝 오른 태그가 없습니다.',
  zones: '이 기간에 구역을 옮긴 태그가 없습니다.',
};

// 각주는 탭마다 그 표의 열 순서대로, 값의 식 한 줄씩(태그 랭킹과 같은 글귀 — 2026-10-18).
const SCORE_NOTE = "인기 점수 = 이 태그 작품들의 랭킹 점수 합 ÷ 그날 순위 작품 전체의 랭킹 점수 합. 랭킹 점수는 노벨피아가 매긴 일간 랭킹 점수(랭킹 표의 '점수').";
const BOTH_ENDS = `첫날과 마지막 날 모두 작품 ${MIN_WORKS}편 이상인 태그.`;
const notesFor = (tab: Tab, N: number | null | undefined): { id: string; content: ReactNode }[] => {
  switch (tab) {
    case 'risers':
    case 'fallers':
      return [{ id: 'elig', content: BOTH_ENDS }, { id: 'score', content: SCORE_NOTE },
        { id: 'chg', content: `변화 = 마지막 날 인기 점수 − 첫날 인기 점수. 상승 ${pctp(SHARE_MIN_CHANGE)} 이상, 하락 ${pctp(-SHARE_MIN_CHANGE)} 이하.` }];
    case 'spikes':
      return [{ id: 'elig', content: BOTH_ENDS }, { id: 'score', content: SCORE_NOTE },
        { id: 'spike', content: `치솟은 폭 = 기간 최고 − 첫날·마지막 날 중 높은 쪽. ${pctp(SPIKE_MIN_SHARE)} 이상이고, 마지막 날 − 첫날이 그 폭의 절반 안인 태그.` }];
    case 'entered':
      return [{ id: 'elig', content: `첫날 집계에 없고(작품 2편 미만) 마지막 날 작품 ${MIN_WORKS}편 이상인 태그.` }, { id: 'score', content: SCORE_NOTE }];
    case 'left':
      return [{ id: 'elig', content: `첫날 작품 ${MIN_WORKS}편 이상이고 마지막 날 집계에 없는(작품 2편 미만) 태그.` }, { id: 'score', content: SCORE_NOTE }];
    case 'zones':
      return [{ id: 'elig', content: '첫날과 마지막 날의 구역이 다른 태그. 어느 한쪽이 경계면 제외.' },
        { id: 'zone', content: zoneNoteText(N) }, { id: 'share', content: shareNoteText(N) }];
  }
};

type SortKey = 'share' | 'count';
const rank = (n: number) => `${formatInt(n)}위`;
const strong = (v: ReactNode) => <b className="rank-strong">{v}</b>;
const tagCell = (tag: string) => <span className="rank-title">{tag}</span>;
const shares = (a: number, b: number) => <>{formatRatio(a)} → {formatRatio(b)}</>;
const topShare = (e: { count: number; top: number }, N: number | null | undefined) => (e.count >= MIN_WORKS ? sharePct(e.top / e.count, N) : '–');

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
  const N = series?.ranked_total?.at(-1);
  const notes = notesFor(tab, N);
  const ref = (id: string) => <FootnoteRef id={id} n={notes.findIndex(x => x.id === id) + 1} />;

  const pickRange = (n: number) => {
    if (!latest) return;
    setRangeDays(n);
    setStartDate(subDays(latest, n - 1));
    setEndDate(latest);
  };
  const toggle = (tag: string) => setOpenTag(cur => (cur === tag ? null : tag));
  // '이탈'은 마지막 날에 그 태그가 없다 — 작품 보기는 마지막으로 집계된 날로 보낸다.
  const expand = (tag: string, at = last) => (series && last
    ? <TagRowExpand tag={tag} date={last} series={series} novelsHref={`/novels/rankings/${at}?tag=${encodeURIComponent(tag)}`} />
    : null);
  const eligAside = ref('elig');
  const scoreAside = ref('score');

  // 뜬 · 식은은 변화 · 작품 수로 다시 볼 수 있다(기본: 변화 — 뜬은 큰 순, 식은은 작은 순). 순위 변동 열은 뺐다(2026-10-18) — 큰 태그는
  // 점수가 1%p 넘게 움직여도 순위 그대로, 작은 태그는 0.2%p 에 10칸 넘게 움직여 순위 정렬이 작은 태그 목록이 됐다.
  const onSort = (k: string) => setSort(cur => (cur.key === k ? { key: cur.key, direction: cur.direction === 'ascending' ? 'descending' : 'ascending' } : { key: k as SortKey, direction: 'descending' }));
  const sortVal = (t: TagTrend) => (sort.key === 'share' ? t.shareChange : t.last.count);
  const sorted = (rows: TagTrend[], defaultDesc: boolean) => {
    // 식은 태그의 '변화'는 내림차순 = 많이 내린 순(값이 작은 순)으로 읽힌다.
    const invert = sort.key === 'share' && !defaultDesc;
    const dir = (sort.direction === 'descending') !== invert ? -1 : 1;
    return [...rows].sort((a, b) => (sortVal(a) - sortVal(b)) * dir || a.tag.localeCompare(b.tag, 'ko'));
  };

  // 숫자도 왼쪽 정렬, 남는 폭은 열마다 나눈다 — 태그 랭킹과 같다(오른쪽 정렬이면 정렬 표시 때문에 머리글과 값의 끝이 어긋났다).
  const trendCols: RankColumn<TagTrend>[] = [
    { key: 'tag', header: '태그', aside: eligAside, width: 'minmax(0,1.2fr)', render: t => tagCell(t.tag) },
    { key: 'score', header: '인기 점수', aside: scoreAside, width: 'minmax(140px,1fr)', render: t => shares(t.first.score, t.last.score) },
    { key: 'chg', header: '변화', aside: ref('chg'), width: 'minmax(96px,0.8fr)', sortKey: 'share', render: t => strong(pctp(t.shareChange)) },
    { key: 'count', header: '작품 수', width: 'minmax(104px,0.8fr)', sortKey: 'count', render: t => <>{formatInt(t.first.count)} → {formatInt(t.last.count)}</> },
  ];
  const spikeCols: RankColumn<TagTrend>[] = [
    { key: 'tag', header: '태그', aside: eligAside, width: 'minmax(0,1.2fr)', render: t => tagCell(t.tag) },
    { key: 'first', header: '첫날', aside: scoreAside, width: 'minmax(84px,0.7fr)', render: t => formatRatio(t.first.score) },
    { key: 'peak', header: '기간 최고', width: 'minmax(132px,0.9fr)', render: t => <>{formatRatio(t.peak.score)} <small className="rank-sub">{formatDateKo(t.peak.date)}</small></> },
    { key: 'last', header: '마지막 날', width: 'minmax(84px,0.7fr)', render: t => formatRatio(t.last.score) },
    { key: 'spike', header: '치솟은 폭', aside: ref('spike'), width: 'minmax(96px,0.7fr)', render: t => strong(pctp(t.spike)) },
  ];
  const edgeCols = (which: 'entered' | 'left'): RankColumn<TagEdge>[] => [
    { key: 'tag', header: '태그', aside: eligAside, width: 'minmax(0,1.2fr)', render: e => tagCell(e.tag) },
    { key: 'rank', header: which === 'entered' ? '마지막 날 순위' : '첫날 순위', width: 'minmax(112px,0.8fr)', render: e => strong(rank(e.rank)) },
    { key: 'score', header: '인기 점수', aside: scoreAside, width: 'minmax(96px,0.8fr)', render: e => formatRatio(e.score) },
    { key: 'count', header: '작품 수', width: 'minmax(80px,0.8fr)', render: e => formatInt(e.count) },
  ];
  const zoneCols: RankColumn<ZoneMove>[] = [
    { key: 'tag', header: '태그', aside: eligAside, width: 'minmax(0,1.2fr)', render: m => tagCell(m.tag) },
    { key: 'zone', header: '구역', aside: ref('zone'), width: 'minmax(200px,1.2fr)', render: m => <><ZoneName zone={m.from} none="구역 없음" /> → <ZoneName zone={m.to} none="구역 없음" /></> },
    { key: 'share', header: '100위 안 비율', aside: ref('share'), width: 'minmax(120px,0.9fr)', render: m => strong(<>{topShare(m.first, series?.ranked_total?.[0])} → {topShare(m.last, N)}</>) },
    { key: 'count', header: '작품 수', width: 'minmax(96px,0.8fr)', render: m => <>{formatInt(m.first.count)} → {formatInt(m.last.count)}</> },
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
          renderMobileRow={t => trendRow(t, <>인기 {shares(t.first.score, t.last.score)} <b>{pctp(t.shareChange)}</b> · 작품 {t.first.count} → {t.last.count}</>)} />;
      case 'spikes':
        return <RankTable<TagTrend> {...common} ariaLabel={TAB_LABEL[tab]} rows={lists.spikes} columns={spikeCols}
          onToggleRow={t => toggle(t.tag)} renderExpanded={t => expand(t.tag)}
          renderMobileRow={t => trendRow(t, <>{formatRatio(t.first.score)} → 최고 {formatRatio(t.peak.score)}({formatDateKo(t.peak.date)}) → {formatRatio(t.last.score)} · <b>{pctp(t.spike)}</b></>)} />;
      case 'zones':
        return <RankTable<ZoneMove> {...common} ariaLabel={TAB_LABEL[tab]} rows={lists.zones} columns={zoneCols}
          onToggleRow={m => toggle(m.tag)} renderExpanded={m => expand(m.tag)}
          renderMobileRow={m => (
            <div className="rank-mrow rank-mrow--plain"><div className="rank-mrow__main">{tagCell(m.tag)}<p><ZoneName zone={m.from} none="구역 없음" /> → <ZoneName zone={m.to} none="구역 없음" /> · 100위 안 비율 <b>{topShare(m.first, series?.ranked_total?.[0])} → {topShare(m.last, N)}</b></p></div></div>
          )} />;
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
        meta={first && last && first !== last ? `수집일 ${windowDates.length}일` : '\u00a0'} />

      {first && last && crossesSampleChange(first, last) ? (
        <p className="period-warn">2025-07-21에 수집 범위가 300편 → 500편으로 바뀌어 이 기간의 작품 수는 견줄 수 없습니다(인기 점수는 비율이라 견줄 만함).</p>
      ) : null}

      <TabBar<Tab> ariaLabel="목록" value={tab} onChange={t => { setTab(t); setOpenTag(null); }}
        items={(Object.keys(TAB_LABEL) as Tab[]).map(k => ({ key: k, label: TAB_LABEL[k], count: series ? lists[k].length : undefined }))} />

      {error ? <p className="empty-line">{error} <button type="button" className="link-button" onClick={() => setRetry(n => n + 1)}>다시 시도</button></p>
        : loading && !series ? <SkeletonRows />
        : tooLong ? <p className="empty-line">기간은 첫날과 마지막 날이 {MAX_SPAN_DAYS}일 이내로 떨어지게 골라 주세요.</p>
        : tooShort ? <p className="empty-line">기간 안에 수집일이 2일 이상 있어야 견줄 수 있습니다.</p>
        : <Stale loading={loading}>{table()}</Stale>}

      {!error && series ? <Footnotes notes={notes} /> : null}
    </div>
  );
}
