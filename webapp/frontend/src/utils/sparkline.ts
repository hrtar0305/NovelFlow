export interface Point { x: number; y: number; }

export interface RankPath {
  d: string;
  last: Point | null;
  best: (Point & { rank: number }) | null;
}

/** 순위 배열(1 = 최고, null = 순위권 밖)을 SVG 경로로. null에서 선을 끊는다. */
export function rankPath(ranks: (number | null)[], width: number, height: number, pad = 4): RankPath {
  const vals = ranks.filter((r): r is number => r != null);
  if (vals.length === 0) return { d: '', last: null, best: null };
  const lo = Math.min(...vals);
  const hi = Math.max(...vals);
  const span = hi === lo ? 1 : hi - lo;
  const X = (i: number) => (ranks.length === 1 ? width / 2 : pad + (i / (ranks.length - 1)) * (width - 2 * pad));
  const Y = (r: number) => pad + ((r - lo) / span) * (height - 2 * pad);
  let d = '';
  let pen = false;
  let last: Point | null = null;
  let best: (Point & { rank: number }) | null = null;
  for (let i = 0; i < ranks.length; i++) {
    const r = ranks[i];
    if (r == null) { pen = false; continue; }
    const p = { x: X(i), y: Y(r) };
    d += `${pen ? 'L' : 'M'}${p.x.toFixed(1)},${p.y.toFixed(1)}`;
    pen = true;
    last = p;
    if (!best || r < best.rank) best = { ...p, rank: r };
  }
  return { d, last, best };
}
