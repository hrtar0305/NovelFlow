import { useState, useEffect } from 'react';
import { getNovelTrend, getNovelAvailableDates, getAvailableDates, getLatestNovelDetails } from '../services/api';
import { format, parseISO, subDays, startOfDay, addDays } from 'date-fns';


interface NovelData {
  ID?: string;
  Date: string;
  Ranking: number | null;
  Title: string;
  View: number | null;
  Like: number | null;
  Fav: number | null;
  Score: number | null;
  Eps?: number | null;
  Alr?: number | null;
}

interface NovelDetails {
  ID: string;
  Title: string;
  AuthorName: string;
  AuthorID: string;
  Synopsis: string;
  Tags: string[];
  View: number;
  Like: number;
  Fav: number;
  Alr: number;
  Eps: number;
  RetentionRate?: number;
  Date?: string;
  Ranking?: number;
  ThumbnailURL?: string | null;
  EarlyRetentionRate?: number | null;
  RecentRetentionRate?: number | null;
}

export const useNovelData = (novelId: string | undefined) => {
  const [startDate, setStartDate] = useState<Date | null>(null);
  const [endDate, setEndDate] = useState<Date | null>(null);
  
  const [novelData, setNovelData] = useState<NovelData[]>([]);
  const [details, setDetails] = useState<NovelDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [minDate, setMinDate] = useState<Date | null>(null);
  const [maxDate, setMaxDate] = useState<Date | null>(null);
  const [availableDates, setAvailableDates] = useState<Date[]>([]);
  const [novelAvailableDatesSet, setNovelAvailableDatesSet] = useState<Set<string>>(new Set());

  const fetchNovelData = async (start: Date, end: Date, datesToUse?: Date[]) => {
    if (!novelId) return;
    setLoading(true);
    setError(null);

    const finalAvailableDates = datesToUse || availableDates;

    try {
      const response = await getNovelTrend(novelId, format(start, 'yyyy-MM-dd'), format(end, 'yyyy-MM-dd'));
      const fetchedData = response.data.sort((a: NovelData, b: NovelData) => a.Date.localeCompare(b.Date));

      // Create a map for quick lookup of fetched data by date
      const fetchedDataMap = new Map<string, NovelData>();
      fetchedData.forEach((d: NovelData) => fetchedDataMap.set(d.Date, d));

      const availableDateSet = new Set(finalAvailableDates.map(d => format(d, 'yyyy-MM-dd')));
      const fullDateRangeData: NovelData[] = [];
      let currentDate = startOfDay(start);
      const endDateFormatted = startOfDay(end);

      while (currentDate <= endDateFormatted) {
        const formattedDate = format(currentDate, 'yyyy-MM-dd');
        
        // Only process dates that are available globally
        // 수집한 날만 넣는다. 그날 기록이 없으면(순위권 밖) 값 없이 둔다 — 가짜 순위(501·301)로 채우지 않는다.
        if (availableDateSet.has(formattedDate)) {
          fullDateRangeData.push(fetchedDataMap.get(formattedDate) ?? {
            Date: formattedDate, Ranking: null, Title: details?.Title || '',
            View: null, Like: null, Fav: null, Score: null,
          });
        }
        currentDate = addDays(currentDate, 1);
      }

      setNovelData(fullDateRangeData);
    } catch {
      setError('해당 소설을 찾을 수 없습니다.');
      setNovelData([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!novelId) return;

    setLoading(true);
    setError(null);
    Promise.all([
        getAvailableDates(), 
        getNovelAvailableDates(novelId),
        getLatestNovelDetails(novelId)
    ]).then(([allDatesResponse, novelDatesResponse, detailsResponse]) => {
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
        setError('해당 소설을 찾을 수 없습니다.');
        setLoading(false);
    });

  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [novelId]);

  return {
    startDate,
    endDate,
    setStartDate,
    setEndDate,
    novelData,
    details,
    loading,
    error,
    minDate,
    maxDate,
    availableDates,
    novelAvailableDatesSet,
    fetchNovelData,
  };
};
