import { changeValue, finiteOrNull } from './rankingQuery';
import { isDeletedContestNovel, type ContestNovel } from './contestNovels';

/**
 * 공모전 수치 조건(2026-10-18, 화면 이름 — 코드는 열 조건) — 참여작 전부(4,670편, 누적 조회 중앙값 37)가 보여 정렬만으로는 조회 몇십 회 작품이 위를 오염시켰다.
 * 숫자 열에 '이상 · 이하'(순위 열은 '이내 · 밖' — '1000위 이상'은 1001위 쪽으로 걸려 직관과 반대였다)를 걸고, 조건끼리는 모두 만족(AND). 값이 없는 작품(삭제 · 잔류율 없음 · 일간 순위 없음)은 그 조건에서 빠진다.
 * 회차 · 구분 · 연재 상태는 이미 따로 필터가 있어 여기 넣지 않는다.
 */
export type ColumnKey = 'daily_rank' | 'daily_rank_change' | 'Rank' | 'rank_change' | 'view_change' | 'View' | 'like_to_view_ratio'
  | 'EarlyRetentionRate' | 'RecentRetentionRate';
export interface ColumnDef { key: ColumnKey; label: string; unit: string; percent?: boolean; rank?: boolean }
export type ConditionOp = 'gte' | 'lte' | 'gt';
/** value 는 화면 단위(30 = 30%). 아직 안 넣었으면 null — 무시한다. */
export interface ColumnCondition { key: ColumnKey; op: ConditionOp; value: number | null }

const DEFS: Record<ColumnKey, ColumnDef> = {
  daily_rank: { key: 'daily_rank', label: '일간 순위', unit: '위', rank: true },
  daily_rank_change: { key: 'daily_rank_change', label: '변동', unit: '계단' },
  Rank: { key: 'Rank', label: '순위', unit: '위', rank: true },
  rank_change: { key: 'rank_change', label: '변동', unit: '계단' },
  view_change: { key: 'view_change', label: '일간 조회', unit: '회' },
  View: { key: 'View', label: '누적 조회', unit: '회' },
  like_to_view_ratio: { key: 'like_to_view_ratio', label: '추천비', unit: '%', percent: true },
  EarlyRetentionRate: { key: 'EarlyRetentionRate', label: '초반 잔류', unit: '%', percent: true },
  RecentRetentionRate: { key: 'RecentRetentionRate', label: '최신 잔류', unit: '%', percent: true },
};

/** 고를 수 있는 비교(첫째가 기본값). 순위는 작을수록 위라 '이내(≤) · 밖(>)', 나머지는 '이상 · 이하'. */
export const opsFor = (key: ColumnKey): { op: ConditionOp; label: string }[] => (DEFS[key].rank
  ? [{ op: 'lte', label: '이내' }, { op: 'gt', label: '밖' }]
  : [{ op: 'gte', label: '이상' }, { op: 'lte', label: '이하' }]);

/** 표의 숫자 열과 같은 순서. 2026(일간)은 일간 순위 · 잔류율, 2025 는 누적 순위. */
export const contestColumns = (daily: boolean): ColumnDef[] => (daily
  ? ['daily_rank', 'daily_rank_change', 'view_change', 'View', 'like_to_view_ratio', 'EarlyRetentionRate', 'RecentRetentionRate']
  : ['Rank', 'rank_change', 'view_change', 'View', 'like_to_view_ratio']).map(k => DEFS[k as ColumnKey]);

/** 조건이 보는 값(화면 단위). 표에서 '–' 인 칸은 null. */
function valueOf(x: ContestNovel, key: ColumnKey, daily: boolean): number | null {
  if (isDeletedContestNovel(x)) return null;
  if (key === 'daily_rank_change' || key === 'rank_change') return changeValue(x[key]);
  if (key === 'view_change' && daily && x.daily_rank == null) return null;   // 직전 값을 몰라 일간 조회가 '–' 인 작품
  const v = finiteOrNull(x[key]);
  return v != null && DEFS[key].percent ? v * 100 : v;
}

export function applyColumnConditions(items: ContestNovel[], conds: ColumnCondition[], daily: boolean): ContestNovel[] {
  const live = conds.filter(c => c.value != null);
  if (live.length === 0) return items;
  return items.filter(x => live.every(c => {
    const v = valueOf(x, c.key, daily);
    return v != null && (c.op === 'gte' ? v >= c.value! : c.op === 'gt' ? v > c.value! : v <= c.value!);
  }));
}

/** 적용 조건 칩(한국어 어순): '누적 조회 1,000회 이상' · '일간 순위 300위 이내' */
export const describeCondition = (c: ColumnCondition): string =>
  `${DEFS[c.key].label} ${(c.value ?? 0).toLocaleString('ko-KR')}${DEFS[c.key].unit} ${opsFor(c.key).find(o => o.op === c.op)?.label ?? ''}`;
