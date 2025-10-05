import { useState, useEffect } from 'react';
import { getLatestContestNovelDetails, getContestNovelTrend, getContestAvailableDates } from '../services/api';
import { format, subDays, parseISO, startOfDay } from 'date-fns';

interface ContestTrendData {
  Date: string;
  Rank: number | null;
  Title: string;
  View: number | null;
  Like: number | null;
  Fav: number | null;
}

interface MappedTrendData {
  Date: string;
  Ranking: number | null; // 'Rank' -> 'Ranking'
  Title: string;
  View: number | null;
  Like: number | null;
  Fav: number | null;
  Score: number | null;
}

interface ContestNovelDetails {
  ID: string;
  Title: string;
  AuthorName: string;
  AuthorID: string;
  Synopsis: string;
  Tags: string[];
  View?: number;
  Like?: number;
  Fav?: number;
  Alr?: number;
  Eps?: number;
  RetentionRate?: number;
  Ranking?: number; // Add Ranking to be consistent
}

export const useContestNovelData = (year: string | undefined, novelId: string | undefined) => {
  const [startDate, setStartDate] = useState<Date | null>(null);
  const [endDate, setEndDate] = useState<Date | null>(null);
  
  const [trendData, setTrendData] = useState<MappedTrendData[]>([]);
  const [details, setDetails] = useState<ContestNovelDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  const [minDate, setMinDate] = useState<Date | null>(null);
  const [maxDate, setMaxDate] = useState<Date | null>(null);
  const [availableDates, setAvailableDates] = useState<Date[]>([]);
  const [novelAvailableDatesSet, setNovelAvailableDatesSet] = useState<Set<string>>(new Set());

  const fetchTrendData = async (start: Date, end: Date) => {
    if (!year || !novelId) return;
    setLoading(true);
    setError(null);
    try {
      const yearNum = parseInt(year, 10);
      const response = await getContestNovelTrend(yearNum, novelId, format(start, 'yyyy-MM-dd'), format(end, 'yyyy-MM-dd'));
      // API 응답 데이터를 SmallMultiplesChart가 요구하는 형태로 매핑합니다.
      const mappedData = response.data.map((d: ContestTrendData) => ({
        ...d,
        Ranking: d.Rank, // Rank를 Ranking으로 매핑
        Score: null,     // Score 속성 추가
      }));
      setTrendData(mappedData);
      
      const novelDates = new Set<string>(response.data.filter((d: any) => d.View !== null).map((d: any) => d.Date));
      setNovelAvailableDatesSet(novelDates);
    } catch {
      setError('트렌드 데이터를 불러오는 데 실패했습니다.');
      setTrendData([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!year || !novelId) return;

    const yearNum = parseInt(year, 10);
    setLoading(true);
    Promise.all([
        getContestAvailableDates(yearNum),
        getLatestContestNovelDetails(yearNum, novelId)
    ]).then(([datesRes, detailsRes]) => {
        const allDates = (datesRes.data.available_dates || []).map((d: string) => parseISO(d));
        setAvailableDates(allDates);

        // details 객체의 Rank를 Ranking으로 매핑하여 데이터 구조의 일관성을 유지합니다.
        const detailsData = detailsRes.data;
        if (detailsData) {
            detailsData.Ranking = detailsData.Rank;
        }
        setDetails(detailsData);

        if (allDates.length > 0) {
            const lastDate = allDates[0];
            const firstAvailableDate = allDates[allDates.length - 1];
            setMinDate(firstAvailableDate);
            setMaxDate(lastDate);

            const sevenDaysAgo = subDays(lastDate, 6);
            const initialStartDate = startOfDay(sevenDaysAgo < firstAvailableDate ? firstAvailableDate : sevenDaysAgo);
            const initialEndDate = startOfDay(lastDate);
            setStartDate(initialStartDate);
            setEndDate(initialEndDate);
            fetchTrendData(initialStartDate, initialEndDate);
        } else {
            setLoading(false);
        }
    }).catch((err) => {
        setError(err.response?.data?.detail || '해당 소설을 찾을 수 없습니다.');
        setLoading(false);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year, novelId]);

  return { startDate, endDate, setStartDate, setEndDate, trendData, details, loading, error, minDate, maxDate, availableDates, novelAvailableDatesSet, fetchTrendData };
};