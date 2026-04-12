import { useState, useEffect } from 'react';

// Bootstrap `md` 브레이크포인트와 동일 (d-md-none / d-none d-md-block 과 일치)
const MOBILE_QUERY = '(max-width: 767.98px)';

/**
 * 현재 뷰포트가 모바일(md 미만)인지 반환합니다.
 *
 * DOM 규모가 큰 페이지에서 `d-md-none` / `d-none d-md-block` 만으로 뷰를 숨기면
 * 숨겨진 요소도 스타일 재계산(style recalc) 대상이 되어 테마 전환처럼 루트 CSS 변수가
 * 바뀌는 순간 대량의 레이아웃 비용이 발생합니다. 이 훅을 사용해 해당 뷰포트에 필요한
 * 뷰만 실제로 마운트하여 비용을 줄일 수 있습니다.
 */
export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia(MOBILE_QUERY).matches;
  });

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mql = window.matchMedia(MOBILE_QUERY);
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, []);

  return isMobile;
}

export default useIsMobile;
