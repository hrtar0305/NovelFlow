import axios from 'axios';

// AWS 배포 후 API Gateway의 URL로 변경해야 합니다.
const API_BASE_URL = 'http://127.0.0.1:8000'; // 로컬 개발용 백엔드 주소

const apiClient = axios.create({
  baseURL: API_BASE_URL,
});

export const getNovelRankingsByDate = (date: string) => {
  return apiClient.get(`/ranks/novels/${date}`);
};

export const getTagRankingsByDate = (date: string) => {
  return apiClient.get(`/ranks/tags/${date}`);
};

export const getTagTrends = (startDate: string, endDate: string) => {
  return apiClient.get(`/trends/tags`, { params: { start_date: startDate, end_date: endDate } });
};



export const analyzeTagTrends = (startDate: string, endDate: string) => {
  return apiClient.get(`/trends/tags/analysis`, {
    params: {
      start_date: startDate,
      end_date: endDate,
    },
  });
};

export const getNovelTrend = (novelId: string, startDate: string, endDate: string) => {
  return apiClient.get(`/trends/novels/${novelId}`, { params: { start_date: startDate, end_date: endDate } });
};

export const getNovelAvailableDates = (novelId: string) => {
  return apiClient.get(`/trends/novels/${novelId}/available-dates`);
};

export const getLatestNovelDetails = (novelId: string) => {
  return apiClient.get(`/novels/${novelId}/latest`);
};

export const getLatestDate = () => {
  return apiClient.get(`/ranks/latest-date`);
};

export const getAvailableDates = () => {
  return apiClient.get(`/api/dates`);
};





export const getAuthorNovels = (authorId: string) => {
  return apiClient.get(`/authors/${authorId}`);
};

