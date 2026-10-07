import React, { forwardRef, useMemo, useState } from 'react';
import DatePicker, { registerLocale } from 'react-datepicker';
import 'react-datepicker/dist/react-datepicker.css';
import { format, startOfDay } from 'date-fns';
import { ko } from 'date-fns/locale';

registerLocale('ko', ko);

interface DateRangePickerProps {
  startDate: Date | null;
  endDate: Date | null;
  minDate?: Date | null;
  maxDate?: Date | null;
  availableDates: Date[];
  onStartDateChange: (date: Date | null) => void;
  onEndDateChange: (date: Date | null) => void;
}

// 상자형 입력칸 대신 점선 밑줄 글자(일간 랭킹의 날짜 이동과 같은 문법). 키보드로도 연다.
const CustomDateDisplay = forwardRef<HTMLSpanElement, { value?: string; onClick?: () => void; label: string }>(({ value, onClick, label }, ref) => (
  <span className="range-inline__date" onClick={onClick} ref={ref} role="button" tabIndex={0} aria-label={`${label} ${value || '선택'}`}
    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick?.(); } }}>
    {value || <span className="range-inline__empty">{label}</span>}
  </span>
));

const DateRangePicker: React.FC<DateRangePickerProps> = ({
  startDate,
  endDate,
  minDate,
  maxDate,
  availableDates,
  onStartDateChange,
  onEndDateChange,
}) => {
  const [isEndCalendarOpen, setIsEndCalendarOpen] = useState(false);

  const availableDateSet = useMemo(() => new Set(availableDates.map(d => format(d, 'yyyy-MM-dd'))), [availableDates]);
  const filterDate = (date: Date) => availableDateSet.has(format(date, 'yyyy-MM-dd'));

  const handleStartDateChange = (date: Date | null) => {
    if (!date) return;
    const normalizedDate = startOfDay(date);
    onStartDateChange(normalizedDate);
    onEndDateChange(null);
    setIsEndCalendarOpen(true);
  };

  const handleEndDateChange = (date: Date | null) => {
    if (!date) return;
    const normalizedDate = startOfDay(date);

    if (startDate && normalizedDate < startDate) {
        onStartDateChange(normalizedDate);
        onEndDateChange(null);
        setIsEndCalendarOpen(true);
    } else {
        onEndDateChange(normalizedDate);
        setIsEndCalendarOpen(false);
    }
  };

  const getRangeDayClassName = (date: Date) => {
    const dayTime = startOfDay(date).getTime();
    const startTime = startDate ? startOfDay(startDate).getTime() : null;
    const endTime = endDate ? startOfDay(endDate).getTime() : null;

    if (startTime !== null && dayTime === startTime) {
      return 'np-date-range-start';
    }
    if (endTime !== null && dayTime === endTime) {
      return 'np-date-range-end';
    }
    if (startTime !== null && endTime !== null && dayTime > startTime && dayTime < endTime) {
      return 'np-date-in-range';
    }
    return '';
  };

  return (
    <div className="range-inline">
          <DatePicker
            selected={startDate}
            onChange={handleStartDateChange}
            startDate={startDate || undefined}
            endDate={endDate || undefined}
            minDate={minDate || undefined}
            maxDate={maxDate || undefined}
            filterDate={filterDate}
            dayClassName={getRangeDayClassName}
            customInput={<CustomDateDisplay label="시작일" />}
            dateFormat="yyyy.MM.dd"
            dateFormatCalendar="yyyy년 M월"
            placeholderText="시작일"
            locale={ko}
            wrapperClassName="flex-grow-0"
            calendarClassName="mobile-calendar-small"
            popperPlacement="bottom-start"
            portalId="datepicker-portal"
          />
          <span className="range-inline__sep" aria-hidden="true">–</span>
          <DatePicker
            key={`end-${startDate ? startDate.getTime() : 'none'}-${endDate ? endDate.getTime() : 'none'}`}
            selected={endDate}
            onChange={handleEndDateChange}
            startDate={startDate || undefined}
            endDate={endDate || undefined}
            minDate={minDate || undefined}
            maxDate={maxDate || undefined}
            filterDate={filterDate}
            dayClassName={getRangeDayClassName}
            openToDate={startDate || undefined}
            customInput={<CustomDateDisplay label="종료일" />}
            dateFormat="yyyy.MM.dd"
            dateFormatCalendar="yyyy년 M월"
            placeholderText="종료일"
            open={isEndCalendarOpen}
            onInputClick={() => setIsEndCalendarOpen(true)}
            onClickOutside={() => setIsEndCalendarOpen(false)}
            locale={ko}
            calendarClassName="mobile-calendar-small"
            wrapperClassName="flex-grow-0"
            popperPlacement="bottom-end"
            portalId="datepicker-portal"
          />
    </div>
  );
};

export default DateRangePicker;
