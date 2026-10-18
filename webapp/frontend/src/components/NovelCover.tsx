import { useEffect, useState } from 'react';
import { EyeFill, EyeSlashFill } from 'react-bootstrap-icons';
import { useCoverMask } from '../theme/coverMaskContext';
import { coverPlaceholder } from '../utils/coverPlaceholder';

type NovelCoverProps = {
  url?: string | null;
  title?: string | null;
  /** <img>에 적용할 클래스 (페이지별 기존 스타일 유지용) */
  imageClassName?: string;
  /** 마스킹 래퍼에 추가할 클래스 */
  className?: string;
  /** 가린 동안 원본을 받지 않고 흐린 색 덩어리를 그린다(표의 작은 썸네일 — 원본 한 장 약 500KB, 2026-10-18). 보기를 누르면 받는다. */
  placeholder?: boolean;
  /** 받는 순서. 'high' = 첫 화면의 가장 큰 그림(쇼케이스 1위) — 바로 · 먼저 받는다. 'low' = 같은 화면의 나머지 쇼케이스 표지.
   *  표지 원본 10장이 한꺼번에 받히며 1위 카드가 늦게 끝나 PC 첫 화면이 4초였다(2026-10-19). */
  priority?: 'high' | 'low';
};

/**
 * 표지 이미지 공용 렌더러. 기본은 헤더의 전체 설정(maskAll)을 따르고, 카드마다 버튼으로
 * 그 표지만 반대로 바꿀 수 있다 — 전체 가림에서 한 장 보기, 전체 표시에서 한 장 가리기.
 * 전체 설정을 바꾸면 개별 설정은 풀린다.
 *
 * 성인작 전용 단계는 없다. 성인작 표지도 다른 표지와 같은 규칙(기본 가림 + 개별
 * 해제)을 따른다. 성인작을 목록에서 빼는 일은 백엔드 `HIDE_ADULT_CONTENT` 가 맡는다.
 */
const NovelCover = ({ url, title, imageClassName, className, placeholder, priority }: NovelCoverProps) => {
  const { maskAll } = useCoverMask();
  const [override, setOverride] = useState<boolean | null>(null);

  // 전체 설정을 바꾸면 개별 설정을 푼다.
  useEffect(() => {
    setOverride(null);
  }, [maskAll]);

  if (!url) return null;

  // 개별 설정(override, null = 누른 적 없음)이 전체 설정보다 우선한다 — 전체 표시 상태에서도 한 장만 가릴 수 있어야 한다.
  const masked = override ?? maskAll;

  const toggle = (event: React.MouseEvent) => {
    // 카드 전체가 링크인 경우 상세 페이지로 이동하지 않도록 막는다.
    event.preventDefault();
    event.stopPropagation();
    setOverride(!masked);   // 지금 보이는 상태의 반대로 고정한다
  };

  return (
    <div className={`novel-cover-mask ${masked ? '' : 'novel-cover-mask--revealed'} ${className ?? ''}`.trim()}>
      {masked && placeholder ? <span className={`novel-cover-ph ${imageClassName ?? ''}`.trim()} style={{ background: coverPlaceholder(url) }} role="img" aria-label={`${title || '소설'} 썸네일(가림)`} /> : <img
        src={url}
        alt={`${title || '소설'} 썸네일`}
        className={imageClassName}
        loading={priority === 'high' ? 'eager' : 'lazy'}
        // React 18 은 fetchPriority 를 모른다 — 소문자 속성으로 그대로 넘긴다.
        {...(priority ? { fetchpriority: priority } : {})}
        onError={(event) => {
          event.currentTarget.style.display = 'none';
        }}
      />}
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
