import React, { useState, useEffect, useMemo } from 'react';
import { format, subDays } from 'date-fns';
import CalendarPicker from '../components/CalendarPicker';
import TagTrendAnalysisContent from '../components/trends/TagTrendAnalysisContent';
import { getAvailableDates, getTagRankingsByDate } from '../services/api';
import { Alert, Spinner } from 'react-bootstrap';

// Define the Tag type directly as it's not exported from api.ts
interface Tag {
  TagName: string;
  ViewCount: number;
  Rank: number;
}

const TagTrendsPage: React.FC = () => {
  const [startDate, setStartDate] = useState<Date | null>(null);
  const [endDate, setEndDate] = useState<Date | null>(null);
  const [availableDates, setAvailableDates] = useState<Set<string>>(new Set());
  
  const [startData, setStartData] = useState<Tag[]>([]);
  const [endData, setEndData] = useState<Tag[]>([]);

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchAvailableDates = async () => {
      try {
        const response = await getAvailableDates();
        const availableDatesArray: string[] = response.data.available_dates || [];
        const dateSet = new Set(availableDatesArray);
        setAvailableDates(dateSet);

        if (availableDatesArray.length > 0) {
          const lastDate = new Date(availableDatesArray[availableDatesArray.length - 1]);
          const sevenDaysAgo = subDays(lastDate, 6);
          
          const firstAvailable = new Date(availableDatesArray[0]);
          
          setEndDate(lastDate);
          setStartDate(sevenDaysAgo < firstAvailable ? firstAvailable : sevenDaysAgo);
        }
      } catch (err) {
        setError('데이터 제공 날짜를 불러오는 데 실패했습니다.');
      }
    };
    fetchAvailableDates();
  }, []);

  useEffect(() => {
    const fetchData = async () => {
      if (!startDate || !endDate) return;

      // Date validation
      if (startDate > endDate) {
        setError('시작일은 종료일보다 이전 날짜여야 합니다.');
        setStartData([]);
        setEndData([]);
        return;
      }

      setIsLoading(true);
      setError(null);

      try {
        const startTagsResponse = await getTagRankingsByDate(format(startDate, 'yyyy-MM-dd'));
        const endTagsResponse = await getTagRankingsByDate(format(endDate, 'yyyy-MM-dd'));

        const startTags = Array.isArray(startTagsResponse.data) ? startTagsResponse.data : [];
        const endTags = Array.isArray(endTagsResponse.data) ? endTagsResponse.data : [];

        setStartData(startTags);
        setEndData(endTags);

      } catch (err) {
        setError('태그 랭킹 데이터를 불러오는 데 실패했습니다.');
      } finally {
        setIsLoading(false);
      }
    };

    fetchData();
  }, [startDate, endDate]);

  const { risingTags, fallingTags, newTags, droppedTags } = useMemo(() => {
    if (!startData.length || !endData.length) {
      return { risingTags: [], fallingTags: [], newTags: [], droppedTags: [] };
    }

    const startRankMap = new Map(startData.map((tag, i) => [tag.TagName, i + 1]));
    const endRankMap = new Map(endData.map((tag, i) => [tag.TagName, i + 1]));

    const allTags = new Set([...startData.map(t => t.TagName), ...endData.map(t => t.TagName)]);

    const changes: { name: string; startRank: number | null; endRank: number | null; change: number }[] = [];
    const newIn: Tag[] = [];
    const droppedOut: Tag[] = [];

    allTags.forEach(tagName => {
      const startRank = startRankMap.get(tagName);
      const endRank = endRankMap.get(tagName);

      if (startRank && endRank) {
        changes.push({ name: tagName, startRank, endRank, change: startRank - endRank });
      } else if (!startRank && endRank) {
        const tagData = endData.find(t => t.TagName === tagName);
        if (tagData) newIn.push(tagData);
      } else if (startRank && !endRank) {
        const tagData = startData.find(t => t.TagName === tagName);
        if (tagData) droppedOut.push(tagData);
      }
    });

    const rising = changes.filter(c => c.change > 0).sort((a, b) => b.change - a.change);
    const falling = changes.filter(c => c.change < 0).sort((a, b) => a.change - b.change);

    return { risingTags: rising, fallingTags: falling, newTags: newIn, droppedTags: droppedOut };
  }, [startData, endData]);

  return (
    <div className="p-4 lg:container mx-auto">
      <div className="mb-4">
        <h1 className="h2 mb-2 ps-0">태그 트렌드 분석</h1>
        <p className="text-muted mb-0">
          두 날짜를 비교하여 인기가 상승하거나 하락한 태그를 확인합니다.
        </p>
      </div>

      <div className="d-flex flex-wrap gap-3 mb-4 p-3 border rounded-3 bg-light">
        <div className="d-flex align-items-center gap-2">
          <span className="form-label mb-0">시작일:</span>
          <CalendarPicker
            selectedDate={startDate}
            onDateChange={setStartDate}
            availableDates={availableDates}
            highlightDates={[startDate, endDate].filter(Boolean) as Date[]}
          />
        </div>
        <div className="d-flex align-items-center gap-2">
          <span className="form-label mb-0">종료일:</span>
          <CalendarPicker
            selectedDate={endDate}
            onDateChange={setEndDate}
            availableDates={availableDates}
            highlightDates={[startDate, endDate].filter(Boolean) as Date[]}
          />
        </div>
      </div>

      {isLoading ? (
        <div className="text-center">
          <Spinner animation="border" role="status">
            <span className="visually-hidden">Loading...</span>
          </Spinner>
        </div>
      ) : error ? (
        <Alert variant="danger">{error}</Alert>
      ) : (
        <TagTrendAnalysisContent
          risingTags={risingTags}
          fallingTags={fallingTags}
          newTags={newTags}
          droppedTags={droppedTags}
          startDate={startDate ? format(startDate, 'yyyy-MM-dd') : ''}
          endDate={endDate ? format(endDate, 'yyyy-MM-dd') : ''}
        />
      )}
    </div>
  );
};

export default TagTrendsPage;
