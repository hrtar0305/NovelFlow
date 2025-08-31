import { Routes, Route, Navigate } from 'react-router-dom';
import { Container } from 'react-bootstrap';
import Header from './components/Header';
import NovelRankingsPage from './pages/NovelRankingsPage';
import TagRankingsPage from './pages/TagRankingsPage';
import AnalysisDashboardPage from './pages/AnalysisDashboardPage';
import NovelDetailPage from './pages/NovelDetailPage';
import AuthorPage from './pages/AuthorPage';
import DataCollectionPage from './pages/DataCollectionPage';
import TagTrendsPage from './pages/TagTrendsPage';
import NovelTrendsPage from './pages/NovelTrendsPage';
import './styles/custom.css';

function App() {
  return (
    <>
      <Header />
      <main style={{ minHeight: 'calc(100vh - 56px)', backgroundColor: '#fff' }}>
        <Container fluid>
          <div className="content-wrapper">
            <Routes>
              <Route path='/' element={<Navigate to="/novels/rankings" replace />} />
              <Route path='/novels/rankings/:date?' element={<NovelRankingsPage />} />
              <Route path='/tags/rankings/:date?' element={<TagRankingsPage />} />
              <Route path='/trends' element={<AnalysisDashboardPage />} />
              <Route path='/trends/tags' element={<TagTrendsPage />} />
              <Route path='/trends/novels' element={<NovelTrendsPage />} />
              <Route path='/novels/:novelId' element={<NovelDetailPage />} />
              <Route path='/authors/:authorId' element={<AuthorPage />} />
              <Route path='/data-collection-info' element={<DataCollectionPage />} />
            </Routes>
          </div>
        </Container>
      </main>
    </>
  );
}

export default App;