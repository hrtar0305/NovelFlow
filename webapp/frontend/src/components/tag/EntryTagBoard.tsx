import { useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Search as SearchIcon } from 'react-bootstrap-icons';
import RankTable, { type RankColumn } from '../ranking/RankTable';
import Footnotes, { FootnoteRef } from '../ui/Footnotes';
import { SkeletonRows, Stale } from '../ui/Loading';
import { DEFAULT_ENTRY_SORT, MIN_ENTRY, entryRate, sortEntryTags, type EntrySort, type EntrySortKey, type EntryTag } from '../../utils/contestEntryTags';
import { nextSortOf } from '../../utils/rankingQuery';
import { formatInt } from '../../utils/format';

const pct = (v: number | null) => (v == null ? '–' : `${(v * 100).toFixed(1)}%`);   // 자리 고정 — '60%' 와 '66.7%' 가 섞였다

/** 공모전 태그 '전체 참여작' 보기 — 표 하나(구역 · 지도 없음). 기본 보기(DailyTagBoard, 일간 500위 안)의 짝(2026-10-18). */
export default function EntryTagBoard({ tags, loading, error, worksHref }: {
  tags: EntryTag[]; loading: boolean; error: string | null; worksHref: (tag: string) => string;
}) {
  const [sort, setSort] = useState<EntrySort>(DEFAULT_ENTRY_SORT);
  const [input, setInput] = useState('');
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const N = tags[0]?.entrants ?? 0;
  const pool = tags[0]?.pool ?? 500;
  const rows = useMemo(() => sortEntryTags(q ? tags.filter(t => t.tag.toLowerCase().includes(q.toLowerCase())) : tags, sort), [tags, q, sort]);
  const strongIf = (k: EntrySortKey, v: ReactNode) => (sort.key === k ? <b className="rank-strong">{v}</b> : v);

  const notes = [
    { id: 'e-count', content: `참여작 = 그날 참여작 ${formatInt(N)}편(삭제 제외) 중 이 태그를 단 작품 수. 2편 미만 태그는 제외.` },
    { id: 'e-share', content: `참여 비율 = 참여작 ÷ ${formatInt(N)}편.` },
    { id: 'e-in', content: `${pool}위 진입 = 이 태그 참여작 중 그날 일간 ${pool}위 안에 든 작품 수.` },
    { id: 'e-rate', content: `진입률 = ${pool}위 진입 ÷ 참여작. 전체 ${N ? pct(pool / N) : ''} = ${pool} ÷ ${formatInt(N)}. 참여작 ${MIN_ENTRY}편 미만 태그는 생략.` },
  ];
  const columns: RankColumn<EntryTag>[] = [
    { key: 'tag', header: '태그', width: 'minmax(0,1.4fr)', render: t => <span className="rank-title">{t.tag}</span> },
    { key: 'count', header: '참여작', aside: <FootnoteRef id="e-count" n={1} />, width: 'minmax(88px,1fr)', sortKey: 'count', render: t => strongIf('count', `${formatInt(t.count)}편`) },
    { key: 'share', header: '참여 비율', aside: <FootnoteRef id="e-share" n={2} />, width: 'minmax(96px,1fr)', render: t => pct(N ? t.count / N : null) },
    { key: 'in', header: `${pool}위 진입`, aside: <FootnoteRef id="e-in" n={3} />, width: 'minmax(104px,1fr)', sortKey: 'entered', render: t => strongIf('entered', `${formatInt(t.entered)}편`) },
    { key: 'rate', header: '진입률', aside: <FootnoteRef id="e-rate" n={4} />, width: 'minmax(88px,1fr)', sortKey: 'rate', render: t => strongIf('rate', pct(entryRate(t))) },
  ];
  const submit = (e: FormEvent) => { e.preventDefault(); setQ(input.trim()); };

  return (
    <>
      <div className="rank-toolbar">
        <h2 className="rank-toolbar__title">태그 순위{q ? <span className="rank-toolbar__count">조건에 맞는 <b>{formatInt(rows.length)}</b>개</span> : null}</h2>
        <form className="toolbar-searchform" role="search" onSubmit={submit}>
          <input className="toolbar-search" type="search" placeholder="태그 검색" aria-label="태그 검색" value={input}
            onChange={e => { setInput(e.target.value); if (e.target.value === '' && q) setQ(''); }} />
          <button type="submit" className="toolbar-searchbtn" aria-label="검색"><SearchIcon size={15} aria-hidden="true" /></button>
        </form>
      </div>
      {error ? <p className="empty-line">{error}</p>
        : loading && tags.length === 0 ? <SkeletonRows />
        : (
          <Stale loading={loading}><RankTable ariaLabel="전체 참여작 태그" rows={rows} rowKey={t => t.tag} columns={columns} rowHeight={52}
            sort={sort} onSort={k => setSort(s => nextSortOf(s, k as EntrySortKey, 'count' as EntrySortKey))}
            expandedKey={open} onToggleRow={t => setOpen(o => (o === t.tag ? null : t.tag))}
            renderExpanded={t => (
              <div className="row-expand row-expand--tag">
                <span>참여작 <b>{formatInt(t.count)}편</b> · {pool}위 진입 <b>{formatInt(t.entered)}편</b></span>
                <Link to={worksHref(t.tag)} className="row-expand__go" onClick={e => e.stopPropagation()}>'{t.tag}' 작품 보기</Link>
              </div>
            )}
            collapseAfter={50} expandOnMobile
            renderMobileRow={t => (
              <div className="rank-mrow rank-mrow--plain"><div className="rank-mrow__main"><span className="rank-title">{t.tag}</span>
                <p>참여작 <b>{formatInt(t.count)}편</b> · {pool}위 진입 <b>{formatInt(t.entered)}편</b> · 진입률 <b>{pct(entryRate(t))}</b></p></div></div>
            )}
            emptyText={tags.length === 0 ? '이 날짜의 공모전 데이터가 없습니다.' : '조건에 맞는 태그가 없습니다.'} /></Stale>
        )}
      {!error && tags.length > 0 ? <Footnotes notes={notes} /> : null}
    </>
  );
}
