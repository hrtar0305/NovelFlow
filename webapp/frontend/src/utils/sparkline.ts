/** 값 배열을 SVG 경로로. null에서 선을 끊는다. */
export function linePath(values: (number | null)[], X: (i: number) => number, Y: (v: number) => number): string {
  let d = '';
  let pen = false;
  values.forEach((v, i) => {
    if (v == null) { pen = false; return; }
    d += `${pen ? 'L' : 'M'}${X(i).toFixed(1)},${Y(v).toFixed(1)}`;
    pen = true;
  });
  return d;
}

/** 순위 배열(1 = 최고, null = 순위권 밖)을 SVG 경로로. 이름표를 다는 쪽을 위해 X·Y 눈금도 돌려준다. */
export function rankPath(ranks: (number | null)[], width: number, height: number, pad = 4) {
  const vals = ranks.filter((r): r is number => r != null);
  const lo = Math.min(...vals);
  const hi = Math.max(...vals);
  const span = hi === lo ? 1 : hi - lo;
  const X = (i: number) => (ranks.length === 1 ? width / 2 : pad + (i / (ranks.length - 1)) * (width - 2 * pad));
  const Y = (r: number) => pad + ((r - lo) / span) * (height - 2 * pad);
  let i = ranks.length - 1;
  while (i >= 0 && ranks[i] == null) i--;
  const last = i >= 0 ? { x: X(i), y: Y(ranks[i]!) } : null;
  return { d: linePath(ranks, X, Y), last, X, Y };
}
