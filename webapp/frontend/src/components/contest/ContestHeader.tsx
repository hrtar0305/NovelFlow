import { Link } from 'react-router-dom';
import PageTitle from '../ui/PageTitle';
import DateNav from '../ui/DateNav';
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
      title={
        <span className="contest-title">
          우주최강 공모전
          <label className="visually-hidden" htmlFor="contest-year">공모전 연도</label>
          <select id="contest-year" className="contest-title__year" value={year} onChange={e => onYearChange(e.target.value)}>
            {CONTEST_YEARS.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
          <ChevronDown className="contest-title__chev" size={14} aria-hidden="true" />
        </span>
      }
      nav={<DateNav value={date} availableDates={availableDates} onChange={onDateChange} />}
      aside={
        <nav className="contest-switch" aria-label="공모전 보기">
          <Link to={`/contests/${year}${suffix}`} className={view === 'novels' ? 'is-on' : undefined} aria-current={view === 'novels' ? 'page' : undefined}>작품</Link>
          <Link to={`/contests/${year}/tags/rankings${suffix}`} className={view === 'tags' ? 'is-on' : undefined} aria-current={view === 'tags' ? 'page' : undefined}>태그</Link>
        </nav>
      }
      meta={meta}
    />
  );
}
