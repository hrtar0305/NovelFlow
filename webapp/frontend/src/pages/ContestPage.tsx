import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { isValid, parseISO } from 'date-fns';
import { Search as SearchIcon } from 'react-bootstrap-icons';
import { getContestAvailableDates, getContestDataByDate, getContestShowcase } from '../services/api';
import ContestHeader from '../components/contest/ContestHeader';
import NovelCover from '../components/NovelCover';
import ChangeMark from '../components/ui/ChangeMark';
import TagLinks from '../components/ui/TagLinks';
import Footnotes, { FootnoteRef } from '../components/ui/Footnotes';
import FilterDrawer from '../components/ranking/FilterDrawer';
import Showcase, { type ShowcaseItem } from '../components/ranking/Showcase';
import AppliedFilters from '../components/ranking/AppliedFilters';
import RankTable, { type RankColumn } from '../components/ranking/RankTable';
import NovelRowExpand from '../components/ranking/NovelRowExpand';
import { EMPTY_FILTER, activeFilterCount, applyRankingFilter, tagCounts, toggleTag, type RankingFilter } from '../utils/rankingQuery';
import {
  AWARD_ORDER, CONTEST_DAILY_SORT, CONTEST_DEFAULT_SORT, isDeletedContestNovel, nextContestSort, sortContestNovels,
  type ContestNovel, type ContestSort, type ContestSortKey,
} from '../utils/contestNovels';
import { formatInt, formatRatio } from '../utils/format';
import { LATEST_CONTEST_YEAR, contestConfig } from '../utils/contest';

/**
 * 공모전 작품 랭킹(2026-09-30 개편) — 일간 랭킹과 같은 문법(필터 서랍, 10열 표, 제목 칸 안 표지,
 * 왼쪽 정렬, 정렬 기준 볼드, 검색은 엔터로 적용). 탭은 두지 않는다 — 급상승은 변동 정렬, 수상작은
 * 필터 서랍의 '수상작만'으로 본다. 수상은 여러 색 칩 대신 강조색 글자 하나.
 *
 * 2026 부터는 대표 순위가 일간 순위다(적재 때 확정한 DailyRank, `utils/contest.ts`). 수상작 발표 전에는
 * 수상 열·'수상작만'을 숨기고, 기성/신인 열·필터와 잔류율 두 열을 둔다. 쇼케이스는 일간 랭킹과 같은 배치(상위 5 +
 * 급상승 5)·같은 규칙(고른 날짜의 표에서) — 2025 의 시상대 배치는 수상작을 놓기 위한 것이라 일간 순위에는 맞지 않는다(사용자 검토 2026-10-03).
 */

const NOTES = [
  { id: 'crank', content: <>순위 = 공모전 참여 작품을 누적 조회수 순으로 여기서 매긴 순위입니다. 노벨피아 공식 순위가 아닙니다.</> },
  { id: 'cview', content: <>조회수 = 직전 수집일보다 누적 조회수가 늘어난 양입니다. 그날 하루의 조회수가 아닙니다.</> },
];
const DAILY_NOTES = [
  { id: 'crank', content: <>순위 = 일간 조회 순위입니다(같으면 누적 조회수 순). 직전 수집 뒤 새로 등록된 작품은 누적 조회수 전체가 그날 조회이고, 직전 값을 알 수 없는 작품(잠시 비공개였던 작품 등)은 그날 순위에서 뺍니다. 노벨피아 공식 순위가 아닙니다.</> },
  { id: 'cview', content: <>일간 조회 = 직전 수집일 자정보다 누적 조회수가 늘어난 양입니다.</> },
  { id: 'early', content: <>초반 잔류 = 30화 조회수 ÷ 1화 조회수</> },
  { id: 'recent', content: <>최신 잔류 = 최신화 조회수 ÷ 30화 전 조회수. 최신화는 수집일에 올라온 회차를 뺀 가장 최근 회차입니다.</> },
];

const toShowcase = (year: string, n: ContestNovel, stat: ReactNode, jump: number | null = null): ShowcaseItem => ({
  id: n.ID, href: `/contests/${year}/novels/${n.ID}`, title: n.Title || '(제목 없음)', cover: n.ThumbnailURL,
  author: n.AuthorName, rank: n.daily_rank ?? 0, stat, jump,
});

/** 기성/신인 — 작가 칸 아래 작은 글씨로 두면 눈에 띄지 않아 열로 뺐다. 판정 못 한 작가는 '–'. */
const CareerText = ({ v }: { v?: boolean | null }) => (v == null ? <span className="career career--none">–</span>
  : <span className="career">{v ? '기성' : '신인'}</span>);
type Career = 'all' | 'veteran' | 'rookie';

const mapRows = (items: ContestNovel[]) => items.map(n => ({
  ...n,
  Tags: n.Tags || [],
  like_to_view_ratio: n.View && n.View > 0 ? (n.Like ?? 0) / n.View : 0,
}));

const AwardText = ({ award }: { award?: string | null }) =>
  award ? <span className={`award-text${award === '본선' ? ' award-text--minor' : ''}`}>{award}</span> : null;

export default function ContestPage() {
  const { year = LATEST_CONTEST_YEAR, date: dateParam } = useParams<{ year: string; date?: string }>();
  const cfg = contestConfig(year);
  const daily = cfg.headline === 'daily';
  const navigate = useNavigate();
  const [params] = useSearchParams();
  // 날짜 목록은 받은 연도와 함께 둔다 — 연도를 바꾼 첫 렌더에 이전 연도 날짜로 리다이렉트하지 않게(같은 라우트라 다시 마운트되지 않는다).
  const [datesOf, setDatesOf] = useState<{ year: string; set: Set<string> }>({ year: '', set: new Set() });
  const dates = useMemo(() => (datesOf.year === year ? datesOf.set : new Set<string>()), [datesOf, year]);
  const [rows, setRows] = useState<ContestNovel[]>([]);
  const [showcase, setShowcase] = useState<ContestNovel[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // ?tag= 로 들어오면(공모전 작품 상세의 태그 링크) 그 태그를 '모두 포함'으로 건다.
  const [filter, setFilter] = useState<RankingFilter>(() => {
    const tag = params.get('tag');
    return tag ? { ...EMPTY_FILTER, tags: [tag] } : EMPTY_FILTER;
  });
  const [winnersOnly, setWinnersOnly] = useState(false);
  const [sort, setSort] = useState<ContestSort>(daily ? CONTEST_DAILY_SORT : CONTEST_DEFAULT_SORT);
  const [career, setCareer] = useState<Career>('all');
  useEffect(() => { setSort(daily ? CONTEST_DAILY_SORT : CONTEST_DEFAULT_SORT); setCareer('all'); setWinnersOnly(false); }, [daily]);
  const [drawer, setDrawer] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [searchInput, setSearchInput] = useState('');
  const toolbarRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const y = parseInt(year, 10);
    // 연도를 빠르게 오가면 늦게 온 이전 연도 응답이 지금 연도를 덮지 않게 버린다.
    let cancelled = false;
    setLoading(true);
    setError(null);
    setShowcase([]);
    getContestAvailableDates(y)
      .then(r => { if (!cancelled) setDatesOf({ year, set: new Set<string>(r.data.available_dates || []) }); })
      .catch(() => { if (!cancelled) { setError('조회 가능한 날짜를 불러오지 못했습니다.'); setLoading(false); } });
    // 수상작 쇼케이스(2025 — 운영자가 고른 수상작 순서)만 API 로 받는다. 일간 쇼케이스는 표에서 고른다.
    if (contestConfig(year).headline !== 'daily') {
      getContestShowcase(y).then(r => { if (!cancelled) setShowcase(mapRows(r.data.items || [])); }).catch(() => { if (!cancelled) setShowcase([]); });
    }
    return () => { cancelled = true; };
  }, [year]);

  useEffect(() => {
    if (dates.size === 0) return;
    if (!dateParam || !isValid(parseISO(dateParam)) || !dates.has(dateParam)) {
      const tag = params.get('tag');
      navigate(`/contests/${year}/${[...dates].sort().at(-1)}${tag ? `?tag=${encodeURIComponent(tag)}` : ''}`, { replace: true });
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    setOpenId(null);
    getContestDataByDate(parseInt(year, 10), dateParam)
      .then(r => { if (!cancelled) setRows(mapRows(r.data || [])); })
      .catch(() => { if (!cancelled) { setRows([]); setError('공모전 랭킹을 불러오지 못했습니다.'); } })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [year, dateParam, dates, navigate, params]);

  const update = useCallback((next: RankingFilter) => setFilter(next), []);
  const deferredFilter = useDeferredValue(filter);
  const deferredWinners = useDeferredValue(winnersOnly);
  const deferredCareer = useDeferredValue(career);
  const result = useMemo(() => {
    // 수상작만 = 수상 값이 있는 작품(본선 포함) — 개편 전 '수상작만 보기'와 같은 기준.
    let base = deferredWinners ? rows.filter(n => !!n.award) : rows;
    if (deferredCareer !== 'all') base = base.filter(n => n.is_veteran === (deferredCareer === 'veteran'));
    return applyRankingFilter(base, deferredFilter);
  }, [rows, deferredFilter, deferredWinners, deferredCareer]);
  const hasAwards = useMemo(() => rows.some(n => !!n.award), [rows]);
  const careerCount = useMemo(() => ({
    veteran: rows.filter(n => n.is_veteran === true).length, rookie: rows.filter(n => n.is_veteran === false).length,
  }), [rows]);
  const sorted = useMemo(() => sortContestNovels(result.items, sort), [result.items, sort]);
  const stats = useMemo(() => tagCounts(rows), [rows]);
  const hit = useMemo(() => new Set(filter.rule ? [] : filter.tags), [filter]);
  const onTag = useCallback((t: string) => update(toggleTag(filter, t)), [filter, update]);
  const isPending = deferredFilter !== filter || deferredWinners !== winnersOnly || deferredCareer !== career;

  // 쇼케이스 — 날짜 선택 바로 아래라 고른 날짜를 따른다(사용자 검토 2026-10-03, 일간 랭킹과 같은 규칙).
  // · 수상작이 있으면 시상대 배치: 2025 는 API(운영자 지정 순서), 2026 수상 발표 뒤에는 그날 표의 수상작.
  // · 2026 수상 발표 전: 일간 랭킹과 같은 상위 5 + 급상승 5 를 그날 표에서 고른다(목록 응답에 일간 순위·변동이 다 있다).
  const awardShowcase = !daily || hasAwards;
  const showcaseItems = useMemo(() => (awardShowcase ? [...(daily ? rows.filter(n => !!n.award) : showcase)]
    .sort((a, b) => ((AWARD_ORDER[a.award ?? ''] ?? 99) - (AWARD_ORDER[b.award ?? ''] ?? 99)) || ((b.View ?? -1) - (a.View ?? -1)))
    .slice(0, 11) : []), [showcase, rows, daily, awardShowcase]);
  const dailyShowcase = useMemo(() => {
    if (awardShowcase) return { top: [], movers: [] };
    const ranked = rows.filter(n => n.daily_rank != null).sort((a, b) => a.daily_rank! - b.daily_rank!);
    const movers = ranked.filter(n => typeof n.daily_rank_change === 'number' && n.daily_rank_change > 0)
      .sort((a, b) => (b.daily_rank_change as number) - (a.daily_rank_change as number) || a.daily_rank! - b.daily_rank!);
    return {
      top: ranked.slice(0, 5).map(n => toShowcase(year, n, <>+{formatInt(n.view_change)}</>)),
      movers: movers.slice(0, 5).map(n => toShowcase(year, n, null, n.daily_rank_change as number)),
    };
  }, [rows, awardShowcase, year]);

  const count = activeFilterCount(filter) + (winnersOnly ? 1 : 0) + (career !== 'all' ? 1 : 0);
  const filtered = count > 0 || filter.search.trim() !== '';
  useEffect(() => { setSearchInput(filter.search); }, [filter.search]);
  const applySearch = (q: string) => {
    update({ ...filter, search: q });
    const el = toolbarRef.current;
    if (el && el.getBoundingClientRect().top < 0) window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 72 });
  };
  const submitSearch = (e: FormEvent) => { e.preventDefault(); applySearch(searchInput.trim()); };

  const strongIf = (keys: ContestSortKey[], v: ReactNode) => (keys.includes(sort.key) ? <b className="rank-strong">{v}</b> : v);
  const dash = '–';

  const headRank = (n: ContestNovel) => (daily ? n.daily_rank ?? null : n.Rank);
  const headChange = (n: ContestNovel) => (daily ? n.daily_rank_change ?? null : n.rank_change);
  const RankNum = ({ n }: { n: ContestNovel }) => {
    const r = headRank(n);
    return r == null ? <span className="rank-num rank-num--none" title="비교할 직전 기록이 없습니다">–</span>
      : <span className={`rank-num${r <= 3 ? ' is-top' : ''}`}>{r}</span>;
  };
  // 열 폭 = max(머리글 글자, 가장 긴 값) — 14px 표 글꼴 실측(2026-10-03). 2025 예선 기간 실측 최댓값: 누적 843,670 · 일간 49,355 ·
  // 변동 3,492(4자리) · 순위 4,719. 2025 는 예선 뒤에도 모아 누적이 8자리(16,677,971)까지 가서 누적 열을 더 넓게 둔다.
  // 잔류·일간 조회는 숫자보다 머리글('초반 잔류 ³ ↕' 69px)이 길어 머리글 기준. 남는 폭은 제목·태그로 간다.
  const columns: RankColumn<ContestNovel>[] = [
    { key: 'rank', header: '순위', aside: <FootnoteRef id="crank" n={1} />, width: '56px',
      sortKey: daily ? 'daily_rank' : undefined, render: n => <RankNum n={n} /> },
    { key: 'chg', header: '변동', width: '48px', sortKey: daily ? 'daily_rank_change' : 'rank_change', render: n => <ChangeMark value={headChange(n)} /> },
    ...(hasAwards || !daily ? [{ key: 'award', header: '수상', width: '64px', render: (n: ContestNovel) => <AwardText award={n.award} /> }] : []),
    { key: 'title', header: '제목', width: 'minmax(0,1fr)',
      render: n => (
        <span className="rank-titlecell">
          <span className="rank-cover"><NovelCover url={n.ThumbnailURL} title={n.Title} imageClassName="rank-cover__img" /></span>
          {isDeletedContestNovel(n)
            ? <span className="rank-title rank-title--muted">삭제된 작품 ({n.ID})</span>
            : <Link to={`/contests/${year}/novels/${n.ID}`} className="rank-title" onClick={e => e.stopPropagation()}>{n.Title || '(제목 없음)'}</Link>}
        </span>
      ) },
    { key: 'author', header: '작가', width: '104px',
      render: n => (isDeletedContestNovel(n) ? dash
        : n.AuthorID && n.AuthorID !== '0'
          ? <Link to={`/authors/${n.AuthorID}`} className="rank-author" title={n.AuthorName ?? undefined} onClick={e => e.stopPropagation()}>{n.AuthorName || '(작자 미상)'}</Link>
          : <span className="rank-author" title={n.AuthorName ?? undefined}>{n.AuthorName || '(작자 미상)'}</span>) },
    ...(daily ? [{ key: 'career', header: '구분', width: '32px', render: (n: ContestNovel) => <CareerText v={n.is_veteran} /> }] : []),
    { key: 'vchg', header: '일간 조회', aside: <FootnoteRef id="cview" n={2} />, width: '70px', sortKey: 'view_change',
      // 2026: 비교할 직전 기록이 없으면(일간 순위 없음) 0 이 아니라 '알 수 없음'이다.
      render: n => (isDeletedContestNovel(n) || (daily && n.daily_rank == null) ? dash : strongIf(['view_change'], formatInt(n.view_change))) },
    { key: 'view', header: '누적 조회', width: daily ? '72px' : '80px', sortKey: 'View',
      render: n => (isDeletedContestNovel(n) ? dash : strongIf(['View'], formatInt(n.View))) },
    { key: 'ratio', header: '추천비', width: '56px', sortKey: 'like_to_view_ratio',
      render: n => (isDeletedContestNovel(n) ? dash : strongIf(['like_to_view_ratio'], formatRatio(n.like_to_view_ratio, 2))) },
    { key: 'eps', header: '회차', width: '44px', sortKey: 'Eps',
      render: n => (isDeletedContestNovel(n) ? dash : strongIf(['Eps'], formatInt(n.Eps))) },
    ...(daily ? [
      { key: 'early', header: '초반 잔류', aside: <FootnoteRef id="early" n={3} />, width: '70px', sortKey: 'EarlyRetentionRate',
        render: (n: ContestNovel) => strongIf(['EarlyRetentionRate'], formatRatio(n.EarlyRetentionRate ?? null, 0)) },
      { key: 'recent', header: '최신 잔류', aside: <FootnoteRef id="recent" n={4} />, width: '70px', sortKey: 'RecentRetentionRate',
        render: (n: ContestNovel) => strongIf(['RecentRetentionRate'], formatRatio(n.RecentRetentionRate ?? null, 0)) },
    ] as RankColumn<ContestNovel>[] : []),
    // 2026 은 열이 셋(구분·잔류 둘) 늘어 태그 폭을 줄여 제목이 덜 잘리게 한다.
    { key: 'tags', header: '태그', width: daily ? 'minmax(0,0.85fr)' : 'minmax(0,1.2fr)', render: n => <TagLinks tags={n.Tags} limit={n.Tags.length} wrap highlighted={hit} onSelect={onTag} /> },
  ];

  const mobileRow = (n: ContestNovel) => (
    <div className="rank-mrow">
      <div className="rank-mrow__rank"><RankNum n={n} /><ChangeMark value={headChange(n)} /></div>
      <span className="rank-cover"><NovelCover url={n.ThumbnailURL} title={n.Title} imageClassName="rank-cover__img" /></span>
      <div className="rank-mrow__main">
        {isDeletedContestNovel(n)
          ? <span className="rank-title rank-title--wrap rank-title--muted">삭제된 작품 ({n.ID})</span>
          : <Link to={`/contests/${year}/novels/${n.ID}`} className="rank-title rank-title--wrap">{n.Title || '(제목 없음)'}</Link>}
        <p>{n.award ? <><AwardText award={n.award} /> · </> : null}{n.AuthorName || '(작자 미상)'}{daily && n.is_veteran != null ? (n.is_veteran ? ' · 기성' : ' · 신인') : ''} · {formatInt(n.Eps)}화</p>
        <p>일간 조회 <b>{isDeletedContestNovel(n) || (daily && n.daily_rank == null) ? dash : formatInt(n.view_change)}</b> · 누적 <b>{isDeletedContestNovel(n) ? dash : formatInt(n.View)}</b> · 추천비 <b>{formatRatio(n.like_to_view_ratio, 2)}</b>{daily ? <> · 초반 <b>{formatRatio(n.EarlyRetentionRate ?? null, 0)}</b> · 최신 <b>{formatRatio(n.RecentRetentionRate ?? null, 0)}</b></> : null}</p>
        <TagLinks tags={n.Tags} highlighted={hit} onSelect={onTag} limit={n.Tags.length} wrap />
      </div>
    </div>
  );

  return (
    <div className="page-shell contest-page novel-rankings-page">
      <ContestHeader year={year} date={dateParam ?? null} availableDates={dates} view="novels"
        onDateChange={d => navigate(`/contests/${year}/${d}`)} onYearChange={y => navigate(`/contests/${y}`)}
        meta={rows.length ? `${cfg.schedule} · 참여 작품 ${formatInt(rows.length)}편` : cfg.schedule} />

      {!awardShowcase && !loading && !error ? <Showcase top={dailyShowcase.top} movers={dailyShowcase.movers} tableDate={dateParam ?? null} /> : null}

      {showcaseItems.length > 0 ? (
        <section className="contest-award-showcase showcase-section" aria-label="수상작">
          <div className="contest-award-showcase__grid">
            {showcaseItems.map((n, i) => (
              <Link key={`${n.ID}-award`} to={`/contests/${year}/novels/${n.ID}`}
                className={`media-rank-card media-rank-card--poster media-rank-card--link contest-award-poster contest-award-poster--podium-${i + 1}`}
                aria-label={`${n.Title || '공모전 작품'} 상세 보기`}>
                <div className="media-rank-card__cover">
                  <NovelCover url={n.ThumbnailURL} title={n.Title} imageClassName="media-rank-card__cover-image" />
                  {n.award ? <div className="media-rank-card__rank contest-award-chip">{n.award}</div> : null}
                </div>
                <div className="media-rank-card__overlay">
                  <div className="media-rank-card__title">{n.Title || '(제목 없음)'}</div>
                  <div className="media-rank-card__meta">
                    <span className="mini-kpi">{n.AuthorName || '(작자 미상)'}</span>
                    <span className="mini-kpi">조회 {formatInt(n.View)}</span>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      <div className="rank-toolbar" ref={toolbarRef}>
        <h2 className="rank-toolbar__title">
          전체 순위
          <span className="rank-toolbar__count">
            {filtered ? <>조건에 맞는 <b>{formatInt(sorted.length)}</b>편 / {formatInt(rows.length)}편</> : <>{formatInt(rows.length)}편</>}
          </span>
        </h2>
        <button type="button" className={`toolbar-filter${count ? ' is-on' : ''}`} onClick={() => setDrawer(true)} aria-haspopup="dialog">
          필터{count ? <span className="toolbar-filter__n">{count}</span> : null}
        </button>
        <form className="toolbar-searchform" role="search" onSubmit={submitSearch}>
          <input className="toolbar-search" type="search" placeholder="제목·작가 검색" aria-label="제목·작가 검색"
            value={searchInput} onChange={e => { setSearchInput(e.target.value); if (e.target.value === '' && filter.search) applySearch(''); }} />
          <button type="submit" className="toolbar-searchbtn" aria-label="검색"><SearchIcon size={15} aria-hidden="true" /></button>
        </form>
      </div>
      <AppliedFilters filter={filter} onChange={update} extra={winnersOnly ? { label: <><b>수상작만</b></>, onClear: () => setWinnersOnly(false) }
        : career !== 'all' ? { label: <><b>{career === 'veteran' ? '기성 작가' : '신인 작가'}</b></>, onClear: () => setCareer('all') } : null} />

      <div className={isPending ? 'is-pending' : undefined}>
        {error ? <p className="empty-line">{error}</p>
          : loading ? <div className="rank-skeleton" aria-busy="true">{Array.from({ length: 8 }, (_, i) => <div key={i} />)}</div>
          : (
            <RankTable ariaLabel="공모전 작품 순위" /* 2026 은 열이 12개라 992~1100px 에서 제목 칸이 114px 까지 준다 — 그 폭부터 모바일 행 */ compactBelow={daily ? 1100 : 992} rowHeight={84} rows={sorted} rowKey={n => n.ID} columns={columns}
              sort={sort} onSort={k => setSort(s => nextContestSort(s, k as ContestSortKey))}
              expandedKey={openId}
              onToggleRow={n => setOpenId(id => (id === n.ID ? null : n.ID))}
              expandFrom="title"
              renderExpanded={n => <NovelRowExpand novelId={n.ID} date={dateParam!} availableDates={dates}
                contest={{ year, daily }} />}
              renderMobileRow={mobileRow}
              emptyText={result.error ?? (rows.length === 0 ? '이 날짜의 공모전 데이터가 없습니다.' : '조건에 맞는 작품이 없습니다.')} />
          )}
      </div>

      {!error && !loading && rows.length > 0 ? <Footnotes notes={daily ? DAILY_NOTES : NOTES} /> : null}

      <FilterDrawer open={drawer} onClose={() => setDrawer(false)} filter={filter} onChange={update}
        tagStats={stats} resultCount={sorted.length} error={result.error} onResetExtra={() => { setWinnersOnly(false); setCareer('all'); }}
        extra={(
          <>
            {hasAwards || !daily ? (
              <>
                <h3 className="filter-drawer__h">수상</h3>
                <div className="filter-drawer__statuses">
                  <button type="button" aria-pressed={winnersOnly} className={winnersOnly ? 'is-on' : ''} onClick={() => setWinnersOnly(w => !w)}>
                    <span>수상작만</span><i>{rows.filter(n => !!n.award).length}</i>
                  </button>
                </div>
              </>
            ) : null}
            {daily ? (
              <>
                <h3 className="filter-drawer__h">작가</h3>
                {/* 기성 = 공모전 시작 전에 낸 작품이 있는 작가. 아직 판정하지 못한 작가는 어느 쪽에도 들지 않는다. */}
                <div className="filter-drawer__statuses">
                  {(['veteran', 'rookie'] as const).map(k => (
                    <button key={k} type="button" aria-pressed={career === k} className={career === k ? 'is-on' : ''} onClick={() => setCareer(c => (c === k ? 'all' : k))}>
                      <span>{k === 'veteran' ? '기성 작가' : '신인 작가'}</span><i>{careerCount[k]}</i>
                    </button>
                  ))}
                </div>
              </>
            ) : null}
          </>
        )} />
    </div>
  );
}
