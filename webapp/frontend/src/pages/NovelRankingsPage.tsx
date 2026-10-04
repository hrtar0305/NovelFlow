import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { isValid, parseISO } from 'date-fns';
import { Search as SearchIcon } from 'react-bootstrap-icons';
import { getAvailableDates, getNovelRankingsByDate } from '../services/api';
import PageTitle from '../components/ui/PageTitle';
import DateNav from '../components/ui/DateNav';
import TagLinks from '../components/ui/TagLinks';
import ChangeMark from '../components/ui/ChangeMark';
import Footnotes, { FootnoteRef } from '../components/ui/Footnotes';
import NovelCover from '../components/NovelCover';
import Showcase, { type ShowcaseItem } from '../components/ranking/Showcase';
import FilterDrawer from '../components/ranking/FilterDrawer';
import AppliedFilters from '../components/ranking/AppliedFilters';
import RankTable, { type RankColumn } from '../components/ranking/RankTable';
import NovelRowExpand from '../components/ranking/NovelRowExpand';
import {
  DEFAULT_SORT, EMPTY_FILTER, activeFilterCount, hasStatusData, statusCounts, applyRankingFilter, nextSort, normalizeNovels, sortRankings, tagCounts, toggleTag,
  type RankingFilter, type RankingNovel, type SortConfig, type SortKey,
} from '../utils/rankingQuery';
import { formatInt, formatRatio } from '../utils/format';
import { SERIAL_STATUS_NOTICE } from '../utils/serialStatusNotice';

// 잔류율 산식은 책 주석처럼 표 아래에 두고, 열 이름 옆 작은 번호로 잇는다 — 머리글 아래에 두면
// 그 두 열만 머리글이 높아져 어색했다. 추천비는 이름으로 뜻이 전해져 설명을 두지 않는다.
const NOTES = [
  { id: 'early', content: <>초반 잔류 = 30화 조회수 ÷ 1화 조회수</> },
  { id: 'recent', content: <>최신 잔류 = 최신화 조회수 ÷ 30화 전 조회수</> },
];

const toShowcase = (n: RankingNovel, stat: ReactNode, jump: number | null = null): ShowcaseItem => ({
  id: n.ID, href: `/novels/${n.ID}`, title: n.Title, cover: n.ThumbnailURL, author: n.AuthorName, rank: n.Ranking, stat, jump,
});

export default function NovelRankingsPage() {
  const { date: dateParam } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();

  const [dates, setDates] = useState<Set<string>>(new Set());
  const [rows, setRows] = useState<RankingNovel[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<RankingFilter>(() => {
    const tag = params.get('tag');
    return tag ? { ...EMPTY_FILTER, tags: [tag] } : EMPTY_FILTER;
  });
  const [sort, setSort] = useState<SortConfig>(DEFAULT_SORT);
  const [drawer, setDrawer] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    getAvailableDates()
      .then(r => setDates(new Set<string>(r.data.available_dates || [])))
      .catch(() => { setError('수집일 목록을 불러오지 못했습니다.'); setLoading(false); });
  }, []);

  useEffect(() => {
    if (dates.size === 0) return;
    const latest = [...dates].sort().at(-1)!;
    if (!dateParam || !isValid(parseISO(dateParam)) || !dates.has(dateParam)) {
      navigate(`/novels/rankings/${latest}${params.get('tag') ? `?tag=${encodeURIComponent(params.get('tag')!)}` : ''}`, { replace: true });
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    setOpenId(null);
    getNovelRankingsByDate(dateParam)
      .then(r => { if (!cancelled) setRows(normalizeNovels(r.data.message ? [] : r.data)); })
      .catch(() => { if (!cancelled) { setRows([]); setError('랭킹을 불러오지 못했습니다.'); } })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [dateParam, dates, navigate, params]);

  const update = useCallback((next: RankingFilter) => setFilter(next), []);
  // 입력은 즉시 반영하고 500행 필터·정렬만 늦춘다(제어 입력을 트랜지션으로 갱신하면 글자가 밀린다).
  const deferredFilter = useDeferredValue(filter);
  const isPending = deferredFilter !== filter;

  const result = useMemo(() => applyRankingFilter(rows, deferredFilter), [rows, deferredFilter]);
  const sorted = useMemo(() => sortRankings(result.items, sort), [result.items, sort]);
  const stats = useMemo(() => tagCounts(rows), [rows]);
  const statusStats = useMemo(() => statusCounts(rows), [rows]);
  const statusAvailable = useMemo(() => hasStatusData(rows), [rows]);
  // 상태를 골랐는데 그날 기록이 없으면(2026-09-05 이전) 결과 0의 이유를 그대로 적는다.
  const statusBlocked = (filter.statuses ?? []).length > 0 && !statusAvailable && rows.length > 0;
  const hit = useMemo(() => new Set(filter.rule ? [] : filter.tags), [filter]);
  const onTag = useCallback((t: string) => update(toggleTag(filter, t)), [filter, update]);

  // 쇼케이스는 고른 날짜의 표에서 바로 고른다 — 날짜 선택이 쇼케이스 위에 있어 날짜를 바꾸면 쇼케이스도 바뀌길 기대한다
  // (사용자 검토 2026-10-03). 목록 응답에 순위·변동이 다 있어 따로 부를 API 도 없다(전에는 최신일 쇼케이스 API 를 따로 불렀다).
  const showcase = useMemo(() => {
    const byRank = [...rows].sort((a, b) => a.Ranking - b.Ranking);
    const movers = rows.filter(n => typeof n.rank_change === 'number' && n.rank_change > 0)
      .sort((a, b) => (b.rank_change as number) - (a.rank_change as number) || a.Ranking - b.Ranking);
    return {
      top: byRank.slice(0, 5).map(n => toShowcase(n, <>점수 {formatInt(n.Score)}</>)),
      movers: movers.slice(0, 5).map(n => toShowcase(n, null, n.rank_change as number)),
    };
  }, [rows]);

  const strongIf = (keys: SortKey[], v: ReactNode) => (keys.includes(sort.key) ? <b className="rank-strong">{v}</b> : v);

  const columns: RankColumn<RankingNovel>[] = [
    { key: 'rank', header: '순위', width: '48px', sortKey: 'Ranking',
      render: n => <span className={`rank-num${n.Ranking <= 3 ? ' is-top' : ''}`}>{n.Ranking}</span> },
    { key: 'chg', header: '변동', width: '44px', sortKey: 'rank_change', render: n => <ChangeMark value={n.rank_change} /> },
    // 표지는 제목 열 안에 둔다 — 따로 열을 두면 머리글 없는 표지 칸이 빈 '제목' 열처럼 보였다.
    { key: 'title', header: '제목', width: 'minmax(0,1fr)',
      render: n => (
        <span className="rank-titlecell">
          <span className="rank-cover"><NovelCover url={n.ThumbnailURL} title={n.Title} imageClassName="rank-cover__img" /></span>
          <Link to={`/novels/${n.ID}`} className="rank-title" onClick={e => e.stopPropagation()}>{n.Title || '(제목 없음)'}</Link>
        </span>
      ) },
    // 볼드: 순위·제목·작가는 늘, 숫자 열은 지금 정렬 기준인 것만. 순위는 점수로 매기므로
    // 순위순(기본)일 때도 점수를 볼드로 둔다.
    { key: 'author', header: '작가', width: '92px',
      // 좁은 열이라 긴 이름은 줄임표로 잘린다 — title로 전체 이름을 보인다.
      render: n => n.AuthorID ? <Link to={`/authors/${n.AuthorID}`} className="rank-author" title={n.AuthorName} onClick={e => e.stopPropagation()}>{n.AuthorName}</Link> : <span className="rank-author" title={n.AuthorName}>{n.AuthorName || '(작자 미상)'}</span> },
    { key: 'score', header: '점수', width: '76px', sortKey: 'Score', render: n => strongIf(['Score', 'Ranking'], formatInt(n.Score)) },
    { key: 'eps', header: '회차', width: '54px', sortKey: 'Eps', render: n => strongIf(['Eps'], formatInt(n.Eps)) },
    { key: 'ratio', header: '추천비', width: '62px', sortKey: 'like_to_view_ratio', render: n => strongIf(['like_to_view_ratio'], formatRatio(n.like_to_view_ratio, 2)) },
    { key: 'early', header: '초반 잔류', aside: <FootnoteRef id="early" n={1} />, width: '72px', sortKey: 'EarlyRetentionRate', render: n => strongIf(['EarlyRetentionRate'], formatRatio(n.EarlyRetentionRate, 0)) },
    { key: 'recent', header: '최신 잔류', aside: <FootnoteRef id="recent" n={2} />, width: '72px', sortKey: 'RecentRetentionRate', render: n => strongIf(['RecentRetentionRate'], formatRatio(n.RecentRetentionRate, 0)) },
    { key: 'tags', header: '태그', width: 'minmax(0,1.3fr)', render: n => <TagLinks tags={n.Tags} limit={n.Tags.length} wrap highlighted={hit} onSelect={onTag} /> },
  ];

  const mobileRow = (n: RankingNovel) => (
    <div className="rank-mrow">
      <div className="rank-mrow__rank"><span className={`rank-num${n.Ranking <= 3 ? ' is-top' : ''}`}>{n.Ranking}</span><ChangeMark value={n.rank_change} /></div>
      <span className="rank-cover"><NovelCover url={n.ThumbnailURL} title={n.Title} imageClassName="rank-cover__img" /></span>
      <div className="rank-mrow__main">
        <Link to={`/novels/${n.ID}`} className="rank-title rank-title--wrap">{n.Title}</Link>
        <p>{n.AuthorName} · 점수 <b>{formatInt(n.Score)}</b> · {formatInt(n.Eps)}화</p>
        <p>추천비 <b>{formatRatio(n.like_to_view_ratio, 2)}</b> · 초반 <b>{formatRatio(n.EarlyRetentionRate, 0)}</b> · 최신 <b>{formatRatio(n.RecentRetentionRate, 0)}</b></p>
        <TagLinks tags={n.Tags} highlighted={hit} onSelect={onTag} limit={n.Tags.length} wrap />
      </div>
    </div>
  );

  const count = activeFilterCount(filter);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const [searchInput, setSearchInput] = useState(filter.search);
  useEffect(() => { setSearchInput(filter.search); }, [filter.search]);
  const applySearch = (q: string) => {
    update({ ...filter, search: q });
    // 표 안쪽까지 내려와 있으면 결과가 줄어 화면이 빈 곳으로 튄다 — 표 머리로 올려 준다.
    const el = toolbarRef.current;
    if (el && el.getBoundingClientRect().top < 0) window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 72 });
  };
  const submitSearch = (e: FormEvent) => { e.preventDefault(); applySearch(searchInput.trim()); };
  const filtered = count > 0 || filter.search.trim() !== '';
  // 10열은 992px 미만에서 제목 칸이 남지 않는다 — 그 폭부터 모바일 행(RankTable compactBelow)으로 그린다.
  return (
    <div className="page-shell novel-rankings-page">
      <PageTitle title="일간 랭킹"
        nav={<DateNav value={dateParam ?? null} availableDates={dates} onChange={d => navigate(`/novels/rankings/${d}`)} />}
        meta={`노벨피아 7일 조회순 상위 ${rows.length || 500}작품`} />

      {!loading && !error ? <Showcase top={showcase.top} movers={showcase.movers} tableDate={dateParam ?? null} /> : null}

      {/* 급상승·신규 진입 탭은 두지 않는다 — 변동 열 내림차순이 곧 NEW → 상승 폭 순이다. */}
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
        {/* 타이핑마다 거르면 결과 수가 바뀔 때마다 페이지 높이가 요동친다 — 엔터·검색 버튼으로 한 번에 적용한다. */}
        <form className="toolbar-searchform" role="search" onSubmit={submitSearch}>
          <input className="toolbar-search" type="search" placeholder="제목·작가 검색" aria-label="제목·작가 검색"
            value={searchInput} onChange={e => { setSearchInput(e.target.value); if (e.target.value === '' && filter.search) applySearch(''); }} />
          <button type="submit" className="toolbar-searchbtn" aria-label="검색"><SearchIcon size={15} aria-hidden="true" /></button>
        </form>
      </div>
      <AppliedFilters filter={filter} onChange={update} />

      <div className={isPending ? 'is-pending' : undefined}>
        {error ? <p className="empty-line">{error} <button type="button" className="link-button" onClick={() => window.location.reload()}>다시 시도</button></p>
          : loading ? <div className="rank-skeleton" aria-busy="true">{Array.from({ length: 8 }, (_, i) => <div key={i} />)}</div>
          : (
            <RankTable ariaLabel="일간 랭킹" compactBelow={992} rowHeight={84} rows={sorted} rowKey={n => n.ID} columns={columns}
              sort={sort} onSort={k => setSort(s => nextSort(s, k as SortKey))}
              expandedKey={openId}
              onToggleRow={n => setOpenId(id => (id === n.ID ? null : n.ID))}
              expandFrom="title"
              renderExpanded={n => <NovelRowExpand novelId={n.ID} date={dateParam!} availableDates={dates} synopsis={n.Synopsis} />}
              renderMobileRow={mobileRow}
              emptyText={result.error ?? (statusBlocked ? SERIAL_STATUS_NOTICE : rows.length === 0 ? '이 날짜의 랭킹 데이터가 없습니다.' : '조건에 맞는 작품이 없습니다.')} />
          )}
      </div>


      {!error && !loading && rows.length > 0 ? <Footnotes notes={NOTES} /> : null}

      <FilterDrawer open={drawer} onClose={() => setDrawer(false)} filter={filter} onChange={update}
        tagStats={stats} resultCount={sorted.length} error={result.error}
        statusStats={statusStats} statusAvailable={statusAvailable} />
    </div>
  );
}
