import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Search as SearchIcon } from 'react-bootstrap-icons';
import Footnotes, { FootnoteRef } from '../ui/Footnotes';
import { SkeletonBox, SkeletonRows, Stale } from '../ui/Loading';
import RankTable, { type RankColumn } from '../ranking/RankTable';
import TagTerrainMap from './TagTerrainMap';
import { useIsMobile } from '../../hooks/useIsMobile';
import {
  DEFAULT_TAG_SORT, MIN_WORKS, ZONE_LABEL, ZONE_ORDER, formatTop, formatTopShare, nextTagSort, shareNoteText, zoneNoteText, sortTags, withZones, zoneCounts, zoneLines,
  type DailyTag, type TagSort, type TagSortKey, type ZonedTag, type ZoneKey,
} from '../../utils/tagZones';
import { formatInt, formatRatio } from '../../utils/format';

/**
 * 태그 순위판 — 구역 칩 → 지형 지도 → 표(상위 50 + 전체 보기) → 각주. 데일리 태그 랭킹과 2026~ 공모전 태그 랭킹이 같이 쓴다.
 * **그날 하루로 판단한다**(DECISIONS 2026-10-06): 작품 수 · 100위 안(t편 · 비율) · 인기 점수(랭킹 점수 점유율), 구역 3개 + 경계.
 * 지도는 표 아래(1~3만 px)에 묻혀 보이지 않아 표 위로 올렸다. 폰은 칩이 요약을 맡고 지도는 펼쳐야 보인다.
 */

type Zone = 'all' | ZoneKey;
type Row = ZonedTag<DailyTag>;

/** none = 구역이 없을 때 쓸 말(표 칸은 '–', 태그 트렌드의 '구역 이동'은 '구역 없음' — '– → 대세'는 읽히지 않았다) */
export const ZoneName = ({ zone, edge, none = '–' }: { zone: ZoneKey | null; edge?: boolean; none?: string }) => (zone
  ? <span className={`zone-name zone-name--${zone}`}><i className="zone-dot" aria-hidden="true" />{ZONE_LABEL[zone]}{edge ? <span className="zone-edge">경계</span> : null}</span>
  : <span className="zone-name zone-name--none">{none}</span>);

interface DailyTagBoardProps {
  tags: DailyTag[];
  loading: boolean;
  error: string | null;
  /** 날짜가 바뀌면 펼친 행을 닫는다. */
  resetKey: string | undefined;
  /** 인기 점수의 재료 이름(데일리 '랭킹 점수', 공모전 '조회 증가')과 그 뜻 한 줄 */
  scoreLabel: string;
  scoreNote: ReactNode;
  /** 대표 작품 링크 */
  novelHref: (id: string) => string;
  ariaLabel: string;
  emptyText: string;
  /** 있으면 행을 눌러 펼친다. */
  renderExpanded?: (t: Row) => ReactNode;
  onOpenTag?: (tag: string | null) => void;
}

export default function DailyTagBoard({
  tags, loading, error, resetKey, scoreLabel, scoreNote, novelHref, ariaLabel, emptyText, renderExpanded, onOpenTag,
}: DailyTagBoardProps) {
  const [sort, setSort] = useState<TagSort>(DEFAULT_TAG_SORT);
  const [zone, setZone] = useState<Zone>('all');
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [openTag, setOpenTagState] = useState<string | null>(null);
  const mobile = useIsMobile();
  const toolbarRef = useRef<HTMLDivElement>(null);

  const setOpenTag = useCallback((tag: string | null) => { setOpenTagState(tag); onOpenTag?.(tag); }, [onOpenTag]);
  useEffect(() => { setOpenTagState(null); }, [resetKey]);

  const N = tags[0]?.ranked_total ?? null;
  const lines = zoneLines(N);
  // 각주는 정의만 — 숫자는 그날 N 으로 채운다(데일리 30편 · 20%, 공모전 179편 · 3.4%).
  // 각주 = 열 순서대로 그 값의 식. 숫자는 그날 N 으로 채운다(데일리 500편, 공모전 약 3,000편).
  const notes = useMemo(() => {
    // '일간 500위 안 작품' — 데일리는 랭킹 전체, 공모전은 참여작 중 일간 500위 안(같은 모집단 크기, 2026-10-18).
    const n = N ? `일간 ${formatInt(N)}위 안 작품` : '순위 작품';
    return [
      { id: 'score', content: <>인기 점수 = 이 태그 작품들의 {scoreLabel} 합 ÷ {n} 전체의 {scoreLabel} 합. {scoreNote}</> },
      { id: 'count', content: <>작품 수 = {n} 중 이 태그를 단 작품 수.</> },
      { id: 'top', content: <>100위 안 = 이 태그 작품 중 100위 안에 든 작품 수.</> },
      { id: 'share', content: shareNoteText(N) },
      { id: 'zone', content: zoneNoteText(N) },
    ];
  }, [N, scoreLabel, scoreNote]);

  const zoned = useMemo(() => withZones(tags), [tags]);
  const counts = useMemo(() => zoneCounts(zoned), [zoned]);
  const hasZones = lines != null && zoned.some(t => t.zone);
  const activeZone: Zone = hasZones ? zone : 'all';
  const q = search.trim().toLowerCase();
  const rows = useMemo(() => sortTags(
    zoned.filter(t => (activeZone === 'all' || t.zone === activeZone) && (!q || t.tag.toLowerCase().includes(q))), sort,
  ), [zoned, activeZone, q, sort]);
  const mapRows = useMemo(() => zoned.filter((t): t is Row & { top100: number; ranked_total: number } =>
    t.count >= MIN_WORKS && t.top100 != null && t.ranked_total != null), [zoned]);
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
  // 지도의 점 = 그 태그의 펼침 열기/닫기. 표와 같은 상태(openTag)를 쓰므로 어느 쪽에서 열고 닫아도 함께 움직인다. 표로 끌고 가거나 표를
  // 거르지 않는다(사용자 2026-10-18) — 예전엔 검색창에 이름을 넣어 걸렀고, 그다음엔 그 행으로 스크롤했는데 스크롤 중에 지도의 '가리킴'이
  // 풀리지 않아 펼침을 닫아도 점이 강조된 채 남았다.
  const pickFromMap = useCallback((tag: string) => {
    if (renderExpanded) setOpenTag(openTag === tag ? null : tag);
  }, [renderExpanded, openTag, setOpenTag]);

  const strongIf = (keys: TagSortKey[], v: ReactNode) => (keys.includes(sort.key) ? <b className="rank-strong">{v}</b> : v);

  // 남는 폭은 열마다 나눠 갖고(fr), 숫자도 작품 표처럼 왼쪽 정렬 — 오른쪽 정렬이면 머리글 끝의 정렬 표시(↕) 때문에 머리글과 값의 끝이
  // 어긋나 보였다. 대표 작품은 맨 오른쪽에 두어 제목이 남는 폭을 채운다(사용자 2026-10-18).
  const columns: RankColumn<Row>[] = [
    { key: 'rank', header: '순위', width: '48px', sortKey: 'Rank', render: t => <span className={`rank-num${t.Rank <= 3 ? ' is-top' : ''}`}>{t.Rank}</span> },
    { key: 'tag', header: '태그', width: 'minmax(0,1fr)', render: t => <span className="rank-title">{t.tag}</span> },
    // 순위가 인기 점수 순이라 순위순(기본)일 때도 점수를 굵게 둔다.
    { key: 'score', header: '인기 점수', aside: <FootnoteRef id="score" n={1} />, width: 'minmax(92px,0.8fr)', sortKey: 'score_share', render: t => strongIf(['score_share', 'Rank'], formatRatio(t.score_share)) },
    { key: 'count', header: '작품 수', aside: <FootnoteRef id="count" n={2} />, width: 'minmax(76px,0.7fr)', sortKey: 'count', render: t => strongIf(['count'], formatInt(t.count)) },
    { key: 'top', header: '100위 안', aside: <FootnoteRef id="top" n={3} />, width: 'minmax(80px,0.7fr)', sortKey: 'top100', render: t => strongIf(['top100'], t.top100 != null ? `${formatInt(t.top100)}편` : '–') },
    { key: 'share', header: '100위 안 비율', aside: <FootnoteRef id="share" n={4} />, width: 'minmax(116px,0.8fr)', sortKey: 'top_share', render: t => strongIf(['top_share'], formatTopShare(t)) },
    // 구역은 작품 수 · 100위 안 비율로 정해지는 값이라 그 뒤에 둔다.
    { key: 'zone', header: '구역', aside: <FootnoteRef id="zone" n={5} />, width: 'minmax(112px,0.8fr)', render: t => <ZoneName zone={t.zone} edge={t.edge} /> },
    { key: 'novel', header: '대표 작품', width: 'minmax(0,1.8fr)', render: t => (t.top_novel
      ? <Link className="rank-toplink" to={novelHref(t.top_novel.id)} onClick={e => e.stopPropagation()}><span className="rank-toplink__rank">{t.top_novel.rank}위</span> {t.top_novel.title}</Link>
      : '–') },
  ];

  const mobileRow = (t: Row) => (
    <div className="rank-mrow rank-mrow--tag">
      <div className="rank-mrow__rank"><span className={`rank-num${t.Rank <= 3 ? ' is-top' : ''}`}>{t.Rank}</span></div>
      <div className="rank-mrow__main">
        <span className="rank-title">{t.tag}</span>
        <p>{t.zone ? <><ZoneName zone={t.zone} edge={t.edge} /> · </> : null}인기 <b>{formatRatio(t.score_share)}</b> · 작품 <b>{formatInt(t.count)}</b> · 100위 안 <b>{formatTop(t)}</b></p>
      </div>
    </div>
  );

  const filtered = activeZone !== 'all' || q !== '';
  // 날짜를 바꾸는 동안 이전 날짜의 칩·지도·표를 흐리게 둔다(Stale). 처음 들어와 값이 없을 때만 빈 틀(2026-10-18).
  const ready = !error && tags.length > 0;
  const firstLoad = loading && !error && tags.length === 0;
  // 폰에서는 지도를 두지 않는다 — 360px 폭에서는 점과 이름이 겹쳐 읽히지 않고, 구역 칩이 요약을 맡는다(모바일은 PC 의 일부만, 사용자 2026-10-19).
  const map = mobile ? null : ready && hasZones && mapRows.length > 0 ? (
    <Stale loading={loading}><section className="tag-map" aria-label="태그 지형 지도">
      <TagTerrainMap rows={mapRows} active={openTag} matches={matches} onPick={pickFromMap} />
    </section></Stale>
  ) : firstLoad ? (
    <section className="tag-map" aria-hidden="true"><SkeletonBox className="tag-map__chart" /></section>
  ) : null;

  return (
    <>
      {ready && hasZones ? (
        <Stale loading={loading}><div className="zone-chips" role="radiogroup" aria-label="구역">
          <button type="button" role="radio" aria-checked={zone === 'all'} className={`zone-chip${zone === 'all' ? ' is-on' : ''}`} onClick={() => setZone('all')}>
            <span className="zone-chip__name">전체</span> <span className="zone-chip__n">{formatInt(tags.length)}</span>
          </button>
          {ZONE_ORDER.map(z => (
            <button key={z} type="button" role="radio" aria-checked={zone === z} className={`zone-chip zone-name--${z}${zone === z ? ' is-on' : ''}`} onClick={() => setZone(zone === z ? 'all' : z)}>
              <span className="zone-chip__name"><i className="zone-dot" aria-hidden="true" />{ZONE_LABEL[z]}</span> <span className="zone-chip__n">{formatInt(counts[z])}</span>
              {leaders[z].length ? <span className="zone-chip__lead">{leaders[z].join(' · ')}</span> : null}
            </button>
          ))}
        </div></Stale>
      ) : firstLoad ? (
        <div className="zone-chips">{[96, 280, 280, 280].map((w, i) => <SkeletonBox key={i} className="zone-chip" style={{ width: w, maxWidth: '100%', height: 61 }} />)}</div>
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
        : firstLoad ? <SkeletonRows />
        : (
          <Stale loading={loading}><RankTable ariaLabel={ariaLabel} rows={rows} rowKey={t => t.tag} columns={columns} rowHeight={52}
            sort={sort} onSort={k => setSort(s => nextTagSort(s, k as TagSortKey))}
            {...(renderExpanded ? {
              expandedKey: openTag,
              onToggleRow: (t: Row) => setOpenTag(openTag === t.tag ? null : t.tag),
              renderExpanded,
            } : {})}
            // 수백 개를 다 펼치면 아래 각주가 1~3만 px 밑에 묻힌다 — 상위 50개만, 나머지는 '전체 보기'(사용자 2026-10-05).
            collapseAfter={50} expandOnMobile
            renderMobileRow={mobileRow}
            emptyText={tags.length === 0 ? emptyText : '조건에 맞는 태그가 없습니다.'} /></Stale>
        )}

      {ready ? <Footnotes notes={notes} /> : null}
    </>
  );
}
