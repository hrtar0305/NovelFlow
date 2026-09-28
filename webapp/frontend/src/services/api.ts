import axios from 'axios';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL;

const apiClient = axios.create({
  baseURL: API_BASE_URL,
});

const FIVE_MINUTES_MS = 5 * 60 * 1000;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

type TimedCacheEntry<T> = {
  promise: Promise<T>;
  expiresAt: number;
};

const getCachedRequest = <T>(
  cache: Record<string, TimedCacheEntry<T>>,
  key: string,
  ttlMs: number,
  request: () => Promise<T>,
) => {
  const now = Date.now();
  const cached = cache[key];

  if (cached && cached.expiresAt > now) {
    return cached.promise;
  }

  const promise = request().catch((error) => {
    if (cache[key]?.promise === promise) {
      delete cache[key];
    }
    throw error;
  });

  cache[key] = {
    promise,
    expiresAt: now + ttlMs,
  };

  return promise;
};

const _novelRankingCache: Record<string, TimedCacheEntry<any>> = {};
const _tagRankingCache: Record<string, TimedCacheEntry<any>> = {};
const _tagTrendAnalysisCache: Record<string, TimedCacheEntry<any>> = {};
const _novelTrendCache: Record<string, TimedCacheEntry<any>> = {};
const _novelAvailableDatesCache: Record<string, TimedCacheEntry<any>> = {};
const _latestNovelDetailsCache: Record<string, TimedCacheEntry<any>> = {};
const _availableDatesCache: Record<string, TimedCacheEntry<any>> = {};
const _tagSeriesCache: Record<string, TimedCacheEntry<any>> = {};
const _analysisReportCache: Record<string, TimedCacheEntry<any>> = {};
const _novelShowcaseCache: Record<string, TimedCacheEntry<any>> = {};
const _authorNovelsCache: Record<string, TimedCacheEntry<any>> = {};

export const getNovelRankingsByDate = (date: string) => {
  return getCachedRequest(
    _novelRankingCache,
    date,
    ONE_DAY_MS,
    () => apiClient.get(`/api/ranks/novels/${date}`),
  );
};

export const getNovelRankingShowcase = () => {
  return getCachedRequest(
    _novelShowcaseCache,
    'default',
    FIVE_MINUTES_MS,
    () => apiClient.get(`/api/ranks/novels/showcase`),
  );
};

export const getTagRankingsByDate = (date: string) => {
  return getCachedRequest(
    _tagRankingCache,
    date,
    ONE_DAY_MS,
    () => apiClient.get(`/api/ranks/tags/${date}`),
  );
};



/** 기간 안의 모든 수집일에 대한 태그별 시계열. 날짜를 하나씩 부르면 날짜당 약
 *  0.4초라 30일이면 12초가 넘는다. 백엔드가 batch_get_item으로 한 번에 읽는다. */
/** 데이터 분석 리포트. 기간 전체가 사전 계산돼 있어 한 번만 받으면 된다
 *  (백엔드가 `RSNAP#<date>` 스냅샷을 배치로 읽어 계산한다). */
export const getAnalysisReport = (days: number) => {
  return getCachedRequest(_analysisReportCache, String(days), FIVE_MINUTES_MS,
    () => apiClient.get(`/api/analysis/report/${days}`));
};

export const getTagSeries = (startDate: string, endDate: string) => {
  return getCachedRequest(
    _tagSeriesCache,
    `${startDate}~${endDate}`,
    FIVE_MINUTES_MS,
    () => apiClient.get(`/api/trends/tags/series/${startDate}/${endDate}`),
  );
};

export const analyzeTagTrends = (startDate: string, endDate: string) => {
  return getCachedRequest(
    _tagTrendAnalysisCache,
    `${startDate}:${endDate}`,
    ONE_DAY_MS,
    () => apiClient.get(`/api/trends/tags/analysis/${startDate}/${endDate}`),
  );
};

export const getNovelTrend = (novelId: string, startDate: string, endDate: string) => {
  return getCachedRequest(
    _novelTrendCache,
    `${novelId}:${startDate}:${endDate}`,
    ONE_DAY_MS,
    () => apiClient.get(`/api/trends/novels/${novelId}/${startDate}/${endDate}`),
  );
};

export const getNovelAvailableDates = (novelId: string) => {
  return getCachedRequest(
    _novelAvailableDatesCache,
    novelId,
    FIVE_MINUTES_MS,
    () => apiClient.get(`/api/trends/novels/${novelId}/available-dates`),
  );
};

export const getLatestNovelDetails = (novelId: string) => {
  return getCachedRequest(
    _latestNovelDetailsCache,
    novelId,
    FIVE_MINUTES_MS,
    () => apiClient.get(`/api/novels/${novelId}/latest`),
  );
};

export const getAvailableDates = () => {
  return getCachedRequest(
    _availableDatesCache,
    'default',
    FIVE_MINUTES_MS,
    () => apiClient.get(`/api/dates`),
  );
};

export const getAuthorNovels = (authorId: string) => {
  return getCachedRequest(
    _authorNovelsCache,
    authorId,
    FIVE_MINUTES_MS,
    () => apiClient.get(`/api/authors/${authorId}`),
  );
};

// --- CONTEST API FUNCTIONS ---

const _contestDataCache: Record<string, TimedCacheEntry<any>> = {};
export const getContestDataByDate = (year: number, date: string) => {
  return getCachedRequest(
    _contestDataCache,
    `${year}:${date}`,
    ONE_DAY_MS,
    () => axios.get(`${API_BASE_URL}/api/contests/${year}/${date}`),
  );
};

const _contestShowcaseCache: Record<string, TimedCacheEntry<any>> = {};
export const getContestShowcase = (year: number) => {
  return getCachedRequest(
    _contestShowcaseCache,
    String(year),
    FIVE_MINUTES_MS,
    () => axios.get(`${API_BASE_URL}/api/contests/${year}/showcase`),
  );
};

const _contestAvailableDatesCache: Record<string, TimedCacheEntry<any>> = {};
export const getContestAvailableDates = (year: number) => {
  return getCachedRequest(
    _contestAvailableDatesCache,
    String(year),
    FIVE_MINUTES_MS,
    () => axios.get(`${API_BASE_URL}/api/contests/${year}/available-dates`),
  );
};

const _latestContestNovelDetailsCache: Record<string, TimedCacheEntry<any>> = {};
export const getLatestContestNovelDetails = (year: number, novelId: string) => {
  return getCachedRequest(
    _latestContestNovelDetailsCache,
    `${year}:${novelId}`,
    FIVE_MINUTES_MS,
    () => axios.get(`${API_BASE_URL}/api/contests/${year}/novels/${novelId}/latest`),
  );
};

const _contestNovelAvailableDatesCache: Record<string, TimedCacheEntry<any>> = {};
export const getContestNovelAvailableDates = (year: number, novelId: string) => {
  return getCachedRequest(
    _contestNovelAvailableDatesCache,
    `${year}:${novelId}`,
    FIVE_MINUTES_MS,
    () => axios.get(`${API_BASE_URL}/api/trends/contests/${year}/novels/${novelId}/available-dates`),
  );
};

const _contestNovelTrendCache: Record<string, TimedCacheEntry<any>> = {};
export const getContestNovelTrend = (year: number, novelId: string, startDate: string, endDate: string) => {
  return getCachedRequest(
    _contestNovelTrendCache,
    `${year}:${novelId}:${startDate}:${endDate}`,
    ONE_DAY_MS,
    () => axios.get(`${API_BASE_URL}/api/trends/contests/${year}/novels/${novelId}/${startDate}/${endDate}`),
  );
};

const _contestTagRankingCache: Record<string, TimedCacheEntry<any>> = {};
export const getContestTagRankingsByDate = (year: number, date: string) => {
  return getCachedRequest(
    _contestTagRankingCache,
    `${year}:${date}`,
    ONE_DAY_MS,
    () => axios.get(`${API_BASE_URL}/api/contests/${year}/ranks/tags/${date}`),
  );
};
