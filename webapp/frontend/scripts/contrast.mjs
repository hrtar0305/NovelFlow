// 글자 토큰이 면(canvas)과 호버면(surface-alt) 위에서 WCAG 4.5:1을 넘는지 검사한다.
//   node scripts/contrast.mjs   → 미달이 있으면 목록을 찍고 exit 1
import { readFileSync } from 'node:fs';
const css = readFileSync(new URL('../src/styles/tokens.css', import.meta.url), 'utf8');
const block = (sel) => {
  const i = css.indexOf(sel + ' {'); if (i < 0) throw new Error('no block ' + sel);
  const body = css.slice(i, css.indexOf('\n}', i));
  return Object.fromEntries([...body.matchAll(/(--np-[\w-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)].map(m => [m[1], m[2]]));
};
const lum = (hex) => {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map(c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const TEXT = ['--np-text-primary', '--np-text-secondary', '--np-text-faint', '--np-rank-up', '--np-rank-down', '--np-new-text',
  '--np-zone-mainstream-text', '--np-zone-gem-text', '--np-zone-saturated-text', '--np-zone-cold-text',
  '--np-award-gold', '--np-award-silver', '--np-award-bronze'];
const dark = block(':root'); const light = { ...dark, ...block('[data-theme="light"]') };
let bad = 0;
for (const [name, t] of [['dark', dark], ['light', light]]) {
  for (const bg of ['--np-canvas', '--np-surface-alt']) {
    for (const k of TEXT) {
      if (!t[k] || !t[bg]) { console.log(`${name} ${k}/${bg}: 값 없음`); bad++; continue; }
      const r = ratio(t[k], t[bg]);
      if (r < 4.5) { console.log(`${name} ${k} ${t[k]} on ${bg} ${t[bg]} = ${r.toFixed(2)}`); bad++; }
    }
  }
}
console.log(bad ? `미달 ${bad}건` : '모두 4.5:1 이상');
process.exit(bad ? 1 : 0);
