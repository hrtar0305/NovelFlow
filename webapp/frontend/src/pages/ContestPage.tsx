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
import AppliedFilters from '../components/ranking/AppliedFilters';
import RankTable, { type RankColumn } from '../components/ranking/RankTable';
import { EMPTY_FILTER, activeFilterCount, applyRankingFilter, tagCounts, toggleTag, type RankingFilter } from '../utils/rankingQuery';
import {
  AWARD_ORDER, CONTEST_DEFAULT_SORT, isDeletedContestNovel, nextContestSort, sortContestNovels,
  type ContestNovel, type ContestSort, type ContestSortKey,
} from '../utils/contestNovels';
import { formatInt, formatRatio } from '../utils/format';

/**
 * 공모전 작품 랭킹(2026-09-30 개편) — 일간 랭킹과 같은 문법(필터 서랍, 10열 표, 제목 칸 안 표지,
 * 왼쪽 정렬, 정렬 기준 볼드, 검색은 엔터로 적용). 탭은 두지 않는다 — 급상승은 변동 정렬, 수상작은
 * 필터 서랍의 '수상작만'으로 본다. 수상은 여러 색 칩 대신 강조색 글자 하나.
 */

const NOTES = [
  { id: 'crank', content: <>순위 = 공모전 참여 작품을 누적 조회수 순으로 여기서 매긴 순위입니다. 노벨피아 공식 순위가 아닙니다.</> },
  { id: 'cview', content: <>조회수 = 직전 수집일보다 누적 조회수가 늘어난 양입니다. 그날 하루의 조회수가 아닙니다.</> },
];

const mapRows = (items: ContestNovel[]) => items.map(n => ({
  ...n,
  Tags: n.Tags || [],
  like_to_view_ratio: n.View && n.View > 0 ? (n.Like ?? 0) / n.View : 0,
}));

const AwardText = ({ award }: { award?: string | null }) =>
  award ? <span className={`award-text${award === '본선' ? ' award-text--minor' : ''}`}>{award}</span> : null;

export default function ContestPage() {
  const { year = '2025', date: dateParam } = useParams<{ year: string; date?: string }>();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [dates, setDates] = useState<Set<string>>(new Set());
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
  const [sort, setSort] = useState<ContestSort>(CONTEST_DEFAULT_SORT);
  const [drawer, setDrawer] = useState(false);
  const [searchInput, setSearchInput] = useState('');
  const toolbarRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const y = parseInt(year, 10);
    getContestAvailableDates(y)
      .then(r => setDates(new Set<string>(r.data.available_dates || [])))
      .catch(() => { setError('조회 가능한 날짜를 불러오지 못했습니다.'); setLoading(false); });
    getContestShowcase(y)
      .then(r => setShowcase(mapRows(r.data.items || [])))
      .catch(() => setShowcase([]));
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
    getContestDataByDate(parseInt(year, 10), dateParam)
      .then(r => { if (!cancelled) setRows(mapRows(r.data || [])); })
      .catch(() => { if (!cancelled) { setRows([]); setError('공모전 랭킹을 불러오지 못했습니다.'); } })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [year, dateParam, dates, navigate, params]);

  const update = useCallback((next: RankingFilter) => setFilter(next), []);
  const deferredFilter = useDeferredValue(filter);
  const deferredWinners = useDeferredValue(winnersOnly);
  const result = useMemo(() => {
    // 수상작만 = 수상 값이 있는 작품(본선 포함) — 개편 전 '수상작만 보기'와 같은 기준.
    const base = deferredWinners ? rows.filter(n => !!n.award) : rows;
    return applyRankingFilter(base, deferredFilter);
  }, [rows, deferredFilter, deferredWinners]);
  const sorted = useMemo(() => sortContestNovels(result.items, sort), [result.items, sort]);
  const stats = useMemo(() => tagCounts(rows), [rows]);
  const hit = useMemo(() => new Set(filter.rule ? [] : filter.tags), [filter]);
  const onTag = useCallback((t: string) => update(toggleTag(filter, t)), [filter, update]);
  const isPending = deferredFilter !== filter || deferredWinners !== winnersOnly;

  const showcaseItems = useMemo(() => [...showcase]
    .sort((a, b) => ((AWARD_ORDER[a.award ?? ''] ?? 99) - (AWARD_ORDER[b.award ?? ''] ?? 99)) || ((b.View ?? -1) - (a.View ?? -1)))
    .slice(0, 11), [showcase]);

  const count = activeFilterCount(filter) + (winnersOnly ? 1 : 0);
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

  const columns: RankColumn<ContestNovel>[] = [
    { key: 'rank', header: '순위', aside: <FootnoteRef id="crank" n={1} />, width: '56px',
      render: n => <span className={`rank-num${n.Rank <= 3 ? ' is-top' : ''}`}>{n.Rank}</span> },
    { key: 'chg', header: '변동', width: '44px', sortKey: 'rank_change', render: n => <ChangeMark value={n.rank_change} /> },
    { key: 'award', header: '수상', width: '64px', render: n => <AwardText award={n.award} /> },
    { key: 'title', header: '제목', width: 'minmax(0,1fr)',
      render: n => (
        <span className="rank-titlecell">
          <span className="rank-cover"><NovelCover url={n.ThumbnailURL} title={n.Title} imageClassName="rank-cover__img" /></span>
          {isDeletedContestNovel(n)
            ? <span className="rank-title rank-title--muted">삭제된 작품 ({n.ID})</span>
            : <Link to={`/contests/${year}/novels/${n.ID}`} className="rank-title" onClick={e => e.stopPropagation()}>{n.Title || '(제목 없음)'}</Link>}
        </span>
      ) },
    { key: 'author', header: '작가', width: '92px',
      render: n => (isDeletedContestNovel(n) ? dash
        : n.AuthorID && n.AuthorID !== '0'
          ? <Link to={`/authors/${n.AuthorID}`} className="rank-author" title={n.AuthorName ?? undefined} onClick={e => e.stopPropagation()}>{n.AuthorName || '(작자 미상)'}</Link>
          : <span className="rank-author" title={n.AuthorName ?? undefined}>{n.AuthorName || '(작자 미상)'}</span>) },
    { key: 'vchg', header: '조회수', aside: <FootnoteRef id="cview" n={2} />, width: '84px', sortKey: 'view_change',
      render: n => (isDeletedContestNovel(n) ? dash : strongIf(['view_change'], formatInt(n.view_change))) },
    { key: 'view', header: '누적 조회수', width: '100px', sortKey: 'View',
      render: n => (isDeletedContestNovel(n) ? dash : strongIf(['View'], formatInt(n.View))) },
    { key: 'ratio', header: '추천비', width: '64px', sortKey: 'like_to_view_ratio',
      render: n => (isDeletedContestNovel(n) ? dash : strongIf(['like_to_view_ratio'], formatRatio(n.like_to_view_ratio, 2))) },
    { key: 'eps', header: '회차', width: '52px', sortKey: 'Eps',
      render: n => (isDeletedContestNovel(n) ? dash : strongIf(['Eps'], formatInt(n.Eps))) },
    { key: 'tags', header: '태그', width: 'minmax(0,1.2fr)', render: n => <TagLinks tags={n.Tags} limit={n.Tags.length} wrap highlighted={hit} onSelect={onTag} /> },
  ];

  const mobileRow = (n: ContestNovel) => (
    <div className="rank-mrow">
      <div className="rank-mrow__rank"><span className={`rank-num${n.Rank <= 3 ? ' is-top' : ''}`}>{n.Rank}</span><ChangeMark value={n.rank_change} /></div>
      <span className="rank-cover"><NovelCover url={n.ThumbnailURL} title={n.Title} imageClassName="rank-cover__img" /></span>
      <div className="rank-mrow__main">
        {isDeletedContestNovel(n)
          ? <span className="rank-title rank-title--wrap rank-title--muted">삭제된 작품 ({n.ID})</span>
          : <Link to={`/contests/${year}/novels/${n.ID}`} className="rank-title rank-title--wrap">{n.Title || '(제목 없음)'}</Link>}
        <p>{n.award ? <><AwardText award={n.award} /> · </> : null}{n.AuthorName || '(작자 미상)'} · {formatInt(n.Eps)}화</p>
        <p>조회수 <b>{isDeletedContestNovel(n) ? dash : formatInt(n.view_change)}</b> · 누적 <b>{isDeletedContestNovel(n) ? dash : formatInt(n.View)}</b> · 추천비 <b>{formatRatio(n.like_to_view_ratio, 2)}</b></p>
        <TagLinks tags={n.Tags} highlighted={hit} onSelect={onTag} limit={n.Tags.length} wrap />
      </div>
    </div>
  );

  return (
    <div className="page-shell contest-page novel-rankings-page">
      <ContestHeader year={year} date={dateParam ?? null} availableDates={dates} view="novels"
        onDateChange={d => navigate(`/contests/${year}/${d}`)} onYearChange={y => navigate(`/contests/${y}`)}
        meta={rows.length ? `매일 오후 2시 · 참여 작품 ${formatInt(rows.length)}편` : '매일 오후 2시'} />

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
      <AppliedFilters filter={filter} onChange={update} extra={winnersOnly ? { label: <><b>수상작만</b></>, onClear: () => setWinnersOnly(false) } : null} />

      <div className={isPending ? 'is-pending' : undefined}>
        {error ? <p className="empty-line">{error}</p>
          : loading ? <div className="rank-skeleton" aria-busy="true">{Array.from({ length: 8 }, (_, i) => <div key={i} />)}</div>
          : (
            <RankTable ariaLabel="공모전 작품 순위" compactBelow={992} rowHeight={84} rows={sorted} rowKey={n => n.ID} columns={columns}
              sort={sort} onSort={k => setSort(s => nextContestSort(s, k as ContestSortKey))}
              renderMobileRow={mobileRow}
              emptyText={result.error ?? (rows.length === 0 ? '이 날짜의 공모전 데이터가 없습니다.' : '조건에 맞는 작품이 없습니다.')} />
          )}
      </div>

      {!error && !loading && rows.length > 0 ? <Footnotes notes={NOTES} /> : null}

      <FilterDrawer open={drawer} onClose={() => setDrawer(false)} filter={filter} onChange={update}
        tagStats={stats} resultCount={sorted.length} error={result.error} onResetExtra={() => setWinnersOnly(false)}
        extra={(
          <>
            <h3 className="filter-drawer__h">수상</h3>
            <div className="filter-drawer__statuses">
              <button type="button" aria-pressed={winnersOnly} className={winnersOnly ? 'is-on' : ''} onClick={() => setWinnersOnly(w => !w)}>
                <span>수상작만</span><i>{rows.filter(n => !!n.award).length}</i>
              </button>
            </div>
          </>
        )} />
    </div>
  );
}
