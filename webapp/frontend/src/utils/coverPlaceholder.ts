/**
 * 작은 표지(표의 썸네일)를 가린 동안 원본 대신 그리는 '흐린 그림' 배경(2026-10-18).
 *
 * 표지는 노벨피아 원본(한 장 약 500KB, 작은 판 없음)이라 랭킹 첫 화면에서만 14장 4.6MB 를 받았고, 모바일 LCP 가 13.8초였다.
 * 썸네일 크기에서는 흐린 원본과 흐린 색 덩어리가 거의 구별되지 않아(사용자), 가린 동안은 받지 않고 이 배경을 그린다.
 * 실제 대표색은 표지를 받아야만 알 수 있어(노벨피아 이미지는 다른 출처라 브라우저가 픽셀을 읽지 못한다) 표지 주소로 정하는
 * 고정 색이다 — 같은 표지는 늘 같은 색이라 다시 그려도 깜빡이지 않는다.
 */
const hash = (s: string): number => {
  let h = 2166136261;   // FNV-1a
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
};

export function coverPlaceholder(seed: string): string {
  const h = hash(seed);
  const hue = h % 360;
  const hue2 = (hue + 25 + ((h >>> 9) % 70)) % 360;   // 가까운 색 — 표지는 대개 한두 계열이다
  const hue3 = (hue + 180 + ((h >>> 17) % 60)) % 360; // 작은 반대색 점 하나
  const x1 = 20 + ((h >>> 3) % 40), y1 = 15 + ((h >>> 11) % 30);
  const x2 = 50 + ((h >>> 5) % 40), y2 = 55 + ((h >>> 13) % 35);
  return [
    `radial-gradient(circle at ${x1}% ${y1}%, hsl(${hue2} 45% 62% / 0.9), transparent 55%)`,
    `radial-gradient(circle at ${x2}% ${y2}%, hsl(${hue3} 40% 55% / 0.55), transparent 50%)`,
    `linear-gradient(160deg, hsl(${hue} 38% 48%), hsl(${hue2} 34% 32%))`,
  ].join(', ');
}
