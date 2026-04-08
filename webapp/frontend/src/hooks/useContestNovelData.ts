import { useState, useEffect } from 'react';
import { getLatestContestNovelDetails, getContestNovelTrend, getContestAvailableDates, getContestNovelAvailableDates } from '../services/api';
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
  Ranking?: number;
  award?: string | null;
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
        getContestAvailableDates(yearNum), // 전체 공모전 기간 날짜를 가져옵니다.
        getLatestContestNovelDetails(yearNum, novelId),
        getContestNovelAvailableDates(yearNum, novelId) // 소설의 데이터 보유 날짜 전체를 가져옵니다.
    ]).then(([contestDatesRes, detailsRes, novelDatesRes]) => {
        const contestDates = (contestDatesRes.data.available_dates || []).sort((a: string, b: string) => a.localeCompare(b));
        setAvailableDates(contestDates.map((d: string) => parseISO(d)));

        const novelDates = new Set<string>(novelDatesRes.data.available_dates || []);
        setNovelAvailableDatesSet(novelDates);

        const detailsData = detailsRes.data;
        if (detailsData) {
            detailsData.Ranking = detailsData.Rank;
        }
        setDetails(detailsData);

        if (contestDates.length > 0) {
            const contestFirstDate = parseISO(contestDates[0]);
            const contestLastDate = parseISO(contestDates[contestDates.length - 1]);
            setMinDate(contestFirstDate);
            setMaxDate(contestLastDate);

            // 초기 날짜 범위는 소설의 마지막 데이터 날짜를 기준으로 설정합니다.
            // `detailsData.Date`가 가장 최근 날짜를 담고 있습니다.
            const novelLastDateStr = detailsData?.Date;
            if (!novelLastDateStr) {
                setError('소설의 최근 데이터 날짜를 찾을 수 없습니다.');
                setLoading(false);
                return;
            }
            const novelLastDate = parseISO(novelLastDateStr);
            const sevenDaysAgo = subDays(novelLastDate, 6);
            const initialStartDate = startOfDay(sevenDaysAgo < contestFirstDate ? contestFirstDate : sevenDaysAgo);
            const initialEndDate = startOfDay(novelLastDate);

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