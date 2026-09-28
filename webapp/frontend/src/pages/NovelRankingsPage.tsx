import { useCallback, useDeferredValue, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { isValid, parseISO } from 'date-fns';
import { getAvailableDates, getNovelRankingShowcase, getNovelRankingsByDate } from '../services/api';
import PageTitle from '../components/ui/PageTitle';
import DateNav from '../components/ui/DateNav';
import TagLinks from '../components/ui/TagLinks';
import ChangeMark from '../components/ui/ChangeMark';
import NovelCover from '../components/NovelCover';
import Showcase from '../components/ranking/Showcase';
import FilterDrawer from '../components/ranking/FilterDrawer';
import AppliedFilters from '../components/ranking/AppliedFilters';
import RankTable, { type RankColumn } from '../components/ranking/RankTable';
import NovelRowExpand from '../components/ranking/NovelRowExpand';
import {
  DEFAULT_SORT, EMPTY_FILTER, activeFilterCount, applyRankingFilter, nextSort, normalizeNovels, sortRankings, tagCounts, toggleTag,
  type RankingFilter, type RankingNovel, type SortConfig, type SortKey,
} from '../utils/rankingQuery';
import { formatInt, formatRatio } from '../utils/format';

// 잔류율 산식은 그 열 머리글 바로 아래 한 줄로 짧게 둔다(좁은 폭은 목록 위 한 줄).
// 열 폭에 맞춰 '조회'는 툴팁에만 쓴다. 추천비는 이름으로 뜻이 전해져 설명을 두지 않는다.
const FORMULA = {
  early: { short: '30화 / 1화', full: '30화 조회수 ÷ 1화 조회수' },
  recent: { short: '최신화 / 30화 전', full: '최신화 조회수 ÷ 30화 전 조회수' },
};

export default function NovelRankingsPage() {
  const { date: dateParam } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();

  const [dates, setDates] = useState<Set<string>>(new Set());
  const [rows, setRows] = useState<RankingNovel[]>([]);
  const [showcase, setShowcase] = useState<{ date?: string; top: RankingNovel[]; movers: RankingNovel[] }>({ top: [], movers: [] });
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
    getNovelRankingShowcase()
      .then(r => setShowcase({ date: r.data.latest_date, top: normalizeNovels(r.data.topThree || []), movers: normalizeNovels(r.data.movers || []) }))
      .catch(() => setShowcase({ top: [], movers: [] }));
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
  const hit = useMemo(() => new Set(filter.rule ? [] : filter.tags), [filter]);
  const onTag = useCallback((t: string) => update(toggleTag(filter, t)), [filter, update]);

  const columns: RankColumn<RankingNovel>[] = [
    { key: 'rank', header: '순위', width: '48px', sortKey: 'Ranking',
      render: n => <span className={`rank-num${n.Ranking <= 3 ? ' is-top' : ''}`}>{n.Ranking}</span> },
    { key: 'chg', header: '변동', width: '52px', sortKey: 'rank_change', render: n => <ChangeMark value={n.rank_change} /> },
    // 표지는 제목 열 안에 둔다 — 따로 열을 두면 머리글 없는 표지 칸이 빈 '제목' 열처럼 보였다.
    { key: 'title', header: '제목', width: 'minmax(0,1fr)',
      render: n => (
        <span className="rank-titlecell">
          <span className="rank-cover"><NovelCover url={n.ThumbnailURL} title={n.Title} imageClassName="rank-cover__img" /></span>
          <Link to={`/novels/${n.ID}`} className="rank-title" onClick={e => e.stopPropagation()}>{n.Title || '(제목 없음)'}</Link>
        </span>
      ) },
    { key: 'author', header: '작가', width: '108px',
      render: n => n.AuthorID ? <Link to={`/authors/${n.AuthorID}`} className="rank-author" onClick={e => e.stopPropagation()}>{n.AuthorName}</Link> : <span className="rank-author">{n.AuthorName || '(작자 미상)'}</span> },
    { key: 'score', header: '점수', width: '76px', sortKey: 'Score', render: n => <b className="rank-strong">{formatInt(n.Score)}</b> },
    { key: 'eps', header: '회차', width: '54px', sortKey: 'Eps', render: n => formatInt(n.Eps) },
    { key: 'ratio', header: '추천비', width: '62px', sortKey: 'like_to_view_ratio', render: n => formatRatio(n.like_to_view_ratio, 2) },
    { key: 'early', header: '초반 잔류', sub: FORMULA.early.short, width: '66px', sortKey: 'EarlyRetentionRate', title: FORMULA.early.full, render: n => formatRatio(n.EarlyRetentionRate, 0) },
    { key: 'recent', header: '최신 잔류', sub: FORMULA.recent.short, width: '80px', sortKey: 'RecentRetentionRate', title: FORMULA.recent.full, render: n => formatRatio(n.RecentRetentionRate, 0) },
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
  // 10열은 992px 미만에서 제목 칸이 남지 않는다 — 그 폭부터 모바일 행(RankTable compactBelow)으로 그린다.
  return (
    <div className="page-shell novel-rankings-page">
      <PageTitle title="일간 랭킹"
        nav={<DateNav value={dateParam ?? null} availableDates={dates} onChange={d => navigate(`/novels/rankings/${d}`)} />}
        meta={`밤 9시 · 노벨피아 7일 조회순 상위 ${rows.length || 500}`} />

      <Showcase top={showcase.top} movers={showcase.movers} showcaseDate={showcase.date} tableDate={dateParam ?? null} />

      {/* 급상승·신규 진입 탭은 두지 않는다 — 변동 열 내림차순이 곧 NEW → 상승 폭 순이다. */}
      <div className="rank-toolbar">
        <span className="rank-toolbar__count">{sorted.length.toLocaleString('ko-KR')}편</span>
        <input className="toolbar-search" type="search" placeholder="제목·작가 검색" aria-label="제목·작가 검색"
          value={filter.search} onChange={e => update({ ...filter, search: e.target.value })} />
        <button type="button" className={`toolbar-filter${count ? ' is-on' : ''}`} onClick={() => setDrawer(true)} aria-haspopup="dialog">
          필터{count ? <span className="toolbar-filter__n">{count}</span> : null}
        </button>
      </div>
      <AppliedFilters filter={filter} onChange={update} />
      {!error && !loading && rows.length > 0 ? (
        <p className="rank-formula">초반 잔류 {FORMULA.early.short} · 최신 잔류 {FORMULA.recent.short} (조회수)</p>
      ) : null}

      <div className={isPending ? 'is-pending' : undefined}>
        {error ? <p className="empty-line">{error} <button type="button" className="link-button" onClick={() => window.location.reload()}>다시 시도</button></p>
          : loading ? <div className="rank-skeleton" aria-busy="true">{Array.from({ length: 8 }, (_, i) => <div key={i} />)}</div>
          : (
            <RankTable ariaLabel="일간 랭킹" compactBelow={992} rowHeight={84} rows={sorted} rowKey={n => n.ID} columns={columns}
              sort={sort} onSort={k => setSort(s => nextSort(s, k as SortKey))}
              expandedKey={openId}
              onToggleRow={n => setOpenId(id => (id === n.ID ? null : n.ID))}
              renderExpanded={n => <NovelRowExpand novelId={n.ID} date={dateParam!} availableDates={dates} />}
              renderMobileRow={mobileRow}
              emptyText={result.error ?? (rows.length === 0 ? '이 날짜의 랭킹 데이터가 없습니다.' : '조건에 맞는 작품이 없습니다.')} />
          )}
      </div>


      <FilterDrawer open={drawer} onClose={() => setDrawer(false)} filter={filter} onChange={update}
        tagStats={stats} resultCount={sorted.length} error={result.error} />
    </div>
  );
}
