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
 * 수상 열·'수상작만'을 숨기고, 기성/신인 필터를 둔다. 쇼케이스는 일간 순위 상위다.
 */

const NOTES = [
  { id: 'crank', content: <>순위 = 공모전 참여 작품을 누적 조회수 순으로 여기서 매긴 순위입니다. 노벨피아 공식 순위가 아닙니다.</> },
  { id: 'cview', content: <>조회수 = 직전 수집일보다 누적 조회수가 늘어난 양입니다. 그날 하루의 조회수가 아닙니다.</> },
];
const DAILY_NOTES = [
  { id: 'crank', content: <>일간 순위 = 직전 수집일보다 누적 조회수가 늘어난 양의 순위입니다(같으면 누적 조회수 순). 비교할 직전 기록이 없는 작품(첫 수집·새로 등록·다시 공개)은 순위가 없습니다. 노벨피아 공식 순위가 아닙니다.</> },
  { id: 'cview', content: <>조회 증가 = 직전 수집일 자정보다 누적 조회수가 늘어난 양입니다. 매일 자정에 모읍니다.</> },
];
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
  const [sort, setSort] = useState<ContestSort>(daily ? CONTEST_DAILY_SORT : CONTEST_DEFAULT_SORT);
  const [career, setCareer] = useState<Career>('all');
  useEffect(() => { setSort(daily ? CONTEST_DAILY_SORT : CONTEST_DEFAULT_SORT); setCareer('all'); setWinnersOnly(false); }, [daily]);
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

  // 2026 은 백엔드가 이미 일간 순위 순으로 준다(수상작 발표 전).
  const showcaseItems = useMemo(() => (daily && !showcase.some(n => n.award) ? showcase.slice(0, 11) : [...showcase]
    .sort((a, b) => ((AWARD_ORDER[a.award ?? ''] ?? 99) - (AWARD_ORDER[b.award ?? ''] ?? 99)) || ((b.View ?? -1) - (a.View ?? -1)))
    .slice(0, 11)), [showcase, daily]);

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
  const columns: RankColumn<ContestNovel>[] = [
    { key: 'rank', header: daily ? '일간 순위' : '순위', aside: <FootnoteRef id="crank" n={1} />, width: daily ? '72px' : '56px',
      sortKey: daily ? 'daily_rank' : undefined, render: n => <RankNum n={n} /> },
    { key: 'chg', header: '변동', width: '44px', sortKey: daily ? 'daily_rank_change' : 'rank_change', render: n => <ChangeMark value={headChange(n)} /> },
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
    { key: 'author', header: '작가', width: '92px',
      render: n => (isDeletedContestNovel(n) ? dash
        : n.AuthorID && n.AuthorID !== '0'
          ? <><Link to={`/authors/${n.AuthorID}`} className="rank-author" title={n.AuthorName ?? undefined} onClick={e => e.stopPropagation()}>{n.AuthorName || '(작자 미상)'}</Link>{n.is_veteran ? <span className="rank-career">기성</span> : null}</>
          : <span className="rank-author" title={n.AuthorName ?? undefined}>{n.AuthorName || '(작자 미상)'}</span>) },
    { key: 'vchg', header: daily ? '조회 증가' : '조회수', aside: <FootnoteRef id="cview" n={2} />, width: '84px', sortKey: 'view_change',
      // 2026: 비교할 직전 기록이 없으면(일간 순위 없음) 0 이 아니라 '알 수 없음'이다.
      render: n => (isDeletedContestNovel(n) || (daily && n.daily_rank == null) ? dash : strongIf(['view_change'], formatInt(n.view_change))) },
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
      <div className="rank-mrow__rank"><RankNum n={n} /><ChangeMark value={headChange(n)} /></div>
      <span className="rank-cover"><NovelCover url={n.ThumbnailURL} title={n.Title} imageClassName="rank-cover__img" /></span>
      <div className="rank-mrow__main">
        {isDeletedContestNovel(n)
          ? <span className="rank-title rank-title--wrap rank-title--muted">삭제된 작품 ({n.ID})</span>
          : <Link to={`/contests/${year}/novels/${n.ID}`} className="rank-title rank-title--wrap">{n.Title || '(제목 없음)'}</Link>}
        <p>{n.award ? <><AwardText award={n.award} /> · </> : null}{n.AuthorName || '(작자 미상)'}{n.is_veteran ? ' · 기성' : ''} · {formatInt(n.Eps)}화</p>
        <p>{daily ? '조회 증가' : '조회수'} <b>{isDeletedContestNovel(n) || (daily && n.daily_rank == null) ? dash : formatInt(n.view_change)}</b> · 누적 <b>{isDeletedContestNovel(n) ? dash : formatInt(n.View)}</b> · 추천비 <b>{formatRatio(n.like_to_view_ratio, 2)}</b></p>
        <TagLinks tags={n.Tags} highlighted={hit} onSelect={onTag} limit={n.Tags.length} wrap />
      </div>
    </div>
  );

  return (
    <div className="page-shell contest-page novel-rankings-page">
      <ContestHeader year={year} date={dateParam ?? null} availableDates={dates} view="novels"
        onDateChange={d => navigate(`/contests/${year}/${d}`)} onYearChange={y => navigate(`/contests/${y}`)}
        meta={rows.length ? `${cfg.schedule} · 참여 작품 ${formatInt(rows.length)}편` : cfg.schedule} />

      {showcaseItems.length > 0 ? (
        <section className="contest-award-showcase showcase-section" aria-label={daily && !hasAwards ? '일간 순위 상위' : '수상작'}>
          <div className="contest-award-showcase__grid">
            {showcaseItems.map((n, i) => (
              <Link key={`${n.ID}-award`} to={`/contests/${year}/novels/${n.ID}`}
                className={`media-rank-card media-rank-card--poster media-rank-card--link contest-award-poster contest-award-poster--podium-${i + 1}`}
                aria-label={`${n.Title || '공모전 작품'} 상세 보기`}>
                <div className="media-rank-card__cover">
                  <NovelCover url={n.ThumbnailURL} title={n.Title} imageClassName="media-rank-card__cover-image" />
                  {n.award ? <div className="media-rank-card__rank contest-award-chip">{n.award}</div>
                    : daily && n.daily_rank != null ? <div className="media-rank-card__rank contest-award-chip">{n.daily_rank}위</div> : null}
                </div>
                <div className="media-rank-card__overlay">
                  <div className="media-rank-card__title">{n.Title || '(제목 없음)'}</div>
                  <div className="media-rank-card__meta">
                    <span className="mini-kpi">{n.AuthorName || '(작자 미상)'}</span>
                    <span className="mini-kpi">{daily && n.daily_rank != null ? `+${formatInt(n.view_change)}` : `조회 ${formatInt(n.View)}`}</span>
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
            <RankTable ariaLabel="공모전 작품 순위" compactBelow={992} rowHeight={84} rows={sorted} rowKey={n => n.ID} columns={columns}
              sort={sort} onSort={k => setSort(s => nextContestSort(s, k as ContestSortKey))}
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
