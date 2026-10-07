import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Search as SearchIcon } from 'react-bootstrap-icons';
import { formatInt } from '../../utils/format';
import type { RankingFilter } from '../../utils/rankingQuery';

/** 작품 랭킹 표 머리 — '전체 순위'·편수 · 필터 버튼 · 제목·작가 검색. 일간 랭킹과 공모전 랭킹이 같이 쓴다.
 *  count: 걸린 필터 수(공모전은 수상작만·기성/신인을 더해 넘긴다). shown/total: 걸러진 편수/그날 편수. */
export default function RankToolbar({ filter, onChange, count, shown, total, onOpenFilter }: {
  filter: RankingFilter; onChange: (next: RankingFilter) => void;
  count: number; shown: number; total: number; onOpenFilter: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [searchInput, setSearchInput] = useState(filter.search);
  useEffect(() => { setSearchInput(filter.search); }, [filter.search]);
  const applySearch = (q: string) => {
    onChange({ ...filter, search: q });
    // 표 안쪽까지 내려와 있으면 결과가 줄어 화면이 빈 곳으로 튄다 — 표 머리로 올려 준다.
    const el = ref.current;
    if (el && el.getBoundingClientRect().top < 0) window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 72 });
  };
  const submitSearch = (e: FormEvent) => { e.preventDefault(); applySearch(searchInput.trim()); };
  const filtered = count > 0 || filter.search.trim() !== '';
  return (
    <div className="rank-toolbar" ref={ref}>
      <h2 className="rank-toolbar__title">
        전체 순위
        <span className="rank-toolbar__count">
          {filtered ? <>조건에 맞는 <b>{formatInt(shown)}</b>편 / {formatInt(total)}편</> : <>{formatInt(total)}편</>}
        </span>
      </h2>
      <button type="button" className={`toolbar-filter${count ? ' is-on' : ''}`} onClick={onOpenFilter} aria-haspopup="dialog">
        필터{count ? <span className="toolbar-filter__n">{count}</span> : null}
      </button>
      {/* 타이핑마다 거르면 결과 수가 바뀔 때마다 페이지 높이가 요동친다 — 엔터·검색 버튼으로 한 번에 적용한다. */}
      <form className="toolbar-searchform" role="search" onSubmit={submitSearch}>
        <input className="toolbar-search" type="search" placeholder="제목·작가 검색" aria-label="제목·작가 검색"
          value={searchInput} onChange={e => { setSearchInput(e.target.value); if (e.target.value === '' && filter.search) applySearch(''); }} />
        <button type="submit" className="toolbar-searchbtn" aria-label="검색"><SearchIcon size={15} aria-hidden="true" /></button>
      </form>
    </div>
  );
}
