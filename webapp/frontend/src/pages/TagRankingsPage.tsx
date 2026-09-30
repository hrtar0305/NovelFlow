import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { format, isValid, parseISO, subDays } from 'date-fns';
import { Search as SearchIcon } from 'react-bootstrap-icons';
import { getAvailableDates, getTagRankingsByDate, getTagSeries } from '../services/api';
import PageTitle from '../components/ui/PageTitle';
import DateNav from '../components/ui/DateNav';
import ViewSwitch from '../components/ui/ViewSwitch';
import ChangeMark from '../components/ui/ChangeMark';
import Footnotes, { FootnoteRef } from '../components/ui/Footnotes';
import RankTable, { type RankColumn } from '../components/ranking/RankTable';
import TagRowExpand, { type TagSeries } from '../components/tag/TagRowExpand';
import TagTerrainMap from '../components/tag/TagTerrainMap';
import {
  DEFAULT_TAG_SORT, ZONE_LABEL, ZONE_ORDER, formatLift, mainstreamCut, nextTagSort, sortTags, withZones, zoneCounts,
  type DailyTag, type TagSort, type TagSortKey, type ZonedTag, type ZoneKey,
} from '../utils/tagZones';
import { formatInt } from '../utils/format';

/**
 * 태그 랭킹(2026-09-30 개편). 요약 카드·선택 패널·구역 칩 패널·변동 카드를 걷고
 * 표 하나 + 구역 필터 + 행 펼침(14일 순위선) + 지형 지도로 줄였다.
 * 뜬·식은·새로 진입 탭은 두지 않는다 — 일간 작품 표와 같이 변동 열 정렬이 그 목록이다.
 * 산식은 백엔드와 한 글자도 어긋나면 안 된다(`main.py` 의 `_compute_local_lift`, 적재의 `TagWeightedScoresLogarithmic`).
 */

const HISTORY_DAYS = 14;

const NOTES = [
  { id: 'zone', content: <>구역 = 작품 수가 그날 상위 25% 안인지 × 상위권 집중도가 1.0 이상인지. 오늘의 대세는 둘 다, 숨은 강자는 적게 쓰이지만 상위권에 몰린 태그, 과포화는 많이 쓰이지만 덜 몰린 태그, 오늘 약세는 둘 다 아닌 태그입니다.</> },
  { id: 'lift', content: <>상위권 집중도 = 상위 100위 안에서의 등장 비율 ÷ 100위 밖에서의 등장 비율. 1.0이면 순위와 무관하게 고르게 쓰인 태그입니다. 작품 5편 미만인 태그는 계산하지 않습니다.</> },
  { id: 'power', content: <>인기 점수 = 태그가 달린 작품마다 1 ÷ ln(순위 + 1)을 더한 값. 상위 작품일수록 크게 반영되며, 태그 순위가 이 점수 순입니다.</> },
];

type Zone = 'all' | ZoneKey;
type Row = ZonedTag<DailyTag>;

const ZoneName = ({ zone }: { zone: ZoneKey | null }) => (zone
  ? <span className={`zone-name zone-name--${zone}`}><i className="zone-dot" aria-hidden="true" />{ZONE_LABEL[zone]}</span>
  : <span className="zone-name zone-name--none">–</span>);

export default function TagRankingsPage() {
  const { date: dateParam } = useParams();
  const navigate = useNavigate();

  const [dates, setDates] = useState<Set<string>>(new Set());
  const [tags, setTags] = useState<DailyTag[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sort, setSort] = useState<TagSort>(DEFAULT_TAG_SORT);
  const [zone, setZone] = useState<Zone>('all');
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [openTag, setOpenTag] = useState<string | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [series, setSeries] = useState<{ date: string; data: TagSeries | 'loading' | 'error' } | null>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);

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
      .then(r => setSeries(cur => (cur?.date === key ? { date: key, data: r.data as TagSeries } : cur)))
      .catch(() => {
        if (requested.current === key) requested.current = null;   // 다음에 펼칠 때 다시 시도
        setSeries(cur => (cur?.date === key ? { date: key, data: 'error' } : cur));
      });
  }, [openTag, dateParam]);

  const zoned = useMemo(() => withZones(tags), [tags]);
  const cut = useMemo(() => mainstreamCut(tags), [tags]);
  const counts = useMemo(() => zoneCounts(zoned), [zoned]);
  const q = search.trim().toLowerCase();
  const rows = useMemo(() => sortTags(
    zoned.filter(t => (zone === 'all' || t.zone === zone) && (!q || t.tag.toLowerCase().includes(q))), sort,
  ), [zoned, zone, q, sort]);
  const mapRows = useMemo(() => zoned.filter((t): t is Row & { zone: ZoneKey; local_lift: number } => t.zone != null && t.local_lift != null), [zoned]);
  const matches = useMemo(() => (zone !== 'all' || q ? new Set(rows.map(r => r.tag)) : null), [rows, zone, q]);

  const scrollToToolbar = () => {
    const el = toolbarRef.current;
    if (el && el.getBoundingClientRect().top < 0) window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 72 });
  };
  const applySearch = (v: string) => { setSearch(v); scrollToToolbar(); };
  const submitSearch = (e: FormEvent) => { e.preventDefault(); applySearch(searchInput.trim()); };
  const pickZone = (z: Zone) => { setZone(z); scrollToToolbar(); };
  // 지도의 원을 누르면 표에서 그 태그를 찾아 펼친다.
  const pickFromMap = useCallback((tag: string) => {
    setZone('all');
    setSearch(tag);
    setSearchInput(tag);
    setOpenTag(tag);
    const el = toolbarRef.current;
    if (el) window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 72, behavior: 'smooth' });
  }, []);

  const strongIf = (keys: TagSortKey[], v: ReactNode) => (keys.includes(sort.key) ? <b className="rank-strong">{v}</b> : v);
  const hasZones = cut != null;

  const columns: RankColumn<Row>[] = [
    { key: 'rank', header: '순위', width: '48px', sortKey: 'Rank', render: t => <span className={`rank-num${t.Rank <= 3 ? ' is-top' : ''}`}>{t.Rank}</span> },
    { key: 'chg', header: '변동', width: '52px', sortKey: 'rank_change', render: t => <ChangeMark value={t.rank_change} /> },
    { key: 'tag', header: '태그', width: 'minmax(0,1fr)', render: t => <span className="rank-title">{t.tag}</span> },
    { key: 'zone', header: '구역', aside: <FootnoteRef id="zone" n={1} />, width: '120px', render: t => <ZoneName zone={t.zone} /> },
    { key: 'count', header: '작품 수', width: '76px', sortKey: 'count', render: t => strongIf(['count'], formatInt(t.count)) },
    { key: 'lift', header: '상위권 집중도', aside: <FootnoteRef id="lift" n={2} />, width: '124px', sortKey: 'local_lift', render: t => strongIf(['local_lift'], formatLift(t.local_lift)) },
    // 순위는 인기 점수로 매기므로 순위순(기본)일 때도 점수를 볼드로 둔다.
    { key: 'power', header: '인기 점수', aside: <FootnoteRef id="power" n={3} />, width: '100px', sortKey: 'power_score', render: t => strongIf(['power_score', 'Rank'], t.power_score.toFixed(2)) },
  ];

  const mobileRow = (t: Row) => (
    <div className="rank-mrow rank-mrow--tag">
      <div className="rank-mrow__rank"><span className={`rank-num${t.Rank <= 3 ? ' is-top' : ''}`}>{t.Rank}</span><ChangeMark value={t.rank_change} /></div>
      <div className="rank-mrow__main">
        <span className="rank-title">{t.tag}</span>
        <p>{t.zone ? <><ZoneName zone={t.zone} /> · </> : null}작품 <b>{formatInt(t.count)}</b> · 집중도 <b>{formatLift(t.local_lift)}</b> · 점수 <b>{t.power_score.toFixed(2)}</b></p>
      </div>
    </div>
  );

  const filtered = zone !== 'all' || q !== '';
  const excluded = tags.length - mapRows.length;

  return (
    <div className="page-shell tag-rankings-page">
      <PageTitle title="태그 랭킹"
        nav={<DateNav value={dateParam ?? null} availableDates={dates} onChange={d => navigate(`/tags/rankings/${d}`)} />}
        aside={<ViewSwitch label="태그 보기" items={[
          { to: `/tags/rankings${dateParam ? `/${dateParam}` : ''}`, label: '오늘', on: true },
          { to: '/tags/trends', label: '기간 트렌드', on: false },
        ]} />}
        meta={tags.length ? `일간 랭킹 작품에 달린 태그 ${formatInt(tags.length)}개 · 인기 점수 순` : '일간 랭킹 작품에 달린 태그 · 인기 점수 순'} />

      <div className="rank-toolbar" ref={toolbarRef}>
        <h2 className="rank-toolbar__title">
          태그 순위
          <span className="rank-toolbar__count">
            {filtered ? <>조건에 맞는 <b>{formatInt(rows.length)}</b>개 / {formatInt(tags.length)}개</> : <>{formatInt(tags.length)}개</>}
          </span>
        </h2>
        <form className="toolbar-searchform" role="search" onSubmit={submitSearch}>
          <input className="toolbar-search" type="search" placeholder="태그 검색" aria-label="태그 검색"
            value={searchInput} onChange={e => { setSearchInput(e.target.value); if (e.target.value === '' && search) applySearch(''); }} />
          <button type="submit" className="toolbar-searchbtn" aria-label="검색"><SearchIcon size={15} aria-hidden="true" /></button>
        </form>
      </div>
      {hasZones && tags.length > 0 ? (
        <div className="zone-filter" role="radiogroup" aria-label="구역">
          <button type="button" role="radio" aria-checked={zone === 'all'} className={zone === 'all' ? 'is-on' : undefined} onClick={() => pickZone('all')}>
            전체 <span className="zone-filter__n">{formatInt(tags.length)}</span>
          </button>
          {ZONE_ORDER.map(z => (
            <button key={z} type="button" role="radio" aria-checked={zone === z} className={`zone-filter__item zone-name--${z}${zone === z ? ' is-on' : ''}`} onClick={() => pickZone(z)}>
              <i className="zone-dot" aria-hidden="true" />{ZONE_LABEL[z]} <span className="zone-filter__n">{formatInt(counts[z])}</span>
            </button>
          ))}
        </div>
      ) : null}

      {error ? <p className="empty-line">{error} <button type="button" className="link-button" onClick={() => window.location.reload()}>다시 시도</button></p>
        : loading ? <div className="rank-skeleton" aria-busy="true">{Array.from({ length: 8 }, (_, i) => <div key={i} />)}</div>
        : (
          <RankTable ariaLabel="태그 순위" rows={rows} rowKey={t => t.tag} columns={columns} rowHeight={52}
            sort={sort} onSort={k => setSort(s => nextTagSort(s, k as TagSortKey))}
            expandedKey={openTag}
            onToggleRow={t => setOpenTag(cur => (cur === t.tag ? null : t.tag))}
            renderExpanded={t => (
              <TagRowExpand tag={t.tag} date={dateParam!}
                series={series && series.date === dateParam ? series.data : 'loading'}
                novelsHref={`/novels/rankings/${dateParam}?tag=${encodeURIComponent(t.tag)}`} />
            )}
            onRowHover={t => setHover(t?.tag ?? null)}
            renderMobileRow={mobileRow}
            emptyText={tags.length === 0 ? '이 날짜의 태그 랭킹이 없습니다.' : '조건에 맞는 태그가 없습니다.'} />
        )}

      {!error && !loading && tags.length > 0 ? (
        <>
          <Footnotes notes={NOTES} />
          <section className="tag-map">
            <div className="tag-map__head">
              <h2>태그 지형 지도</h2>
              {hasZones ? <span className="tag-map__meta">태그 {formatInt(mapRows.length)}개{excluded > 0 ? ` · 작품 5편 미만 ${formatInt(excluded)}개 제외` : ''}</span> : null}
            </div>
            {hasZones && cut != null ? (
              <>
                <p className="tag-map__axis">가로 작품 수 · 세로 상위권 집중도 · 원 크기 인기 점수 · 이름은 눈에 띄는 태그에만, 원을 누르면 표에서 찾습니다</p>
                <TagTerrainMap rows={mapRows} cut={cut} active={hover ?? openTag} matches={matches} onPick={pickFromMap} onHover={setHover} />
              </>
            ) : (
              <p className="empty-line">2026년 4월 13일 이전 수집분에는 상위권 집중도가 없어 지도를 그리지 않습니다.</p>
            )}
          </section>
        </>
      ) : null}
    </div>
  );
}
