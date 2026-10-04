import { awardTier } from '../../utils/contestNovels';

/**
 * 수상 표기: 금(대상)·은(최우수상)·동(탑툰상·우수상·특별상)·흐림(본선). 수상만을 위한 예외 색이다 — 강조색(빨강)은
 * 순위 1~3위의 뜻이라 수상에 쓰면 섞이고, 굵기·밝기만으로는 상끼리 구분되지 않았다(2026-10-04 사용자).
 */
export default function AwardText({ award }: { award?: string | null }) {
  return award ? <span className={`award-text award-text--${awardTier(award)}`}>{award}</span> : null;
}
