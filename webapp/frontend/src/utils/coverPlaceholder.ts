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

/** 흐린 표지처럼 — 색조 하나, 바랜 채도, 표지마다 다른 밝기, 가운데가 조금 밝은 부드러운 번짐. 색조 여러 개를 섞었더니
 *  흐린 표지가 아니라 색 얼룩처럼 보였다(사용자 2026-10-19). 실제 흐린 표지는 대개 회색 · 갈색 · 베이지 쪽으로 바랜다. */
export function coverPlaceholder(seed: string): string {
  const h = hash(seed);
  const hue = h % 360;
  const sat = 6 + ((h >>> 9) % 18);          // 6~23%
  const light = 22 + ((h >>> 14) % 34);      // 22~55%
  const x = 40 + ((h >>> 3) % 20), y = 35 + ((h >>> 20) % 20);
  return [
    `radial-gradient(ellipse at ${x}% ${y}%, hsl(${hue} ${sat}% ${light + 10}%), transparent 70%)`,
    `linear-gradient(180deg, hsl(${hue} ${sat}% ${light}%), hsl(${hue} ${sat}% ${Math.max(light - 8, 10)}%))`,
  ].join(', ');
}
