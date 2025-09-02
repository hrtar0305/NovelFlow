import React from 'react';
import { Link } from 'react-router-dom';
import { Card, Badge } from 'react-bootstrap';

interface NovelDetails {
  ID: string;
  Title: string;
  AuthorName: string;
  AuthorID: string;
  Synopsis: string;
  Tags: string[];
  View: number;
  Like: number;
  Fav: number;
  Alr: number;
  Eps: number;
}

interface NovelDetailsCardProps {
  details: NovelDetails | null;
}

const NovelDetailsCard: React.FC<NovelDetailsCardProps> = ({ details }) => {
  if (!details) {
    return null;
  }

  return (
    <Card className="mb-3">
      <Card.Header>
        <div className="d-flex align-items-center gap-1">
          <h5 className="mb-0 fw-bold">{details.Title}</h5>
          <a href={`https://novelpia.com/novel/${details.ID.includes('#') ? details.ID.split('#')[1] : details.ID}`} target="_blank" rel="noopener noreferrer" style={{ color: 'inherit' }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
              <polyline points="15 3 21 3 21 9"></polyline>
              <line x1="10" y1="14" x2="21" y2="3"></line>
            </svg>
          </a>
        </div>
        <div className="mt-1 text-muted">
          <Link to={`/authors/${details.AuthorID}`} className="fw-bold">{details.AuthorName}</Link>
        </div>
      </Card.Header>
      <Card.Body>
        <div className="mb-2">
          {details.Tags.map(tag => (
            <Badge pill bg="info" text="dark" className="me-1 fw-bold" key={tag} style={{ fontSize: '0.95rem' }}>
              #{tag}
            </Badge>
          ))}
        </div>

        <div className="d-flex justify-content-start gap-4 text-center mb-2">
          <div>
            <strong className="fs-5">{details.View.toLocaleString()}</strong>
            <div className="text-muted" style={{fontSize: '0.8rem'}}>조회</div>
          </div>
          <div>
            <strong className="fs-5">{details.Like.toLocaleString()}</strong>
            <div className="text-muted" style={{fontSize: '0.8rem'}}>추천</div>
          </div>
          <div>
            <strong className="fs-5">{details.Fav.toLocaleString()}</strong>
            <div className="text-muted" style={{fontSize: '0.8rem'}}>선호</div>
          </div>
          <div>
            <strong className="fs-5">{details.Alr.toLocaleString()}</strong>
            <div className="text-muted" style={{fontSize: '0.8rem'}}>알람</div>
          </div>
          <div>
            <strong className="fs-5">{details.Eps}</strong>
            <div className="text-muted" style={{fontSize: '0.8rem'}}>회차</div>
          </div>
        </div>
        
        <Card.Text className="mt-2 p-3 bg-light rounded" style={{ whiteSpace: 'pre-wrap' }}>
          {details.Synopsis}
        </Card.Text>

      </Card.Body>
    </Card>
  );
};

export default NovelDetailsCard;
