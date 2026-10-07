import React, { useState, useCallback, forwardRef, useMemo } from 'react';
import DatePicker, { registerLocale } from 'react-datepicker';
import type { DatePickerProps } from 'react-datepicker';
import { offset, shift } from '@floating-ui/react';
import { format, parseISO } from 'date-fns';
import { ko } from 'date-fns/locale';
import 'react-datepicker/dist/react-datepicker.css';

registerLocale('ko', ko);

interface CalendarPickerProps {
  selectedDate: Date | null;
  onDateChange: (date: Date | null) => void;
  availableDates: Set<string>;
}

// Custom input component to replace the default <input> with a <div>
// This resolves the blinking cursor issue.
const CustomDateDisplay = forwardRef<HTMLDivElement, { value?: string; onClick?: () => void }>(({ value, onClick }, ref) => (
  <div
    className="date-nav__date"
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

/** 제목 옆 날짜(점선 밑줄 글자)로 보인다. */
const CalendarPicker: React.FC<CalendarPickerProps> = ({ selectedDate, onDateChange, availableDates }) => {
  const [isOpen, setIsOpen] = useState(false);
  const fixedBottomPopperProps = useMemo(() => ({
    // react-datepicker adds flip() by default. Override middleware so the
    // calendar keeps its top edge anchored and always expands downward.
    // shift: 모바일(390)에서 달력이 오른쪽 화면 밖으로 잘렸다 — 옆으로만 밀어 넣는다(아래로 여는 것은 그대로).
    middleware: [offset(10), shift({ padding: 16 })],
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

  return (
    <div className="date-picker-wrapper" onClick={(e) => { if (e.target === e.currentTarget) handleToggle(); }}>
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
        dateFormat="yyyy.MM.dd"
        dateFormatCalendar="yyyy년 M월"
        customInput={<CustomDateDisplay />}
        locale={ko}
        calendarClassName="mobile-calendar-small"
        popperPlacement="bottom-start"
        popperProps={fixedBottomPopperProps}
        showPopperArrow={false}
      />
    </div>
  );
};

export default CalendarPicker;
