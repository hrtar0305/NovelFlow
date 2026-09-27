# 웹앱 개편 계획 1 — 기반 · 일간 랭킹 · 작품 상세

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 새 디자인 토큰·서체를 사이트 전체에 적용하고, 공통 컴포넌트를 만든 뒤 일간 랭킹과 작품 상세를 차트 페이지 문법으로 다시 짠다.

**Architecture:** 기존 `--np-*` 토큰 **이름은 그대로 두고 값만** 새 팔레트로 바꿔 한 번에 전 페이지를 재칠한다. 필터·정렬·숫자 표기 같은 순수 로직은 `src/utils/`로 빼서 vitest로 먼저 고정하고, 화면 컴포넌트는 `src/components/ui/`(범용)와 `src/components/ranking/`(랭킹 전용)에 둔다. 공모전·태그·분석은 계획 2~4에서 이 컴포넌트를 재사용한다.

**Tech Stack:** React 18, TypeScript 5.8, Vite 7, react-bootstrap 2(Offcanvas·Modal만 계속 사용), @tanstack/react-virtual 3, Recharts 3, react-datepicker 8, vitest(신규), 헤드리스 Chrome(스크린샷).

**Spec:** `docs/superpowers/specs/2026-09-28-webapp-redesign-design.md` — 이 계획은 스펙 §3, §4, §5.1, §5.2, §5.9, §9, §11을 구현한다. 시안: `.design-concepts/4차-A-vs-C/table.html`(`?dark`), `A.html#detail`.

**작업 위치:** `webapp/frontend/` (명령은 모두 이 폴더 기준). 브랜치 `feat/webapp-redesign`. 작업 트리에는 이 개편 전의 미커밋 웹 변경이 이미 있다 — 각 태스크는 **자기가 만든 파일만** `git add` 한다.

## Global Constraints

- 서체: Wanted Sans Variable 하나 — `https://cdn.jsdelivr.net/npm/wanted-sans@1.0.3/fonts/webfonts/variable/split/WantedSansVariable.min.css`. Pretendard는 제거.
- 숫자는 `font-feature-settings: "tnum"`, 숫자 열은 **오른쪽 정렬**.
- 모든 색은 토큰으로만. 토큰 파일(`src/styles/tokens.css`) 밖에 `#rrggbb`를 새로 쓰지 않는다. 예외: 쇼케이스 띠 위 글자(표지 위라 두 테마 모두 흰색 고정)와 `index.html`·`ThemeProvider`의 배경색.
- 글자색은 `--np-canvas`와 `--np-surface-alt` 위에서 **대비 4.5:1 이상**.
- 순위 변동 표기: `▲3`(상승) · `▼2`(하락) · `–`(변동 없음) · `NEW`(신규). 상승은 빨강, 하락은 파랑.
- 금지: 카드·패널 격자, 알약 칩 줄, 헤딩 아래 부제·설명 문단, 큰 숫자 타일 줄, 영문 눈썹 라벨, 그라데이션 버튼. 섹션 구분은 가로선 한 줄.
- sticky 헤더에 `backdrop-filter` 금지(iOS 상태바 색 고정 버그). theme-color는 이중 meta의 `media`를 바꿔 끼운다.
- 화면 높이 채우기는 `.app-shell`만 맡는다 — 새 요소에 `min-height: 100dvh` 금지.
- 표지는 `NovelCover`로만 그린다.
- 없는 값은 `–`. "변동 없음"과 "비교할 기록 없음"을 같은 기호로 뭉뚱그리지 않는다.
- 쇼케이스는 모자이크(1위 세로 두 칸) + 표지 전면 + 글자 뒤 블러 띠 구조를 유지한다.
- 커밋 메시지는 한국어 한 줄 요약 + 본문에 왜, 끝에 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. 푸시는 하지 않는다.

## Review Focus

1. **쇼케이스 날짜와 표 날짜가 다를 때** — 쇼케이스는 항상 최신 수집일, 표는 고른 날짜다. 과거 날짜를 보면 쇼케이스가 오늘 것이라는 표시가 있어야 한다 → Task 10에서 날짜가 다르면 그룹 제목 옆에 `9.27 기준`을 붙이고, 같으면 붙이지 않는다.
2. **오늘 순위권 밖인 작품의 상세** — 상세 API는 마지막 기록일의 `Ranking`을 준다. 그대로 크게 띄우면 오늘 순위처럼 읽힌다 → Task 13 `describeCurrentRank()`가 마지막 기록일 ≠ 최신 수집일이면 `순위권 밖 · 마지막 기록 9월 12일 45위`를 돌려준다(단위 테스트 포함).
3. **조건식 오류** — 괄호가 안 맞는 식을 적용하면 표가 비고 이유가 보여야 한다. 앱이 멈추거나 이전 결과가 조용히 남으면 안 된다 → Task 6 테스트 `applyRankingFilter`가 `error`를 돌려주는지, Task 8 서랍이 그 문장을 조건식 입력 아래에 보이는지.
4. **다른 날짜로 이동해도 필터 유지** — 날짜만 바꿨는데 조건이 풀리면 사용자는 다시 고른다 → Task 11에서 날짜 이동은 경로만 바꾸고 필터 상태는 컴포넌트에 남는다(수동 확인 단계 포함).
5. **태그로 들어왔을 때(`?tag=판타지`)** — 상세의 태그 링크나 이후 태그 랭킹에서 들어오면 그 태그가 걸린 상태로 열려야 하고, 존재하지 않는 태그면 빈 표 + 조건 한 줄로 이유가 보여야 한다 → Task 11 수동 확인 단계.

---

## 파일 구조

| 파일 | 책임 |
|---|---|
| `scripts/shots.sh` (신규) | dev 서버에 붙어 경로 × 폭(360/768/1200) × 테마를 PNG로 찍는다 |
| `src/utils/format.ts` (신규) | 숫자·날짜 표기(`formatInt`, `formatMan`, `formatRatio`, `formatDateDot`, `formatDateKo`) |
| `src/utils/rankChange.ts` (신규) | 순위 변동 값 → 표기·종류·읽기 문장 |
| `src/utils/rankingQuery.ts` (신규) | 랭킹 필터·정렬·태그 집계(기존 페이지 안에 있던 로직을 순수 함수로) |
| `src/utils/sparkline.ts` (신규) | 순위 배열 → SVG 경로 |
| `src/utils/trendSummary.ts` (신규) | 추이 응답 → 30일 차트인 일수·최고 순위·순위 배열, 현재 순위 문구 |
| `src/components/ui/*.tsx` (신규 7개) | `ChangeMark`, `PageTitle`, `DateNav`, `TabBar`, `InlineNums`, `Footnotes`, `TagLinks`, `Sparkline` |
| `src/components/ranking/*.tsx` (신규 5개) | `FilterDrawer`, `AppliedFilters`, `RankTable`, `Showcase`, `NovelRowExpand` |
| `src/components/novel/NovelHeader.tsx` (신규) | 작품 상세 머리(표지·제목·순위·한 줄 수치) |
| `src/styles/redesign.css` (신규) | 위 컴포넌트들의 스타일. `styles/index.css`에서 마지막에 import |
| `src/theme/themeContext.ts`, `src/theme/coverMaskContext.ts` (신규) | 컨텍스트·훅을 컴포넌트 파일에서 분리(react-refresh 린트) |
| `src/pages/NotFoundPage.tsx` (신규) | 알 수 없는 URL |
| `src/pages/NovelRankingsPage.tsx` (재작성) | 조립만 한다 |
| `src/pages/NovelDetailPage.tsx`, `src/components/novel/SmallMultiplesChart.tsx` (수정) | 상세 조립, 차트 훅 규칙 위반 수정·토큰화 |

---

### Task 1: 테스트·스크린샷 도구

**Files:**
- Modify: `package.json`, `vite.config.ts`, `index.html:18-30`
- Create: `scripts/shots.sh`, `src/utils/smoke.test.ts`(이 태스크 끝에 지운다)

**Interfaces:**
- Produces: `npm test`(vitest run), `scripts/shots.sh <출력폴더> [경로...]`, URL `?theme=light|dark`로 테마 강제.

- [ ] **Step 1: vitest 설치**

Run: `npm i -D vitest`
Expected: `package.json` devDependencies에 `vitest`가 생긴다. `npx vitest --version`이 버전을 출력한다.

- [ ] **Step 2: 스크립트와 설정 추가**

`package.json` scripts에 추가:
```json
    "test": "vitest run",
```

`vite.config.ts` 전체를 다음으로 바꾼다:
```ts
/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
      },
    },
  },
  build: {
    // Let Vite handle chunking automatically to ensure correct dependency loading order.
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
```

- [ ] **Step 3: 동작 확인용 테스트를 쓰고 돌린다**

`src/utils/smoke.test.ts`:
```ts
import { describe, expect, it } from 'vitest';

describe('vitest', () => {
  it('runs', () => {
    expect(1 + 1).toBe(2);
  });
});
```
Run: `npm test`
Expected: `1 passed`.

- [ ] **Step 4: `?theme=` 쿼리로 테마를 강제한다**

`index.html`의 inline script 첫 줄 `var t = localStorage.getItem('theme') || 'dark';`를 다음으로 바꾼다(헤드리스 크롬은 localStorage를 미리 채울 수 없어서 스크린샷이 테마를 고를 방법이 필요하다):
```js
        var q = new URLSearchParams(location.search).get('theme');
        if (q === 'light' || q === 'dark') localStorage.setItem('theme', q);
        var t = localStorage.getItem('theme') || 'dark';
```

- [ ] **Step 5: 스크린샷 스크립트**

`scripts/shots.sh`:
```bash
#!/usr/bin/env bash
# dev 서버(npm run dev, 기본 5173)에 붙어 경로 × 폭 × 테마를 PNG로 찍는다.
#   scripts/shots.sh <출력폴더> [경로...]      예) scripts/shots.sh /tmp/shots /novels/rankings /novels/433986
# BASE 로 서버 주소를 바꾼다. 백엔드(localhost:8000)도 떠 있어야 데이터가 나온다.
set -euo pipefail
OUT=${1:?출력 폴더를 주세요}; shift || true
[ $# -eq 0 ] && set -- /novels/rankings
BASE=${BASE:-http://localhost:5173}
mkdir -p "$OUT"
for p in "$@"; do
  slug=$(printf '%s' "$p" | tr '/?=&' '____' | sed 's/^_//')
  for w in 360 768 1200; do
    for t in light dark; do
      sep='?'; case "$p" in *\?*) sep='&';; esac
      google-chrome --headless=new --disable-gpu --no-sandbox --hide-scrollbars \
        --virtual-time-budget=15000 --window-size="$w,2600" \
        --screenshot="$OUT/${slug:-root}-$w-$t.png" "$BASE$p${sep}theme=$t" >/dev/null 2>&1
    done
  done
done
ls -1 "$OUT"
```
Run: `chmod +x scripts/shots.sh`

- [ ] **Step 6: 스크린샷이 찍히는지 확인**

터미널 1: `cd ../backend && python api/main.py` (포트 8000) · 터미널 2: `npm run dev`
Run: `scripts/shots.sh /tmp/nf-shots-baseline /novels/rankings`
Expected: `novels_rankings-{360,768,1200}-{light,dark}.png` 6장. 1200-light를 열어 현재(개편 전) 화면이 찍혔는지 본다. 이 폴더는 이후 태스크의 "전" 비교용이다.

- [ ] **Step 7: 확인용 테스트를 지우고 커밋**

```bash
rm src/utils/smoke.test.ts
git add package.json package-lock.json vite.config.ts index.html scripts/shots.sh
git commit -m "웹 개편용 테스트·스크린샷 도구를 추가한다

순수 로직을 vitest로 먼저 고정하고, 화면은 헤드리스 크롬으로 폭 3개 × 테마 2개를
찍어 확인한다. 헤드리스에서는 localStorage를 미리 채울 수 없어 ?theme= 쿼리로
테마를 강제하게 했다.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: 디자인 토큰 · 서체 교체

**Files:**
- Modify: `src/styles/tokens.css`(전체), `src/styles/base.css:18-20, 140-160`, `src/index.css:1-9`, `index.html:13-16, 20`, `src/theme/ThemeProvider.tsx:18-21`
- Create: `scripts/contrast.mjs`

**Interfaces:**
- Produces(이후 모든 태스크가 쓰는 토큰): 기존 `--np-*` 전부 + 신규 `--np-font-sans`, `--np-text-faint`, `--np-new-text`, `--np-cover-bg`, `--np-zone-mainstream|gem|saturated|cold`(점), `--np-zone-*-text`(글자), `--np-header-h`.

- [ ] **Step 1: 대비 검사 스크립트를 먼저 쓴다(실패하는 상태 확인)**

`scripts/contrast.mjs`:
```js
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
  '--np-zone-mainstream-text', '--np-zone-gem-text', '--np-zone-saturated-text', '--np-zone-cold-text'];
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
```
Run: `node scripts/contrast.mjs`
Expected: FAIL(현재 토큰에는 `--np-text-faint` 등이 없어 "값 없음"이 찍히고 exit 1).

- [ ] **Step 2: `src/styles/tokens.css`를 통째로 바꾼다**

```css
/* NovelFlow 디자인 토큰 — 차트 페이지(2026-09-28, docs/superpowers/specs/2026-09-28-webapp-redesign-design.md)
 *
 * 토큰 **이름은 이전(클린 모던) 그대로** 두고 값만 바꿨다. CSS 전체가 이 이름을 쓰므로
 * 값만 바꾸면 전 페이지가 한 번에 새 인상으로 바뀐다. 새로 필요한 것만 아래에 추가했다.
 *
 * - 면은 하나다(canvas = surface). 섹션은 박스가 아니라 가로선으로 나눈다.
 * - 강조(accent)는 빨강 — 활성 탭 밑줄, 1~3위 숫자, 차트 선. 채운 버튼은 accent-solid(본문색).
 * - 상승 빨강 / 하락 파랑(한국 차트 관례). positive/negative도 같은 값이다.
 * - 글자색은 canvas·surface-alt 위 4.5:1 이상 — scripts/contrast.mjs로 검사한다.
 */
:root {
  color-scheme: dark;
  --np-font-sans: 'Wanted Sans Variable', 'Wanted Sans', -apple-system, BlinkMacSystemFont, system-ui,
    'Apple SD Gothic Neo', 'Noto Sans KR', sans-serif;
  --np-header-h: 64px;

  --np-canvas: #121418;
  --np-canvas-elevated: #121418;
  --np-surface: #121418;
  --np-surface-alt: #1b1e23;
  --np-surface-raised: #23262d;
  --np-surface-overlay: rgba(18, 20, 24, 0.96);
  --np-cover-bg: #2a2d34;

  --np-border: #262930;
  --np-border-strong: #353942;

  --np-text-primary: #eceef2;
  --np-text-secondary: #a0a6b1;
  --np-text-faint: #858b96;
  --np-text-heading: #eceef2;

  --np-accent: #ff5c70;
  --np-accent-strong: #ff8190;
  --np-accent-soft: rgba(255, 92, 112, 0.14);
  --np-accent-ghost: rgba(255, 92, 112, 0.08);
  --np-accent-warm: #5c95ff;
  --np-accent-warm-soft: rgba(92, 149, 255, 0.12);
  --np-accent-solid: #eceef2;
  --np-on-accent-solid: #121418;

  --np-positive: #ff5c70;
  --np-negative: #5c95ff;
  --np-warning: #f2a23a;
  --np-focus-ring: rgba(92, 149, 255, 0.45);
  --np-rank-up: #ff5c70;
  --np-rank-down: #5c95ff;
  --np-new-text: #f2a23a;

  --np-zone-mainstream: #9a86ff;
  --np-zone-gem: #2cc4ac;
  --np-zone-saturated: #f0a030;
  --np-zone-cold: #858b96;
  --np-zone-mainstream-text: #9a86ff;
  --np-zone-gem-text: #2cc4ac;
  --np-zone-saturated-text: #f0a030;
  --np-zone-cold-text: #a0a6b1;

  --np-banner-start: #121418;
  --np-banner-end: #121418;
  --np-bg: var(--np-canvas);
  --np-border-subtle: var(--np-border);

  --np-chart-1: #ff5c70;
  --np-chart-2: #5c95ff;
  --np-chart-3: #9a86ff;
  --np-chart-4: #2cc4ac;
  --np-chart-5: #f2a23a;
  --np-chart-6: #a0a6b1;

  --np-radius-sm: 4px;
  --np-radius-md: 8px;
  --np-radius-lg: 10px;
  --np-radius-xl: 14px;

  --np-shadow-sm: none;
  --np-shadow-md: 0 8px 24px rgba(0, 0, 0, 0.4);
  --np-shadow-lg: -12px 0 32px rgba(0, 0, 0, 0.45);

  --np-space-1: 0.375rem;
  --np-space-2: 0.625rem;
  --np-space-3: 0.875rem;
  --np-space-4: 1.125rem;
  --np-space-5: 1.5rem;
  --np-space-6: 2rem;
  --np-space-7: 2.75rem;
  --np-space-8: 3.5rem;
  --np-fs-micro: 0.75rem;
  --np-fs-meta: 0.8125rem;
  --np-fs-body: 0.875rem;
  --np-fs-body-lg: 0.9375rem;
  --np-fs-title-sm: 1.1875rem;
  --np-fs-title-md: 1.875rem;
  --np-fs-title-lg: 2rem;
  --np-content-max: 1200px;
  --np-transition: 150ms ease;
  --bs-body-bg: var(--np-canvas);
  --bs-body-color: var(--np-text-primary);
  --bs-border-color: var(--np-border);
  --bs-secondary-color: var(--np-text-secondary);
  --bs-heading-color: var(--np-text-heading);
  --bs-emphasis-color: var(--np-text-heading);
}

[data-theme="light"] {
  color-scheme: light;

  --np-canvas: #ffffff;
  --np-canvas-elevated: #ffffff;
  --np-surface: #ffffff;
  --np-surface-alt: #f7f8fa;
  --np-surface-raised: #f1f2f5;
  --np-surface-overlay: rgba(255, 255, 255, 0.97);
  --np-cover-bg: #d9dce1;

  --np-border: #edeef1;
  --np-border-strong: #dfe1e6;

  --np-text-primary: #15171c;
  --np-text-secondary: #6a707b;
  --np-text-faint: #6f7580;
  --np-text-heading: #15171c;

  --np-accent: #d42a44;
  --np-accent-strong: #b81f37;
  --np-accent-soft: rgba(212, 42, 68, 0.1);
  --np-accent-ghost: rgba(212, 42, 68, 0.06);
  --np-accent-warm: #2c6be0;
  --np-accent-warm-soft: rgba(44, 107, 224, 0.1);
  --np-accent-solid: #15171c;
  --np-on-accent-solid: #ffffff;

  --np-positive: #d42a44;
  --np-negative: #2c6be0;
  --np-warning: #a35f00;
  --np-focus-ring: rgba(44, 107, 224, 0.35);
  --np-rank-up: #d42a44;
  --np-rank-down: #2c6be0;
  --np-new-text: #a35f00;

  --np-zone-mainstream: #6247d6;
  --np-zone-gem: #0f9a86;
  --np-zone-saturated: #d9820a;
  --np-zone-cold: #a1a6af;
  --np-zone-mainstream-text: #6247d6;
  --np-zone-gem-text: #0d7f6f;
  --np-zone-saturated-text: #a8650a;
  --np-zone-cold-text: #6a707b;

  --np-banner-start: #ffffff;
  --np-banner-end: #ffffff;
  --np-bg: var(--np-canvas);
  --np-border-subtle: var(--np-border);

  --np-chart-1: #d42a44;
  --np-chart-2: #2c6be0;
  --np-chart-3: #6247d6;
  --np-chart-4: #0f9a86;
  --np-chart-5: #d9820a;
  --np-chart-6: #6a707b;

  --np-shadow-sm: none;
  --np-shadow-md: 0 8px 28px rgba(20, 24, 32, 0.14);
  --np-shadow-lg: -12px 0 32px rgba(20, 24, 32, 0.12);

  --bs-body-bg: var(--np-canvas);
  --bs-body-color: var(--np-text-primary);
  --bs-border-color: var(--np-border);
  --bs-secondary-color: var(--np-text-secondary);
  --bs-heading-color: var(--np-text-heading);
  --bs-emphasis-color: var(--np-text-heading);
}
```

- [ ] **Step 3: 대비 검사가 통과하는지 확인**

Run: `node scripts/contrast.mjs`
Expected: `모두 4.5:1 이상`, exit 0. 미달이 찍히면 그 토큰 값을 한 단계 진하게(라이트)·밝게(다크) 바꿔 다시 돌린다.

- [ ] **Step 4: 서체 연결**

`index.html`: Pretendard `<link ...pretendard...>` 줄을 다음으로 바꾼다:
```html
    <link rel="stylesheet" crossorigin href="https://cdn.jsdelivr.net/npm/wanted-sans@1.0.3/fonts/webfonts/variable/split/WantedSansVariable.min.css" />
```
같은 파일의 배경색 세 곳(`content="#101114"`, `content="#f6f7f9"`, inline script의 `'#f6f7f9' : '#101114'`)을 `#121418`(다크)·`#ffffff`(라이트)로 바꾼다.

`src/theme/ThemeProvider.tsx`:
```ts
const THEME_BG_COLORS: Record<ThemeMode, string> = {
  dark: '#121418',
  light: '#ffffff',
};
```

`src/index.css` 1~9행의 `:root { font-family: 'Pretendard Variable', ... }` 블록에서 `font-family` 줄만 지운다(나머지 속성은 둔다). `src/styles/base.css`의 `body` 안 `font-family: 'Pretendard Variable', ...` 두 줄을 다음 한 줄로 바꾸고, 같은 규칙 끝에 tnum을 더한다:
```css
  font-family: var(--np-font-sans);
  font-feature-settings: "tnum" 1;
```

- [ ] **Step 5: 그라데이션 버튼과 한글 넓은 자간을 없앤다**

`src/styles/base.css`에서 `.btn-primary` 규칙의 `background`(indigo→cyan 그라데이션)를 다음으로 바꾼다:
```css
  background: var(--np-accent-solid) !important;
  color: var(--np-on-accent-solid) !important;
  border-color: var(--np-accent-solid) !important;
```
그리고 다음 명령으로 한글 라벨의 넓은 자간을 찾아 `letter-spacing`을 `0`으로 바꾼다:
Run: `grep -n "letter-spacing: 0\.1[0-9]*em\|letter-spacing: 0\.0[6-9]em" src/styles/*.css | grep -v custom.css`
Expected: `.sidebar-label`, `.tag-ranking-control-bar__label`, `.selected-tag-panel__eyebrow`, `.novel-stat-label`, `.page-hero__eyebrow`, `.compact-meta`, `.section-kicker` 등이 나온다 — 각 줄을 `letter-spacing: 0;`으로 바꾸고 같은 규칙의 `text-transform: uppercase`도 지운다.

- [ ] **Step 6: 빌드와 스크린샷으로 확인**

Run: `npm run build && node scripts/contrast.mjs`
Expected: 빌드 성공, 대비 통과.
Run: `scripts/shots.sh /tmp/nf-shots-t2 /novels/rankings /tags/rankings /trends`
Expected: 모든 페이지가 새 서체(Wanted Sans)·흰/짙은 면·빨강 강조로 바뀌었다. 구조는 그대로(카드 등)여도 된다 — 구조는 이후 태스크. 다크에서 글자가 사라진 곳이 없는지 1200-dark 세 장을 본다.

- [ ] **Step 7: 커밋**

```bash
git add src/styles/tokens.css src/styles/base.css src/index.css index.html src/theme/ThemeProvider.tsx scripts/contrast.mjs
git commit -m "디자인 토큰과 서체를 차트 페이지 기준으로 바꾼다

토큰 이름은 그대로 두고 값만 바꿔 전 페이지를 한 번에 재칠한다. 서체는 Pretendard
(라틴·숫자가 Inter)에서 Wanted Sans로, 변동 색은 한국 차트 관례(상승 빨강·하락
파랑)로 바꿨다. 글자 토큰은 면·호버면 위 4.5:1 이상인지 scripts/contrast.mjs로
검사한다 — 시안 값 중 라이트 상승·신규·흐림, 다크 흐림은 미달이라 보정했다.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: 죽은 코드 제거 · 테마 파일 린트 정리

**Files:**
- Delete: `src/styles/custom.css`, `src/App.css`, `src/styles/index.html`, `src/components/ui/SectionHeader.tsx`, `src/components/ui/FilterRail.tsx`, `src/components/ui/DataTableShell.tsx`, `src/components/TagFilterControls.tsx`, `src/components/novel/NovelTrendChart.tsx`, `src/components/trends/TagTrendAnalysisContent.tsx`
- Create: `src/theme/themeContext.ts`, `src/theme/coverMaskContext.ts`
- Modify: `src/theme/ThemeProvider.tsx`, `src/theme/CoverMaskProvider.tsx`, `useTheme`/`useCoverMask`를 import하는 모든 파일, `src/styles/pages.css`·`components.css`(죽은 클래스), `src/index.css:27-30`

**Interfaces:**
- Produces: `import { useTheme } from '../theme/themeContext'`, `import { useCoverMask } from '../theme/coverMaskContext'` — 이후 태스크는 이 경로를 쓴다.

- [ ] **Step 1: 지울 파일이 정말 참조되지 않는지 확인**

Run:
```bash
for n in custom.css App.css SectionHeader FilterRail DataTableShell TagFilterControls NovelTrendChart TagTrendAnalysisContent "styles/index.html"; do
  printf '%-26s ' "$n"; grep -rl --include=*.ts --include=*.tsx --include=*.css --include=*.html "$n" src index.html | grep -v "src/.*$n" | tr '\n' ' '; echo; done
```
Expected: 각 줄 오른쪽이 비어 있다(자기 자신 외 참조 없음). 비어 있지 않은 줄이 있으면 지우지 말고 그 참조를 먼저 확인한다.

- [ ] **Step 2: 파일 삭제**

```bash
git rm -q src/styles/custom.css src/App.css src/styles/index.html src/components/ui/SectionHeader.tsx \
  src/components/ui/FilterRail.tsx src/components/ui/DataTableShell.tsx src/components/TagFilterControls.tsx \
  src/components/novel/NovelTrendChart.tsx src/components/trends/TagTrendAnalysisContent.tsx
```
(`custom.css` 등이 미추적 상태라 `git rm`이 실패하면 `rm`으로 지운다.)

- [ ] **Step 3: 테마 컨텍스트를 분리**

`src/theme/themeContext.ts`:
```ts
import { createContext, useContext } from 'react';

export type ThemeMode = 'dark' | 'light';

export interface ThemeContextValue {
  theme: ThemeMode;
  setTheme: (theme: ThemeMode) => void;
  toggleTheme: () => void;
}

export const ThemeContext = createContext<ThemeContextValue | null>(null);

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) throw new Error('useTheme must be used within ThemeProvider');
  return context;
}
```
`src/theme/ThemeProvider.tsx`에서 `ThemeMode` 타입·`ThemeContextValue`·`createContext` 호출·`useTheme` 함수를 지우고, 맨 위에 `import { ThemeContext, type ThemeMode, type ThemeContextValue } from './themeContext';`를 둔다(나머지 Provider 본문은 그대로).

`src/theme/CoverMaskProvider.tsx`도 같은 방식으로 `createContext`·컨텍스트 타입·`useCoverMask`를 `src/theme/coverMaskContext.ts`로 옮긴다. 옮기기 전에 Run: `sed -n 1,70p src/theme/CoverMaskProvider.tsx`로 현재 이름을 확인하고, 옮긴 파일은 `export const CoverMaskContext`, `export function useCoverMask()`를 내보낸다.

- [ ] **Step 4: import 경로 갱신**

Run:
```bash
grep -rln "useTheme\b" src --include=*.tsx | grep -v theme/ | xargs -r sed -i "s#from '\(\.\./\)*\(\.\./\)\?theme/ThemeProvider'#from '\1\2theme/themeContext'#; s#from '\./ThemeProvider'#from './themeContext'#"
grep -rln "useCoverMask\b" src --include=*.tsx | grep -v theme/ | xargs -r sed -i "s#theme/CoverMaskProvider'#theme/coverMaskContext'#"
grep -rn "useTheme\|useCoverMask" src --include=*.tsx | grep import
```
Expected: 마지막 명령의 모든 줄이 `themeContext` / `coverMaskContext`에서 import한다. `main.tsx`의 Provider import는 바뀌지 않는다.

- [ ] **Step 5: 쓰이지 않는 CSS 클래스 제거**

각 클래스를 지우기 전에 참조가 없는지 확인한다:
```bash
for c in analysis-link analysis-links analysis-card-grid analysis-brief-card tag-ranking-panel tag-rank-item tag-ranking-table \
  tag-ranking-column-guide spotlight-card featured-tag-card ranking-module metric-mini-card showcase-grid tag-feature-grid \
  notice-box ranking-info-link tag-bubble-legend contest-rank-control-bar media-row ranking-showcase-mosaic \
  author-novel-card-body tag-chart-meta-item segmented-control report-warn content-wrapper; do
  n=$(grep -rl --include=*.tsx "$c" src | wc -l); echo "$n $c"; done
```
Expected: 모두 `0`. `0`인 클래스의 규칙 블록(선택자에 그 클래스가 들어간 블록, 콤마로 묶인 경우 그 선택자만)을 `src/styles/pages.css`, `components.css`, `layout.css`, `src/index.css`에서 지운다. `pages.css`의 "코호트 곡선" 주석 블록(검색: `grep -n "코호트" src/styles/pages.css`)도 지운다.

- [ ] **Step 6: 확인**

Run: `npm run build && npm run lint 2>&1 | tail -3`
Expected: 빌드 성공. 린트 문제 수가 49에서 줄었고, `react-refresh/only-export-components` 오류가 테마 두 파일에서 사라졌다(`npx eslint src/theme` 결과 0).
Run: `scripts/shots.sh /tmp/nf-shots-t3 /novels/rankings /novels/433986` — Task 2 결과와 달라진 곳이 없어야 한다(죽은 코드만 지웠으므로).

- [ ] **Step 7: 커밋**

```bash
git add -A src/theme src/styles src/index.css src/components src/App.css 2>/dev/null; git add -u src
git commit -m "쓰이지 않는 스타일·컴포넌트를 지우고 테마 훅을 분리한다

custom.css(3,328줄)·App.css·빈 컴포넌트 6개와 참조 없는 CSS 클래스는 import되지
않거나 .tsx에서 쓰이지 않는다. 테마·표지 가리기 컨텍스트는 컴포넌트 파일에서 분리해
fast refresh 린트 오류를 없앴다.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
주의: `git add -u src`는 이 개편 전의 미커밋 수정까지 올린다. 대신 Step 2~5에서 **직접 바꾼 파일 목록**만 `git add`한다 — `git status --short`로 확인하고 필요한 파일만 고른다.

---

### Task 4: 전역 틀 — 헤더 · 푸터 · 없는 경로

**Files:**
- Modify: `src/components/Header.tsx`, `src/components/layout/AppShell.tsx`, `src/App.tsx`, `src/components/Search.tsx:85`, `src/styles/layout.css:61-200`
- Create: `src/pages/NotFoundPage.tsx`

**Interfaces:**
- Produces: 헤더 높이는 `--np-header-h`(64px). 내비 항목 4개.

- [ ] **Step 1: 헤더 내비를 4개로**

`src/components/Header.tsx`의 `NAV_LINKS`와 브랜드를 다음으로 바꾼다. "태그"는 태그 랭킹과 태그 트렌드 두 경로에서 모두 켜져야 하므로 `match`를 둔다:
```tsx
const NAV_LINKS = [
  { to: '/novels/rankings', label: '랭킹', match: ['/novels'] },
  { to: '/tags/rankings', label: '태그', match: ['/tags'] },
  { to: '/contests', label: '공모전', match: ['/contests'] },
  { to: '/trends', label: '분석', match: ['/trends'] },
];
```
`NavLink`의 `className`은 `isActive` 대신 현재 경로로 판정한다. 파일 위에 `import { NavLink, useLocation } from 'react-router-dom';`, 컴포넌트 안에:
```tsx
  const { pathname } = useLocation();
  const isOn = (match: string[]) => match.some(m => pathname === m || pathname.startsWith(m + '/'));
```
두 `NavLink` 목록(데스크톱·모바일) 모두 `className={`app-header-link${isOn(match) ? ' app-header-link--active' : ''}`}`(모바일은 `mobile-nav-link` 접두사)로 바꾼다. 브랜드 블록은:
```tsx
        <NavLink to="/" className="app-header-brand" onClick={() => setMenuOpen(false)}>NovelFlow</NavLink>
```

- [ ] **Step 2: 헤더 스타일**

`src/styles/layout.css`의 `.app-header` ~ `.app-header-mobile-menu` 규칙 중 다음 속성을 바꾼다(선택자는 유지, backdrop-filter는 쓰지 않는다):
```css
.app-header { height: var(--np-header-h); background: var(--np-canvas); border-bottom: 1px solid var(--np-border); }
.app-header-brand { font-size: 1.25rem; font-weight: 800; letter-spacing: -0.03em; color: var(--np-text-heading); text-decoration: none; }
.app-header-link {
  display: flex; align-items: center; height: var(--np-header-h); padding: 0; margin-right: 1.625rem;
  border-radius: 0; background: none; border-bottom: 2px solid transparent;
  font-size: 0.9375rem; font-weight: 600; color: var(--np-text-secondary);
}
.app-header-link--active { color: var(--np-text-heading); border-bottom-color: var(--np-text-heading); background: none; }
```
기존 규칙에 `border-radius: 999px`(알약 모양)나 배경 채움이 있으면 지운다. `.brand-icon`, `.brand-copy`, `.brand-text` 규칙은 지운다.

- [ ] **Step 3: 푸터 문구**

`src/components/layout/AppShell.tsx`의 `<footer>` 안 문구와 위 주석을 지우고 다음만 남긴다(2026-09-27 성인작 제외 해제로 문장이 틀렸다):
```tsx
      <footer className="app-footer">
        <div className="app-main-inner">
          <Link to="/data-collection-info" className="app-footer__link">수집 및 랭킹 기준</Link>
        </div>
      </footer>
```

- [ ] **Step 4: 없는 경로와 옛 경로**

`src/pages/NotFoundPage.tsx`:
```tsx
import { Link } from 'react-router-dom';

export default function NotFoundPage() {
  return (
    <div className="page-shell">
      <p className="empty-line">페이지를 찾을 수 없습니다. <Link to="/novels/rankings">일간 랭킹으로 가기</Link></p>
    </div>
  );
}
```
`src/App.tsx`: lazy import에 `const NotFoundPage = lazy(() => import('./pages/NotFoundPage'));`, `<Routes>` 맨 끝에:
```tsx
          <Route path='/trends/novels' element={<Navigate to="/novels/rankings" replace />} />
          <Route path='*' element={<NotFoundPage />} />
```
`src/styles/redesign.css`(이 태스크에서 처음 만든다)에:
```css
/* 개편(2026-09-28) 이후 공통 컴포넌트 스타일. 기존 파일 뒤에 import 된다. */
.empty-line { padding: 3rem 0; color: var(--np-text-secondary); font-size: var(--np-fs-body-lg); }
.empty-line a { color: var(--np-text-heading); text-decoration: underline; text-underline-offset: 3px; }
```
`src/styles/index.css` 끝에 `@import './redesign.css';`를 더한다.

- [ ] **Step 5: 검색 미설정 문구**

`src/components/Search.tsx`의 `"검색 기능이 설정되지 않았습니다. Algolia 인증 정보를 추가해주세요."`를 `"검색을 잠시 쓸 수 없습니다."`로 바꾼다(사용자에게 개발용 문구를 보이지 않는다).

- [ ] **Step 6: 확인**

Run: `npm run build`
Expected: 성공.
수동: dev 서버에서 `/tags/trends`를 열면 헤더의 "태그"가 켜져 있다. `/없는-주소`는 "페이지를 찾을 수 없습니다", `/trends/novels`는 `/novels/rankings/<최신일>`로 간다. 푸터에는 링크 하나만 있다.
Run: `scripts/shots.sh /tmp/nf-shots-t4 /novels/rankings` — 360px에서 햄버거 메뉴가 보이고, 1200px에서 메뉴 4개가 밑줄 방식이다.

- [ ] **Step 7: 커밋**

```bash
git add src/components/Header.tsx src/components/layout/AppShell.tsx src/App.tsx src/components/Search.tsx \
  src/styles/layout.css src/styles/redesign.css src/styles/index.css src/pages/NotFoundPage.tsx
git commit -m "헤더를 텍스트 내비 4개로 줄이고 푸터·없는 경로를 정리한다

태그 트렌드는 태그 페이지 안의 전환으로 들어가므로 내비는 랭킹·태그·공모전·분석
넷이다. 성인작 제외가 풀려 틀린 문장이 된 푸터 안내를 지우고, 알 수 없는 주소와
삭제된 /trends/novels가 빈 화면이 되지 않게 했다.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: 숫자 표기 · 순위 변동 유틸과 ChangeMark

**Files:**
- Create: `src/utils/format.ts`, `src/utils/format.test.ts`, `src/utils/rankChange.ts`, `src/utils/rankChange.test.ts`, `src/components/ui/ChangeMark.tsx`
- Modify: `src/styles/redesign.css`

**Interfaces:**
- Produces:
  - `DASH: '–'`, `formatInt(n?: number | null): string`, `formatMan(n?: number | null): string`, `formatRatio(v?: number | null, digits?: number): string`, `formatDateDot(iso: string): string`, `formatDateKo(iso: string): string`
  - `type RankChangeValue = number | 'New' | null | undefined`, `type RankChangeKind = 'up' | 'down' | 'same' | 'new' | 'none'`, `describeRankChange(v: RankChangeValue): { kind: RankChangeKind; text: string; label: string }`
  - `<ChangeMark value={RankChangeValue} />`

- [ ] **Step 1: 실패하는 테스트**

`src/utils/format.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { DASH, formatDateDot, formatDateKo, formatInt, formatMan, formatRatio } from './format';

describe('formatInt', () => {
  it('천 단위 쉼표', () => expect(formatInt(7845354)).toBe('7,845,354'));
  it('없는 값은 대시', () => {
    expect(formatInt(null)).toBe(DASH);
    expect(formatInt(undefined)).toBe(DASH);
    expect(formatInt(Number.NaN)).toBe(DASH);
  });
});

describe('formatMan', () => {
  it('1만 미만은 그대로', () => expect(formatMan(9999)).toBe('9,999'));
  it('1만~100만은 소수 한 자리 만', () => {
    expect(formatMan(433801)).toBe('43.4만');
    expect(formatMan(100000)).toBe('10만');
  });
  it('100만 이상은 정수 만', () => expect(formatMan(7845354)).toBe('785만'));
  it('1억 이상은 억', () => {
    expect(formatMan(115510888)).toBe('1.2억');
    expect(formatMan(300000000)).toBe('3억');
  });
  it('없는 값은 대시', () => expect(formatMan(null)).toBe(DASH));
});

describe('formatRatio', () => {
  it('비율을 퍼센트로', () => {
    expect(formatRatio(0.06452, 2)).toBe('6.45%');
    expect(formatRatio(0.66)).toBe('66.0%');
  });
  it('없는 값은 대시', () => expect(formatRatio(null)).toBe(DASH));
});

describe('날짜', () => {
  it('점 표기', () => expect(formatDateDot('2026-09-27')).toBe('2026.09.27'));
  it('한국어 월일', () => expect(formatDateKo('2026-09-07')).toBe('9월 7일'));
});
```
`src/utils/rankChange.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { describeRankChange } from './rankChange';

describe('describeRankChange', () => {
  it('상승', () => expect(describeRankChange(135)).toEqual({ kind: 'up', text: '▲135', label: '135계단 상승' }));
  it('하락', () => expect(describeRankChange(-2)).toEqual({ kind: 'down', text: '▼2', label: '2계단 하락' }));
  it('변동 없음', () => expect(describeRankChange(0)).toEqual({ kind: 'same', text: '–', label: '변동 없음' }));
  it('신규', () => expect(describeRankChange('New')).toEqual({ kind: 'new', text: 'NEW', label: '신규 진입' }));
  it('기록 없음은 변동 없음과 다르다', () => {
    expect(describeRankChange(undefined)).toEqual({ kind: 'none', text: '', label: '비교할 전일 기록 없음' });
    expect(describeRankChange(null).kind).toBe('none');
  });
  it('큰 수는 쉼표', () => expect(describeRankChange(1200).text).toBe('▲1,200'));
});
```
Run: `npm test`
Expected: FAIL — `Failed to resolve import "./format"`.

- [ ] **Step 2: 구현**

`src/utils/format.ts`:
```ts
/** 화면 표기 규칙(스펙 §3.3). 없는 값은 모두 DASH. */
export const DASH = '–';

const isNum = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
const trimZero = (s: string) => s.replace(/\.0$/, '');

export const formatInt = (n?: number | null): string => (isNum(n) ? n.toLocaleString('ko-KR') : DASH);

/** 표 밖(쇼케이스·한 줄 수치)에서 쓰는 큰 수 표기. 표 안에서는 formatInt. */
export const formatMan = (n?: number | null): string => {
  if (!isNum(n)) return DASH;
  if (n >= 1e8) return `${trimZero((n / 1e8).toFixed(1))}억`;
  if (n >= 1e6) return `${Math.round(n / 1e4).toLocaleString('ko-KR')}만`;
  if (n >= 1e4) return `${trimZero((n / 1e4).toFixed(1))}만`;
  return n.toLocaleString('ko-KR');
};

export const formatRatio = (v?: number | null, digits = 1): string => (isNum(v) ? `${(v * 100).toFixed(digits)}%` : DASH);

export const formatDateDot = (iso: string): string => iso.replaceAll('-', '.');

export const formatDateKo = (iso: string): string => {
  const [, m, d] = iso.split('-');
  return `${Number(m)}월 ${Number(d)}일`;
};
```
`src/utils/rankChange.ts`:
```ts
export type RankChangeValue = number | 'New' | null | undefined;
export type RankChangeKind = 'up' | 'down' | 'same' | 'new' | 'none';

export interface RankChangeView {
  kind: RankChangeKind;
  text: string;
  /** 화면 읽기·툴팁용 문장 */
  label: string;
}

/** `rank_change`(전일 순위 − 오늘 순위, 양수 = 상승)를 표기로 바꾼다.
 *  0(변동 없음)과 값 없음(전일 기록 없음)을 구분한다 — 같은 기호로 뭉뚱그리지 않는다. */
export function describeRankChange(value: RankChangeValue): RankChangeView {
  if (value === 'New') return { kind: 'new', text: 'NEW', label: '신규 진입' };
  if (typeof value !== 'number' || !Number.isFinite(value)) return { kind: 'none', text: '', label: '비교할 전일 기록 없음' };
  if (value === 0) return { kind: 'same', text: '–', label: '변동 없음' };
  const n = Math.abs(value).toLocaleString('ko-KR');
  return value > 0
    ? { kind: 'up', text: `▲${n}`, label: `${n}계단 상승` }
    : { kind: 'down', text: `▼${n}`, label: `${n}계단 하락` };
}
```
`src/components/ui/ChangeMark.tsx`:
```tsx
import { describeRankChange, type RankChangeValue } from '../../utils/rankChange';

export default function ChangeMark({ value }: { value: RankChangeValue }) {
  const v = describeRankChange(value);
  return (
    <span className={`change-mark change-mark--${v.kind}`} title={v.label} aria-label={v.label}>
      {v.text}
    </span>
  );
}
```
`src/styles/redesign.css`에 추가:
```css
.change-mark { font-size: 0.78rem; font-weight: 700; white-space: nowrap; font-variant-numeric: tabular-nums; }
.change-mark--up { color: var(--np-rank-up); }
.change-mark--down { color: var(--np-rank-down); }
.change-mark--same { color: var(--np-text-faint); }
.change-mark--new { color: var(--np-new-text); font-size: 0.72rem; letter-spacing: 0.02em; }
```

- [ ] **Step 3: 테스트 통과 확인**

Run: `npm test`
Expected: `format.test.ts`, `rankChange.test.ts` 모두 PASS.

- [ ] **Step 4: 커밋**

```bash
git add src/utils/format.ts src/utils/format.test.ts src/utils/rankChange.ts src/utils/rankChange.test.ts src/components/ui/ChangeMark.tsx src/styles/redesign.css
git commit -m "숫자·날짜·순위 변동 표기를 한 곳에 모은다

페이지마다 따로 있던 toLocaleString·퍼센트·만 단위 변환과 두 벌의
RankChangeIndicator를 대체한다. 변동 없음(0)과 전일 기록 없음을 다른 표기로 둔다.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: 랭킹 필터·정렬을 순수 함수로

**Files:**
- Create: `src/utils/rankingQuery.ts`, `src/utils/rankingQuery.test.ts`

**Interfaces:**
- Consumes: `evaluateAdvancedRule(rule: string, tags: string[]): boolean` (`src/utils/tagFilter.ts`, 식이 틀리면 throw)
- Produces:
```ts
interface RankingNovel { ID: string; Ranking: number; Title: string; AuthorName: string; AuthorID?: number | string | null;
  Score: number; Eps: number; Tags: string[]; rank_change?: number | 'New'; View?: number; Like?: number;
  EarlyRetentionRate?: number | null; RecentRetentionRate?: number | null; like_to_view_ratio?: number; ThumbnailURL?: string | null; }
type TagMode = 'include-and' | 'include-or' | 'exclude';
type RankingView = 'all' | 'rising' | 'new';
interface RankingFilter { view: RankingView; search: string; minEps: number | null; maxEps: number | null; tagMode: TagMode; tags: string[]; rule: string; }
const EMPTY_FILTER: RankingFilter;
type SortKey = 'Ranking' | 'rank_change' | 'Score' | 'Eps' | 'like_to_view_ratio' | 'EarlyRetentionRate' | 'RecentRetentionRate';
interface SortConfig { key: SortKey; direction: 'ascending' | 'descending'; }
const DEFAULT_SORT: SortConfig;
function normalizeNovels(items: RankingNovel[]): RankingNovel[];         // like_to_view_ratio 계산
function applyRankingFilter(items: RankingNovel[], f: RankingFilter): { items: RankingNovel[]; error: string | null };
function sortRankings(items: RankingNovel[], s: SortConfig): RankingNovel[];
function nextSort(current: SortConfig, key: SortKey): SortConfig;
function tagCounts(items: RankingNovel[]): Array<{ tag: string; count: number }>;
function activeFilterCount(f: RankingFilter): number;
function toggleTag(f: RankingFilter, tag: string): RankingFilter;
```

- [ ] **Step 1: 실패하는 테스트**

`src/utils/rankingQuery.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import {
  EMPTY_FILTER, DEFAULT_SORT, activeFilterCount, applyRankingFilter, nextSort, normalizeNovels,
  sortRankings, tagCounts, toggleTag, type RankingNovel,
} from './rankingQuery';

const n = (o: Partial<RankingNovel> & { ID: string; Ranking: number }): RankingNovel => ({
  Title: `작품${o.ID}`, AuthorName: `작가${o.ID}`, Score: 1000 - o.Ranking, Eps: 100, Tags: [], ...o,
});
const rows = [
  n({ ID: '1', Ranking: 1, Tags: ['판타지', '하렘'], rank_change: 0, Eps: 121 }),
  n({ ID: '2', Ranking: 2, Tags: ['판타지'], rank_change: 'New', Eps: 26, Title: '초월자 티어표' }),
  n({ ID: '3', Ranking: 3, Tags: ['현대', 'BL'], rank_change: -1, Eps: 315, AuthorName: '쉼게지는꽃' }),
  n({ ID: '4', Ranking: 4, Tags: ['하렘'], rank_change: 12, Eps: 60, EarlyRetentionRate: null }),
];

describe('applyRankingFilter', () => {
  it('빈 필터는 그대로', () => expect(applyRankingFilter(rows, EMPTY_FILTER).items).toHaveLength(4));
  it('태그 모두 포함', () => {
    const r = applyRankingFilter(rows, { ...EMPTY_FILTER, tags: ['판타지', '하렘'] });
    expect(r.items.map(x => x.ID)).toEqual(['1']);
  });
  it('태그 하나라도 포함', () => {
    const r = applyRankingFilter(rows, { ...EMPTY_FILTER, tagMode: 'include-or', tags: ['현대', '하렘'] });
    expect(r.items.map(x => x.ID)).toEqual(['1', '3', '4']);
  });
  it('태그 제외', () => {
    const r = applyRankingFilter(rows, { ...EMPTY_FILTER, tagMode: 'exclude', tags: ['BL'] });
    expect(r.items.map(x => x.ID)).toEqual(['1', '2', '4']);
  });
  it('조건식이 있으면 태그 선택보다 우선', () => {
    const r = applyRankingFilter(rows, { ...EMPTY_FILTER, tags: ['BL'], rule: '판타지 AND NOT 하렘' });
    expect(r.items.map(x => x.ID)).toEqual(['2']);
    expect(r.error).toBeNull();
  });
  it('틀린 조건식은 빈 결과와 오류 문장', () => {
    const r = applyRankingFilter(rows, { ...EMPTY_FILTER, rule: '(판타지 AND 하렘' });
    expect(r.items).toEqual([]);
    expect(r.error).toMatch(/^조건식 오류/);
  });
  it('검색은 제목·작가, 대소문자 무시', () => {
    expect(applyRankingFilter(rows, { ...EMPTY_FILTER, search: '티어표' }).items.map(x => x.ID)).toEqual(['2']);
    expect(applyRankingFilter(rows, { ...EMPTY_FILTER, search: '쉼게' }).items.map(x => x.ID)).toEqual(['3']);
  });
  it('회차 범위', () => {
    const r = applyRankingFilter(rows, { ...EMPTY_FILTER, minEps: 50, maxEps: 200 });
    expect(r.items.map(x => x.ID)).toEqual(['1', '4']);
  });
  it('급상승 보기는 상승한 작품만', () => {
    expect(applyRankingFilter(rows, { ...EMPTY_FILTER, view: 'rising' }).items.map(x => x.ID)).toEqual(['4']);
  });
  it('신규 보기는 NEW만', () => {
    expect(applyRankingFilter(rows, { ...EMPTY_FILTER, view: 'new' }).items.map(x => x.ID)).toEqual(['2']);
  });
});

describe('sortRankings', () => {
  it('기본은 순위 오름차순', () => expect(sortRankings([...rows].reverse(), DEFAULT_SORT).map(x => x.ID)).toEqual(['1', '2', '3', '4']));
  it('변동 내림차순: NEW가 맨 위, 기록 없음이 맨 아래', () => {
    const withNone = [...rows, n({ ID: '5', Ranking: 5 })];
    const r = sortRankings(withNone, { key: 'rank_change', direction: 'descending' });
    expect(r.map(x => x.ID)).toEqual(['2', '4', '1', '3', '5']);
  });
  it('값이 없는 행은 방향과 무관하게 맨 아래', () => {
    const r = sortRankings(rows, { key: 'EarlyRetentionRate', direction: 'ascending' });
    expect(r.at(-1)?.ID).toBe('4');
  });
});

describe('nextSort', () => {
  it('같은 열을 다시 누르면 방향이 바뀐다', () =>
    expect(nextSort({ key: 'Eps', direction: 'descending' }, 'Eps')).toEqual({ key: 'Eps', direction: 'ascending' }));
  it('새 열은 내림차순부터(순위만 오름차순)', () => {
    expect(nextSort(DEFAULT_SORT, 'Eps')).toEqual({ key: 'Eps', direction: 'descending' });
    expect(nextSort({ key: 'Eps', direction: 'descending' }, 'Ranking')).toEqual(DEFAULT_SORT);
  });
});

describe('보조 함수', () => {
  it('normalizeNovels가 추천비를 계산', () => {
    const [x] = normalizeNovels([n({ ID: '9', Ranking: 9, View: 1000, Like: 64 })]);
    expect(x.like_to_view_ratio).toBeCloseTo(0.064);
  });
  it('tagCounts는 많은 순, 같으면 가나다', () =>
    expect(tagCounts(rows).slice(0, 3)).toEqual([{ tag: '판타지', count: 2 }, { tag: '하렘', count: 2 }, { tag: 'BL', count: 1 }].sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag, 'ko'))));
  it('activeFilterCount는 태그 수 + 회차 1', () => {
    expect(activeFilterCount(EMPTY_FILTER)).toBe(0);
    expect(activeFilterCount({ ...EMPTY_FILTER, tags: ['a', 'b'], minEps: 10 })).toBe(3);
    expect(activeFilterCount({ ...EMPTY_FILTER, tags: ['a'], rule: 'x OR y' })).toBe(1);
  });
  it('toggleTag는 조건식을 비우고 태그를 넣고 뺀다', () => {
    const f = toggleTag({ ...EMPTY_FILTER, rule: 'a' }, '판타지');
    expect(f).toMatchObject({ rule: '', tags: ['판타지'] });
    expect(toggleTag(f, '판타지').tags).toEqual([]);
  });
});
```
Run: `npm test`
Expected: FAIL — `Failed to resolve import "./rankingQuery"`.

- [ ] **Step 2: 구현**

`src/utils/rankingQuery.ts`:
```ts
import { evaluateAdvancedRule } from './tagFilter';

/** 일간 랭킹 API(`/api/ranks/novels/{date}`) 한 행. 공모전은 계획 2에서 이것을 확장한다. */
export interface RankingNovel {
  ID: string;
  Ranking: number;
  Title: string;
  AuthorName: string;
  AuthorID?: number | string | null;
  Score: number;
  Eps: number;
  Tags: string[];
  rank_change?: number | 'New';
  View?: number;
  Like?: number;
  EarlyRetentionRate?: number | null;
  RecentRetentionRate?: number | null;
  like_to_view_ratio?: number;
  ThumbnailURL?: string | null;
}

export type TagMode = 'include-and' | 'include-or' | 'exclude';
export type RankingView = 'all' | 'rising' | 'new';

/** 적용된 필터. `rule`이 비어 있지 않으면 `tags`/`tagMode` 대신 조건식으로 거른다. */
export interface RankingFilter {
  view: RankingView;
  search: string;
  minEps: number | null;
  maxEps: number | null;
  tagMode: TagMode;
  tags: string[];
  rule: string;
}

export const EMPTY_FILTER: RankingFilter = {
  view: 'all', search: '', minEps: null, maxEps: null, tagMode: 'include-and', tags: [], rule: '',
};

export type SortKey = 'Ranking' | 'rank_change' | 'Score' | 'Eps' | 'like_to_view_ratio' | 'EarlyRetentionRate' | 'RecentRetentionRate';
export interface SortConfig { key: SortKey; direction: 'ascending' | 'descending'; }
export const DEFAULT_SORT: SortConfig = { key: 'Ranking', direction: 'ascending' };

export const normalizeNovels = (items: RankingNovel[]): RankingNovel[] => items.map(x => ({
  ...x,
  Tags: x.Tags || [],
  like_to_view_ratio: x.View && x.View > 0 ? (x.Like ?? 0) / x.View : (x.like_to_view_ratio ?? 0),
}));

export function applyRankingFilter(items: RankingNovel[], f: RankingFilter): { items: RankingNovel[]; error: string | null } {
  let out = items;
  if (f.view === 'rising') out = out.filter(x => typeof x.rank_change === 'number' && x.rank_change > 0);
  if (f.view === 'new') out = out.filter(x => x.rank_change === 'New');

  if (f.rule.trim()) {
    try {
      out = out.filter(x => evaluateAdvancedRule(f.rule, x.Tags || []));
    } catch (e) {
      return { items: [], error: `조건식 오류: ${e instanceof Error ? e.message : '잘못된 구문입니다'}` };
    }
  } else if (f.tags.length > 0) {
    const has = (x: RankingNovel, t: string) => (x.Tags || []).includes(t);
    if (f.tagMode === 'include-and') out = out.filter(x => f.tags.every(t => has(x, t)));
    else if (f.tagMode === 'include-or') out = out.filter(x => f.tags.some(t => has(x, t)));
    else out = out.filter(x => !f.tags.some(t => has(x, t)));
  }

  const q = f.search.trim().toLowerCase();
  if (q) out = out.filter(x => x.Title.toLowerCase().includes(q) || x.AuthorName.toLowerCase().includes(q));
  if (f.minEps !== null) { const min = f.minEps; out = out.filter(x => x.Eps >= min); }
  if (f.maxEps !== null) { const max = f.maxEps; out = out.filter(x => x.Eps <= max); }
  return { items: out, error: null };
}

export function sortRankings(items: RankingNovel[], s: SortConfig): RankingNovel[] {
  const dir = s.direction === 'ascending' ? 1 : -1;
  return [...items].sort((a, b) => {
    if (s.key === 'rank_change') {
      const v = (x: RankingNovel['rank_change']) => (x === 'New' ? Infinity : typeof x === 'number' ? x : -Infinity);
      const va = v(a.rank_change);
      const vb = v(b.rank_change);
      if (va === vb) return a.Ranking - b.Ranking;
      if (va === -Infinity) return 1;
      if (vb === -Infinity) return -1;
      return va < vb ? -dir : dir;
    }
    const av = a[s.key];
    const bv = b[s.key];
    if (av == null) return 1;
    if (bv == null) return -1;
    if (av < bv) return -dir;
    if (av > bv) return dir;
    return a.Ranking - b.Ranking;
  });
}

export function nextSort(current: SortConfig, key: SortKey): SortConfig {
  if (current.key === key) return { key, direction: current.direction === 'ascending' ? 'descending' : 'ascending' };
  return { key, direction: key === 'Ranking' ? 'ascending' : 'descending' };
}

export function tagCounts(items: RankingNovel[]): Array<{ tag: string; count: number }> {
  const m = new Map<string, number>();
  for (const x of items) for (const t of new Set(x.Tags || [])) m.set(t, (m.get(t) ?? 0) + 1);
  return [...m].map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag, 'ko'));
}

export function activeFilterCount(f: RankingFilter): number {
  const tagPart = f.rule.trim() ? 1 : f.tags.length;
  const epsPart = f.minEps !== null || f.maxEps !== null ? 1 : 0;
  return tagPart + epsPart;
}

export function toggleTag(f: RankingFilter, tag: string): RankingFilter {
  const tags = f.tags.includes(tag) ? f.tags.filter(t => t !== tag) : [...f.tags, tag];
  return { ...f, rule: '', tags };
}
```
주의(기존 동작과의 차이): 이전 `requestSort`는 순위 오름차순 상태에서 점수를 누르면 점수 **오름차순**으로 시작했고, 변동 정렬에서 기록 없음이 방향에 따라 위로 올라갔다. 두 동작 모두 의도가 기록돼 있지 않아 "새 열은 내림차순, 값 없는 행은 항상 아래"로 통일했다 — Task 15에서 DECISIONS에 적는다.

- [ ] **Step 3: 테스트 통과 확인**

Run: `npm test`
Expected: rankingQuery의 모든 테스트 PASS.

- [ ] **Step 4: 커밋**

```bash
git add src/utils/rankingQuery.ts src/utils/rankingQuery.test.ts
git commit -m "랭킹 필터·정렬을 페이지 밖 순수 함수로 뺀다

NovelRankingsPage 안에 있던 태그 모드 3종·조건식·검색·회차 필터와 정렬을
그대로 옮겨 테스트로 고정한다. 공모전 페이지가 같은 로직을 복사해 쓰고 있어
계획 2에서 이 모듈로 합친다. 정렬은 '새 열은 내림차순, 값 없는 행은 항상 아래'로
통일했다.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: 범용 UI 조각 — PageTitle · DateNav · TabBar · InlineNums · Footnotes · TagLinks · Sparkline

**Files:**
- Create: `src/components/ui/PageTitle.tsx`, `DateNav.tsx`, `TabBar.tsx`, `InlineNums.tsx`, `Footnotes.tsx`, `TagLinks.tsx`, `Sparkline.tsx`, `src/utils/sparkline.ts`, `src/utils/sparkline.test.ts`
- Modify: `src/components/CalendarPicker.tsx`, `src/styles/redesign.css`

**Interfaces:**
- Produces:
  - `<PageTitle title nav? aside? meta? />`
  - `<DateNav value={string | null} availableDates={Set<string>} onChange={(iso: string) => void} />`
  - `interface TabItem<K extends string> { key: K; label: string; count?: number }`, `<TabBar<K> items value onChange ariaLabel>{tools?}</TabBar>`
  - `interface InlineNum { label: ReactNode; value: ReactNode }`, `<InlineNums items={InlineNum[]} />`
  - `<Footnotes notes={ReactNode[]} />` (①②③… 순서)
  - `<TagLinks tags highlighted? limit? onSelect? hrefFor? />`
  - `rankPath(ranks: (number | null)[], width: number, height: number, pad?: number): { d: string; last: Point | null; best: Point & { rank: number } | null }`, `<Sparkline ranks width height showBest? />`
  - `CalendarPicker`에 `variant?: 'field' | 'inline'` prop 추가(기본 `'field'` — 기존 사용처 영향 없음)

- [ ] **Step 1: 순위선 경로 테스트(실패)**

`src/utils/sparkline.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { rankPath } from './sparkline';

describe('rankPath', () => {
  it('1위가 위, 큰 순위가 아래', () => {
    const r = rankPath([10, 1], 100, 50, 0);
    expect(r.d.startsWith('M0.0,')).toBe(true);
    const ys = [...r.d.matchAll(/[ML][\d.]+,([\d.]+)/g)].map(m => Number(m[1]));
    expect(ys[0]).toBeGreaterThan(ys[1]);
  });
  it('순위권 밖(null)에서 선이 끊긴다', () => {
    const r = rankPath([5, null, 3, 2], 90, 30);
    expect(r.d.match(/M/g)).toHaveLength(2);
  });
  it('마지막 점과 최고 순위 점', () => {
    const r = rankPath([30, 4, 8], 80, 40);
    expect(r.best?.rank).toBe(4);
    expect(r.last).not.toBeNull();
  });
  it('값이 하나도 없으면 빈 경로', () => {
    expect(rankPath([null, null], 50, 20)).toEqual({ d: '', last: null, best: null });
  });
});
```
Run: `npm test` → Expected: FAIL(`./sparkline` 없음).

- [ ] **Step 2: 순위선 경로 구현**

`src/utils/sparkline.ts`:
```ts
export interface Point { x: number; y: number; }

/** 순위 배열(1 = 최고, null = 순위권 밖)을 SVG 경로로. null에서 선을 끊는다. */
export function rankPath(ranks: (number | null)[], width: number, height: number, pad = 4) {
  const vals = ranks.filter((r): r is number => r != null);
  if (vals.length === 0) return { d: '', last: null as Point | null, best: null as (Point & { rank: number }) | null };
  const lo = Math.min(...vals);
  const hi = Math.max(...vals);
  const span = hi === lo ? 1 : hi - lo;
  const X = (i: number) => (ranks.length === 1 ? width / 2 : pad + (i / (ranks.length - 1)) * (width - 2 * pad));
  const Y = (r: number) => pad + ((r - lo) / span) * (height - 2 * pad);
  let d = '';
  let pen = false;
  let last: Point | null = null;
  let best: (Point & { rank: number }) | null = null;
  ranks.forEach((r, i) => {
    if (r == null) { pen = false; return; }
    const p = { x: X(i), y: Y(r) };
    d += `${pen ? 'L' : 'M'}${p.x.toFixed(1)},${p.y.toFixed(1)}`;
    pen = true;
    last = p;
    if (!best || r < best.rank) best = { ...p, rank: r };
  });
  return { d, last, best };
}
```
Run: `npm test` → Expected: PASS.

- [ ] **Step 3: 컴포넌트 작성**

`src/components/ui/Sparkline.tsx`:
```tsx
import { rankPath } from '../../utils/sparkline';

interface SparklineProps { ranks: (number | null)[]; width: number; height: number; showBest?: boolean; label: string; }

export default function Sparkline({ ranks, width, height, showBest = false, label }: SparklineProps) {
  const { d, last, best } = rankPath(ranks, width, height);
  if (!d) return <span className="sparkline sparkline--empty">{label}</span>;
  return (
    <svg className="sparkline" width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label}>
      <path d={d} fill="none" stroke="var(--np-accent)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
      {showBest && best ? (
        <>
          <circle cx={best.x} cy={best.y} r={3.5} fill="var(--np-accent)" />
          <text x={best.x} y={Math.max(10, best.y - 8)} textAnchor="middle" className="sparkline__label">{best.rank}위</text>
        </>
      ) : null}
      {last ? <circle cx={last.x} cy={last.y} r={4} fill="var(--np-canvas)" stroke="var(--np-accent)" strokeWidth={2} /> : null}
    </svg>
  );
}
```
`src/components/ui/PageTitle.tsx`:
```tsx
import type { ReactNode } from 'react';

interface PageTitleProps { title: ReactNode; nav?: ReactNode; aside?: ReactNode; meta?: ReactNode; }

/** 페이지 제목 줄. meta는 설명이 아니라 데이터 한 줄(예: 밤 9시 · 노벨피아 7일 조회순 상위 500). */
export default function PageTitle({ title, nav, aside, meta }: PageTitleProps) {
  return (
    <header className="page-title">
      <div className="page-title__row">
        <h1 className="page-title__h">{title}</h1>
        {nav ? <div className="page-title__nav">{nav}</div> : null}
        {aside ? <div className="page-title__aside">{aside}</div> : null}
      </div>
      {meta ? <p className="page-title__meta">{meta}</p> : null}
    </header>
  );
}
```
`src/components/CalendarPicker.tsx` — `variant` 추가:
```tsx
interface CalendarPickerProps {
  selectedDate: Date | null;
  onDateChange: (date: Date | null) => void;
  availableDates: Set<string>;
  highlightDates?: Date[];
  /** 'inline'은 제목 옆 날짜(점선 밑줄 글자)로 보인다. */
  variant?: 'field' | 'inline';
}

const CustomDateDisplay = forwardRef<HTMLDivElement, { value?: string; onClick?: () => void; className?: string }>(({ value, onClick, className }, ref) => (
  <div className={className ?? 'form-control'} onClick={onClick} ref={ref} role="button" tabIndex={0}
    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick?.(); } }}
    style={{ cursor: 'pointer' }}>
    {value || <span className="text-muted">날짜 선택</span>}
  </div>
));
```
컴포넌트 시그니처에 `variant = 'field'`를 받고, `inline`이면 아이콘을 그리지 않고 `dateFormat="yyyy.MM.dd"`, `customInput={<CustomDateDisplay className="date-nav__date" />}`를 쓴다:
```tsx
const CalendarPicker: React.FC<CalendarPickerProps> = ({ selectedDate, onDateChange, availableDates, highlightDates, variant = 'field' }) => {
  // ...기존 상태·useMemo·handler 그대로...
  const inline = variant === 'inline';
  return (
    <div className={inline ? 'date-picker-wrapper date-picker-wrapper--inline' : 'date-picker-wrapper'} onClick={(e) => { if (e.target === e.currentTarget) handleToggle(); }}>
      {inline ? null : <CalendarEvent className="date-picker-icon" />}
      <DatePicker
        /* ...기존 props 그대로... */
        dateFormat={inline ? 'yyyy.MM.dd' : 'yyyy-MM-dd'}
        customInput={<CustomDateDisplay className={inline ? 'date-nav__date' : undefined} />}
      />
    </div>
  );
};
```
`src/components/ui/DateNav.tsx`:
```tsx
import { useMemo } from 'react';
import { format, parseISO } from 'date-fns';
import CalendarPicker from '../CalendarPicker';

interface DateNavProps { value: string | null; availableDates: Set<string>; onChange: (iso: string) => void; }

/** ‹ 2026.09.27 › — 화살표는 인접한 수집일로, 날짜를 누르면 달력(수집된 날만). */
export default function DateNav({ value, availableDates, onChange }: DateNavProps) {
  const sorted = useMemo(() => [...availableDates].sort(), [availableDates]);
  const i = value ? sorted.indexOf(value) : -1;
  const prev = i > 0 ? sorted[i - 1] : null;
  const next = i >= 0 && i < sorted.length - 1 ? sorted[i + 1] : null;
  return (
    <div className="date-nav">
      <button type="button" className="date-nav__step" disabled={!prev} onClick={() => prev && onChange(prev)} aria-label="이전 수집일">‹</button>
      <CalendarPicker variant="inline" selectedDate={value ? parseISO(value) : null} availableDates={availableDates}
        onDateChange={(d) => { if (d) onChange(format(d, 'yyyy-MM-dd')); }} />
      <button type="button" className="date-nav__step" disabled={!next} onClick={() => next && onChange(next)} aria-label="다음 수집일">›</button>
    </div>
  );
}
```
`src/components/ui/TabBar.tsx`:
```tsx
import type { ReactNode } from 'react';

export interface TabItem<K extends string> { key: K; label: string; count?: number; }

interface TabBarProps<K extends string> { items: TabItem<K>[]; value: K; onChange: (key: K) => void; ariaLabel: string; children?: ReactNode; }

export default function TabBar<K extends string>({ items, value, onChange, ariaLabel, children }: TabBarProps<K>) {
  return (
    <div className="tab-bar">
      <div className="tab-bar__tabs" role="tablist" aria-label={ariaLabel}>
        {items.map(t => (
          <button key={t.key} type="button" role="tab" aria-selected={t.key === value}
            className={`tab-bar__tab${t.key === value ? ' is-on' : ''}`} onClick={() => onChange(t.key)}>
            {t.label}{t.count != null ? <span className="tab-bar__count">{t.count}</span> : null}
          </button>
        ))}
      </div>
      {children ? <div className="tab-bar__tools">{children}</div> : null}
    </div>
  );
}
```
`src/components/ui/InlineNums.tsx`:
```tsx
import type { ReactNode } from 'react';

export interface InlineNum { label: ReactNode; value: ReactNode; }

/** 큰 숫자 타일 대신 쓰는 한 줄 수치: 조회 72.2만 | 추천 3.6만 */
export default function InlineNums({ items }: { items: InlineNum[] }) {
  return (
    <p className="inline-nums">
      {items.map((it, i) => <span key={i} className="inline-nums__item">{it.label}<b>{it.value}</b></span>)}
    </p>
  );
}
```
`src/components/ui/Footnotes.tsx`:
```tsx
import type { ReactNode } from 'react';

const MARKS = '①②③④⑤⑥⑦⑧⑨';

/** 산식·해명은 헤딩 아래가 아니라 여기(표·섹션 끝)에만 둔다. */
export default function Footnotes({ notes }: { notes: ReactNode[] }) {
  return (
    <ol className="footnotes">
      {notes.map((n, i) => <li key={i}><span className="footnotes__mark" aria-hidden="true">{MARKS[i]}</span>{n}</li>)}
    </ol>
  );
}
```
`src/components/ui/TagLinks.tsx`:
```tsx
import { Link } from 'react-router-dom';

interface TagLinksProps {
  tags: string[];
  highlighted?: ReadonlySet<string>;
  limit?: number;
  /** 누르면 필터에 추가(표 안). hrefFor가 있으면 그 주소로 이동(상세 등). */
  onSelect?: (tag: string) => void;
  hrefFor?: (tag: string) => string;
}

export default function TagLinks({ tags, highlighted, limit = 3, onSelect, hrefFor }: TagLinksProps) {
  const shown = tags.slice(0, limit);
  const rest = tags.length - shown.length;
  return (
    <span className="tag-links">
      {shown.map(t => {
        const cls = `tag-links__tag${highlighted?.has(t) ? ' is-hit' : ''}`;
        if (hrefFor) return <Link key={t} to={hrefFor(t)} className={cls}>#{t}</Link>;
        return (
          <button key={t} type="button" className={cls}
            onClick={(e) => { e.stopPropagation(); onSelect?.(t); }} aria-pressed={highlighted?.has(t) ?? false}>#{t}</button>
        );
      })}
      {rest > 0 ? <span className="tag-links__more" title={tags.slice(limit).join(', ')}>+{rest}</span> : null}
    </span>
  );
}
```
`src/styles/redesign.css`에 추가:
```css
.page-title { padding: 2rem 0 0; }
.page-title__row { display: flex; align-items: flex-end; gap: 1.25rem; flex-wrap: wrap; }
.page-title__h { font-size: var(--np-fs-title-md); font-weight: 800; letter-spacing: -0.03em; line-height: 1.15; }
.page-title__nav { padding-bottom: 0.2rem; }
.page-title__aside { margin-left: auto; padding-bottom: 0.3rem; font-size: var(--np-fs-body); color: var(--np-text-secondary); }
.page-title__meta { margin-top: 0.4rem; font-size: var(--np-fs-meta); color: var(--np-text-faint); }

.date-nav { display: flex; align-items: center; gap: 0.6rem; }
.date-nav__step { width: 28px; height: 28px; border-radius: 50%; border: 0; background: var(--np-surface-alt); color: var(--np-text-heading); font-weight: 700; line-height: 1; }
.date-nav__step:disabled { color: var(--np-text-faint); opacity: 0.6; }
.date-picker-wrapper--inline .date-picker-icon { display: none; }
.date-nav__date { font-size: 0.9375rem; font-weight: 700; color: var(--np-text-heading); border-bottom: 1.5px dashed var(--np-text-faint); padding: 0 0 1px; }

.tab-bar { display: flex; align-items: flex-end; gap: 1.375rem; border-bottom: 1px solid var(--np-border); margin-top: 1.25rem; flex-wrap: wrap; }
.tab-bar__tabs { display: flex; gap: 1.375rem; }
.tab-bar__tab { padding: 0 0 0.75rem; margin-bottom: -1px; border: 0; background: none; border-bottom: 2px solid transparent; font-size: 0.9375rem; font-weight: 600; color: var(--np-text-secondary); white-space: nowrap; }
.tab-bar__tab.is-on { color: var(--np-text-heading); border-bottom-color: var(--np-accent); }
.tab-bar__count { margin-left: 0.2rem; font-size: 0.75rem; color: var(--np-text-faint); }
.tab-bar__tools { margin-left: auto; display: flex; align-items: center; gap: 1rem; padding-bottom: 0.55rem; }

.inline-nums { font-size: 0.9375rem; color: var(--np-text-secondary); }
.inline-nums__item b { margin-left: 0.25rem; color: var(--np-text-heading); font-weight: 700; }
.inline-nums__item + .inline-nums__item::before { content: ""; display: inline-block; width: 1px; height: 12px; background: var(--np-border-strong); margin: 0 0.875rem; vertical-align: -1px; }

.footnotes { margin: 0; padding: 0.875rem 0 1.5rem; list-style: none; font-size: 0.78rem; line-height: 1.8; color: var(--np-text-secondary); }
.footnotes__mark { margin-right: 0.3rem; color: var(--np-text-faint); }

.tag-links { font-size: 0.8125rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; display: block; }
.tag-links__tag { margin-right: 0.5rem; padding: 0; border: 0; background: none; color: var(--np-text-secondary); font: inherit; }
.tag-links__tag:hover { color: var(--np-text-heading); text-decoration: underline; }
.tag-links__tag.is-hit { color: var(--np-rank-up); font-weight: 700; }
.tag-links__more { color: var(--np-text-faint); }

.sparkline { display: block; overflow: visible; }
.sparkline__label { font-size: 11px; font-weight: 700; fill: var(--np-text-heading); }
.sparkline--empty { font-size: var(--np-fs-meta); color: var(--np-text-faint); }
```

- [ ] **Step 4: 확인**

Run: `npm test && npm run build && npx eslint src/components/ui src/utils`
Expected: 테스트 PASS, 빌드 성공, 린트 0건. (아직 페이지에서 쓰지 않으므로 화면 변화는 없다.)

- [ ] **Step 5: 커밋**

```bash
git add src/components/ui/PageTitle.tsx src/components/ui/DateNav.tsx src/components/ui/TabBar.tsx src/components/ui/InlineNums.tsx \
  src/components/ui/Footnotes.tsx src/components/ui/TagLinks.tsx src/components/ui/Sparkline.tsx src/utils/sparkline.ts \
  src/utils/sparkline.test.ts src/components/CalendarPicker.tsx src/styles/redesign.css
git commit -m "제목 줄·날짜 이동·탭·한 줄 수치·각주·태그 링크·순위선 조각을 만든다

카드·칩·타일 대신 쓰는 범용 조각이다. 모든 페이지가 이것으로 조립된다.
태그는 알약 버튼이 아니라 #텍스트 링크, 수치는 한 줄, 산식은 끝의 번호 각주.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: 필터 서랍 · 적용 조건 한 줄

**Files:**
- Create: `src/components/ranking/FilterDrawer.tsx`, `src/components/ranking/AppliedFilters.tsx`
- Modify: `src/styles/redesign.css`

**Interfaces:**
- Consumes: `RankingFilter`, `TagMode`, `EMPTY_FILTER`, `toggleTag`, `activeFilterCount` (Task 6)
- Produces:
  - `<FilterDrawer open onClose filter onChange tagStats resultCount error extra? />` — `tagStats: Array<{ tag: string; count: number }>`, `onChange(next: RankingFilter)`, `extra?: ReactNode`(공모전 "수상작만" 같은 추가 조건 자리, 계획 2)
  - `<AppliedFilters filter onChange />` — 조건이 없으면 아무것도 그리지 않는다
  - 필터 조작 결과는 **즉시** 표에 반영된다(기존 기본 모드 동작). 조건식만 Enter 또는 "적용"으로 반영. 하단 버튼 `N편 보기`는 서랍을 닫는다.

- [ ] **Step 1: 서랍 구현**

`src/components/ranking/FilterDrawer.tsx`:
```tsx
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Offcanvas } from 'react-bootstrap';
import { EMPTY_FILTER, toggleTag, type RankingFilter, type TagMode } from '../../utils/rankingQuery';

type Mode = TagMode | 'rule';
const MODES: Array<{ key: Mode; label: string }> = [
  { key: 'include-and', label: '모두 포함' },
  { key: 'include-or', label: '하나라도 포함' },
  { key: 'exclude', label: '제외' },
  { key: 'rule', label: '조건식' },
];

interface FilterDrawerProps {
  open: boolean;
  onClose: () => void;
  filter: RankingFilter;
  onChange: (next: RankingFilter) => void;
  tagStats: Array<{ tag: string; count: number }>;
  resultCount: number;
  error: string | null;
  extra?: ReactNode;
}

const toNum = (s: string): number | null => {
  const v = parseInt(s.replace(/[^\d]/g, ''), 10);
  return Number.isFinite(v) ? v : null;
};

export default function FilterDrawer({ open, onClose, filter, onChange, tagStats, resultCount, error, extra }: FilterDrawerProps) {
  const [mode, setMode] = useState<Mode>(filter.rule ? 'rule' : filter.tagMode);
  const [ruleText, setRuleText] = useState(filter.rule);
  const [q, setQ] = useState('');
  const [minEps, setMinEps] = useState(filter.minEps?.toString() ?? '');
  const [maxEps, setMaxEps] = useState(filter.maxEps?.toString() ?? '');

  // 바깥(적용 조건 한 줄의 ×, 초기화)에서 바뀐 값을 입력칸에 되돌려 놓는다.
  useEffect(() => { setMinEps(filter.minEps?.toString() ?? ''); setMaxEps(filter.maxEps?.toString() ?? ''); }, [filter.minEps, filter.maxEps]);
  useEffect(() => { setRuleText(filter.rule); if (filter.rule) setMode('rule'); }, [filter.rule]);

  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return s ? tagStats.filter(t => t.tag.toLowerCase().includes(s)) : tagStats;
  }, [q, tagStats]);

  const applyEps = () => onChange({ ...filter, minEps: toNum(minEps), maxEps: toNum(maxEps) });
  const pickMode = (m: Mode) => {
    setMode(m);
    if (m !== 'rule') onChange({ ...filter, tagMode: m, rule: '' });
  };
  const applyRule = () => onChange({ ...filter, rule: ruleText.trim(), tags: [] });
  const reset = () => { setQ(''); setRuleText(''); setMode('include-and'); onChange({ ...EMPTY_FILTER, view: filter.view, search: filter.search }); };

  return (
    <Offcanvas show={open} onHide={onClose} placement="end" className="filter-drawer" aria-labelledby="filter-drawer-title">
      <Offcanvas.Header closeButton>
        <Offcanvas.Title id="filter-drawer-title" className="filter-drawer__title">필터</Offcanvas.Title>
      </Offcanvas.Header>
      <Offcanvas.Body className="filter-drawer__body">
        <section className="filter-drawer__group">
          <h3 className="filter-drawer__h">회차</h3>
          <div className="filter-drawer__range">
            <input inputMode="numeric" aria-label="최소 회차" value={minEps} onChange={e => setMinEps(e.target.value)}
              onBlur={applyEps} onKeyDown={e => e.key === 'Enter' && applyEps()} />
            <span>–</span>
            <input inputMode="numeric" aria-label="최대 회차" value={maxEps} onChange={e => setMaxEps(e.target.value)}
              onBlur={applyEps} onKeyDown={e => e.key === 'Enter' && applyEps()} />
            <span>화</span>
          </div>
        </section>

        {extra ? <section className="filter-drawer__group">{extra}</section> : null}

        <section className="filter-drawer__group filter-drawer__group--tags">
          <h3 className="filter-drawer__h">태그</h3>
          <div className="filter-drawer__modes" role="radiogroup" aria-label="태그 조건">
            {MODES.map(m => (
              <button key={m.key} type="button" role="radio" aria-checked={mode === m.key}
                className={`filter-drawer__mode${mode === m.key ? ' is-on' : ''}`} onClick={() => pickMode(m.key)}>{m.label}</button>
            ))}
          </div>

          {mode === 'rule' ? (
            <div className="filter-drawer__rule">
              <input value={ruleText} onChange={e => setRuleText(e.target.value)} onKeyDown={e => e.key === 'Enter' && applyRule()}
                placeholder="(하렘 AND 순애) OR (TS AND NOT BL)" aria-label="태그 조건식" aria-invalid={!!error} />
              <button type="button" className="filter-drawer__rule-apply" onClick={applyRule}>적용</button>
              <p className={error ? 'filter-drawer__error' : 'filter-drawer__help'}>{error ?? 'AND · OR · NOT · 괄호를 쓸 수 있습니다. 엔터로 적용합니다.'}</p>
            </div>
          ) : (
            <>
              {filter.tags.length > 0 ? (
                <div className="filter-drawer__chosen">
                  {filter.tags.map(t => (
                    <button key={t} type="button" onClick={() => onChange(toggleTag(filter, t))} aria-label={`${t} 해제`}>
                      <b className={filter.tagMode === 'exclude' ? 'is-exclude' : ''}>{t}</b><i aria-hidden="true">×</i>
                    </button>
                  ))}
                </div>
              ) : null}
              <input className="filter-drawer__search" value={q} onChange={e => setQ(e.target.value)} placeholder={`태그 검색 · ${tagStats.length}개`} aria-label="태그 검색" />
              <ul className="filter-drawer__tags">
                {shown.map(({ tag, count }) => {
                  const on = filter.tags.includes(tag);
                  return (
                    <li key={tag}>
                      <button type="button" aria-pressed={on} className={on ? (filter.tagMode === 'exclude' ? 'is-exclude' : 'is-on') : ''}
                        onClick={() => onChange(toggleTag({ ...filter, tagMode: mode === 'rule' ? 'include-and' : mode }, tag))}>
                        <span>{tag}</span><i>{count}</i>
                      </button>
                    </li>
                  );
                })}
                {shown.length === 0 ? <li className="filter-drawer__none">검색된 태그가 없습니다.</li> : null}
              </ul>
            </>
          )}
        </section>
      </Offcanvas.Body>
      <div className="filter-drawer__actions">
        <button type="button" className="filter-drawer__reset" onClick={reset}>초기화</button>
        <button type="button" className="filter-drawer__done" onClick={onClose}>{resultCount.toLocaleString('ko-KR')}편 보기</button>
      </div>
    </Offcanvas>
  );
}
```
`src/components/ranking/AppliedFilters.tsx`:
```tsx
import { activeFilterCount, EMPTY_FILTER, toggleTag, type RankingFilter } from '../../utils/rankingQuery';

const MODE_LABEL = { 'include-and': '모두 포함', 'include-or': '하나라도 포함', exclude: '제외' } as const;

export default function AppliedFilters({ filter, onChange }: { filter: RankingFilter; onChange: (next: RankingFilter) => void }) {
  if (activeFilterCount(filter) === 0) return null;
  const eps = filter.minEps !== null || filter.maxEps !== null
    ? `${filter.minEps ?? 1}–${filter.maxEps ?? ''}화` : null;
  return (
    <div className="applied-filters" aria-label="적용 중인 조건">
      {filter.rule ? (
        <span className="applied-filters__part">조건식 <b>{filter.rule}</b>
          <button type="button" aria-label="조건식 해제" onClick={() => onChange({ ...filter, rule: '' })}>×</button></span>
      ) : filter.tags.length > 0 ? (
        <span className="applied-filters__part">태그
          {filter.tags.map(t => (
            <span key={t}> <b className={filter.tagMode === 'exclude' ? 'is-exclude' : ''}>{t}</b>
              <button type="button" aria-label={`${t} 해제`} onClick={() => onChange(toggleTag(filter, t))}>×</button></span>
          ))} {MODE_LABEL[filter.tagMode]}</span>
      ) : null}
      {eps ? (
        <span className="applied-filters__part">회차 <b>{eps}</b>
          <button type="button" aria-label="회차 조건 해제" onClick={() => onChange({ ...filter, minEps: null, maxEps: null })}>×</button></span>
      ) : null}
      <button type="button" className="applied-filters__reset" onClick={() => onChange({ ...EMPTY_FILTER, view: filter.view, search: filter.search })}>초기화</button>
    </div>
  );
}
```
`src/styles/redesign.css`에 추가:
```css
.filter-drawer.offcanvas { width: 440px; background: var(--np-canvas); color: var(--np-text-primary); border-left: 1px solid var(--np-border); box-shadow: var(--np-shadow-lg); }
@media (max-width: 575.98px) { .filter-drawer.offcanvas { width: 100vw; } }
.filter-drawer .offcanvas-header { padding: 1.5rem 1.75rem 0.5rem; }
.filter-drawer__title { font-size: 1.25rem; font-weight: 800; }
.filter-drawer__body { padding: 1rem 1.75rem; display: flex; flex-direction: column; }
.filter-drawer__group { margin-bottom: 1.5rem; }
.filter-drawer__group--tags { flex: 1; min-height: 0; display: flex; flex-direction: column; margin-bottom: 0; }
.filter-drawer__h { margin: 0 0 0.6rem; font-size: 0.8125rem; font-weight: 700; color: var(--np-text-secondary); }
.filter-drawer__range { display: flex; align-items: center; gap: 0.6rem; font-size: 0.9375rem; }
.filter-drawer__range input { width: 80px; border: 0; border-bottom: 1.5px solid var(--np-text-heading); background: none; color: inherit; padding: 3px 4px; text-align: right; }
.filter-drawer__modes { display: flex; gap: 1.1rem; flex-wrap: wrap; margin-bottom: 0.75rem; }
.filter-drawer__mode { padding: 0 0 4px; border: 0; background: none; border-bottom: 2px solid transparent; font-size: 0.9375rem; font-weight: 600; color: var(--np-text-secondary); }
.filter-drawer__mode.is-on { color: var(--np-text-heading); border-bottom-color: var(--np-text-heading); }
.filter-drawer__chosen { display: flex; flex-wrap: wrap; gap: 0.8rem; margin-bottom: 0.7rem; }
.filter-drawer__chosen button { border: 0; background: none; padding: 0; color: var(--np-text-heading); }
.filter-drawer__chosen b { font-weight: 700; } .filter-drawer__chosen b.is-exclude { color: var(--np-rank-down); text-decoration: line-through; }
.filter-drawer__chosen i { font-style: normal; margin-left: 2px; color: var(--np-text-faint); }
.filter-drawer__search, .filter-drawer__rule input { width: 100%; border: 0; border-bottom: 1.5px solid var(--np-border-strong); background: none; color: inherit; padding: 6px 2px; }
.filter-drawer__tags { list-style: none; margin: 0.5rem 0 0; padding: 0; columns: 2; column-gap: 1.75rem; overflow-y: auto; flex: 1; }
.filter-drawer__tags li { break-inside: avoid; }
.filter-drawer__tags button { width: 100%; display: flex; justify-content: space-between; padding: 0.28rem 0; border: 0; background: none; color: var(--np-text-primary); font-size: 0.875rem; text-align: left; }
.filter-drawer__tags i { font-style: normal; font-size: 0.8125rem; color: var(--np-text-faint); }
.filter-drawer__tags button.is-on { font-weight: 700; color: var(--np-text-heading); }
.filter-drawer__tags button.is-on span::before { content: "✓ "; color: var(--np-accent); }
.filter-drawer__tags button.is-exclude { font-weight: 700; color: var(--np-rank-down); text-decoration: line-through; }
.filter-drawer__none { color: var(--np-text-faint); font-size: var(--np-fs-meta); }
.filter-drawer__rule { display: flex; flex-wrap: wrap; gap: 0.5rem; align-items: center; }
.filter-drawer__rule input { flex: 1; }
.filter-drawer__rule-apply { border: 0; background: none; font-weight: 700; color: var(--np-text-heading); text-decoration: underline; text-underline-offset: 3px; }
.filter-drawer__help, .filter-drawer__error { flex-basis: 100%; margin: 0.3rem 0 0; font-size: 0.8125rem; color: var(--np-text-faint); }
.filter-drawer__error { color: var(--np-rank-up); }
.filter-drawer__actions { display: flex; justify-content: flex-end; align-items: center; gap: 0.9rem; padding: 1rem 1.75rem 1.5rem; border-top: 1px solid var(--np-border); }
.filter-drawer__reset { border: 0; background: none; color: var(--np-text-secondary); text-decoration: underline; text-underline-offset: 3px; }
.filter-drawer__done { height: 42px; padding: 0 1.5rem; border: 0; border-radius: 21px; background: var(--np-accent-solid); color: var(--np-on-accent-solid); font-weight: 700; }

.applied-filters { display: flex; flex-wrap: wrap; align-items: center; gap: 0.35rem 0.9rem; padding: 0.7rem 0; border-bottom: 1px solid var(--np-border); font-size: 0.875rem; color: var(--np-text-secondary); }
.applied-filters b { color: var(--np-text-heading); font-weight: 700; } .applied-filters b.is-exclude { color: var(--np-rank-down); }
.applied-filters__part button { border: 0; background: none; padding: 0 0 0 2px; color: var(--np-text-faint); }
.applied-filters__reset { margin-left: auto; border: 0; background: none; color: var(--np-text-secondary); text-decoration: underline; text-underline-offset: 3px; }
```

- [ ] **Step 2: 확인**

Run: `npm run build && npx eslint src/components/ranking`
Expected: 성공, 린트 0건. (조립은 Task 11 — 거기서 화면으로 확인한다.)

- [ ] **Step 3: 커밋**

```bash
git add src/components/ranking/FilterDrawer.tsx src/components/ranking/AppliedFilters.tsx src/styles/redesign.css
git commit -m "왼쪽 사이드바 필터를 오른쪽 서랍으로 옮긴다

기능은 그대로다: 회차 범위, 태그 모두/하나라도 포함·제외, 조건식과 오류 표시,
고른 태그 해제, 태그 검색, 초기화. 태그 목록은 알약 대신 개수가 붙은 두 줄 텍스트.
적용 중인 조건은 표 위 한 줄(AppliedFilters)로 늘 보인다.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: RankTable — 정렬 머리글 · 가상 스크롤 · 행 펼침 · 모바일 행

**Files:**
- Create: `src/components/ranking/RankTable.tsx`
- Modify: `src/styles/redesign.css`

**Interfaces:**
- Consumes: `useIsMobile()` (`src/hooks/useIsMobile.ts` — Step 1에서 반환 타입 확인)
- Produces:
```ts
interface RankColumn<T> { key: string; header: ReactNode; width: string; align?: 'left' | 'right' | 'center';
  sortKey?: string; title?: string; render: (row: T) => ReactNode; }
interface RankTableProps<T> { rows: T[]; rowKey: (row: T) => string; columns: RankColumn<T>[];
  sort?: { key: string; direction: 'ascending' | 'descending' }; onSort?: (key: string) => void;
  expandedKey?: string | null; onToggleRow?: (row: T) => void; renderExpanded?: (row: T) => ReactNode;
  renderMobileRow: (row: T) => ReactNode; emptyText: string; rowHeight?: number; ariaLabel: string; }
```

- [ ] **Step 1: useIsMobile 확인**

Run: `cat src/hooks/useIsMobile.ts`
Expected: `export const useIsMobile = (...)` 또는 `export default` 형태와 기준 폭. 기준이 768px이 아니면 이 태스크의 모바일 분기는 `useIsMobile(768)`처럼 인자를 넘기거나 `window.matchMedia('(max-width: 767.98px)')`를 쓰는 새 훅을 같은 파일에 추가한다(기존 사용처는 건드리지 않는다).

- [ ] **Step 2: 구현**

`src/components/ranking/RankTable.tsx`:
```tsx
import { Fragment, useRef, type ReactNode } from 'react';
import { useWindowVirtualizer } from '@tanstack/react-virtual';
import { useIsMobile } from '../../hooks/useIsMobile';

export interface RankColumn<T> {
  key: string;
  header: ReactNode;
  /** grid-template-columns 한 칸 (예: '64px', 'minmax(0,1.5fr)') */
  width: string;
  align?: 'left' | 'right' | 'center';
  sortKey?: string;
  /** 머리글 툴팁(산식). 터치 기기용으로는 표 아래 Footnotes에도 같은 문구를 둔다. */
  title?: string;
  render: (row: T) => ReactNode;
}

interface RankTableProps<T> {
  rows: T[];
  rowKey: (row: T) => string;
  columns: RankColumn<T>[];
  sort?: { key: string; direction: 'ascending' | 'descending' };
  onSort?: (key: string) => void;
  expandedKey?: string | null;
  onToggleRow?: (row: T) => void;
  renderExpanded?: (row: T) => ReactNode;
  renderMobileRow: (row: T) => ReactNode;
  emptyText: string;
  rowHeight?: number;
  ariaLabel: string;
}

const ariaSort = (on: boolean, dir?: 'ascending' | 'descending') => (on ? dir : 'none') as 'ascending' | 'descending' | 'none';

export default function RankTable<T>(props: RankTableProps<T>) {
  const { rows, rowKey, columns, sort, onSort, expandedKey, onToggleRow, renderExpanded, renderMobileRow, emptyText, rowHeight = 60, ariaLabel } = props;
  const isMobile = useIsMobile();
  const listRef = useRef<HTMLDivElement>(null);
  const virtualizer = useWindowVirtualizer({
    count: rows.length,
    estimateSize: () => (isMobile ? 112 : rowHeight),
    overscan: 8,
    scrollMargin: listRef.current?.offsetTop ?? 0,
  });
  const template = columns.map(c => c.width).join(' ');

  if (rows.length === 0) return <p className="empty-line">{emptyText}</p>;

  return (
    <div className="rank-table" role="table" aria-label={ariaLabel} aria-rowcount={rows.length}>
      {!isMobile ? (
        <div className="rank-table__head" role="row" style={{ gridTemplateColumns: template }}>
          {columns.map(c => {
            const on = !!c.sortKey && sort?.key === c.sortKey;
            return (
              <div key={c.key} role="columnheader" aria-sort={c.sortKey ? ariaSort(on, sort?.direction) : undefined}
                className={`rank-table__th is-${c.align ?? 'left'}${c.sortKey ? ' is-sortable' : ''}${on ? ' is-on' : ''}`} title={c.title}>
                {c.sortKey ? (
                  <button type="button" onClick={() => onSort?.(c.sortKey!)}>
                    {c.header}<span className="rank-table__sort" aria-hidden="true">{on ? (sort?.direction === 'ascending' ? '↑' : '↓') : '↕'}</span>
                  </button>
                ) : c.header}
              </div>
            );
          })}
        </div>
      ) : null}
      <div ref={listRef} className="rank-table__body" style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
        {virtualizer.getVirtualItems().map(v => {
          const row = rows[v.index];
          const key = rowKey(row);
          const open = expandedKey === key;
          return (
            <div key={key} data-index={v.index} ref={virtualizer.measureElement}
              style={{ position: 'absolute', top: 0, left: 0, right: 0, transform: `translateY(${v.start - virtualizer.options.scrollMargin}px)` }}>
              {isMobile ? (
                <div className="rank-table__mrow" role="row">{renderMobileRow(row)}</div>
              ) : (
                <Fragment>
                  <div role="row" className={`rank-table__row${open ? ' is-open' : ''}${onToggleRow ? ' is-clickable' : ''}`}
                    style={{ gridTemplateColumns: template, minHeight: rowHeight }}
                    onClick={() => onToggleRow?.(row)} aria-expanded={renderExpanded ? open : undefined}>
                    {columns.map(c => <div key={c.key} role="cell" className={`rank-table__td is-${c.align ?? 'left'}`}>{c.render(row)}</div>)}
                  </div>
                  {open && renderExpanded ? <div className="rank-table__expand">{renderExpanded(row)}</div> : null}
                </Fragment>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
```
`src/styles/redesign.css`에 추가:
```css
.rank-table { font-size: 0.875rem; }
.rank-table__head { display: grid; column-gap: 12px; align-items: center; height: 40px; border-bottom: 1px solid var(--np-border);
  position: sticky; top: var(--np-header-h); z-index: 2; background: var(--np-canvas); font-size: 0.75rem; font-weight: 600; color: var(--np-text-faint); }
.rank-table__th button { border: 0; background: none; padding: 0; font: inherit; color: inherit; white-space: nowrap; }
.rank-table__th.is-on { color: var(--np-text-heading); }
.rank-table__sort { margin-left: 3px; font-size: 0.7rem; opacity: 0.7; } .rank-table__th.is-on .rank-table__sort { color: var(--np-accent); opacity: 1; }
.rank-table__row { display: grid; column-gap: 12px; align-items: center; border-bottom: 1px solid var(--np-border); }
.rank-table__row.is-clickable { cursor: pointer; } .rank-table__row:hover, .rank-table__row.is-open { background: var(--np-surface-alt); }
.rank-table__th.is-right, .rank-table__td.is-right { text-align: right; } .rank-table__th.is-center, .rank-table__td.is-center { text-align: center; }
.rank-table__td { min-width: 0; color: var(--np-text-secondary); font-variant-numeric: tabular-nums; }
.rank-table__expand { background: var(--np-surface-alt); border-bottom: 1px solid var(--np-border); }
.rank-table__mrow { border-bottom: 1px solid var(--np-border); }
```

- [ ] **Step 3: 확인**

Run: `npm run build && npx eslint src/components/ranking/RankTable.tsx`
Expected: 성공, 0건.

- [ ] **Step 4: 커밋**

```bash
git add src/components/ranking/RankTable.tsx src/styles/redesign.css src/hooks/useIsMobile.ts
git commit -m "정렬·가상 스크롤·행 펼침·모바일 행을 갖춘 RankTable을 만든다

일간·공모전·태그·작가 표가 모두 이것을 쓴다. 표 안에 스크롤 상자를 두던 방식
대신 페이지(window) 스크롤로 가상화해 쇼케이스 아래로 자연스럽게 이어진다.
머리글은 헤더 아래에 붙고, 정렬 표시는 머리글 뒤 ↕/↓/↑.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: 쇼케이스 분리 · 새 칩

**Files:**
- Create: `src/components/ranking/Showcase.tsx`
- Modify: `src/styles/components.css:445-470`(`.media-rank-card--poster .media-rank-card__rank`, `--mover`), `src/styles/pages.css:944`(`.ranking-showcase-group__meta`)

**Interfaces:**
- Consumes: `RankingNovel` (Task 6), `formatInt`, `formatDateDot` (Task 5), `NovelCover`
- Produces: `<Showcase top={RankingNovel[]} movers={RankingNovel[]} showcaseDate={string | undefined} tableDate={string | null} />`

- [ ] **Step 1: 컴포넌트로 옮긴다**

`src/components/ranking/Showcase.tsx` — `NovelRankingsPage.tsx`의 `renderPosterCard`·`topShowcaseItems`·`risingShowcaseItems`·`showcaseSection`을 옮기되, 칩 글자와 그룹 제목 옆 문구를 바꾼다:
```tsx
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import NovelCover from '../NovelCover';
import type { RankingNovel } from '../../utils/rankingQuery';
import { formatDateDot, formatInt } from '../../utils/format';

const COUNT = 5; // 모자이크는 1위(세로 2칸) + 2~5위(2×2) 정확히 5칸

interface ShowcaseProps { top: RankingNovel[]; movers: RankingNovel[]; showcaseDate?: string; tableDate: string | null; }

function Poster({ novel, chip, meta, cls }: { novel: RankingNovel; chip: ReactNode; meta: ReactNode; cls: string }) {
  return (
    <Link to={`/novels/${novel.ID}`} className={`media-rank-card media-rank-card--poster media-rank-card--link ${cls}`} aria-label={`${novel.Title} 상세 보기`}>
      {/* 칩은 표지 안에 둔다 — 띠(overlay)가 position: relative라 그 안에 두면 제목 옆으로 내려온다. */}
      <div className="media-rank-card__cover">
        <NovelCover url={novel.ThumbnailURL} title={novel.Title} imageClassName="media-rank-card__cover-image" />
        <div className="media-rank-card__rank">{chip}</div>
      </div>
      <div className="media-rank-card__overlay">
        <div className="media-rank-card__title">{novel.Title}</div>
        <div className="media-rank-card__meta">{meta}</div>
      </div>
    </Link>
  );
}

export default function Showcase({ top, movers, showcaseDate, tableDate }: ShowcaseProps) {
  if (top.length === 0 && movers.length === 0) return null;
  // 쇼케이스는 늘 최신 수집일이다. 과거 날짜의 표를 볼 때만 기준일을 붙인다.
  const stamp = showcaseDate && tableDate && showcaseDate !== tableDate ? `${formatDateDot(showcaseDate).slice(5)} 기준` : null;
  return (
    <div className="showcase-section">
      <div className="ranking-showcase-split">
        {top.length > 0 ? (
          <section className="ranking-showcase-group">
            <div className="ranking-showcase-group__header">
              <h2 className="ranking-showcase-group__title">상위 5작품</h2>
              {stamp ? <span className="ranking-showcase-group__meta">{stamp}</span> : null}
            </div>
            <div className="ranking-showcase-top-grid">
              {top.slice(0, COUNT).map((n, i) => (
                <Poster key={`top-${n.ID}`} novel={n} chip={n.Ranking} cls={`media-rank-card--split media-rank-card--rank-${i + 1}`}
                  meta={<><span className="mini-kpi">{n.AuthorName}</span><span className="mini-kpi">점수 {formatInt(n.Score)}</span></>} />
              ))}
            </div>
          </section>
        ) : null}
        {movers.length > 0 ? (
          <section className="ranking-showcase-group">
            <div className="ranking-showcase-group__header">
              <h2 className="ranking-showcase-group__title">급상승 5작품</h2>
              {stamp ? <span className="ranking-showcase-group__meta">{stamp}</span> : null}
            </div>
            <div className="ranking-showcase-rising-grid">
              {movers.slice(0, COUNT).map((n, i) => {
                const jump = typeof n.rank_change === 'number' ? n.rank_change : null;
                return (
                  <Poster key={`mover-${n.ID}`} novel={n} chip={jump != null ? `▲${jump}` : 'NEW'}
                    cls={`media-rank-card--split media-rank-card--mover media-rank-card--mover-${i + 1}`}
                    meta={jump != null
                      ? <span className="rank-move"><span className="rank-move__from">{n.Ranking + jump}위</span><i className="mv-arrow" aria-hidden="true" /><span className="rank-move__to">{n.Ranking}위</span></span>
                      : <span className="rank-move__to">{n.Ranking}위</span>} />
                );
              })}
            </div>
          </section>
        ) : null}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 칩 색**

`src/styles/components.css`의 `.media-rank-card--poster .media-rank-card__rank` 규칙에서 `border-radius`를 `13px`로, `backdrop-filter`·`border-color`는 두고 글자 크기 `0.8125rem`·굵기 800으로. `.media-rank-card--mover .media-rank-card__rank` 규칙을 다음으로 바꾼다(표지 위라 두 테마 모두 같은 색 — Global Constraints의 예외):
```css
.media-rank-card--mover .media-rank-card__rank {
  min-width: 0;
  height: 1.65rem;
  padding: 0 0.55rem;
  font-size: 0.8125rem;
  letter-spacing: 0;
  border-color: transparent;
  background-color: #d42a44;
  color: #ffffff;
}
```
`src/styles/pages.css`의 `.ranking-showcase-group__meta`는 `color: var(--np-text-faint); font-size: var(--np-fs-meta);`로 둔다. 그룹 제목 규칙(`.ranking-showcase-group__title`)은 `font-size: 1.0625rem; font-weight: 800;`로.

- [ ] **Step 3: 확인**

Run: `npm run build`
Expected: 성공. (Task 11에서 페이지에 연결한 뒤 화면 확인.)

- [ ] **Step 4: 커밋**

```bash
git add src/components/ranking/Showcase.tsx src/styles/components.css src/styles/pages.css
git commit -m "쇼케이스를 컴포넌트로 빼고 칩을 새 규칙으로 칠한다

모자이크·표지 전면·블러 띠 구조는 2026-08-30 결정 그대로다. 순위 칩은 검정 반투명,
상승 칩은 빨강(▲135). 그룹 옆 설명 문구는 없애고, 과거 날짜 표를 볼 때만
'9.27 기준'을 붙인다 — 쇼케이스는 늘 최신 수집일이라 그대로 두면 날짜를 오해한다.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: 일간 랭킹 조립

**Files:**
- Modify(재작성): `src/pages/NovelRankingsPage.tsx`
- Modify: `src/styles/redesign.css`

**Interfaces:**
- Consumes: Task 5~10의 모든 Produces, `getAvailableDates`, `getNovelRankingShowcase`, `getNovelRankingsByDate` (`src/services/api.ts` — 기존 그대로)
- Produces: 경로 `/novels/rankings/:date?`, 쿼리 `?tag=<태그>`(들어올 때 그 태그 하나를 "모두 포함"으로 건다). 행 펼침 슬롯은 Task 12에서 `NovelRowExpand`로 채운다 — 이 태스크에서는 `renderExpanded={() => null}`로 두지 않고 **펼침 자체를 연결하지 않는다**(Task 12에서 `onToggleRow`·`renderExpanded`를 추가).

- [ ] **Step 1: 페이지를 새로 쓴다**

`src/pages/NovelRankingsPage.tsx` 전체:
```tsx
import { useCallback, useEffect, useMemo, useState, useTransition } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { isValid, parseISO } from 'date-fns';
import { getAvailableDates, getNovelRankingShowcase, getNovelRankingsByDate } from '../services/api';
import PageTitle from '../components/ui/PageTitle';
import DateNav from '../components/ui/DateNav';
import TabBar from '../components/ui/TabBar';
import TagLinks from '../components/ui/TagLinks';
import ChangeMark from '../components/ui/ChangeMark';
import NovelCover from '../components/NovelCover';
import Showcase from '../components/ranking/Showcase';
import FilterDrawer from '../components/ranking/FilterDrawer';
import AppliedFilters from '../components/ranking/AppliedFilters';
import RankTable, { type RankColumn } from '../components/ranking/RankTable';
import {
  DEFAULT_SORT, EMPTY_FILTER, activeFilterCount, applyRankingFilter, nextSort, normalizeNovels, sortRankings, tagCounts, toggleTag,
  type RankingFilter, type RankingNovel, type RankingView, type SortConfig, type SortKey,
} from '../utils/rankingQuery';
import { formatInt, formatRatio } from '../utils/format';

const VIEWS: Array<{ key: RankingView; label: string }> = [
  { key: 'all', label: '전체' },
  { key: 'rising', label: '급상승' },
  { key: 'new', label: '신규 진입' },
];

export default function NovelRankingsPage() {
  const { date: dateParam } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [isPending, startTransition] = useTransition();

  const [dates, setDates] = useState<Set<string>>(new Set());
  const [rows, setRows] = useState<RankingNovel[]>([]);
  const [showcase, setShowcase] = useState<{ date?: string; top: RankingNovel[]; movers: RankingNovel[] }>({ top: [], movers: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<RankingFilter>(() => {
    const tag = params.get('tag');
    return tag ? { ...EMPTY_FILTER, tags: [tag] } : EMPTY_FILTER;
  });
  const [sort, setSort] = useState<SortConfig>(DEFAULT_SORT);
  const [drawer, setDrawer] = useState(false);

  useEffect(() => {
    getAvailableDates()
      .then(r => setDates(new Set<string>(r.data.available_dates || [])))
      .catch(() => { setError('수집일 목록을 불러오지 못했습니다.'); setLoading(false); });
    getNovelRankingShowcase()
      .then(r => setShowcase({ date: r.data.latest_date, top: normalizeNovels(r.data.topThree || []), movers: normalizeNovels(r.data.movers || []) }))
      .catch(() => setShowcase({ top: [], movers: [] }));
  }, []);

  useEffect(() => {
    if (dates.size === 0) return;
    const latest = [...dates].sort().at(-1)!;
    if (!dateParam || !isValid(parseISO(dateParam)) || !dates.has(dateParam)) {
      navigate(`/novels/rankings/${latest}${params.get('tag') ? `?tag=${encodeURIComponent(params.get('tag')!)}` : ''}`, { replace: true });
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    getNovelRankingsByDate(dateParam)
      .then(r => { if (!cancelled) setRows(normalizeNovels(r.data.message ? [] : r.data)); })
      .catch(() => { if (!cancelled) { setRows([]); setError('랭킹을 불러오지 못했습니다.'); } })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [dateParam, dates, navigate, params]);

  const update = useCallback((next: RankingFilter) => startTransition(() => setFilter(next)), []);
  const setView = (view: RankingView) => {
    update({ ...filter, view });
    // 급상승 보기는 오른 폭 순서가 곧 의미다.
    setSort(view === 'rising' ? { key: 'rank_change', direction: 'descending' } : DEFAULT_SORT);
  };

  const result = useMemo(() => applyRankingFilter(rows, filter), [rows, filter]);
  const sorted = useMemo(() => sortRankings(result.items, sort), [result.items, sort]);
  const stats = useMemo(() => tagCounts(rows), [rows]);
  const hit = useMemo(() => new Set(filter.rule ? [] : filter.tags), [filter]);
  const onTag = useCallback((t: string) => update(toggleTag(filter, t)), [filter, update]);

  const columns: RankColumn<RankingNovel>[] = [
    { key: 'rank', header: '순위', width: '48px', align: 'center', sortKey: 'Ranking',
      render: n => <span className={`rank-num${n.Ranking <= 3 ? ' is-top' : ''}`}>{n.Ranking}</span> },
    { key: 'chg', header: '변동', width: '52px', align: 'center', sortKey: 'rank_change', render: n => <ChangeMark value={n.rank_change} /> },
    { key: 'cover', header: '', width: '34px', render: n => <span className="rank-cover"><NovelCover url={n.ThumbnailURL} title={n.Title} imageClassName="rank-cover__img" /></span> },
    { key: 'title', header: '제목', width: 'minmax(0,1.5fr)',
      render: n => <Link to={`/novels/${n.ID}`} className="rank-title" onClick={e => e.stopPropagation()}>{n.Title || '(제목 없음)'}</Link> },
    { key: 'author', header: '작가', width: '108px',
      render: n => n.AuthorID ? <Link to={`/authors/${n.AuthorID}`} className="rank-author" onClick={e => e.stopPropagation()}>{n.AuthorName}</Link> : <span className="rank-author">{n.AuthorName || '(작자 미상)'}</span> },
    { key: 'score', header: '점수', width: '76px', align: 'right', sortKey: 'Score', render: n => <b className="rank-strong">{formatInt(n.Score)}</b> },
    { key: 'eps', header: '회차', width: '54px', align: 'right', sortKey: 'Eps', render: n => formatInt(n.Eps) },
    { key: 'ratio', header: '추천비', width: '62px', align: 'right', sortKey: 'like_to_view_ratio', title: '추천 ÷ 누적 조회', render: n => formatRatio(n.like_to_view_ratio, 2) },
    { key: 'early', header: '초반 잔류', width: '66px', align: 'right', sortKey: 'EarlyRetentionRate', title: '30번째 유효 회차 조회 ÷ 1화 조회', render: n => formatRatio(n.EarlyRetentionRate, 0) },
    { key: 'recent', header: '최신 잔류', width: '66px', align: 'right', sortKey: 'RecentRetentionRate', title: '최신화 조회 ÷ 역순 30번째 회차 조회', render: n => formatRatio(n.RecentRetentionRate, 0) },
    { key: 'tags', header: '태그', width: 'minmax(0,1fr)', render: n => <TagLinks tags={n.Tags} highlighted={hit} onSelect={onTag} /> },
  ];

  const mobileRow = (n: RankingNovel) => (
    <div className="rank-mrow">
      <div className="rank-mrow__rank"><span className={`rank-num${n.Ranking <= 3 ? ' is-top' : ''}`}>{n.Ranking}</span><ChangeMark value={n.rank_change} /></div>
      <div className="rank-mrow__main">
        <Link to={`/novels/${n.ID}`} className="rank-title rank-title--wrap">{n.Title}</Link>
        <p>{n.AuthorName} · 점수 <b>{formatInt(n.Score)}</b> · {formatInt(n.Eps)}화</p>
        <p>추천비 <b>{formatRatio(n.like_to_view_ratio, 2)}</b> · 초반 <b>{formatRatio(n.EarlyRetentionRate, 0)}</b> · 최신 <b>{formatRatio(n.RecentRetentionRate, 0)}</b></p>
        <TagLinks tags={n.Tags} highlighted={hit} onSelect={onTag} limit={4} />
      </div>
    </div>
  );

  const count = activeFilterCount(filter);
  return (
    <div className="page-shell rankings">
      <PageTitle title="일간 랭킹"
        nav={<DateNav value={dateParam ?? null} availableDates={dates} onChange={d => navigate(`/novels/rankings/${d}`)} />}
        meta={`밤 9시 · 노벨피아 7일 조회순 상위 ${rows.length || 500}`} />

      <Showcase top={showcase.top} movers={showcase.movers} showcaseDate={showcase.date} tableDate={dateParam ?? null} />

      <TabBar ariaLabel="보기" items={VIEWS} value={filter.view} onChange={setView}>
        <input className="toolbar-search" type="search" placeholder="제목·작가 검색" aria-label="제목·작가 검색"
          value={filter.search} onChange={e => update({ ...filter, search: e.target.value })} />
        <button type="button" className={`toolbar-filter${count ? ' is-on' : ''}`} onClick={() => setDrawer(true)} aria-haspopup="dialog">
          필터{count ? <span className="toolbar-filter__n">{count}</span> : null}
        </button>
      </TabBar>
      <AppliedFilters filter={filter} onChange={update} />

      <div className={isPending ? 'is-pending' : undefined}>
        {error ? <p className="empty-line">{error} <button type="button" className="link-button" onClick={() => window.location.reload()}>다시 시도</button></p>
          : loading ? <div className="rank-skeleton" aria-busy="true">{Array.from({ length: 8 }, (_, i) => <div key={i} />)}</div>
          : (
            <RankTable ariaLabel="일간 랭킹" rows={sorted} rowKey={n => n.ID} columns={columns}
              sort={sort} onSort={k => setSort(s => nextSort(s, k as SortKey))}
              renderMobileRow={mobileRow}
              emptyText={result.error ?? (rows.length === 0 ? '이 날짜의 랭킹 데이터가 없습니다.' : '조건에 맞는 작품이 없습니다.')} />
          )}
      </div>

      <FilterDrawer open={drawer} onClose={() => setDrawer(false)} filter={filter} onChange={update}
        tagStats={stats} resultCount={sorted.length} error={result.error} />
    </div>
  );
}
```

- [ ] **Step 2: 스타일**

`src/styles/redesign.css`에 추가:
```css
.rank-num { font-size: 1.3125rem; font-weight: 800; letter-spacing: -0.03em; color: var(--np-text-heading); }
.rank-num.is-top { color: var(--np-accent); }
.rank-cover { display: block; width: 34px; height: 48px; border-radius: 3px; overflow: hidden; background: var(--np-cover-bg); }
.rank-cover .novel-cover-mask, .rank-cover__img { width: 100%; height: 100%; object-fit: cover; }
.rank-cover .novel-cover-mask button { display: none; } /* 34px 표지에는 토글을 두지 않는다 — 전체 가리기 토글이 헤더에 있다 */
.rank-title { display: block; font-size: 0.9375rem; font-weight: 700; letter-spacing: -0.02em; color: var(--np-text-heading); text-decoration: none; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.rank-title--wrap { white-space: normal; }
.rank-author { display: block; color: var(--np-text-secondary); text-decoration: none; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.rank-strong { color: var(--np-text-heading); font-weight: 600; }
.toolbar-search { width: 240px; border: 0; border-bottom: 1.5px solid var(--np-text-heading); background: none; color: var(--np-text-primary); padding: 4px 2px; font-size: 0.875rem; }
.toolbar-filter { height: 34px; padding: 0 1rem; border-radius: 17px; border: 1.5px solid var(--np-text-heading); background: var(--np-canvas); color: var(--np-text-heading); font-weight: 700; font-size: 0.875rem; }
.toolbar-filter.is-on { background: var(--np-accent-solid); color: var(--np-on-accent-solid); }
.toolbar-filter__n { margin-left: 6px; font-size: 0.75rem; opacity: 0.8; }
.rank-mrow { display: grid; grid-template-columns: 34px minmax(0, 1fr); gap: 8px; padding: 11px 0; }
.rank-mrow__rank { text-align: center; display: flex; flex-direction: column; align-items: center; gap: 3px; }
.rank-mrow__rank .rank-num { font-size: 1.1875rem; line-height: 1.1; }
.rank-mrow__main p { margin: 3px 0 0; font-size: 0.78rem; color: var(--np-text-secondary); } .rank-mrow__main b { color: var(--np-text-heading); font-weight: 600; }
.rank-mrow__main .tag-links { margin-top: 4px; font-size: 0.75rem; }
.rank-skeleton div { height: 60px; border-bottom: 1px solid var(--np-border); background: linear-gradient(90deg, transparent, var(--np-surface-alt), transparent); background-size: 200% 100%; animation: rank-skel 1.2s linear infinite; }
@keyframes rank-skel { from { background-position: 200% 0; } to { background-position: -200% 0; } }
@media (prefers-reduced-motion: reduce) { .rank-skeleton div { animation: none; } }
.is-pending { opacity: 0.7; transition: opacity var(--np-transition); }
.link-button { border: 0; background: none; padding: 0; color: var(--np-text-heading); text-decoration: underline; text-underline-offset: 3px; }
@media (max-width: 767.98px) { .tab-bar__tools { width: 100%; margin-left: 0; } .toolbar-search { flex: 1; width: auto; } }
```
기존 `NovelRankingsPage`에서만 쓰던 클래스(`.novel-rankings-layout`, `.page-sidebar`, `.sidebar-section`, `.sidebar-label`, `.sidebar-divider`, `.mobile-controls-bar`, `.filter-panel`, `.ranking-table-panel`, `.ranking-table-scroll`, `.novel-rankings-table`, `.tag-filter-*`)는 **공모전 페이지가 아직 쓰므로 지우지 않는다** — 계획 2에서 지운다.

- [ ] **Step 3: 빌드·린트**

Run: `npm run build && npx eslint src/pages/NovelRankingsPage.tsx`
Expected: 성공, 0건. (`NovelFilterControls`, `TagFilter`는 공모전이 아직 쓰므로 남는다.)

- [ ] **Step 4: 화면으로 확인**

Run: `scripts/shots.sh /tmp/nf-shots-t11 /novels/rankings "/novels/rankings?tag=판타지"`
Expected (1200px): 제목 `일간 랭킹 ‹ 날짜 ›` → 쇼케이스 두 그룹 → 탭(전체·급상승·신규 진입) + 검색칸 + `필터` → 10열 표. `?tag=판타지`는 표 위에 `태그 판타지× 모두 포함`, 태그 열의 `#판타지`가 빨강. 360px: 세 줄 행, 가로 스크롤 없음. 다크에서 글자가 사라진 곳 없음.

- [ ] **Step 5: 기능을 손으로 확인(dev 서버)**

다음을 순서대로 해 보고 모두 기대대로면 다음 단계로:
1. 표의 `#하렘`을 누른다 → 표가 거르고 적용 조건 한 줄이 생긴다. 한 번 더 누르면 풀린다.
2. `필터` → 서랍에서 "제외" → `BL`을 누른다 → 표에서 BL 작품이 사라지고 한 줄에 파란 `BL`. `N편 보기`로 닫힌다.
3. "조건식" → `(하렘 AND 순애` 입력 후 엔터 → 입력 아래 빨간 `조건식 오류: ...`, 표 자리에 같은 문장. 괄호를 닫고 엔터 → 결과가 나온다.
4. 회차 `50`–`300` 입력 후 바깥을 누른다 → 한 줄에 `회차 50–300화`.
5. 머리글 `최신 잔류` 두 번 → ↓ 다음 ↑, `–`인 행은 두 경우 모두 맨 아래.
6. 조건을 건 채로 `‹`(이전 수집일) → 날짜만 바뀌고 조건은 그대로(Review Focus 4).
7. `급상승` 탭 → 오른 폭 순서, `신규 진입` 탭 → NEW만.
8. 과거 날짜에서 쇼케이스 그룹 제목 옆에 `MM.DD 기준`, 최신 날짜에서는 없음(Review Focus 1).
9. `?tag=없는태그` → 한 줄 `태그 없는태그×`, 표 자리 `조건에 맞는 작품이 없습니다.`(Review Focus 5).

- [ ] **Step 6: 커밋**

```bash
git add src/pages/NovelRankingsPage.tsx src/styles/redesign.css
git commit -m "일간 랭킹을 차트 페이지 문법으로 다시 짠다

제목 옆 날짜 이동, 쇼케이스, 전체·급상승·신규 탭, 오른쪽 서랍 필터, 10열 표
(순위·변동·표지·제목·작가·점수·회차·추천비·초반/최신 잔류·태그)로 조립한다.
기능은 이전과 같다. ?tag= 로 들어오면 그 태그가 걸린 상태로 연다 — 상세의 태그
링크와 이후 태그 랭킹의 '작품 보기'가 이 주소를 쓴다.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: 행 펼침 — 30일 순위선 · 차트인 일수 · 최고 순위

**Files:**
- Create: `src/utils/trendSummary.ts`, `src/utils/trendSummary.test.ts`, `src/components/ranking/NovelRowExpand.tsx`
- Modify: `src/pages/NovelRankingsPage.tsx`, `src/styles/redesign.css`

**Interfaces:**
- Consumes: `getNovelTrend(novelId: string, startDate: string, endDate: string)` → `{ data: Array<{ Date: string; Ranking: number | null; View: number | null; ... }> }`, `Sparkline`, `formatInt`, `formatDateKo`
- Produces:
```ts
interface TrendPoint { Date: string; Ranking: number | null; View?: number | null; }
function isOutOfRank(rank: number | null | undefined, date: string): boolean;   // 501(또는 2025-07-20 이전 301) 이상/없음
function summarizeWindow(points: TrendPoint[], windowDates: string[]): { ranks: (number | null)[]; days: number; peak: number | null; lastView: number | null };
function windowOf(dates: Iterable<string>, end: string, size: number): string[];   // end 포함 이전 size개 수집일
```

- [ ] **Step 1: 실패하는 테스트**

`src/utils/trendSummary.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { isOutOfRank, summarizeWindow, windowOf } from './trendSummary';

describe('isOutOfRank', () => {
  it('2025-07-21 이후 501위 이상은 순위권 밖', () => {
    expect(isOutOfRank(500, '2026-09-01')).toBe(false);
    expect(isOutOfRank(501, '2026-09-01')).toBe(true);
  });
  it('2025-07-20 이전은 301위부터 순위권 밖', () => {
    expect(isOutOfRank(301, '2025-07-20')).toBe(true);
    expect(isOutOfRank(300, '2025-07-20')).toBe(false);
  });
  it('값이 없으면 순위권 밖', () => expect(isOutOfRank(null, '2026-09-01')).toBe(true));
});

describe('windowOf', () => {
  it('끝 날짜를 포함해 앞쪽 수집일 N개(빠진 날은 건너뜀)', () => {
    const dates = ['2026-09-20', '2026-09-22', '2026-09-23', '2026-09-24', '2026-09-26'];
    expect(windowOf(dates, '2026-09-24', 3)).toEqual(['2026-09-22', '2026-09-23', '2026-09-24']);
    expect(windowOf(dates, '2026-09-21', 3)).toEqual(['2026-09-20']);
  });
});

describe('summarizeWindow', () => {
  const win = ['2026-09-24', '2026-09-25', '2026-09-26', '2026-09-27'];
  it('차트인 일수·최고 순위·순위 배열', () => {
    const r = summarizeWindow([
      { Date: '2026-09-24', Ranking: 501 },
      { Date: '2026-09-25', Ranking: 40, View: 100 },
      { Date: '2026-09-27', Ranking: 8, View: 300 },
    ], win);
    expect(r).toEqual({ ranks: [null, 40, null, 8], days: 2, peak: 8, lastView: 300 });
  });
  it('한 번도 순위권에 없으면 최고 없음', () => {
    expect(summarizeWindow([], win)).toEqual({ ranks: [null, null, null, null], days: 0, peak: null, lastView: null });
  });
});
```
Run: `npm test` → Expected: FAIL(`./trendSummary` 없음).

- [ ] **Step 2: 구현**

`src/utils/trendSummary.ts`:
```ts
/** 추이 API는 순위권 밖 날을 501위(2025-07-20 이전 수집분은 301위)로 채워 보낸다(SmallMultiplesChart와 같은 규칙). */
const TOP_300_END_DATE = '2025-07-20';

export interface TrendPoint { Date: string; Ranking: number | null; View?: number | null; }

export function isOutOfRank(rank: number | null | undefined, date: string): boolean {
  if (rank == null) return true;
  return date <= TOP_300_END_DATE ? rank >= 301 : rank >= 501;
}

export function windowOf(dates: Iterable<string>, end: string, size: number): string[] {
  const upTo = [...dates].filter(d => d <= end).sort();
  return upTo.slice(Math.max(0, upTo.length - size));
}

export function summarizeWindow(points: TrendPoint[], windowDates: string[]) {
  const byDate = new Map(points.map(p => [p.Date, p]));
  const ranks = windowDates.map(d => {
    const p = byDate.get(d);
    return p && !isOutOfRank(p.Ranking, d) ? p.Ranking : null;
  });
  const inRank = ranks.filter((r): r is number => r != null);
  const lastWithView = [...windowDates].reverse().map(d => byDate.get(d)).find(p => p?.View != null);
  return { ranks, days: inRank.length, peak: inRank.length ? Math.min(...inRank) : null, lastView: lastWithView?.View ?? null };
}
```
Run: `npm test` → Expected: PASS.

- [ ] **Step 3: 펼침 컴포넌트**

`src/components/ranking/NovelRowExpand.tsx`:
```tsx
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { getNovelTrend } from '../../services/api';
import Sparkline from '../ui/Sparkline';
import { formatDateKo, formatInt } from '../../utils/format';
import { summarizeWindow, windowOf, type TrendPoint } from '../../utils/trendSummary';

const WINDOW = 30;

interface Props { novelId: string; date: string; availableDates: Set<string>; }

/** 행을 누르면 그 자리에서 30일 순위선·차트인 일수·최고 순위. 펼칠 때 한 번만 부른다. */
export default function NovelRowExpand({ novelId, date, availableDates }: Props) {
  const win = windowOf(availableDates, date, WINDOW);
  const [state, setState] = useState<{ points: TrendPoint[] } | 'loading' | 'error'>('loading');

  useEffect(() => {
    let cancelled = false;
    if (win.length === 0) return;
    getNovelTrend(novelId, win[0], date)
      .then(r => { if (!cancelled) setState({ points: r.data as TrendPoint[] }); })
      .catch(() => { if (!cancelled) setState('error'); });
    return () => { cancelled = true; };
    // win은 date·availableDates에서 파생 — 둘이 바뀔 때만 다시 부른다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [novelId, date, availableDates]);

  if (state === 'loading') return <div className="row-expand row-expand--loading" aria-busy="true">불러오는 중</div>;
  if (state === 'error') return <div className="row-expand">추이를 불러오지 못했습니다.</div>;
  const s = summarizeWindow(state.points, win);
  return (
    <div className="row-expand">
      <div>
        <Sparkline ranks={s.ranks} width={300} height={46} label={`${win.length}일 순위 추이`} />
        <div className="row-expand__cap"><span>{formatDateKo(win[0])}</span><span>{formatDateKo(date)}</span></div>
      </div>
      <p className="row-expand__facts">
        {win.length}일 중 <b>{s.days}일</b> 차트인 · 최고 <b>{s.peak != null ? `${s.peak}위` : '–'}</b>
        {s.lastView != null ? <> · 조회 <b>{formatInt(s.lastView)}</b></> : null}
      </p>
      <Link to={`/novels/${novelId}`} className="row-expand__go" onClick={e => e.stopPropagation()}>작품 정보 보기</Link>
    </div>
  );
}
```
`src/pages/NovelRankingsPage.tsx`에 펼침을 연결한다. 상태 `const [openId, setOpenId] = useState<string | null>(null);`를 추가하고, `RankTable`에 다음 props를 더한다:
```tsx
              expandedKey={openId}
              onToggleRow={n => setOpenId(id => (id === n.ID ? null : n.ID))}
              renderExpanded={n => <NovelRowExpand novelId={n.ID} date={dateParam!} availableDates={dates} />}
```
import: `import NovelRowExpand from '../components/ranking/NovelRowExpand';`. 날짜가 바뀌면 닫는다 — 데이터 불러오는 `useEffect` 안 `setLoading(true);` 다음 줄에 `setOpenId(null);`.

`src/styles/redesign.css`에 추가:
```css
.row-expand { display: flex; gap: 2.75rem; align-items: center; padding: 1rem 1.75rem 1.1rem 9rem; font-size: 0.875rem; color: var(--np-text-secondary); }
.row-expand--loading { min-height: 84px; color: var(--np-text-faint); }
.row-expand__cap { display: flex; justify-content: space-between; margin-top: 2px; font-size: 0.6875rem; color: var(--np-text-faint); }
.row-expand__facts b { color: var(--np-text-heading); }
.row-expand__go { margin-left: auto; font-weight: 700; color: var(--np-text-heading); text-decoration: none; border-bottom: 1.5px solid var(--np-text-heading); }
```

- [ ] **Step 4: 확인**

Run: `npm test && npm run build`
Expected: PASS, 성공.
수동: 표의 행을 누르면 아래에 순위선과 `30일 중 N일 차트인 · 최고 N위 · 조회 N`이 펼쳐지고, 다시 누르면 닫힌다. 제목·작가·태그 링크를 누르면 펼쳐지지 않고 그 링크로 간다. 다른 날짜로 가면 닫혀 있다.

- [ ] **Step 5: 커밋**

```bash
git add src/utils/trendSummary.ts src/utils/trendSummary.test.ts src/components/ranking/NovelRowExpand.tsx src/pages/NovelRankingsPage.tsx src/styles/redesign.css
git commit -m "랭킹 행을 누르면 30일 순위선과 차트인 일수를 펼친다

표에서 뺀 정보(누적 조회·30일 최고·차트인)를 여기서 본다. 펼칠 때 기존 추이
API를 한 번 부르므로 새 API는 없다. 순위권 밖 판정(501위, 2025-07-20 이전 301위)은
상세 차트와 같은 규칙이다.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 13: 작품 상세 머리 — 현재 순위 · 한 줄 수치 · 태그 링크

**Files:**
- Create: `src/components/novel/NovelHeader.tsx`, `src/utils/currentRank.ts`, `src/utils/currentRank.test.ts`
- Modify: `src/pages/NovelDetailPage.tsx`, `src/hooks/useNovelData.ts`(details 타입), `src/styles/redesign.css`
- Delete: `src/components/novel/NovelDetailsCard.tsx`(작품 상세만 썼다 — Step 1에서 확인)

**Interfaces:**
- Consumes: `useNovelData(novelId)` → `{ details, novelData: Array<{ Date; Ranking; ... }>, maxDate, ... }`, `InlineNums`, `ChangeMark`, `TagLinks`, `formatMan`, `formatInt`, `formatRatio`, `formatDateKo`, `isOutOfRank`
- Produces:
```ts
type CurrentRank = { kind: 'ranked'; rank: number; change: number | 'New' | null } | { kind: 'out'; lastDate: string; lastRank: number } | { kind: 'unknown' };
function describeCurrentRank(args: { detailDate?: string | null; detailRank?: number | null; latestDate?: string | null;
  series: Array<{ Date: string; Ranking: number | null }> }): CurrentRank;
```

- [ ] **Step 1: NovelDetailsCard 사용처 확인**

Run: `grep -rn "NovelDetailsCard" src --include=*.tsx`
Expected: `NovelDetailPage.tsx`와 파일 자신뿐. 다른 곳이 있으면 그 파일은 계획 2에서 처리하도록 이 태스크에서 삭제하지 않는다.

- [ ] **Step 2: 실패하는 테스트**

`src/utils/currentRank.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { describeCurrentRank } from './currentRank';

const series = [
  { Date: '2026-09-25', Ranking: 5 },
  { Date: '2026-09-26', Ranking: 7 },
  { Date: '2026-09-27', Ranking: 8 },
];

describe('describeCurrentRank', () => {
  it('최신 수집일에 순위가 있으면 순위와 전일 대비 변동', () => {
    expect(describeCurrentRank({ detailDate: '2026-09-27', detailRank: 8, latestDate: '2026-09-27', series }))
      .toEqual({ kind: 'ranked', rank: 8, change: -1 });
  });
  it('전일이 순위권 밖이면 NEW', () => {
    const s = [{ Date: '2026-09-26', Ranking: 501 }, { Date: '2026-09-27', Ranking: 480 }];
    expect(describeCurrentRank({ detailDate: '2026-09-27', detailRank: 480, latestDate: '2026-09-27', series: s }))
      .toEqual({ kind: 'ranked', rank: 480, change: 'New' });
  });
  it('전일 기록이 없으면 변동 없음이 아니라 null', () => {
    expect(describeCurrentRank({ detailDate: '2026-09-27', detailRank: 8, latestDate: '2026-09-27', series: [{ Date: '2026-09-27', Ranking: 8 }] }))
      .toEqual({ kind: 'ranked', rank: 8, change: null });
  });
  it('마지막 기록일이 최신 수집일이 아니면 순위권 밖', () => {
    expect(describeCurrentRank({ detailDate: '2026-09-12', detailRank: 45, latestDate: '2026-09-27', series }))
      .toEqual({ kind: 'out', lastDate: '2026-09-12', lastRank: 45 });
  });
  it('정보가 없으면 unknown', () => {
    expect(describeCurrentRank({ detailDate: null, detailRank: null, latestDate: '2026-09-27', series: [] })).toEqual({ kind: 'unknown' });
  });
});
```
Run: `npm test` → Expected: FAIL.

- [ ] **Step 3: 구현**

`src/utils/currentRank.ts`:
```ts
import { isOutOfRank } from './trendSummary';

export type CurrentRank =
  | { kind: 'ranked'; rank: number; change: number | 'New' | null }
  | { kind: 'out'; lastDate: string; lastRank: number }
  | { kind: 'unknown' };

/** 상세 API는 '마지막으로 기록된 날'의 순위를 준다. 그 날이 최신 수집일이 아니면
 *  오늘은 순위권 밖이다 — 그대로 크게 띄우면 오늘 순위로 읽힌다. */
export function describeCurrentRank({ detailDate, detailRank, latestDate, series }: {
  detailDate?: string | null; detailRank?: number | null; latestDate?: string | null;
  series: Array<{ Date: string; Ranking: number | null }>;
}): CurrentRank {
  if (!detailDate || detailRank == null) return { kind: 'unknown' };
  if (latestDate && detailDate !== latestDate) return { kind: 'out', lastDate: detailDate, lastRank: detailRank };
  const sorted = [...series].sort((a, b) => a.Date.localeCompare(b.Date));
  const i = sorted.findIndex(p => p.Date === detailDate);
  const prev = i > 0 ? sorted[i - 1] : null;
  if (!prev) return { kind: 'ranked', rank: detailRank, change: null };
  if (isOutOfRank(prev.Ranking, prev.Date)) return { kind: 'ranked', rank: detailRank, change: 'New' };
  return { kind: 'ranked', rank: detailRank, change: (prev.Ranking as number) - detailRank };
}
```
Run: `npm test` → Expected: PASS.

`src/hooks/useNovelData.ts`의 `NovelDetails` 인터페이스에 상세 API가 이미 주는 필드를 더한다(값은 이미 오고 있다 — 타입만):
```ts
  Date?: string;
  Ranking?: number;
  ThumbnailURL?: string | null;
  EarlyRetentionRate?: number | null;
  RecentRetentionRate?: number | null;
```
훅의 `maxDate`(Date)는 **전체 수집일의 최신**이다(`getAvailableDates` 최댓값, useNovelData.ts:117-120) — 작품의 마지막 기록일이 아니다. 최신 수집일 문자열은 페이지에서 `const latestDate = maxDate ? format(maxDate, 'yyyy-MM-dd') : null;`로 만든다. 작품의 마지막 기록일은 `novelAvailableDatesSet`의 최댓값이다.

`src/components/novel/NovelHeader.tsx`:
```tsx
import { Link } from 'react-router-dom';
import NovelCover from '../NovelCover';
import ChangeMark from '../ui/ChangeMark';
import InlineNums from '../ui/InlineNums';
import TagLinks from '../ui/TagLinks';
import { formatDateKo, formatInt, formatMan, formatRatio } from '../../utils/format';
import type { CurrentRank } from '../../utils/currentRank';

interface NovelHeaderDetails {
  ID: string; Title?: string | null; AuthorName?: string | null; AuthorID?: string | null; Eps?: number | null;
  View?: number | null; Like?: number | null; Fav?: number | null; Synopsis?: string | null; Tags?: string[];
  ThumbnailURL?: string | null; EarlyRetentionRate?: number | null; RecentRetentionRate?: number | null;
}

export default function NovelHeader({ details, current, backTo }: { details: NovelHeaderDetails; current: CurrentRank; backTo: { to: string; label: string } }) {
  const novelUrl = `https://novelpia.com/novel/${details.ID.includes('#') ? details.ID.split('#')[1] : details.ID}`;
  const ratio = details.View && details.View > 0 && details.Like != null ? details.Like / details.View : null;
  return (
    <>
      <Link to={backTo.to} className="detail-back">‹ {backTo.label}</Link>
      <header className="detail-head">
        <div className="detail-head__cover"><NovelCover url={details.ThumbnailURL} title={details.Title} imageClassName="detail-head__cover-img" /></div>
        <div>
          <h1 className="detail-head__title">{details.Title || '(제목 없음)'}</h1>
          <p className="detail-head__by">
            {details.AuthorID ? <Link to={`/authors/${details.AuthorID}`}>{details.AuthorName}</Link> : details.AuthorName}
            {details.Eps != null ? <> · 연재 {formatInt(details.Eps)}화</> : null}
            {' · '}<a href={novelUrl} target="_blank" rel="noopener noreferrer">노벨피아에서 보기</a>
          </p>
          <div className="detail-head__now">
            {current.kind === 'ranked' ? (
              <><span className="detail-head__rank">{current.rank}<small>위</small></span>
                <span className="detail-head__chg"><ChangeMark value={current.change} />{current.change != null ? <span>전일 대비</span> : null}</span></>
            ) : current.kind === 'out' ? (
              <span className="detail-head__out">순위권 밖 · 마지막 기록 {formatDateKo(current.lastDate)} {current.lastRank}위</span>
            ) : null}
          </div>
          <InlineNums items={[
            { label: '조회', value: formatMan(details.View) },
            { label: '추천', value: formatMan(details.Like) },
            { label: '선호', value: formatMan(details.Fav) },
            { label: '추천비', value: formatRatio(ratio, 2) },
            { label: '초반 잔류', value: formatRatio(details.EarlyRetentionRate, 0) },
            { label: '최신 잔류', value: formatRatio(details.RecentRetentionRate, 0) },
          ]} />
        </div>
      </header>
      {details.Synopsis ? <section className="detail-sec"><h2 className="detail-sec__h">작품 소개</h2><p className="detail-synopsis">{details.Synopsis}</p></section> : null}
      {details.Tags && details.Tags.length > 0 ? (
        <section className="detail-sec detail-sec--tags">
          <TagLinks tags={details.Tags} limit={details.Tags.length} hrefFor={t => `/novels/rankings?tag=${encodeURIComponent(t)}`} />
        </section>
      ) : null}
    </>
  );
}
```
주: 스펙 순서는 "머리 → 차트 → 소개 → 태그"다. `NovelHeader`는 머리만 그리고, 소개·태그는 `NovelDetailPage`가 차트 뒤에 그리도록 Step 4에서 `NovelHeader`의 두 `<section>`을 `NovelDetailSections` export로 분리한다:
```tsx
export function NovelDetailSections({ details }: { details: NovelHeaderDetails }) { /* 위 두 section 그대로 */ }
```
(`NovelHeader`에서는 두 section을 지운다.)

`src/styles/redesign.css`에 추가:
```css
.detail-back { display: inline-block; margin-top: 1.6rem; font-size: 0.875rem; font-weight: 600; color: var(--np-text-secondary); text-decoration: none; }
.detail-head { display: grid; grid-template-columns: 176px minmax(0, 1fr); gap: 2.25rem; padding: 1.4rem 0 2rem; border-bottom: 1px solid var(--np-border); }
.detail-head__cover { width: 176px; height: 248px; border-radius: 8px; overflow: hidden; background: var(--np-cover-bg); }
.detail-head__cover-img { width: 100%; height: 100%; object-fit: cover; }
.detail-head__title { margin: 0.4rem 0 0.5rem; font-size: 2rem; font-weight: 800; letter-spacing: -0.035em; line-height: 1.25; }
.detail-head__by { font-size: 0.9375rem; color: var(--np-text-secondary); }
.detail-head__by a { color: var(--np-text-heading); font-weight: 700; text-decoration: none; }
.detail-head__now { display: flex; align-items: baseline; gap: 0.875rem; margin: 1.6rem 0 1.1rem; min-height: 1rem; }
.detail-head__rank { font-size: 3.5rem; font-weight: 800; letter-spacing: -0.05em; line-height: 1; color: var(--np-text-heading); }
.detail-head__rank small { font-size: 1.5rem; margin-left: 2px; }
.detail-head__chg { display: inline-flex; gap: 0.4rem; align-items: baseline; font-size: 1rem; } .detail-head__chg .change-mark { font-size: 1rem; }
.detail-head__chg span:last-child { color: var(--np-text-faint); font-weight: 500; font-size: 0.875rem; }
.detail-head__out { font-size: 1.0625rem; font-weight: 700; color: var(--np-text-secondary); }
.detail-sec { padding: 1.9rem 0; border-bottom: 1px solid var(--np-border); }
.detail-sec__h { margin: 0 0 1rem; font-size: 1.1875rem; font-weight: 800; letter-spacing: -0.02em; }
.detail-synopsis { max-width: 760px; white-space: pre-line; font-size: 0.9375rem; line-height: 1.8; color: var(--np-text-primary); }
.detail-sec--tags { border-bottom: 0; } .detail-sec--tags .tag-links { white-space: normal; font-size: 0.875rem; }
@media (max-width: 767.98px) {
  .detail-head { grid-template-columns: 96px minmax(0, 1fr); gap: 1rem; }
  .detail-head__cover { width: 96px; height: 136px; }
  .detail-head__title { font-size: 1.375rem; }
  .detail-head__rank { font-size: 2.5rem; }
  .detail-head .inline-nums { grid-column: 1 / -1; }
}
```

- [ ] **Step 4: 페이지 연결**

`src/pages/NovelDetailPage.tsx`: `NovelDetailsCard` import와 사용을 지우고, `NovelHeader`·`NovelDetailSections`·`describeCurrentRank`를 import한다.

머리의 전일 대비는 **처음 불러온 추이**(작품 마지막 기록일로 끝나는 7일)로 한 번만 계산한다 — 사용자가 차트 기간을 과거로 옮기면 `novelData`에서 마지막 기록일이 빠져 변동이 사라지기 때문이다:
```tsx
  const latestDate = maxDate ? format(maxDate, 'yyyy-MM-dd') : null;
  const [headSeries, setHeadSeries] = useState<Array<{ Date: string; Ranking: number | null }> | null>(null);
  useEffect(() => { if (headSeries === null && novelData.length > 0) setHeadSeries(novelData); }, [novelData, headSeries]);
  useEffect(() => { setHeadSeries(null); }, [novelId]);
  const current = useMemo(
    () => describeCurrentRank({ detailDate: details?.Date, detailRank: details?.Ranking, latestDate, series: headSeries ?? [] }),
    [details, latestDate, headSeries],
  );
```
렌더 부분:
```tsx
      <>
        {details ? <NovelHeader details={details} backTo={{ to: '/novels/rankings', label: '일간 랭킹' }} current={current} /> : null}
        {/* 차트 영역 — Task 14에서 바꾼다. 지금은 기존 PanelCard를 그대로 둔다 */}
        ...기존 PanelCard 블록...
        {details ? <NovelDetailSections details={details} /> : null}
      </>
```
`NovelDetailsCard.tsx`를 지운다(Step 1에서 다른 사용처가 없을 때만): `git rm -q src/components/novel/NovelDetailsCard.tsx` (미추적이면 `rm`).

- [ ] **Step 5: 확인**

Run: `npm test && npm run build && scripts/shots.sh /tmp/nf-shots-t13 /novels/433986`
Expected: 테스트 PASS, 빌드 성공. 1200px: `‹ 일간 랭킹` → 표지 + 제목 + `작가 · 연재 N화 · 노벨피아에서 보기` + 큰 순위와 변동 + 한 줄 수치. 통계 타일·태그 알약·테두리 상자가 없다. 360px: 표지 96px 옆에 제목, 수치 줄은 아래로.
수동(Review Focus 2): 오늘 순위권에 없는 작품 ID(예: 9/27 목록에 없는 작품 — 작가 페이지에서 옛 작품을 고른다)를 열면 큰 숫자 대신 `순위권 밖 · 마지막 기록 M월 D일 N위`.
수동: 맨 아래 `#판타지`를 누르면 `/novels/rankings/<최신일>?tag=판타지`로 가서 태그가 걸려 있다.

- [ ] **Step 6: 커밋**

```bash
git add src/components/novel/NovelHeader.tsx src/utils/currentRank.ts src/utils/currentRank.test.ts src/pages/NovelDetailPage.tsx src/hooks/useNovelData.ts src/styles/redesign.css
git rm -q --cached src/components/novel/NovelDetailsCard.tsx 2>/dev/null || true
git commit -m "작품 상세 머리를 순위 한 줄과 한 줄 수치로 바꾼다

통계 타일 8개·테두리 상자·제목 아래 태그 알약을 없애고, 큰 순위와 전일 대비 변동,
'조회 | 추천 | 선호 | 추천비 | 초반/최신 잔류' 한 줄로 바꾼다. 상세 API는 마지막
기록일의 순위를 주므로, 그날이 최신 수집일이 아니면 '순위권 밖 · 마지막 기록'으로
적는다. 태그는 맨 아래 링크이고 누르면 그 태그로 거른 일간 랭킹으로 간다.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 14: 상세 차트 정리 — 훅 규칙 위반 수정 · 토큰 · 기간 바로가기

**Files:**
- Modify: `src/components/novel/SmallMultiplesChart.tsx`, `src/pages/NovelDetailPage.tsx`, `src/styles/pages.css`(`.chart-card` 계열), `src/styles/redesign.css`

**Interfaces:**
- Consumes: 기존 `SmallMultiplesChart` props(`data, hasBothPeriods, onZoomClick, isModal?, metricConfigs, modalMetric?`) — **바꾸지 않는다**(공모전 상세도 쓴다)
- Produces: 같은 props, 내부만 `MetricPanel` 하위 컴포넌트로 분리. 상세 페이지 차트 영역은 `detail-sec` 문법(가로선 섹션, `h2` + 기간 바로가기).

- [ ] **Step 1: 차트 한 칸을 컴포넌트로 뺀다(훅 규칙 위반 수정)**

현재 `SmallMultiplesChart`는 `metrics.map(...)` 안에서 `useMemo`를 두 번 부른다(린트 `react-hooks/rules-of-hooks` 224·268행). `map` 콜백 본문 전체(`const config = ...`부터 `return (<div key={metric} ...>)`까지)를 새 컴포넌트로 옮긴다:
```tsx
interface MetricPanelProps {
  metric: string;
  config: { name: string };
  data: NovelData[];
  processedData: Array<Record<string, unknown>>;
  hasBothPeriods: boolean;
  isModal: boolean;
  isMobile: boolean;
  onZoomClick: (metric: string) => void;
}

const MetricPanel = ({ metric, config, data, processedData, hasBothPeriods, isModal, isMobile, onZoomClick }: MetricPanelProps) => {
  const yDomain = useMemo(() => { /* 기존 yDomain useMemo 본문 그대로 */ }, [data, metric]);
  const dataWithTooltipTarget = useMemo(
    () => processedData.map(d => ({ ...d, tooltipTrigger: [yDomain[0], yDomain[1]] })),
    [processedData, yDomain],
  );
  // ...기존 map 콜백의 나머지 계산(upColor, pointCount, xTickFormatter ...)과 return JSX 그대로...
};
```
`SmallMultiplesChart` 본문의 `metrics.map(...)`은 다음으로 바꾼다:
```tsx
      {metrics.map(metric => (
        <MetricPanel key={metric} metric={metric} config={metricConfigs[metric]} data={data} processedData={processedData}
          hasBothPeriods={hasBothPeriods} isModal={isModal} isMobile={isMobile} onZoomClick={onZoomClick} />
      ))}
```
`processedData`의 `useMemo` 안 `const entry: { [key: string]: any }`는 `Record<string, unknown>`로, `NovelData`의 `[key: string]: any`는 `[key: string]: unknown`으로 바꾸고, 그로 인해 생기는 타입 오류는 사용하는 곳에서 `as number | null`로 좁힌다. `CenteredBar`의 `props: any`는:
```tsx
const CenteredBar = (props: { fill?: string; x?: number; y?: number; width?: number; height?: number }) => {
```

- [ ] **Step 2: 색·표시선을 토큰과 라벨로**

같은 파일에서:
- `CustomizedDot`의 `stroke="#d9534f"` → `stroke="var(--np-text-faint)"`, `fill="#8884d8"` → `fill="var(--np-accent)"`.
- `<Line ... stroke="var(--np-accent)">`는 그대로(이제 빨강).
- `CartesianGrid`는 `vertical={false}` 로 두고 `strokeDasharray` 제거(가로선만).
- 표시선에 라벨을 붙인다(상세 페이지의 안내 상자를 대체):
```tsx
                    {hasBothPeriods && (
                      <ReferenceLine x="2025-07-21" stroke="var(--np-text-faint)" strokeDasharray="3 3"
                        label={{ value: '300→500위 집계', position: 'insideTopRight', fill: 'var(--np-text-secondary)', fontSize: 11 }} />
                    )}
```
- "자세히 보기" 버튼(`<Button variant="outline-secondary" ...>`)을 `<button type="button" className="chart-zoom-link" onClick={() => onZoomClick(metric)}>크게 보기</button>`로 바꾸고, 파일의 `import { Button } from 'react-bootstrap';`를 지운다.

`src/styles/pages.css`의 `.chart-card`, `.chart-card-header`, `.chart-card-title` 규칙에서 테두리·배경·반경을 없앤다:
```css
.chart-card { border: 0; background: none; border-radius: 0; }
.chart-card-header { padding: 0 0 0.4rem; background: none; border: 0; }
.chart-card-title { font-size: 0.875rem; font-weight: 700; color: var(--np-text-heading); }
```
`src/styles/redesign.css`에 `.chart-zoom-link { border: 0; background: none; padding: 0; font-size: 0.8125rem; color: var(--np-text-secondary); text-decoration: underline; text-underline-offset: 3px; }`.

- [ ] **Step 3: 상세 페이지 차트 영역을 섹션 문법으로**

`src/pages/NovelDetailPage.tsx`의 `<PanelCard title="지표별 상세 추이" meta="기간을 선택해..." ...>` 블록을 다음으로 바꾼다. 안내 `Alert`(참고: 2025-07-21...)는 지운다(표시선 라벨이 대신한다). "데이터가 없습니다" `Alert`는 `<p className="empty-line">선택한 기간에 기록이 없습니다.</p>`로:
```tsx
          <section className="detail-sec">
            <div className="detail-sec__head">
              <h2 className="detail-sec__h">지표 변화</h2>
              <div className="detail-sec__range">
                {[7, 30, 90].map(n => (
                  <button key={n} type="button" className={rangeDays === n ? 'is-on' : ''} onClick={() => pickRange(n)}>{n}일</button>
                ))}
                <DateRangePicker startDate={startDate} endDate={endDate} minDate={minDate} maxDate={maxDate}
                  availableDates={Array.from(novelAvailableDatesSet).map(d => parseISO(d))} novelAvailableDatesSet={novelAvailableDatesSet}
                  onStartDateChange={handleStartDateChange} onEndDateChange={handleEndDateChange}
                  isNovelDetailPage={false} noMargin={true} showNovelDataIndicator={false} />
              </div>
            </div>
            <div className="detail-chart-area position-relative" aria-busy={loading}>
              <div style={{ opacity: loading ? 0.5 : 1, transition: 'opacity 0.2s' }}>
                {novelData.length > 0 ? (
                  <Suspense fallback={<div className="rank-skeleton" aria-busy="true"><div /><div /><div /></div>}>
                    <SmallMultiplesChart data={novelData} hasBothPeriods={hasBothPeriods} onZoomClick={handleZoomClick} metricConfigs={metricConfigs} />
                  </Suspense>
                ) : (!loading && <p className="empty-line">선택한 기간에 기록이 없습니다.</p>)}
              </div>
            </div>
          </section>
```
바로가기 상태와 핸들러를 컴포넌트에 추가한다. 끝은 **작품의 마지막 기록일**이다(`maxDate`는 전체 최신 수집일이라, 오늘 순위권 밖인 작품은 빈 차트가 된다). 훅의 초기 기간이 이미 "마지막 기록일로 끝나는 7일"이라 초기값 7과 맞는다:
```tsx
  const novelLastDate = useMemo(() => {
    const last = [...novelAvailableDatesSet].sort().at(-1);
    return last ? parseISO(last) : null;
  }, [novelAvailableDatesSet]);
  const [rangeDays, setRangeDays] = useState<number | null>(7);
  const pickRange = (n: number) => {
    if (!novelLastDate) return;
    const start = subDays(novelLastDate, n - 1);
    setRangeDays(n);
    setStartDate(start);
    setEndDate(novelLastDate);
    fetchNovelData(start, novelLastDate);
  };
```
(`fetchNovelData`의 실제 인자 순서는 Run: `grep -n "const fetchNovelData" -A3 src/hooks/useNovelData.ts`로 확인하고 맞춘다.)
`handleStartDateChange`·`handleEndDateChange` 안에서 `setRangeDays(null)`을 부른다(직접 고르면 바로가기 표시를 끈다). import에 `subDays`·`format`·`parseISO`(date-fns), `useMemo`·`useEffect`·`useState`(react) 중 없는 것을 더하고 `Alert`, `InfoCircle`, `PanelCard` import 중 쓰지 않게 된 것을 지운다. `src/styles/redesign.css`:
```css
.detail-sec__head { display: flex; align-items: center; gap: 1.25rem; flex-wrap: wrap; margin-bottom: 1rem; }
.detail-sec__head .detail-sec__h { margin: 0; }
.detail-sec__range { display: flex; align-items: center; gap: 0.875rem; font-size: 0.875rem; }
.detail-sec__range > button { border: 0; background: none; padding: 0; font-weight: 600; color: var(--np-text-faint); }
.detail-sec__range > button.is-on { color: var(--np-text-heading); }
```

- [ ] **Step 4: 확인**

Run: `npm run build && npx eslint src/components/novel/SmallMultiplesChart.tsx src/pages/NovelDetailPage.tsx`
Expected: 성공, 두 파일 린트 0건(rules-of-hooks·no-explicit-any·exhaustive-deps 사라짐 — 남으면 그 줄을 고친다).
Run: `scripts/shots.sh /tmp/nf-shots-t14 /novels/433986`
Expected: 차트 5개(랭킹·점수·조회수·추천·선호)가 테두리 없이 가로선 섹션 안에 있고, 제목 옆에 `7일 30일 90일` + 기간 선택. 다크에서 선·축 글자가 보인다.
수동: `90일` → 기간이 바뀌고 `90일`만 진하다. `크게 보기` → 모달에 그 지표 하나와 아래 Brush(구간 선택 막대). 2025-07 이전부터 기록이 있는 오래된 작품에서는 표시선에 `300→500위 집계` 라벨이 보인다. 공모전 작품 상세(`/contests/2025/novels/<id>`)도 여전히 차트가 뜬다(같은 컴포넌트).

- [ ] **Step 5: 커밋**

```bash
git add src/components/novel/SmallMultiplesChart.tsx src/pages/NovelDetailPage.tsx src/styles/pages.css src/styles/redesign.css
git commit -m "상세 차트의 훅 규칙 위반을 고치고 섹션 문법으로 바꾼다

지표마다 map 안에서 useMemo를 부르던 구조를 MetricPanel 컴포넌트로 빼서 훅
규칙 위반을 없앴다(props는 그대로라 공모전 상세도 그대로 쓴다). 지표 5개·Brush·
크게 보기는 유지하고, 300→500위 안내 상자는 차트 표시선의 라벨로 옮겼다.
기간은 7/30/90일 바로가기와 직접 선택 둘 다 된다.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 15: 결정 기록 · 전체 점검

**Files:**
- Modify: `docs/DECISIONS.md`, `CLAUDE.md`(바뀐 규칙 줄만)

- [ ] **Step 1: 금지 패턴 검색**

Run:
```bash
grep -rn "rounded-pill\|PanelCard\|page-hero__eyebrow\|<Badge" src/pages/NovelRankingsPage.tsx src/pages/NovelDetailPage.tsx src/components/ranking src/components/novel/NovelHeader.tsx src/components/ui/{PageTitle,DateNav,TabBar,InlineNums,Footnotes,TagLinks,Sparkline,ChangeMark}.tsx
grep -rnE "#[0-9a-fA-F]{6}\b" src/styles/redesign.css src/components/ranking src/components/ui src/components/novel/NovelHeader.tsx
```
Expected: 첫 명령 결과 없음. 두 번째는 결과 없음(쇼케이스 칩의 `#d42a44`·`#ffffff`는 `components.css`에 있고 Global Constraints 예외).

- [ ] **Step 2: 전체 확인**

Run: `npm test && npm run build && npm run lint 2>&1 | tail -3 && node scripts/contrast.mjs`
Expected: 테스트 전부 PASS, 빌드 성공, 대비 통과. 린트는 남은 오류가 **공모전·태그 파일에만** 있다(계획 2~3 범위): `npx eslint src 2>&1 | grep -E "^/" | grep -v -E "Contest|TagRankings|TagTrends|Analysis"`가 비어 있어야 한다.
Run: `scripts/shots.sh /tmp/nf-shots-final /novels/rankings /novels/433986 /tags/rankings /없는주소`
Expected: 일간·상세는 시안(`table.html`, `A.html#detail`)과 같은 구조, 두 테마, 세 폭에서 가로 스크롤 없음. 태그 랭킹은 새 토큰만 입은 기존 구조(계획 3에서 바꾼다) — 깨진 곳이 없으면 된다.

- [ ] **Step 3: 기능 보존 체크리스트(스펙 §10 중 계획 1 범위)**

dev 서버에서 하나씩 확인하고 결과를 커밋 본문에 적는다:
- 일간 랭킹: 날짜 선택(달력은 수집된 날만), 검색, 회차 범위, 태그 모두/일부 포함·제외, 조건식과 오류 표시, 초기화, 태그 클릭 → 필터, 10열 정렬, 쇼케이스 두 그룹, 급상승·신규, 표지 가리기(헤더 토글), 가상 스크롤(끝까지 스크롤해 500위가 보이는지), 모바일
- 작품 상세: 지표 5개, 기간 선택·바로가기, 크게 보기, Brush, 7/21 표시선, 작가 링크, 노벨피아 링크, 줄거리, 태그
- 공통: 라이트/다크 전환, 검색(작품·작가), 푸터 링크

- [ ] **Step 4: DECISIONS.md에 항목 추가 · 대체 표시**

`docs/DECISIONS.md` 끝에 다음 항목을 추가한다:
```markdown
## 2026-09-28 — 웹 개편 1단계: 차트 페이지 토큰 · 일간 랭킹 · 작품 상세

**결정:** 스펙 `docs/superpowers/specs/2026-09-28-webapp-redesign-design.md` 의 1단계를 적용했다. 서체 Wanted Sans,
상승 빨강·하락 파랑, 면 하나(섹션은 가로선), 숫자 우측 정렬. 일간 랭킹은 오른쪽 서랍 필터 + 10열 표 + 행 펼침,
작품 상세는 큰 순위 + 한 줄 수치 + 가로선 섹션 차트.

**이유:** 카드 격자·알약 칩·설명 부제·숫자 타일이 "AI가 만든 화면" 인상의 대부분이었다. 사용자는 웹소설 독자라
멜론·네이버 시리즈 같은 차트 페이지 문법이 익숙하다. 토큰 이름은 그대로 두고 값만 바꿔 전 페이지를 한 번에
재칠했고, 글자색은 면·호버면 위 4.5:1을 scripts/contrast.mjs로 검사한다(시안의 라이트 #e5304b 4.32 등은 미달이라 보정).

**영향:**
- 정렬은 "새 열은 내림차순부터, 값 없는 행은 방향과 무관하게 맨 아래"로 통일했다. 이전의 '순위 오름차순에서 점수를
  누르면 점수 오름차순' 동작은 근거가 기록돼 있지 않아 없앴다.
- 상세 API는 마지막 기록일의 순위를 준다 — 그날이 최신 수집일이 아니면 '순위권 밖 · 마지막 기록'으로 적는다
  (`src/utils/currentRank.ts`). 큰 숫자로 띄우지 말 것.
- 쇼케이스는 늘 최신 수집일이다. 과거 날짜의 표를 볼 때만 'MM.DD 기준'을 붙인다.
- 공모전·태그·분석 페이지는 새 토큰만 입었고 구조는 계획 2~4에서 바꾼다.

**상태:** 유효
```
그리고 다음 기존 항목의 `**상태:**` 줄을 `대체됨 (→ 2026-09-28, 웹 개편 1단계)`로 바꾼다(항목 제목으로 찾는다):
- `## 시각 테마 교체: 네이비 대시보드 → 클린 모던 (2026-08-29)`
- `## 표 정렬 (2026-08-30)`
- `## 쇼케이스 두 칩의 강조 수준을 맞춘다 (2026-08-30)`
각 항목에 `**상태:**` 줄이 없으면 항목 끝에 `**상태:** 대체됨 (→ 2026-09-28, 웹 개편 1단계)`를 추가한다.

`CLAUDE.md`의 `- **표지를 그리는 유일한 경로는 \`NovelCover\`**...` 줄은 그대로 두고, `## 컨벤션 / 함정` 목록 끝에 한 줄 추가:
```markdown
- 색은 `src/styles/tokens.css` 토큰으로만. 글자색을 바꾸면 `node webapp/frontend/scripts/contrast.mjs`로 4.5:1을 확인한다.
```

- [ ] **Step 5: 커밋**

```bash
git add docs/DECISIONS.md CLAUDE.md
git commit -m "웹 개편 1단계 결정을 기록한다

토큰·서체·정렬 규칙 변경, 상세의 '순위권 밖' 표기, 쇼케이스 기준일 표기를
DECISIONS에 남기고 대체된 2026-08-29/30 항목을 표시한다.

기능 보존 확인(스펙 §10, 계획 1 범위): <Step 3 결과를 여기에 적는다>

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## 이후 계획(이 문서 범위 밖)

- **계획 2 — 공모전 3종**: `RankTable`·`FilterDrawer(extra)`·`Showcase`(시상대 배치)·`NovelHeader` 재사용, 공모전 쪽 중복 코드(`RankChangeIndicator`, 수상 배지 표, `StatBlock`, 태그 필터) 제거, 공모전 태그의 3-track "합계/평균" 전환과 포지셔닝 맵 재칠, 사이드바 관련 CSS·`NovelFilterControls`·`TagFilter`·`ContestNovelFilterControls` 삭제, 공모전 파일 린트 정리.
- **계획 3 — 태그 랭킹 · 태그 트렌드**: 표 + 탭 + 구역 필터 + 행 펼침 + 지형 지도, 태그 트렌드 탭 6개.
- **계획 4 — 분석 · 작가 · 수집 기록**: 분석 일곱 섹션(그래프 없음, 요약 자리), 백엔드 `tag_combinations` 기준 변경(pytest), 작가 행 목록, 수집 기록 재칠.
