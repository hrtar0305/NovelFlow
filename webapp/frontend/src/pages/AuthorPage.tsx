import { useState, useEffect } from 'react';
import NovelCover from '../components/NovelCover';
import { useParams, Link } from 'react-router-dom';
import { Spinner, Alert } from 'react-bootstrap';
import { getAuthorNovels } from '../services/api';
import PageHero from '../components/ui/PageHero';
import EmptyState from '../components/ui/EmptyState';

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
  ThumbnailURL?: string | null;
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

  return (
    <div className="page-shell author-page">
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
          <PageHero
            title={authorName || '작가 페이지'}
          />
          <section className="author-work-section">
              {novels.length > 0 ? (
                <div className="author-work-grid">
                  {novels.map((novel) => (
                    <Link key={novel.ID} to={`/novels/${novel.ID}`} className="author-work-card media-rank-card media-rank-card--poster">
                      <div className="media-rank-card__cover">
                        <NovelCover
                          url={novel.ThumbnailURL}
                          title={novel.Title}
                          imageClassName="media-rank-card__cover-image"
                        />
                      </div>
                      <div className="media-rank-card__overlay">
                        <div className="media-rank-card__title">{novel.Title || '(제목 없음)'}</div>
                        <div className="media-rank-card__meta">
                          <span className="mini-kpi">{novel.Eps.toLocaleString()}화</span>
                          <span className="mini-kpi">조회 {formatNum(novel.View)}</span>
                          <span className="mini-kpi">선호 {formatNum(novel.Fav)}</span>
                        </div>
                        {novel.Tags && novel.Tags.length > 0 && (
                          <div className="author-work-tags">
                            {novel.Tags.slice(0, 6).map((tag) => (
                              <span key={tag} className="author-page-tag-chip">{tag}</span>
                            ))}
                          </div>
                        )}
                      </div>
                    </Link>
                  ))}
                </div>
              ) : (
                <EmptyState title="이 작가의 작품을 찾을 수 없습니다." />
              )}
          </section>
        </>
      )}
    </div>
  );
};

export default AuthorPage;
