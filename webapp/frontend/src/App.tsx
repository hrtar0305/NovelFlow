import { Suspense, lazy } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import AppShell from './components/layout/AppShell';
import './styles/index.css';

const NovelRankingsPage = lazy(() => import('./pages/NovelRankingsPage'));
const TagRankingsPage = lazy(() => import('./pages/TagRankingsPage'));
const AnalysisDashboardPage = lazy(() => import('./pages/AnalysisDashboardPage'));
const NovelDetailPage = lazy(() => import('./pages/NovelDetailPage'));
const AuthorPage = lazy(() => import('./pages/AuthorPage'));
const ContestPage = lazy(() => import('./pages/ContestPage'));
const ContestNovelDetailPage = lazy(() => import('./pages/ContestNovelDetailPage'));
const ContestTagRankingsPage = lazy(() => import('./pages/ContestTagRankingsPage'));
const DataCollectionPage = lazy(() => import('./pages/DataCollectionPage'));
const TagTrendsPage = lazy(() => import('./pages/TagTrendsPage'));

const routeFallback = (
  <div className="route-loading" aria-live="polite">
    <span className="route-loading__spinner" />
  </div>
);

function App() {
  return (
    <AppShell>
      <Suspense fallback={routeFallback}>
        <Routes>
          <Route path='/' element={<Navigate to="/novels/rankings" replace />} />
          <Route path='/contests' element={<Navigate to="/contests/2025" replace />} />
          <Route path='/novels/rankings/:date?' element={<NovelRankingsPage />} />
          <Route path='/tags/rankings/:date?' element={<TagRankingsPage />} />
          <Route path='/trends' element={<AnalysisDashboardPage />} />
          <Route path='/tags/trends' element={<TagTrendsPage />} />
          {/* 태그 트렌드는 한때 데이터 분석의 하위 경로였다. 지금은 독립 화면이고
              `/tags/rankings` 와 짝을 이루므로 `/tags/trends` 로 옮겼다.
              옛 링크와 북마크를 위해 리다이렉트를 남긴다. */}
          <Route path='/trends/tags' element={<Navigate to="/tags/trends" replace />} />
          <Route path='/novels/:novelId' element={<NovelDetailPage />} />
          <Route path='/contests/:year/:date?' element={<ContestPage />} />
          <Route path='/contests/:year/tags/rankings/:date?' element={<ContestTagRankingsPage />} />
          <Route path='/contests/:year/novels/:novelId' element={<ContestNovelDetailPage />} />
          <Route path='/authors/:authorId' element={<AuthorPage />} />
          <Route path='/data-collection-info' element={<DataCollectionPage />} />
        </Routes>
      </Suspense>
    </AppShell>
  );
}

export default App;
