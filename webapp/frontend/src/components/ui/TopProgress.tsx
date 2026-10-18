import { useEffect, useState } from 'react';
import { pendingCount, subscribePending } from '../../utils/loadingSignal';

/** 이보다 빨리 끝나는 요청은 막대를 띄우지 않는다 — 캐시 적중(50~70ms)마다 깜빡이면 오히려 산만하다. */
const SHOW_AFTER_MS = 200;

/**
 * 받는 중 — 헤더 바로 아래 한 줄짜리 진행 막대(2026-10-18). 데이터 요청이 200ms 넘게 걸리면 뜨고 끝나면 사라진다.
 * 끝을 모르는 요청이라 진행률 대신 흐르는 막대(indeterminate)다. YouTube · GitHub · Next.js(nprogress) 와 같은 패턴 —
 * 1초 넘게 걸리면 '진행 중'이라는 표시가 있어야 멈춘 것과 구분된다(NN/g 응답 시간 기준).
 */
export default function TopProgress() {
  const [busy, setBusy] = useState(pendingCount() > 0);
  const [show, setShow] = useState(false);
  useEffect(() => subscribePending(n => setBusy(n > 0)), []);
  useEffect(() => {
    if (!busy) { setShow(false); return; }
    const t = window.setTimeout(() => setShow(true), SHOW_AFTER_MS);
    return () => window.clearTimeout(t);
  }, [busy]);
  return show
    ? <div className="top-progress" role="progressbar" aria-label="불러오는 중" aria-busy="true"><span /></div>
    : null;
}
