import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App.tsx'
import { ThemeProvider } from './theme/ThemeProvider.tsx'
import { CoverMaskProvider } from './theme/CoverMaskProvider.tsx'

import 'bootstrap/dist/css/bootstrap.min.css'
import './index.css'

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
