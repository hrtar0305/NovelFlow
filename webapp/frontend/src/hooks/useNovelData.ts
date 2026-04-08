import { useState, useEffect } from 'react';
import { getNovelTrend, getNovelAvailableDates, getAvailableDates, getLatestNovelDetails } from '../services/api';
import { format, parseISO, subDays, startOfDay, addDays } from 'date-fns';


interface NovelData {
  Date: string;
  Ranking: number | null;
  Title: string;
  View: number | null;
  Like: number | null;
  Fav: number | null;
  Score: number | null;
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
      const TOP_300_END_DATE_STR = '2025-07-20';

      while (currentDate <= endDateFormatted) {
        const formattedDate = format(currentDate, 'yyyy-MM-dd');
        
        // Only process dates that are available globally
        if (availableDateSet.has(formattedDate)) {
          let existingData = fetchedDataMap.get(formattedDate);

          if (existingData) {
            // Data for this date exists, check if Ranking is null (which means rank out)
            if (existingData.Ranking === null) {
              const rankOutValue = formattedDate <= TOP_300_END_DATE_STR ? 301 : 501;
              // Clone and modify the object to set the rank out value
              existingData = { ...existingData, Ranking: rankOutValue };
            }
            fullDateRangeData.push(existingData);
          } else {
            // No data for this date at all, create a full placeholder for rank out
            const rankOutValue = formattedDate <= TOP_300_END_DATE_STR ? 301 : 501;
            fullDateRangeData.push({
              Date: formattedDate,
              Ranking: rankOutValue,
              Title: details?.Title || '',
              View: null, Like: null, Fav: null, Score: null,
            });
          }
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
