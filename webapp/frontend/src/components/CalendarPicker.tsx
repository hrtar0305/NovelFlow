import React, { useState, useCallback, forwardRef, useMemo } from 'react';
import DatePicker, { registerLocale } from 'react-datepicker';
import type { DatePickerProps } from 'react-datepicker';
import { offset } from '@floating-ui/react';
import { format, parseISO } from 'date-fns';
import { ko } from 'date-fns/locale';
import { CalendarEvent } from 'react-bootstrap-icons';
import 'react-datepicker/dist/react-datepicker.css';

registerLocale('ko', ko);

interface CalendarPickerProps {
  selectedDate: Date | null;
  onDateChange: (date: Date | null) => void;
  availableDates: Set<string>;
  highlightDates?: Date[];
  /** 'inline'은 제목 옆 날짜(점선 밑줄 글자)로 보인다. */
  variant?: 'field' | 'inline';
}

// Custom input component to replace the default <input> with a <div>
// This resolves the blinking cursor issue.
const CustomDateDisplay = forwardRef<HTMLDivElement, { value?: string; onClick?: () => void; className?: string }>(({ value, onClick, className }, ref) => (
  <div
    className={className ?? 'form-control'}
    onClick={onClick}
    ref={ref}
    role="button"
    tabIndex={0}
    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick?.(); } }}
    style={{ cursor: 'pointer' }}
  >
    {value || <span className="text-muted">날짜 선택</span>}
  </div>
));

const CalendarPicker: React.FC<CalendarPickerProps> = ({ selectedDate, onDateChange, availableDates, highlightDates, variant = 'field' }) => {
  const [isOpen, setIsOpen] = useState(false);
  const fixedBottomPopperProps = useMemo(() => ({
    // react-datepicker adds flip() by default. Override middleware so the
    // calendar keeps its top edge anchored and always expands downward.
    middleware: [offset(10)],
  }) as unknown as DatePickerProps['popperProps'], []);

  const maxDate = useMemo(() => {
    if (availableDates.size === 0) return undefined;
    const dates = Array.from(availableDates).sort();
    // new Date('YYYY-MM-DD')는 UTC 자정이라 UTC보다 늦은 시간대에서 로컬 전날이 된다 — filterDate처럼 로컬 날짜로 읽는다.
    return parseISO(dates[dates.length - 1]);
  }, [availableDates]);

  const filterDate = useCallback((d: Date) => {
    return availableDates.has(format(d, 'yyyy-MM-dd'));
  }, [availableDates]);

  const handleChange = (date: Date | null) => {
    onDateChange(date);
    setIsOpen(false); // Automatically close the calendar after selection
  };

  const handleToggle = () => {
    setIsOpen(prev => !prev);
  };

  const inline = variant === 'inline';

  return (
    <div className={inline ? 'date-picker-wrapper date-picker-wrapper--inline' : 'date-picker-wrapper'} onClick={(e) => { if (e.target === e.currentTarget) handleToggle(); }}>
      {inline ? null : <CalendarEvent className="date-picker-icon" />}
      <DatePicker
        key={availableDates.size}
        selected={selectedDate}
        onChange={handleChange}
        filterDate={filterDate}
        maxDate={maxDate}
        openToDate={selectedDate || maxDate}
        open={isOpen}
        onInputClick={() => setIsOpen(true)}
        onClickOutside={() => setIsOpen(false)}
        dateFormat={inline ? 'yyyy.MM.dd' : 'yyyy-MM-dd'}
        dateFormatCalendar="yyyy년 M월"
        customInput={<CustomDateDisplay className={inline ? 'date-nav__date' : undefined} />}
        locale={ko}
        highlightDates={highlightDates}
        calendarClassName="mobile-calendar-small"
        popperPlacement="bottom-start"
        popperProps={fixedBottomPopperProps}
        showPopperArrow={false}
      />
    </div>
  );
};

export default CalendarPicker;
