/**
 * 지금 받는 중인 데이터 요청 수 — 화면 위 진행 막대(components/ui/TopProgress)가 구독한다(2026-10-18).
 * 흐리게 두기(Stale)만으로는 받는 중인지 멈춘 건지 구분이 안 됐다(사용자). 요청 층(services/api 의 get)에서 세므로
 * 페이지마다 따로 알릴 필요가 없다. 캐시에서 바로 나오는 응답은 세지 않는다.
 */
let count = 0;
const listeners = new Set<(n: number) => void>();
const emit = () => listeners.forEach(f => f(count));

export const pendingCount = () => count;

export function subscribePending(f: (n: number) => void): () => void {
  listeners.add(f);
  return () => { listeners.delete(f); };
}

export function trackPending<T>(p: Promise<T>): Promise<T> {
  count += 1;
  emit();
  const done = () => { count -= 1; emit(); };
  p.then(done, done);
  return p;
}
