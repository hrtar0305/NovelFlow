import { useMemo } from 'react';
import { format, parseISO } from 'date-fns';
import CalendarPicker from '../CalendarPicker';

interface DateNavProps { value: string | null; availableDates: Set<string>; onChange: (iso: string) => void; }

/** ‹ 2026.09.27 › — 화살표는 인접한 수집일로, 날짜를 누르면 달력(수집된 날만). */
export default function DateNav({ value, availableDates, onChange }: DateNavProps) {
  const sorted = useMemo(() => [...availableDates].sort(), [availableDates]);
  const i = value ? sorted.indexOf(value) : -1;
  const prev = i > 0 ? sorted[i - 1] : null;
  const next = i >= 0 && i < sorted.length - 1 ? sorted[i + 1] : null;
  return (
    <div className="date-nav">
      <button type="button" className="date-nav__step" disabled={!prev} onClick={() => prev && onChange(prev)} aria-label="이전 수집일">‹</button>
      <CalendarPicker variant="inline" selectedDate={value ? parseISO(value) : null} availableDates={availableDates}
        onDateChange={(d) => { if (d) onChange(format(d, 'yyyy-MM-dd')); }} />
      <button type="button" className="date-nav__step" disabled={!next} onClick={() => next && onChange(next)} aria-label="다음 수집일">›</button>
    </div>
  );
}
