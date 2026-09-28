/** 책 주석처럼 본문 번호 ↔ 주석을 오간다. 주소(#)는 바꾸지 않고 스크롤·포커스만 옮긴다 —
 *  라우터가 해시 변경을 내비게이션으로 받지 않게, 뒤로가기 기록도 쌓지 않게. */
export function jumpTo(id: string) {
  return (e: { preventDefault: () => void }) => {
    const el = document.getElementById(id);
    if (!el) return;
    e.preventDefault();
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    el.focus({ preventScroll: true });
  };
}
