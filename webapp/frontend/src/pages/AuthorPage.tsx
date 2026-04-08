import { useState, useEffect } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { Spinner, Alert, Card, Row, Col } from 'react-bootstrap';
import { getAuthorNovels } from '../services/api';

// API로부터 받는 소설 데이터 타입 정의
interface Novel {
  ID: string;
  Title: string;
  AuthorName: string;
  AuthorID: number;
  Eps: number;
  View: number;
  Like: number;
  Fav: number;
  Alr: number;
  Tags: string[];
}

const formatNum = (n: number): string => {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, '')}k`;
  return n.toLocaleString();
};

const AuthorPage = () => {
  const { authorId } = useParams<{ authorId: string }>();
  const [novels, setNovels] = useState<Novel[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [authorName, setAuthorName] = useState<string | null>(null);
  const navigate = useNavigate();
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);

  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);


  useEffect(() => {
    if (!authorId) return;

    const fetchAuthorNovels = async () => {
      setLoading(true);
      setError(null);
      try {
        const response = await getAuthorNovels(authorId);
        if (response.data && Array.isArray(response.data) && response.data.length > 0) {
          const sortedNovels = response.data.sort((a: Novel, b: Novel) => a.Title.localeCompare(b.Title));
          setNovels(sortedNovels);
          if (sortedNovels.length > 0) {
            setAuthorName(sortedNovels[0].AuthorName);
          }
        } else {
          // 데이터가 없거나 배열이 아닌 경우 '찾을 수 없음'으로 처리
          setError('해당 작가를 찾을 수 없습니다.');
          setNovels([]);
        }
      } catch (err: any) {
        if (err.response && (err.response.status === 404 || err.response.status === 304)) {
          setError('해당 작가를 찾을 수 없습니다.');
        } else {
          setError('작품 목록을 불러오는 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.');
        }
        setNovels([]);
      } finally {
        setLoading(false);
      }
    };

    fetchAuthorNovels();
  }, [authorId]);

  const handleCardClick = (novelId: string) => {
    if (isMobile) {
      navigate(`/novels/${novelId}`);
    }
  };

  return (
    <div className="np-page-container">
      {loading ? (
        <div className="text-center">
          <Spinner animation="border" />
        </div>
      ) : error ? (
        <Alert variant="danger" className="text-center">
          {error}
        </Alert>
      ) : (
        <>
          {authorName && <h1 className="mb-2 h2 fs-page-title">{authorName}</h1>}
          <div>
            {novels.length > 0 ? (
              novels.map((novel) => (
                <Card 
                  key={novel.ID} 
                  className="mb-2 shadow-sm"
                  onClick={() => handleCardClick(novel.ID)}
                  style={isMobile ? { cursor: 'pointer' } : {}}
                >
                  <Card.Body className="p-3 author-novel-card-body">
                    <Card.Title className="h5 mb-2 fs-author-page-novel-title">
                      {isMobile ? (
                        <span className="author-novel-title-link">{novel.Title || '(제목 없음)'}</span>
                      ) : (
                        <Link to={`/novels/${novel.ID}`} className="author-novel-title-link">
                          {novel.Title || '(제목 없음)'}
                        </Link>
                      )}
                    </Card.Title>
                    {/* 모바일: 인라인 한 줄 */}
                    <div className="d-md-none author-stats-inline">
                      <span>{novel.Eps.toLocaleString()}화</span>
                      <span className="author-stats-dot">·</span>
                      <span>조회 {formatNum(novel.View)}</span>
                      <span className="author-stats-dot">·</span>
                      <span>선호 {formatNum(novel.Fav)}</span>
                    </div>
                    {/* 데스크탑: 그리드 */}
                    <Row xs={4} className="d-none d-md-flex g-2 text-start mb-2 author-page-stats">
                      <Col><div className="author-stat-label">회차</div><strong className="author-stat-value">{novel.Eps.toLocaleString()}화</strong></Col>
                      <Col><div className="author-stat-label">조회수</div><strong className="author-stat-value">{novel.View.toLocaleString()}</strong></Col>
                      <Col><div className="author-stat-label">추천</div><strong className="author-stat-value">{novel.Like.toLocaleString()}</strong></Col>
                      <Col><div className="author-stat-label">선호</div><strong className="author-stat-value">{novel.Fav.toLocaleString()}</strong></Col>
                    </Row>
                    {novel.Tags && novel.Tags.length > 0 && (
                      <div className="pt-2 border-top">
                        <div className="d-flex flex-wrap gap-1">
                          {novel.Tags.map((tag) => (
                            <span key={tag} className="author-page-tag-chip">{tag}</span>
                          ))}
                        </div>
                      </div>
                    )}
                  </Card.Body>
                </Card>
              ))
            ) : (
              <Alert variant="info">이 작가의 작품을 찾을 수 없습니다.</Alert>
            )}
          </div>
        </>
      )}
    </div>
  );
};



export default AuthorPage;
