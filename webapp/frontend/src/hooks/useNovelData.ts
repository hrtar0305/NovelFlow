import { useState, useEffect, useRef } from 'react';
import { getNovelTrend, getNovelAvailableDates, getAvailableDates, getLatestNovelDetails } from '../services/api';
import { format, parseISO, subDays, startOfDay } from 'date-fns';
import type { NovelHeaderDetails } from '../components/novel/NovelHeader';
import type { MetricRow } from '../utils/metricSeries';

export const useNovelData = (novelId: string | undefined) => {
  const [startDate, setStartDate] = useState<Date | null>(null);
  const [endDate, setEndDate] = useState<Date | null>(null);
  
  const [novelData, setNovelData] = useState<MetricRow[]>([]);
  /** novelData 중 화면 기간의 첫날. 그 앞 하루는 첫날을 전날과 견주기 위한 기준값이다. */
  const [dataStart, setDataStart] = useState<string | null>(null);
  const [details, setDetails] = useState<(NovelHeaderDetails & { Date?: string; Ranking?: number }) | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [minDate, setMinDate] = useState<Date | null>(null);
  const [maxDate, setMaxDate] = useState<Date | null>(null);
  const [availableDates, setAvailableDates] = useState<Date[]>([]);
  const [novelAvailableDatesSet, setNovelAvailableDatesSet] = useState<Set<string>>(new Set());
  // 요청 번호. 기간·작품을 빠르게 바꾸면 늦게 온 이전 응답(캐시 안 된 90일 등)이 지금 선택을 덮어쓰므로,
  // 마지막에 시작한 요청의 응답만 반영한다. 작품이 바뀔 때도 올려 이전 작품의 진행 중 요청을 버린다.
  const reqSeq = useRef(0);

  const fetchNovelData = async (start: Date, end: Date, datesToUse?: Date[]) => {
    if (!novelId) return;
    const seq = ++reqSeq.current;
    const stale = () => seq !== reqSeq.current;
    setLoading(true);
    setError(null);

    const finalAvailableDates = datesToUse || availableDates;

    try {
      // 하루 앞(달력 기준 전날)부터 받는다 — 기간 첫날의 증가량·연재 여부·변동을 전날과 견줘 채우기 위해서다.
      const lo = format(subDays(startOfDay(start), 1), 'yyyy-MM-dd');
      const hi = format(end, 'yyyy-MM-dd');
      const response = await getNovelTrend(novelId, lo, hi);
      if (stale()) return;
      const byDate = new Map<string, MetricRow>(response.data.map((d: MetricRow) => [d.Date, d]));
      // 수집한 날만 넣는다. 그날 기록이 없으면(순위권 밖) 값 없이 둔다 — 가짜 순위(501·301)로 채우지 않는다.
      const fullDateRangeData = [...new Set(finalAvailableDates.map(d => format(d, 'yyyy-MM-dd')))]
        .filter(d => d >= lo && d <= hi)
        .map(d => byDate.get(d) ?? { Date: d, Ranking: null, Title: details?.Title || '', View: null, Like: null, Fav: null, Score: null });

      setNovelData(fullDateRangeData);
      setDataStart(format(startOfDay(start), 'yyyy-MM-dd'));
    } catch {
      if (stale()) return;
      setError('해당 소설을 찾을 수 없습니다.');
      setNovelData([]);
    } finally {
      if (!stale()) setLoading(false);
    }
  };

  useEffect(() => {
    if (!novelId) return;

    let cancelled = false;
    reqSeq.current++;
    setLoading(true);
    setError(null);
    Promise.all([
        getAvailableDates(), 
        getNovelAvailableDates(novelId),
        getLatestNovelDetails(novelId)
    ]).then(([allDatesResponse, novelDatesResponse, detailsResponse]) => {
        if (cancelled) return;
        const allFetchedDates: string[] = allDatesResponse.data.available_dates || [];
        const allDateObjects = allFetchedDates.map(d => parseISO(d)).sort((a, b) => a.getTime() - b.getTime());
        
        if (allDateObjects.length > 0) {
            const globalOldestDate = allDateObjects[0];
            const globalMostRecentDate = allDateObjects[allDateObjects.length - 1];
            setMinDate(globalOldestDate);
            setMaxDate(globalMostRecentDate);
            setAvailableDates(allDateObjects);
        }

        const novelFetchedDates: string[] = novelDatesResponse.data.available_dates || [];
        setNovelAvailableDatesSet(new Set(novelFetchedDates));
        const novelDateObjects = novelFetchedDates.map(d => parseISO(d)).sort((a, b) => a.getTime() - b.getTime());

        setDetails(detailsResponse.data);

        if (novelDateObjects.length > 0) {
            const novelOldestDate = novelDateObjects[0];
            const novelMostRecentDate = novelDateObjects[novelDateObjects.length - 1];

            const sevenDaysAgo = subDays(novelMostRecentDate, 6);
            const initialStartDate = startOfDay(sevenDaysAgo.getTime() < novelOldestDate.getTime() ? novelOldestDate : sevenDaysAgo);
            const initialEndDate = startOfDay(novelMostRecentDate);

            setStartDate(initialStartDate);
            setEndDate(initialEndDate);
            
            fetchNovelData(initialStartDate, initialEndDate, allDateObjects);
        } else {
            setError('해당 소설을 찾을 수 없습니다.');
            setLoading(false);
        }

    }).catch(() => {
        if (cancelled) return;
        setError('해당 소설을 찾을 수 없습니다.');
        setLoading(false);
    });
    return () => { cancelled = true; };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [novelId]);

  return {
    startDate,
    endDate,
    setStartDate,
    setEndDate,
    novelData,
    dataStart,
    details,
    loading,
    error,
    minDate,
    maxDate,
    novelAvailableDatesSet,
    fetchNovelData,
  };
};
