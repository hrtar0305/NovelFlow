import {
  getAnalysisReport, getAvailableDates, getContestAvailableDates, getContestDailyTagRankingsByDate, getContestDataByDate,
  getContestTagRankingsByDate, getNovelRankingsByDate, getTagRankingsByDate,
} from './api';
import { LATEST_CONTEST_YEAR, contestConfig } from '../utils/contest';

/**
 * 앱 코드가 돌자마자 그 주소의 데이터를 미리 부른다(2026-10-19). 예전 순서는 앱 코드 → 페이지 코드 → (화면이 뜬 뒤) 날짜 목록 → 데이터로
 * 줄줄이라 느린 회선에서 왕복이 쌓였다(모바일 랭킹 첫 화면 4.6초 · 공모전 6.4초). 여기서 날짜 목록 → 최신 날짜 데이터를 페이지 코드와
 * 나란히 받기 시작하면, 페이지가 나중에 같은 주소를 부를 때 `get` 의 요청 캐시(같은 URL 이면 진행 중인 요청을 함께 씀)가 받는다.
 * 주소 · 기간은 페이지가 부르는 것과 똑같아야 한다(다르면 두 번 받는다).
 */
export type BootPlan =
  | { kind: 'daily'; page: 'novels' | 'tags'; date: string | null }
  | { kind: 'contest'; year: number; page: 'novels' | 'tags'; date: string | null }
  | { kind: 'analysis'; days: number };

const DATE = '(\\d{4}-\\d{2}-\\d{2})';

export function bootPlan(pathname: string, search: string): BootPlan | null {
  const p = pathname.replace(/\/+$/, '') || '/';
  let m: RegExpMatchArray | null;
  if (p === '/' || p === '/novels/rankings') return { kind: 'daily', page: 'novels', date: null };
  if ((m = p.match(new RegExp(`^/novels/rankings/${DATE}$`)))) return { kind: 'daily', page: 'novels', date: m[1] };
  if (p === '/tags/rankings') return { kind: 'daily', page: 'tags', date: null };
  if ((m = p.match(new RegExp(`^/tags/rankings/${DATE}$`)))) return { kind: 'daily', page: 'tags', date: m[1] };
  if (p === '/contests') return { kind: 'contest', year: Number(LATEST_CONTEST_YEAR), page: 'novels', date: null };
  if ((m = p.match(new RegExp(`^/contests/(\\d{4})(?:/tags/rankings)?(?:/${DATE})?$`)))) {
    return { kind: 'contest', year: Number(m[1]), page: p.includes('/tags/rankings') ? 'tags' : 'novels', date: m[2] ?? null };
  }
  if (p === '/trends') {
    const d = Number(new URLSearchParams(search).get('days'));
    return { kind: 'analysis', days: [7, 30, 90].includes(d) ? d : 30 };
  }
  return null;
}

const latest = (dates: string[]) => [...dates].sort().at(-1);

/** 실패는 조용히 버린다 — 페이지가 같은 요청을 다시 하며 오류를 직접 보여 준다(`get` 은 실패한 요청을 캐시에서 지운다). */
export function runBootPrefetch(pathname: string, search: string): void {
  const plan = bootPlan(pathname, search);
  if (!plan) return;
  const quiet = (p: Promise<unknown>) => { p.catch(() => {}); };
  if (plan.kind === 'analysis') { quiet(getAnalysisReport(plan.days)); return; }
  if (plan.kind === 'daily') {
    const byDate = plan.page === 'novels' ? getNovelRankingsByDate : getTagRankingsByDate;
    const dates = getAvailableDates();
    if (plan.date) quiet(byDate(plan.date));
    quiet(dates.then(r => { const d = plan.date ?? latest(r.data.available_dates ?? []); if (d) quiet(byDate(d)); }));
    return;
  }
  const daily = contestConfig(String(plan.year)).headline === 'daily';
  const byDate = (d: string) => (plan.page === 'novels' ? getContestDataByDate(plan.year, d)
    : daily ? getContestDailyTagRankingsByDate(plan.year, d) : getContestTagRankingsByDate(plan.year, d));
  const dates = getContestAvailableDates(plan.year);
  if (plan.date) quiet(byDate(plan.date));
  quiet(dates.then(r => { const d = plan.date ?? latest(r.data.available_dates ?? []); if (d) quiet(byDate(d)); }));
}
