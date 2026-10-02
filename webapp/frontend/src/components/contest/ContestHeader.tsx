import { useEffect, useRef, useState } from 'react';
import PageTitle from '../ui/PageTitle';
import DateNav from '../ui/DateNav';
import ViewSwitch from '../ui/ViewSwitch';
import { ChevronDown } from 'react-bootstrap-icons';
import { CONTEST_YEARS } from '../../utils/contest';

interface ContestHeaderProps {
  year: string;
  date: string | null;
  availableDates: Set<string>;
  onDateChange: (iso: string) => void;
  onYearChange: (year: string) => void;
  view: 'novels' | 'tags';
  meta?: string;
}

/** 공모전 세 화면 공통 머리: '우주최강 공모전 2025 ▾ ‹ 날짜 ›' + 오른쪽 작품 / 태그 전환 + 데이터 한 줄. */
export default function ContestHeader({ year, date, availableDates, onDateChange, onYearChange, view, meta }: ContestHeaderProps) {
  const suffix = date ? `/${date}` : '';
  return (
    <PageTitle
      title={<span className="contest-title">우주최강 공모전 <YearMenu year={year} onChange={onYearChange} /></span>}
      nav={<DateNav value={date} availableDates={availableDates} onChange={onDateChange} />}
      aside={
        <ViewSwitch label="공모전 보기" items={[
          { to: `/contests/${year}${suffix}`, label: '작품', on: view === 'novels' },
          { to: `/contests/${year}/tags/rankings${suffix}`, label: '태그', on: view === 'tags' },
        ]} />
      }
      meta={meta}
    />
  );
}

/**
 * 연도 고르기. 기본 <select> 는 펼친 목록을 OS 가 그려 다크 테마에서도 흰 상자가 뜨고 글자 크기도 제목을 따라 커졌다
 * (사용자 검토 2026-10-03) — 제목과 같은 글자 + 테마 토큰으로 그린 작은 목록으로 바꾼다. 키보드: Enter/Space/↓ 로 열고
 * ↑↓ 로 고르고 Enter 로 정하고 Esc 로 닫는다.
 */
function YearMenu({ year, onChange }: { year: string; onChange: (y: string) => void }) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(Math.max(0, CONTEST_YEARS.indexOf(year)));
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);
  const pick = (y: string) => { setOpen(false); if (y !== year) onChange(y); };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { setOpen(false); return; }
    if (!open && ['Enter', ' ', 'ArrowDown'].includes(e.key)) { e.preventDefault(); setActive(Math.max(0, CONTEST_YEARS.indexOf(year))); setOpen(true); return; }
    if (!open) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(i => Math.min(CONTEST_YEARS.length - 1, i + 1)); }
    if (e.key === 'ArrowUp') { e.preventDefault(); setActive(i => Math.max(0, i - 1)); }
    if (e.key === 'Enter') { e.preventDefault(); pick(CONTEST_YEARS[active]); }
  };
  return (
    <span className="year-menu" ref={ref}>
      <button type="button" className="year-menu__btn" aria-haspopup="listbox" aria-expanded={open} aria-label={`공모전 연도 ${year}`}
        onClick={() => setOpen(o => !o)} onKeyDown={onKey}>
        {year}<ChevronDown className={`year-menu__chev${open ? ' is-open' : ''}`} size={14} aria-hidden="true" />
      </button>
      {open ? (
        <ul className="year-menu__list" role="listbox" aria-label="공모전 연도">
          {CONTEST_YEARS.map((y, i) => (
            <li key={y} role="option" aria-selected={y === year}
              className={`year-menu__opt${y === year ? ' is-current' : ''}${i === active ? ' is-active' : ''}`}
              onMouseEnter={() => setActive(i)} onMouseDown={e => { e.preventDefault(); pick(y); }}>
              {y}
            </li>
          ))}
        </ul>
      ) : null}
    </span>
  );
}
