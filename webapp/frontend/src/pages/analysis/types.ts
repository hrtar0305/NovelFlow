/** `/api/analysis/report/{days}` 응답. 계산은 전부 백엔드가 한다 —
 *  기간 전체(최대 90일)를 클라이언트에서 모으는 건 페이로드 30MB라 불가능했다. */

export interface ReportWork {
  id: string;
  title: string | null;
  author: string | null;
  author_id?: string | null;
  tags: string[];
  eps: number | null;
  added_eps: number | null;
  /** 마지막 7일에 늘어난 회차 */
  recent_added_eps: number | null;
  rank: number | null;
  best_rank: number | null;
  avg_rank: number | null;
  early: number | null;
  recent: number | null;
  period_ratio: number | null;
  per_week: number | null;
  observations: number | null;
  /** 들어온 작품: 수집 시작 이후 처음 목록에 든 작품인가 */
  first?: boolean;
}

export interface ReportLeaver {
  id: string;
  title: string | null;
  author: string | null;
  author_id?: string | null;
  tags: string[];
  early: number | null;
  recent: number | null;
  rank_at_start: number;
  best_rank: number;
  last_seen: string;
  observations: number;
  eps: number;
  added_eps: number;
}

export interface TagCombo { tags: string[]; count: number; lift: number }

export interface Quartile { label: string; min: number; max: number | null; count: number }

export interface DiagnoseWork {
  id: string; title: string | null; author: string | null;
  avg_rank: number; best_rank: number; band: number | null;
  score: number | null; eps: number;
  delta_view: number; period_ratio: number | null; per_week: number;
  early: number | null; recent: number | null;
}

/** 하루 세 번(7/30/90일) 미리 만들어 두는 기간 요약. 아직 생성 경로가 없어
 *  백엔드가 `null` 을 준다 — 화면은 그때 자리를 숨긴다. */
export interface AiSummary {
  text: string;
  model: string | null;
  generated_at: string | null;
}

/** '처음 진입'을 어떻게 판정했는지.
 *
 *  들어온 작품(지금 있고 기간 첫날엔 없던 작품)마다 **자기 과거 행**을 한 건 조회해 기간 전에
 *  랭킹에 든 적이 있는지 확인한다 — 그래서 확인 범위가 수집 전 기간이고, 스냅샷 보유
 *  기간에 묶이지 않는다. `checked − returning` 이 처음 진입 수(`totals.first_entrants`)다. */
export interface EntrantsBasis {
  checked: number;
  returning: number;
  first_collected: string;
}

export interface AnalysisReport {
  days_requested: number;
  dates: string[];
  dates_missing: number;
  start: string;
  end: string;
  ai_summary: AiSummary | null;
  entrants_basis: EntrantsBasis;
  totals: { end_works: number; entrants: number; first_entrants: number; leavers: number };
  churn: {
    footrule: number | null;
    /** 순위가 무작위로 섞였다면 나올 평균 이동. `footrule` 의 비교 기준선이다. */
    random_move: number | null;
    median_move: number | null;
    p90_move: number | null;
    kendall_tau: number | null;
    common: number;
    start_works: number;
    end_works: number;
    bands: { label: string; total: number; stayed: number; rate: number | null }[];
  };
  pace: {
    median: number | null; p90: number | null; max: number | null;
    growing: number; flat: number;
    /** 이 기간에 회차가 가장 많이 늘어난 작품. 분포만으로는 "어떤 작품이"에 답하지 못한다. */
    top: ReportWork[];
  };
  entrants: ReportWork[];
  leavers: ReportLeaver[];
  period_ratio: {
    floor_delta_view: number; counted: number;
    top: ReportWork[]; hidden: ReportWork[];
  };
  /** counted = 최근 7일에 회차가 늘고 두 잔류율이 다 있는 작품 수 */
  retention: { counted: number; rows: ReportWork[] };
  diagnose: { quartiles: Quartile[]; works: DiagnoseWork[] };
  /** 두 태그: 우연 대비 배수. 세 태그: 가장 강한 두 태그 짝 대비 배수(2026-09-30, analysis_report.tag_combinations). */
  tags: { pairs: TagCombo[]; triples: TagCombo[] };
}
