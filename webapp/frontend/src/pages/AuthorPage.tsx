import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Table, Spinner, Alert, Container } from 'react-bootstrap';
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
          <Table hover responsive className="custom-table">
            <thead>
              <tr>
                <th>제목</th>
                <th>회차</th>
                <th>조회</th>
                <th>추천</th>
                <th>선호</th>
                <th>알람</th>
                <th>태그</th>
              </tr>
            </thead>
            <tbody>
              {novels.length > 0 ? (
                novels.map((novel) => (
                  <tr key={novel.ID}>
                    <td>
                      <Link to={`/novels/${novel.ID}`}>{novel.Title || '(제목 없음)'}</Link>
                    </td>
                    <td>{novel.Eps}</td>
                    <td>{novel.View}</td>
                    <td>{novel.Like}</td>
                    <td>{novel.Fav}</td>
                    <td>{novel.Alr}</td>
                    <td>{novel.Tags.join(', ')}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={7} className="text-center py-4">No novels found for this author.</td>
                </tr>
              )}
            </tbody>
          </Table>
        </>
      )}
    </Container>
  );
};



export default AuthorPage;
