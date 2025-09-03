import axios from 'axios';

// Vite 환경 변수를 사용하여 API 기본 URL을 설정합니다.
// 개발 시에는 .env.development 파일의 값을, 빌드 시에는 .env.production 파일의 값을 사용합니다.
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL;

const apiClient = axios.create({
  baseURL: API_BASE_URL,
});

export const getNovelRankingsByDate = (date: string) => {
  return apiClient.get(`/api/ranks/novels/${date}`);
};

export const getTagRankingsByDate = (date: string) => {
  return apiClient.get(`/api/ranks/tags/${date}`);
};

export const getTagTrends = (startDate: string, endDate: string) => {
  return apiClient.get(`/api/trends/tags`, { params: { start_date: startDate, end_date: endDate } });
};



export const analyzeTagTrends = (startDate: string, endDate: string) => {
  return apiClient.get(`/api/trends/tags/analysis`, {
    params: {
      start_date: startDate,
      end_date: endDate,
    },
  });
};

export const getNovelTrend = (novelId: string, startDate: string, endDate: string) => {
  return apiClient.get(`/api/trends/novels/${novelId}`, { params: { start_date: startDate, end_date: endDate } });
};

export const getNovelAvailableDates = (novelId: string) => {
  return apiClient.get(`/api/trends/novels/${novelId}/available-dates`);
};

export const getLatestNovelDetails = (novelId: string) => {
  return apiClient.get(`/api/novels/${novelId}/latest`);
};

export const getLatestDate = () => {
  return apiClient.get(`/api/ranks/latest-date`);
};

export const getAvailableDates = () => {
  return apiClient.get(`/api/dates`);
};

export const getAuthorNovels = (authorId: string) => {
  return apiClient.get(`/api/authors/${authorId}`);
};
