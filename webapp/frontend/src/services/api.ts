import axios, { type AxiosResponse } from 'axios';
import { trackPending } from '../utils/loadingSignal';

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

// 응답 모양은 호출부가 안다(r.data). 캐시는 URL 하나를 키로 AxiosResponse 단위로만 다룬다.
const cache: Record<string, TimedCacheEntry<AxiosResponse>> = {};
// 실제로 나가는 요청만 센다(캐시 적중은 request 를 부르지 않는다) — 화면 위 진행 막대(TopProgress)의 재료.
const get = (url: string, ttlMs = FIVE_MINUTES_MS) => getCachedRequest(cache, url, ttlMs, () => trackPending(apiClient.get(url)));

export const getNovelRankingsByDate = (date: string) => get(`/api/ranks/novels/${date}`, ONE_DAY_MS);
export const getTagRankingsByDate = (date: string) => get(`/api/ranks/tags/${date}`, ONE_DAY_MS);

/** 데이터 분석 리포트. 기간 전체가 사전 계산돼 있어 한 번만 받으면 된다
 *  (백엔드가 `RSNAP#<date>` 스냅샷을 배치로 읽어 계산한다). */
export const getAnalysisReport = (days: number) => get(`/api/analysis/report/${days}`);

/** 기간 안의 모든 수집일에 대한 태그별 시계열. 날짜를 하나씩 부르면 날짜당 약
 *  0.4초라 30일이면 12초가 넘는다. 백엔드가 batch_get_item으로 한 번에 읽는다. */
export const getTagSeries = (startDate: string, endDate: string) => get(`/api/trends/tags/series/${startDate}/${endDate}`);

/**
 * 연재 기록 — 날짜별 올린 화 수. `asof` 를 주면 그날 수집 마감(데일리 D 22:00, 공모전 D+1 01:00 KST)까지 본 회차만
 * 센다(행 펼침의 고정값). 응답 모양은 `utils/uploads` 의 UploadsResponse.
 */
export const getUploads = (novelId: string, start: string, end: string, asof?: { date: string; source: 'daily' | 'contest' }) =>
  // 경로로 보낸다 — CloudFront 가 API 쿼리 문자열을 버린다(캐시 우회 방지, 2026-10-18).
  get(`/api/uploads/${novelId}/${start}/${end}${asof ? `/${asof.source}/${asof.date}` : ''}`);

export const getNovelTrend = (novelId: string, startDate: string, endDate: string) =>
  get(`/api/trends/novels/${novelId}/${startDate}/${endDate}`, ONE_DAY_MS);
export const getNovelAvailableDates = (novelId: string) => get(`/api/trends/novels/${novelId}/available-dates`);
export const getLatestNovelDetails = (novelId: string) => get(`/api/novels/${novelId}/latest`);
export const getAvailableDates = () => get(`/api/dates`);
export const getAuthorNovels = (authorId: string) => get(`/api/authors/${authorId}`);

// --- CONTEST API FUNCTIONS ---

export const getContestDataByDate = (year: number, date: string) => get(`/api/contests/${year}/${date}`, ONE_DAY_MS);
export const getContestShowcase = (year: number) => get(`/api/contests/${year}/showcase`);
export const getContestAvailableDates = (year: number) => get(`/api/contests/${year}/available-dates`);
export const getLatestContestNovelDetails = (year: number, novelId: string) => get(`/api/contests/${year}/novels/${novelId}/latest`);
export const getContestNovelAvailableDates = (year: number, novelId: string) =>
  get(`/api/trends/contests/${year}/novels/${novelId}/available-dates`);
export const getContestNovelTrend = (year: number, novelId: string, startDate: string, endDate: string) =>
  get(`/api/trends/contests/${year}/novels/${novelId}/${startDate}/${endDate}`, ONE_DAY_MS);

/** 2026~ 공모전 태그 랭킹(일간 순위 기준, 데일리 태그와 같은 꼴). 일간 순위가 없는 날은 404. */
export const getContestDailyTagRankingsByDate = (year: number, date: string) =>
  get(`/api/contests/${year}/ranks/daily-tags/${date}`, ONE_DAY_MS);
/** 2026~ 공모전 태그 — 전체 참여작 기준(참여작 수 · 일간 500위 진입). */
export const getContestEntryTagsByDate = (year: number, date: string) =>
  get(`/api/contests/${year}/ranks/entry-tags/${date}`, ONE_DAY_MS);
export const getContestTagRankingsByDate = (year: number, date: string) =>
  get(`/api/contests/${year}/ranks/tags/${date}`, ONE_DAY_MS);
