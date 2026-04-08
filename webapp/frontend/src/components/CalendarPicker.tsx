import React, { useState, useCallback, forwardRef, useEffect, useMemo } from 'react';
import DatePicker, { registerLocale } from 'react-datepicker';
import { format } from 'date-fns';
import { ko } from 'date-fns/locale';
import { CalendarEvent } from 'react-bootstrap-icons';
import 'react-datepicker/dist/react-datepicker.css';

registerLocale('ko', ko);

interface CalendarPickerProps {
  selectedDate: Date | null;
  onDateChange: (date: Date | null) => void;
  availableDates: Set<string>;
  highlightDates?: Date[];
}

// Custom input component to replace the default <input> with a <div>
// This resolves the blinking cursor issue.
const CustomDateDisplay = forwardRef<HTMLDivElement, { value?: string; onClick?: () => void }>(({ value, onClick }, ref) => (
  <div 
    className="form-control"
    onClick={onClick} 
    ref={ref}
    style={{ cursor: 'pointer' }}
  >
    {value || <span className="text-muted">날짜 선택</span>}
  </div>
));

const CalendarPicker: React.FC<CalendarPickerProps> = ({ selectedDate, onDateChange, availableDates, highlightDates }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [popperPlacement, setPopperPlacement] = useState<'bottom-start' | 'bottom'>('bottom-start');

  const maxDate = useMemo(() => {
    if (availableDates.size === 0) return undefined;
    const dates = Array.from(availableDates).sort();
    return new Date(dates[dates.length - 1]);
  }, [availableDates]);

  useEffect(() => {
    const updatePlacement = () => {
      if (window.innerWidth < 768) {
        setPopperPlacement('bottom-start');
      } else {
        setPopperPlacement('bottom');
      }
    };
    updatePlacement();
    window.addEventListener('resize', updatePlacement);
    return () => window.removeEventListener('resize', updatePlacement);
  }, []);

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
      <CalendarEvent className="date-picker-icon" />
      <DatePicker
        key={availableDates.size}
        selected={selectedDate}
        onChange={handleChange}
        filterDate={filterDate}
        maxDate={maxDate}
        open={isOpen}
        onInputClick={() => setIsOpen(true)}
        onClickOutside={() => setIsOpen(false)}
        dateFormat="yyyy-MM-dd"
        customInput={<CustomDateDisplay />}
        locale={ko}
        highlightDates={highlightDates}
        calendarClassName="mobile-calendar-small"
        popperPlacement={popperPlacement}
      />
    </div>
  );
};

export default CalendarPicker;
