/** 책 주석처럼 본문 번호 ↔ 주석을 오간다. 주소(#)는 바꾸지 않고 스크롤·포커스만 옮긴다 —
 *  라우터가 해시 변경을 내비게이션으로 받지 않게, 뒤로가기 기록도 쌓지 않게.
 *
 *  먼 거리는 부드럽게 굴리지 않고 바로 옮긴다. 공모전 표(4,670행 · 문서 39만 px)에서 부드러운 스크롤이 1.9만 px 쯤에서
 *  멈췄다 — 굴러가는 동안 가상 목록이 행을 새로 재며 문서 높이가 바뀌자 브라우저가 스크롤을 끊었다(2026-10-18). 바로 옮긴 뒤에도
 *  그 자리 행이 재어지며 목표가 밀릴 수 있어 다음 프레임에 한 번 더 맞춘다. */
const SMOOTH_MAX_SCREENS = 3;

export function jumpTo(id: string) {
  return (e: { preventDefault: () => void }) => {
    const el = document.getElementById(id);
    if (!el) return;
    e.preventDefault();
    const far = Math.abs(el.getBoundingClientRect().top) > SMOOTH_MAX_SCREENS * window.innerHeight;
    // 'auto' 가 아니라 'instant' — Bootstrap 이 :root 에 scroll-behavior: smooth 를 걸어 'auto' 도 부드럽게 굴렀다.
    el.scrollIntoView({ block: 'center', behavior: far ? 'instant' : 'smooth' });
    if (far) requestAnimationFrame(() => el.scrollIntoView({ block: 'center', behavior: 'instant' }));
    el.focus({ preventScroll: true });
  };
}
