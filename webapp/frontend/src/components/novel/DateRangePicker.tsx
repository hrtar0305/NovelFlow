import React, { useRef, forwardRef, useMemo } from 'react';
import { Form, InputGroup } from 'react-bootstrap';
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
  novelAvailableDatesSet: Set<string>;
  onStartDateChange: (date: Date | null) => void;
  onEndDateChange: (date: Date | null) => void;
  isNovelDetailPage?: boolean;
  noMargin?: boolean;
  showNovelDataIndicator?: boolean; // New prop
}

const CustomDateDisplay = forwardRef<HTMLDivElement, { value?: string; onClick?: () => void; className?: string }>(({ value, onClick, className }, ref) => (
  <div
    className={`form-control ${className || ''} rounded-0 w-100`}
    onClick={onClick}
    ref={ref}
    style={{ cursor: 'pointer', backgroundColor: 'var(--np-surface-alt)' }}
  >
    {value || <span className="text-muted">날짜 선택</span>}
  </div>
));

const DateRangePicker: React.FC<DateRangePickerProps> = ({
  startDate,
  endDate,
  minDate,
  maxDate,
  availableDates,
  novelAvailableDatesSet,
  onStartDateChange,
  onEndDateChange,
  isNovelDetailPage,
  noMargin,
  showNovelDataIndicator = true // Default to true for backward compatibility
}) => {
  const endDatePickerRef = useRef<DatePicker | null>(null);

  const availableDateSet = useMemo(() => new Set(availableDates.map(d => format(d, 'yyyy-MM-dd'))), [availableDates]);
  const filterDate = (date: Date) => availableDateSet.has(format(date, 'yyyy-MM-dd'));

  const handleStartDateChange = (date: Date | null) => {
    if (!date) return;
    const normalizedDate = startOfDay(date);
    onStartDateChange(normalizedDate);
    endDatePickerRef.current?.setOpen(true);
  };

  const handleEndDateChange = (date: Date | null) => {
    if (!date) return;
    const normalizedDate = startOfDay(date);

    if (startDate && normalizedDate < startDate) {
        onStartDateChange(normalizedDate);
        onEndDateChange(null);
        endDatePickerRef.current?.setOpen(true);
    } else {
        onEndDateChange(normalizedDate);
        endDatePickerRef.current?.setOpen(false);
    }
  };

  const renderDayContents = (day: number, date?: Date) => {
    if (!date) return day;
    const dateString = format(date, 'yyyy-MM-dd');
    const hasData = novelAvailableDatesSet.has(dateString);

    return (
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        paddingBottom: showNovelDataIndicator ? '4px' : '0'
      }}>
        {day}
        {showNovelDataIndicator && (
          <div style={{
            height: '4px',
            width: '4px',
            borderRadius: '50%',
            backgroundColor: hasData ? '#8884d8' : 'transparent',
            margin: '-2px auto 0 auto'
          }}></div>
        )}
      </div>
    );
  };

  return (
    <Form className={`d-flex flex-wrap align-items-end gap-0 ${noMargin ? '' : 'mb-2'}`}>
      <Form.Group className="flex-grow-1" style={{ minWidth: '80px' }}>
        <InputGroup>
          <InputGroup.Text>From</InputGroup.Text>
          <DatePicker
            selected={startDate}
            onChange={handleStartDateChange}
            startDate={startDate || undefined}
            endDate={endDate || undefined}
            minDate={minDate || undefined}
            maxDate={maxDate || undefined}
            filterDate={filterDate}
            renderDayContents={renderDayContents}
            customInput={<CustomDateDisplay />}
            dateFormat="yyyy-MM-dd"
            placeholderText="Start Date"
            highlightDates={startDate && !endDate ? [startDate] : []}
            className="rounded-end-0"
            locale={ko}
            wrapperClassName="flex-grow-0"
            calendarClassName="mobile-calendar-small"
            popperPlacement="bottom-start"
            portalId="datepicker-portal"
          />
          <InputGroup.Text>To</InputGroup.Text>
          <DatePicker
            ref={endDatePickerRef}
            selected={endDate}
            onChange={handleEndDateChange}
            startDate={startDate || undefined}
            endDate={endDate || undefined}
            minDate={minDate || undefined}
            maxDate={maxDate || undefined}
            filterDate={filterDate}
            renderDayContents={renderDayContents}
            openToDate={startDate || undefined}
            customInput={<CustomDateDisplay />}
            dateFormat="yyyy-MM-dd"
            placeholderText="End Date"
            onInputClick={() => endDatePickerRef.current?.setOpen(true)}
            onClickOutside={() => endDatePickerRef.current?.setOpen(false)}
            highlightDates={startDate && !endDate ? [startDate] : []}
            locale={ko}
            className="rounded-start-0"
            calendarClassName="mobile-calendar-small"
            wrapperClassName="flex-grow-0"
            popperPlacement="bottom-end"
            portalId="datepicker-portal"
          />
        </InputGroup>
      </Form.Group>
      {isNovelDetailPage && (
        <div className="w-100 mt-1 datepicker-help-text-container">
            <p className="text-muted mb-0">데이터가 수집되지 않은 날짜는 비활성화됩니다.</p>
        </div>
      )}
    </Form>
  );
};

export default DateRangePicker;
