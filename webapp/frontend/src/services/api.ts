import axios from 'axios';

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

// --- CONTEST API FUNCTIONS ---

export const getContestDataByDate = (year: number, date: string) => {
  return axios.get(`${API_BASE_URL}/api/contests/${year}/${date}`);
};

export const getContestLatestDate = (year: number) => {
  return axios.get(`${API_BASE_URL}/api/contests/${year}/latest-date`);
};

export const getContestAvailableDates = (year: number) => {
  return axios.get(`${API_BASE_URL}/api/contests/${year}/available-dates`);
};

export const getLatestContestNovelDetails = (year: number, novelId: string) => {
  return axios.get(`${API_BASE_URL}/api/contests/${year}/novels/${novelId}/latest`);
};

export const getContestNovelTrend = (year: number, novelId: string, startDate: string, endDate: string) => {
  return axios.get(`${API_BASE_URL}/api/trends/contests/${year}/novels/${novelId}`, {
    params: {
      start_date: startDate,
      end_date: endDate,
    },
  });
};

export const getContestTagRankingsByDate = (year: number, date: string) => {
  return axios.get(`${API_BASE_URL}/api/contests/${year}/ranks/tags/${date}`);
};
