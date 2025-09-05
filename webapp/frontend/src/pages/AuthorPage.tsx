import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Spinner, Alert, Container, Card, Row, Col, Badge } from 'react-bootstrap';
import { getAuthorNovels } from '../services/api';
import axios from 'axios'; // axios import 추가

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

const AuthorPage = () => {
  const { authorId } = useParams<{ authorId: string }>();
  const [novels, setNovels] = useState<Novel[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [authorName, setAuthorName] = useState<string | null>(null);

  useEffect(() => {
    if (!authorId) return;

    const fetchAuthorNovels = async () => {
      setLoading(true);
      setError(null);
      try {
        const response = await getAuthorNovels(authorId);
        const sortedNovels = response.data.sort((a: Novel, b: Novel) => a.Title.localeCompare(b.Title));
        setNovels(sortedNovels);
        if (sortedNovels.length > 0) {
          setAuthorName(sortedNovels[0].AuthorName);
        }
      } catch (err) {
        if (axios.isAxiosError(err) && err.response?.status === 404) {
          setError('해당 작가를 찾을 수 없습니다.');
        } else {
          setError('Failed to fetch author\'s novels. Please try again later.');
        }
        setNovels([]);
      } finally {
        setLoading(false);
      }
    };

    fetchAuthorNovels();
  }, [authorId]);

  return (
    <Container className="py-4">
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
          {authorName && <h1 className="mb-4 h2">{authorName}</h1>}
          <div>
            {novels.length > 0 ? (
              novels.map((novel) => (
                <Card key={novel.ID} className="mb-3 shadow-sm">
                  <Card.Body className="p-3">
                    <Card.Title className="h5 mb-2">
                      <Link to={`/novels/${novel.ID}`} className="text-dark text-decoration-none">
                        {novel.Title || '(제목 없음)'}
                      </Link>
                    </Card.Title>
                    <Row xs={2} md={4} className="g-4 g-md-2 text-center text-md-start mb-2">
                      <Col><div className="text-muted small">회차</div><strong>{novel.Eps.toLocaleString()}화</strong></Col>
                      <Col><div className="text-muted small">조회수</div><strong>{novel.View.toLocaleString()}</strong></Col>
                      <Col><div className="text-muted small">추천</div><strong>{novel.Like.toLocaleString()}</strong></Col>
                      <Col><div className="text-muted small">선호</div><strong>{novel.Fav.toLocaleString()}</strong></Col>
                    </Row>
                    {novel.Tags && novel.Tags.length > 0 && (
                      <div className="pt-2 border-top">
                        <div className="d-flex flex-wrap gap-1">
                          {novel.Tags.map((tag) => (
                            <Badge pill bg="secondary" key={tag} className="fw-normal" style={{ fontSize: '0.85rem' }}>{tag}</Badge>
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
    </Container>
  );
};



export default AuthorPage;
