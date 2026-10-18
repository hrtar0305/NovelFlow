import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App.tsx'
import { ThemeProvider } from './theme/ThemeProvider.tsx'
import { CoverMaskProvider } from './theme/CoverMaskProvider.tsx'

import 'bootstrap/dist/css/bootstrap.min.css'
import { runBootPrefetch } from './services/bootPrefetch'

// 그 주소의 데이터(날짜 목록 → 최신 날짜 데이터)를 페이지 코드와 나란히 받기 시작한다 — services/bootPrefetch.
runBootPrefetch(window.location.pathname, window.location.search)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <CoverMaskProvider>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </CoverMaskProvider>
    </ThemeProvider>
  </StrictMode>,
)
