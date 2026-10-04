import { awardTier } from '../../utils/contestNovels';

/**
 * 수상 표기: 상 이름은 본문색, 단계는 앞의 작은 메달 점 — 샴페인(대상)·플래티넘(최우수상)·로즈골드(탑툰상·우수상·특별상).
 * 본선은 점 없이 흐리게. 수상만을 위한 예외 색이다(순위의 빨강과 섞이지 않게). 색을 글자에 주면 라이트 모드에서
 * 읽히는 금색이 갈색이 돼서, 글자가 아닌 점에 둔다(2026-10-04 사용자 선택).
 */
export default function AwardText({ award }: { award?: string | null }) {
  if (!award) return null;
  const tier = awardTier(award);
  return (
    <span className={`award-text award-text--${tier}`}>
      {tier !== 'minor' ? <i className={`award-dot award-dot--${tier}`} aria-hidden="true" /> : null}
      {award}
    </span>
  );
}
