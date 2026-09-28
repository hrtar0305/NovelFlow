import { useEffect, useState } from 'react';
import { EyeFill, EyeSlashFill } from 'react-bootstrap-icons';
import { useCoverMask } from '../theme/CoverMaskProvider';

type NovelCoverProps = {
  url?: string | null;
  title?: string | null;
  /** <img>에 적용할 클래스 (페이지별 기존 스타일 유지용) */
  imageClassName?: string;
  /** 마스킹 래퍼에 추가할 클래스 */
  className?: string;
};

/**
 * 표지 이미지 공용 렌더러. 표시 단계는 둘이다.
 *
 * 1) 가림(masked)   — 기본값. "표지 보기"로 개별 해제한다.
 * 2) 표시(revealed) — 사용자가 직접 해제한 상태. "가리기"로 되돌린다.
 *
 * 성인작 전용 단계는 없다. 성인작 표지도 다른 표지와 같은 규칙(기본 가림 + 개별
 * 해제)을 따른다. 성인작을 목록에서 빼는 일은 백엔드 `HIDE_ADULT_CONTENT` 가 맡는다.
 */
const NovelCover = ({ url, title, imageClassName, className }: NovelCoverProps) => {
  const { maskAll } = useCoverMask();
  const [revealed, setRevealed] = useState(false);

  // 전체 가리기를 다시 켜면 개별 해제를 되돌린다.
  useEffect(() => {
    if (maskAll) setRevealed(false);
  }, [maskAll]);

  if (!url) return null;

  const masked = maskAll && !revealed;

  const toggle = (event: React.MouseEvent) => {
    // 카드 전체가 링크인 경우 상세 페이지로 이동하지 않도록 막는다.
    event.preventDefault();
    event.stopPropagation();
    setRevealed((prev) => !prev);
  };

  return (
    <div className={`novel-cover-mask ${masked ? '' : 'novel-cover-mask--revealed'} ${className ?? ''}`.trim()}>
      <img
        src={url}
        alt={`${title || '소설'} 썸네일`}
        className={imageClassName}
        loading="lazy"
        onError={(event) => {
          event.currentTarget.style.display = 'none';
        }}
      />
      <button
        type="button"
        className="novel-cover-mask__reveal"
        aria-label={masked ? '표지 보기' : '표지 다시 가리기'}
        aria-pressed={!masked}
        onClick={toggle}
      >
        {masked
          ? <><EyeFill size={16} aria-hidden="true" /><span className="novel-cover-mask__label">표지 보기</span></>
          : <><EyeSlashFill size={16} aria-hidden="true" /><span className="novel-cover-mask__label">가리기</span></>}
      </button>
    </div>
  );
};

export default NovelCover;
