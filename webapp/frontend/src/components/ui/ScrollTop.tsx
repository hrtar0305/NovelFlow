import { useEffect, useState } from 'react';
import { ArrowUp } from 'react-bootstrap-icons';
import { SMOOTH_MAX_SCREENS } from '../../utils/footnoteJump';

/** 맨 위로 — 화면 두 개 넘게 내려가면 오른쪽 아래에 뜬다. 공모전 표(4,670행)는 손으로 올리기 너무 길었다(사용자 2026-10-18).
 *  먼 거리는 바로 옮긴다: 부드럽게 굴리면 가상 목록이 행을 재며 문서 높이가 바뀌어 브라우저가 중간에 스크롤을 끊는다(footnoteJump). */
export default function ScrollTop() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    const onScroll = () => setShow(window.scrollY > 2 * window.innerHeight);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);
  if (!show) return null;
  const toTop = () => window.scrollTo({ top: 0, behavior: window.scrollY > SMOOTH_MAX_SCREENS * window.innerHeight ? 'instant' : 'smooth' });
  return (
    <button type="button" className="scroll-top" onClick={toTop} aria-label="맨 위로" title="맨 위로">
      <ArrowUp size={18} aria-hidden="true" />
    </button>
  );
}
