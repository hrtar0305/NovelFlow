import React from 'react';
import { Link } from 'react-router-dom';
import { Badge } from 'react-bootstrap';

interface NovelDetails {
  ID: string;
  Title?: string | null;
  AuthorName?: string | null;
  AuthorID?: string | null;
  Synopsis?: string | null;
  Tags?: string[];
  View?: number | null;
  Like?: number | null;
  Fav?: number | null;
  Alr?: number | null;
  Eps?: number | null;
  EarlyRetentionRate?: number | null;
  RecentRetentionRate?: number | null;
  award?: string | null;
}

interface NovelDetailsCardProps {
  details: NovelDetails | null;
}

const StatBlock: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className="novel-stat-block">
    <span className="novel-stat-value">{value}</span>
    <span className="novel-stat-label">{label}</span>
  </div>
);

const formatNum = (n: number): string => {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, '')}k`;
  return n.toLocaleString();
};

const NovelDetailsCard: React.FC<NovelDetailsCardProps> = ({ details }) => {
  if (!details) return null;

  const novelUrl = `https://novelpia.com/novel/${details.ID.includes('#') ? details.ID.split('#')[1] : details.ID}`;
  const likeToViewRatio = (details.View && details.View > 0 && details.Like != null)
    ? details.Like / details.View
    : null;

  return (
    <div className="novel-detail-header">
      <div className="novel-detail-header-inner">
      {/* Title row */}
      <div className="novel-detail-title-row">
        <h1 className="novel-detail-title">{details.Title || '(제목 없음)'}</h1>
        <a href={novelUrl} target="_blank" rel="noopener noreferrer" className="novel-detail-ext-link" aria-label="노벨피아에서 보기">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
            <polyline points="15 3 21 3 21 9" />
            <line x1="10" y1="14" x2="21" y2="3" />
          </svg>
        </a>
        {details.award && (
          <Badge bg="warning" text="dark" className="novel-detail-award-badge">{details.award}</Badge>
        )}
      </div>

      {/* Author */}
      <div className="novel-detail-author">
        <Link to={`/authors/${details.AuthorID}`}>{details.AuthorName || '(작자 미상)'}</Link>
      </div>

      {/* Tags */}
      {(details.Tags || []).length > 0 && (
        <div className="novel-detail-tags">
          {(details.Tags || []).map(tag => (
            <Badge pill bg="secondary" className="fw-bold fs-tag-badge" key={tag}>#{tag}</Badge>
          ))}
        </div>
      )}

      {/* Stats */}
      <div className="novel-stats-row">
        <StatBlock label="조회" value={formatNum(details.View || 0)} />
        <StatBlock label="추천" value={formatNum(details.Like || 0)} />
        <StatBlock label="선호" value={formatNum(details.Fav || 0)} />
        <StatBlock label="알람" value={formatNum(details.Alr || 0)} />
        <StatBlock label="회차" value={(details.Eps || 0).toLocaleString()} />
        <div className="novel-stats-divider" />
        <StatBlock label="추천비" value={likeToViewRatio != null ? `${(likeToViewRatio * 100).toFixed(2)}%` : '-'} />
        <StatBlock label="초반 잔류율" value={typeof details.EarlyRetentionRate === 'number' ? `${(details.EarlyRetentionRate * 100).toFixed(1)}%` : '-'} />
        <StatBlock label="최신 잔류율" value={typeof details.RecentRetentionRate === 'number' ? `${(details.RecentRetentionRate * 100).toFixed(1)}%` : '-'} />
      </div>

      {/* Synopsis */}
      {details.Synopsis && (
        <p className="novel-detail-synopsis">{details.Synopsis}</p>
      )}
      </div>
    </div>
  );
};

export default NovelDetailsCard;
