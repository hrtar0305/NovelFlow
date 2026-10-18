import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Search as SearchIcon } from 'react-bootstrap-icons';
import ChangeMark from '../ui/ChangeMark';
import Footnotes, { FootnoteRef } from '../ui/Footnotes';
import RankTable, { type RankColumn } from '../ranking/RankTable';
import TagTerrainMap from './TagTerrainMap';
import { useIsMobile } from '../../hooks/useIsMobile';
import {
  DAILY_RULES, DEFAULT_TAG_SORT, ZONE_LABEL, ZONE_ORDER, formatTop, nextTagSort, sortTags, withZones, zoneCounts, zoneLines,
  type DailyTag, type TagSort, type TagSortKey, type ZonedTag, type ZoneKey, type ZoneRules,
} from '../../utils/tagZones';
import { formatInt, formatRatio } from '../../utils/format';

/**
 * 태그 순위판 — 구역 칩 → 지형 지도 → 표(상위 50 + 전체 보기) → 각주. 데일리 태그 랭킹과 2026~ 공모전 태그 랭킹이 같이 쓴다.
 * **그날 하루로 판단한다**(DECISIONS 2026-10-06): 작품 수 · 100위 안(t편 · 비율) · 인기 점수(랭킹 점수 점유율), 구역 3개 + 경계.
 * 지도는 표 아래(1~3만 px)에 묻혀 보이지 않아 표 위로 올렸다. 폰은 칩이 요약을 맡고 지도는 펼쳐야 보인다.
 */

type Zone = 'all' | ZoneKey;
type Row = ZonedTag<DailyTag>;

const ZoneName = ({ zone, edge }: { zone: ZoneKey | null; edge?: boolean }) => (zone
  ? <span className={`zone-name zone-name--${zone}`}><i className="zone-dot" aria-hidden="true" />{ZONE_LABEL[zone]}{edge ? <span className="zone-edge">경계</span> : null}</span>
  : <span className="zone-name zone-name--none">–</span>);

interface DailyTagBoardProps {
  tags: DailyTag[];
  loading: boolean;
  error: string | null;
  /** 날짜가 바뀌면 펼친 행을 닫는다. */
  resetKey: string | undefined;
  /** 인기 점수의 재료 이름(데일리 '랭킹 점수', 공모전 '조회 증가') */
  scoreLabel: string;
  /** 구역 판정 기준(공모전은 숨은 강자에 100위 안 6편 — tagZones.CONTEST_RULES) */
  rules?: ZoneRules;
  ariaLabel: string;
  emptyText: string;
  /** 있으면 행을 눌러 펼친다. */
  renderExpanded?: (t: Row) => ReactNode;
  onOpenTag?: (tag: string | null) => void;
}

export default function DailyTagBoard({
  tags, loading, error, resetKey, scoreLabel, rules = DAILY_RULES, ariaLabel, emptyText, renderExpanded, onOpenTag,
}: DailyTagBoardProps) {
  const [sort, setSort] = useState<TagSort>(DEFAULT_TAG_SORT);
  const [zone, setZone] = useState<Zone>('all');
  const [search, setSearch] = useState('');
  // 지도에서 고른 태그 — 표를 거르지 않고 전체 표에서 그 행으로 데려간다(2026-10-18).
  const [focus, setFocus] = useState<{ key: string; seq: number } | null>(null);
  const [searchInput, setSearchInput] = useState('');
  const [openTag, setOpenTagState] = useState<string | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [mapOpen, setMapOpen] = useState(false);
  const mobile = useIsMobile();
  const toolbarRef = useRef<HTMLDivElement>(null);

  const setOpenTag = useCallback((tag: string | null) => { setOpenTagState(tag); onOpenTag?.(tag); }, [onOpenTag]);
  useEffect(() => { setOpenTagState(null); }, [resetKey]);

  const N = tags[0]?.ranked_total ?? null;
  const lines = zoneLines(N, rules);
  const notes = useMemo(() => [
    { id: 'score', content: <>인기 점수 = 오늘 순위 작품{N ? ` ${formatInt(N)}편` : ''}이 받은 {scoreLabel} 가운데 이 태그가 달린 작품들이 차지하는 몫. 한 작품에 태그가 여럿이라 태그끼리 더하면 100%를 넘습니다. 표의 순위가 이 값 순입니다.</> },
    { id: 'top', content: <>100위 안 = 이 태그 작품 가운데 100위 안에 든 작품 수와 그 비율. 평균은 {lines ? `${Math.round(lines.p0 * 1000) / 10}%` : '100 ÷ 순위 작품 수'}입니다.</> },
    { id: 'zone', content: <>구역 — 대세: {lines ? `${lines.cut}편` : '6%'} 이상 쓰이면서 100위 안 비율이 평균 이상 · 과포화: 많이 쓰이지만 평균 미만 · 숨은 강자: 적게 쓰이지만 100위 안에 {rules.gemMinTop}편 이상, 평균의 {rules.gemMult}배 이상. 경계는 비율이 평균의 ±{Math.round(rules.edge * 100)}% 안이라 하루 사이 바뀔 수 있는 태그. 뜨고 식는 태그는 태그 트렌드(기간)에서 봅니다.</> },
  ], [N, lines, scoreLabel, rules]);

  const zoned = useMemo(() => withZones(tags, rules), [tags, rules]);
  const counts = useMemo(() => zoneCounts(zoned), [zoned]);
  const hasZones = lines != null && zoned.some(t => t.zone);
  const activeZone: Zone = hasZones ? zone : 'all';
  const q = search.trim().toLowerCase();
  const rows = useMemo(() => sortTags(
    zoned.filter(t => (activeZone === 'all' || t.zone === activeZone) && (!q || t.tag.toLowerCase().includes(q))), sort,
  ), [zoned, activeZone, q, sort]);
  const mapRows = useMemo(() => zoned.filter((t): t is Row & { top100: number; ranked_total: number } =>
    t.count >= 5 && t.top100 != null && t.ranked_total != null), [zoned]);
  const matches = useMemo(() => (activeZone !== 'all' || q ? new Set(rows.map(r => r.tag)) : null), [rows, activeZone, q]);
  // 칩의 대표 태그: 구역마다 인기 점수 상위 3개
  const leaders = useMemo(() => Object.fromEntries(ZONE_ORDER.map(z => [z,
    zoned.filter(t => t.zone === z).sort((a, b) => (b.score_share ?? 0) - (a.score_share ?? 0)).slice(0, 3).map(t => t.tag)])) as Record<ZoneKey, string[]>, [zoned]);

  const scrollToToolbar = () => {
    const el = toolbarRef.current;
    if (el && el.getBoundingClientRect().top < 0) window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 72 });
  };
  const applySearch = (v: string) => { setSearch(v); scrollToToolbar(); };
  const submitSearch = (e: FormEvent) => { e.preventDefault(); applySearch(searchInput.trim()); };
  // 지도의 점을 누르면 표를 거르지 않고 그 행으로 데려간다(펼칠 수 있는 판이면 펼친다). 예전엔 태그 이름을 검색창에 넣어 걸렀는데,
  // 검색창의 글자를 사용자가 친 것처럼 보여 다시 검색하면 '포함' 검색으로 다른 태그가 생겼다(2026-10-18). 지금 구역·검색이 그 태그를
  // 가리고 있으면 그때만 풀어 준다.
  const pickFromMap = useCallback((tag: string) => {
    if (!rows.some(r => r.tag === tag)) { setZone('all'); setSearch(''); setSearchInput(''); }
    if (renderExpanded) setOpenTag(tag);
    setFocus(f => ({ key: tag, seq: (f?.seq ?? 0) + 1 }));
  }, [rows, renderExpanded, setOpenTag]);

  const strongIf = (keys: TagSortKey[], v: ReactNode) => (keys.includes(sort.key) ? <b className="rank-strong">{v}</b> : v);

  const columns: RankColumn<Row>[] = [
    { key: 'rank', header: '순위', width: '48px', sortKey: 'Rank', render: t => <span className={`rank-num${t.Rank <= 3 ? ' is-top' : ''}`}>{t.Rank}</span> },
    { key: 'chg', header: '변동', width: '52px', sortKey: 'rank_change', render: t => <ChangeMark value={t.rank_change} /> },
    { key: 'tag', header: '태그', width: 'minmax(0,1fr)', render: t => <span className="rank-title">{t.tag}</span> },
    { key: 'zone', header: '구역', aside: <FootnoteRef id="zone" n={3} />, width: '132px', render: t => <ZoneName zone={t.zone} edge={t.edge} /> },
    // 순위가 인기 점수 순이라 순위순(기본)일 때도 점수를 굵게 둔다.
    { key: 'score', header: '인기 점수', aside: <FootnoteRef id="score" n={1} />, width: '104px', sortKey: 'score_share', align: 'right', render: t => strongIf(['score_share', 'Rank'], formatRatio(t.score_share)) },
    { key: 'count', header: '작품 수', width: '80px', sortKey: 'count', align: 'right', render: t => strongIf(['count'], formatInt(t.count)) },
    { key: 'top', header: '100위 안', aside: <FootnoteRef id="top" n={2} />, width: '112px', sortKey: 'top_share', align: 'right', render: t => strongIf(['top_share'], formatTop(t)) },
  ];

  const mobileRow = (t: Row) => (
    <div className="rank-mrow rank-mrow--tag">
      <div className="rank-mrow__rank"><span className={`rank-num${t.Rank <= 3 ? ' is-top' : ''}`}>{t.Rank}</span><ChangeMark value={t.rank_change} /></div>
      <div className="rank-mrow__main">
        <span className="rank-title">{t.tag}</span>
        <p>{t.zone ? <><ZoneName zone={t.zone} edge={t.edge} /> · </> : null}인기 <b>{formatRatio(t.score_share)}</b> · 작품 <b>{formatInt(t.count)}</b> · 100위 안 <b>{formatTop(t)}</b></p>
      </div>
    </div>
  );

  const filtered = activeZone !== 'all' || q !== '';
  const ready = !error && !loading && tags.length > 0;
  const map = ready && hasZones && mapRows.length > 0 ? (
    <section className="tag-map" aria-label="태그 지형 지도">
      {mobile && !mapOpen ? (
        <button type="button" className="link-button tag-map__open" onClick={() => setMapOpen(true)}>지형 지도 보기</button>
      ) : (
        <>
          <TagTerrainMap rows={mapRows} rules={rules} active={hover ?? openTag} matches={matches} onPick={pickFromMap} onHover={setHover} />
          <p className="tag-map__note">작품 5편 미만 태그는 그리지 않습니다 · 뜨고 식는 태그는 태그 트렌드(기간)에서 봅니다</p>
        </>
      )}
    </section>
  ) : null;

  return (
    <>
      {ready && hasZones ? (
        <div className="zone-chips" role="radiogroup" aria-label="구역">
          <button type="button" role="radio" aria-checked={zone === 'all'} className={`zone-chip${zone === 'all' ? ' is-on' : ''}`} onClick={() => setZone('all')}>
            <span className="zone-chip__name">전체</span> <span className="zone-chip__n">{formatInt(tags.length)}</span>
          </button>
          {ZONE_ORDER.map(z => (
            <button key={z} type="button" role="radio" aria-checked={zone === z} className={`zone-chip zone-name--${z}${zone === z ? ' is-on' : ''}`} onClick={() => setZone(zone === z ? 'all' : z)}>
              <span className="zone-chip__name"><i className="zone-dot" aria-hidden="true" />{ZONE_LABEL[z]}</span> <span className="zone-chip__n">{formatInt(counts[z])}</span>
              {leaders[z].length ? <span className="zone-chip__lead">{leaders[z].join(' · ')}</span> : null}
            </button>
          ))}
        </div>
      ) : null}
      {map}

      <div className="rank-toolbar" ref={toolbarRef}>
        <h2 className="rank-toolbar__title">
          태그 순위
          {filtered ? <span className="rank-toolbar__count">조건에 맞는 <b>{formatInt(rows.length)}</b>개</span> : null}
        </h2>
        <form className="toolbar-searchform" role="search" onSubmit={submitSearch}>
          <input className="toolbar-search" type="search" placeholder="태그 검색" aria-label="태그 검색"
            value={searchInput} onChange={e => { setSearchInput(e.target.value); if (e.target.value === '' && search) applySearch(''); }} />
          <button type="submit" className="toolbar-searchbtn" aria-label="검색"><SearchIcon size={15} aria-hidden="true" /></button>
        </form>
      </div>

      {error ? <p className="empty-line">{error} <button type="button" className="link-button" onClick={() => window.location.reload()}>다시 시도</button></p>
        : loading ? <div className="rank-skeleton" aria-busy="true">{Array.from({ length: 8 }, (_, i) => <div key={i} />)}</div>
        : (
          <RankTable ariaLabel={ariaLabel} rows={rows} rowKey={t => t.tag} columns={columns} rowHeight={52}
            sort={sort} onSort={k => setSort(s => nextTagSort(s, k as TagSortKey))}
            {...(renderExpanded ? {
              expandedKey: openTag,
              onToggleRow: (t: Row) => setOpenTag(openTag === t.tag ? null : t.tag),
              renderExpanded,
            } : {})}
            onRowHover={t => setHover(t?.tag ?? null)}
            // 수백 개를 다 펼치면 아래 각주가 1~3만 px 밑에 묻힌다 — 상위 50개만, 나머지는 '전체 보기'(사용자 2026-10-05).
            collapseAfter={50} expandOnMobile focus={focus}
            renderMobileRow={mobileRow}
            emptyText={tags.length === 0 ? emptyText : '조건에 맞는 태그가 없습니다.'} />
        )}

      {ready ? <Footnotes notes={notes} /> : null}
    </>
  );
}
