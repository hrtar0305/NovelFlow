import { awardTier } from '../../utils/contestNovels';

/**
 * 수상 표기. 강조색은 하나(빨강)만 쓰고 **대상에만** 준다 — 표에서 빨강이 '1~3위'와 '대상', 곧 맨 위라는 뜻 하나가 되게.
 * 나머지 상은 새 색·배지 없이 글자 굵기·밝기로 단계를 둔다(2026-10-04): 최우수상 > 탑툰상·우수상·특별상 > 본선.
 */
export default function AwardText({ award }: { award?: string | null }) {
  return award ? <span className={`award-text award-text--${awardTier(award)}`}>{award}</span> : null;
}
