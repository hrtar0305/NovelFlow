import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Card, Badge } from 'react-bootstrap';

interface ContestNovelDetails {
  ID: string;
  Title: string;
  AuthorName: string;
  AuthorID: string;
  Synopsis: string;
  Tags: string[];
  View?: number;
  Like?: number;
  Fav?: number;
  Alr?: number;
  Eps?: number;
  RetentionRate?: number;
}

interface ContestNovelDetailsCardProps {
  details: ContestNovelDetails | null;
}

const formatStatNumber = (num: number): string => {
  if (num >= 1000000) {
    return `${(num / 1000000).toFixed(1).replace(/\.0$/, '')}M`;
  }
  if (num >= 1000) {
    return `${(num / 1000).toFixed(1).replace(/\.0$/, '')}k`;
  }
  return num.toLocaleString();
};

const ContestNovelDetailsCard: React.FC<ContestNovelDetailsCardProps> = ({ details }) => {
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);

  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  if (!details) {
    return null;
  }

  const { View = 0, Like = 0, Fav = 0, Alr = 0, Eps = 0, RetentionRate } = details;

  return (
    <Card className="mb-3">
      <Card.Header className="novel-card-header">
        <div className="d-flex align-items-baseline gap-1">
          <h5 className="mb-0 fw-bold fs-novel-title">{details.Title}</h5>
          <a href={`https://novelpia.com/novel/${details.ID}`} target="_blank" rel="noopener noreferrer" style={{ color: 'inherit' }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
              <polyline points="15 3 21 3 21 9"></polyline>
              <line x1="10" y1="14" x2="21" y2="3"></line>
            </svg>
          </a>
        </div>
        <div className="text-muted">
          <Link to={`/authors/${details.AuthorID}`} className="fw-bold fs-author-name">{details.AuthorName}</Link>
        </div>
      </Card.Header>
      <Card.Body className="novel-card-body">
        <div className="d-flex flex-wrap gap-1 mb-1">
          {details.Tags.map(tag => (
            <Badge pill bg="info" text="dark" className="fw-bold fs-tag-badge" key={tag}>
              #{tag}
            </Badge>
          ))}
        </div>

        <div className="d-flex flex-wrap justify-content-around justify-content-md-start text-center mb-2 gap-3 gap-md-4">
          <div><strong className="fs-stat">{isMobile ? formatStatNumber(View) : View.toLocaleString()}</strong><div className="text-muted" style={{fontSize: '0.65rem'}}>조회</div></div>
          <div><strong className="fs-stat">{isMobile ? formatStatNumber(Like) : Like.toLocaleString()}</strong><div className="text-muted" style={{fontSize: '0.65rem'}}>추천</div></div>
          <div><strong className="fs-stat">{isMobile ? formatStatNumber(Fav) : Fav.toLocaleString()}</strong><div className="text-muted" style={{fontSize: '0.65rem'}}>선호</div></div>
          <div><strong className="fs-stat">{isMobile ? formatStatNumber(Alr) : Alr.toLocaleString()}</strong><div className="text-muted" style={{fontSize: '0.65rem'}}>알람</div></div>
          <div><strong className="fs-stat">{Eps.toLocaleString()}</strong><div className="text-muted" style={{fontSize: '0.65rem'}}>회차</div></div>
          {typeof RetentionRate === 'number' && <div><strong className="fs-stat">{(RetentionRate * 100).toFixed(1)}%</strong><div className="text-muted" style={{fontSize: '0.65rem'}}>연독률</div></div>}
        </div>
        
        <Card.Text className="mt-2 p-2 bg-light rounded fs-synopsis" style={{ whiteSpace: 'pre-wrap' }}>
          {details.Synopsis ? details.Synopsis.trim() : ''}
        </Card.Text>

      </Card.Body>
    </Card>
  );
};

export default ContestNovelDetailsCard;