/** 공모전 연도 목록(최신 먼저). 새 공모전 파이프라인이 붙으면 여기에 더한다. */
export const CONTEST_YEARS = ['2026', '2025'];
export const LATEST_CONTEST_YEAR = CONTEST_YEARS[0];

export interface ContestYearConfig {
  /** 머리 한 줄의 갱신 시각 표기 */
  schedule: string;
  /**
   * 대표 순위. 2025 는 누적 조회수 순위(`Rank`), 2026 부터는 적재 때 확정한 일간 순위(`DailyRank` —
   * 직전 수집일 대비 누적 조회 증가 순). 누적 순위는 공모전 중반부터 거의 움직이지 않는다(면접 D22).
   */
  headline: 'cumulative' | 'daily';
}

const CONFIG: Record<string, ContestYearConfig> = {
  2025: { schedule: '매일 오후 2시 갱신', headline: 'cumulative' },
  2026: { schedule: '매일 자정 갱신', headline: 'daily' },
};

export const contestConfig = (year: string): ContestYearConfig => CONFIG[year] ?? CONFIG[LATEST_CONTEST_YEAR];
