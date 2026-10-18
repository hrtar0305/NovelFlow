/// <reference types="vitest/config" />
import { defineConfig, type Plugin } from 'vite'
import type { OutputBundle, OutputChunk } from 'rollup'
import react from '@vitejs/plugin-react'

/**
 * 첫 방문 주소의 페이지 코드를 앱 코드와 나란히 받게 한다(2026-10-19). 페이지는 lazy 라 예전엔 앱 코드를 다 받고 실행한 뒤에야 페이지 코드
 * (와 그 조각 15개 남짓)를 부르기 시작해, 느린 회선에서 왕복 한 단계가 더 쌓였다. 빌드 때 주소 → 페이지 조각(과 정적 의존 조각 · CSS)을 표로
 * 만들어 index.html 에 작은 스크립트로 넣고, 그 스크립트가 지금 주소에 맞는 것만 `modulepreload` 한다. 주소 규칙은 App.tsx 의 Route 와 맞춘다.
 */
const ROUTE_PAGES: [string, string][] = [
  ['^/contests/\\d{4}/tags/rankings', 'ContestTagRankingsPage'],
  ['^/contests/\\d{4}/novels/', 'ContestNovelDetailPage'],
  ['^/contests(/|$)', 'ContestPage'],
  ['^/($|novels/rankings)', 'NovelRankingsPage'],
  ['^/novels/[^/]+/?$', 'NovelDetailPage'],
  ['^/tags/rankings', 'TagRankingsPage'],
  ['^/tags/trends', 'TagTrendsPage'],
  ['^/trends/?$', 'AnalysisDashboardPage'],
  ['^/authors/', 'AuthorPage'],
  ['^/data-collection-info', 'DataCollectionPage'],
]

function routePreload(): Plugin {
  return {
    name: 'novelflow-route-preload',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler(html, ctx) {
        const bundle = ctx.bundle as OutputBundle | undefined
        if (!bundle) return html
        const chunks = Object.values(bundle).filter((c): c is OutputChunk => c.type === 'chunk')
        const byFile = new Map(chunks.map(c => [c.fileName, c]))
        const entry = new Set(chunks.filter(c => c.isEntry).flatMap(c => [c.fileName, ...c.imports]))   // 이미 받는 앱 코드
        const table = ROUTE_PAGES.map(([re, page]) => {
          const root = chunks.find(c => c.facadeModuleId?.endsWith(`/src/pages/${page}.tsx`))
          const js = new Set<string>(), css = new Set<string>()
          const walk = (c?: OutputChunk) => {
            if (!c || js.has(c.fileName) || entry.has(c.fileName)) return
            js.add(c.fileName)
            c.viteMetadata?.importedCss.forEach(f => css.add(f))
            c.imports.forEach(f => walk(byFile.get(f)))
          }
          walk(root)
          return [re, [...js], [...css]]
        }).filter(([, js]) => js.length)
        const script = `(function(){var T=${JSON.stringify(table)},p=location.pathname;for(var i=0;i<T.length;i++){if(new RegExp(T[i][0]).test(p)){`
          + `T[i][1].forEach(function(f){var l=document.createElement('link');l.rel='modulepreload';l.href='/'+f;document.head.appendChild(l)});`
          + `T[i][2].forEach(function(f){var l=document.createElement('link');l.rel='preload';l.as='style';l.href='/'+f;document.head.appendChild(l)});break}}})();`
        return [{ tag: 'script', children: script, injectTo: 'head' }]
      },
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), routePreload()],
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
