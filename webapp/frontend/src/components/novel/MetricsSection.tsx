import { useMemo, useState } from 'react';
import { parseISO, subDays } from 'date-fns';
import DateRangePicker from './DateRangePicker';
import MetricsPanel from './MetricsPanel';
import type { MetricPoint } from '../../utils/metricSeries';
import type { UploadsState } from '../../utils/uploads';

/** 작품 상세의 '지표' 구역 — 기간 바로가기(7·30·90일) · 기간 선택 · 지표 패널. 일간·공모전 상세가 같이 쓴다.
 *  기간 상태는 상세 훅(useNovelData · useContestNovelData)의 것을 그대로 받는다. */
export default function MetricsSection({
  kind, points, uploads, loading, startDate, endDate, setStartDate, setEndDate, minDate, maxDate, novelAvailableDatesSet, fetchRange,
}: {
  kind: 'daily' | 'contest'; points: MetricPoint[]; uploads?: UploadsState; loading: boolean;
  startDate: Date | null; endDate: Date | null; setStartDate: (d: Date | null) => void; setEndDate: (d: Date | null) => void;
  minDate: Date | null; maxDate: Date | null; novelAvailableDatesSet: Set<string>; fetchRange: (start: Date, end: Date) => void;
}) {
  // 기간 바로가기. 끝은 작품의 마지막 기록일이다(maxDate는 전체 최신 수집일이라, 오늘 순위권 밖인
  // 작품은 빈 차트가 된다). 훅의 초기 기간이 이미 '마지막 기록일로 끝나는 7일'이라 초기값 7과 맞는다.
  const novelLastDate = useMemo(() => {
    const last = [...novelAvailableDatesSet].sort().at(-1);
    return last ? parseISO(last) : null;
  }, [novelAvailableDatesSet]);
  const [rangeDays, setRangeDays] = useState<number | null>(7);
  const pickRange = (n: number) => {
    if (!novelLastDate) return;
    const start = subDays(novelLastDate, n - 1);
    setRangeDays(n);
    setStartDate(start);
    setEndDate(novelLastDate);
    fetchRange(start, novelLastDate);
  };
  const handleStartDateChange = (date: Date | null) => { setRangeDays(null); setStartDate(date); setEndDate(null); };
  const handleEndDateChange = (date: Date | null) => {
    setRangeDays(null);
    setEndDate(date);
    if (startDate && date) fetchRange(startDate, date);
  };

  return (
    <section className="detail-sec detail-chart-panel">
      <div className="detail-sec__head">
        <h2 className="detail-sec__h">지표</h2>
        <div className="detail-sec__range">
          {[7, 30, 90].map(n => (
            <button key={n} type="button" className={rangeDays === n ? 'is-on' : ''} aria-pressed={rangeDays === n} onClick={() => pickRange(n)}>{n}일</button>
          ))}
          <DateRangePicker
            startDate={startDate} endDate={endDate} minDate={minDate} maxDate={maxDate}
            availableDates={Array.from(novelAvailableDatesSet).map(d => parseISO(d))}
            onStartDateChange={handleStartDateChange} onEndDateChange={handleEndDateChange}
          />
        </div>
      </div>
      <div className="detail-chart-area" aria-busy={loading} style={{ opacity: loading ? 0.5 : 1, transition: 'opacity 0.2s' }}>
        {points.length > 0 ? <MetricsPanel points={points} kind={kind} uploads={uploads} />
          : (!loading && <p className="empty-line">선택한 기간에 기록이 없습니다.</p>)}
      </div>
    </section>
  );
}
