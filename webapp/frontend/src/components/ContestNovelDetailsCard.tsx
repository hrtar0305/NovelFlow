import React from 'react';
import { Link } from 'react-router-dom';
import { Badge } from 'react-bootstrap';

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
  award?: string | null;
}

interface ContestNovelDetailsCardProps {
  details: ContestNovelDetails | null;
}

const AWARD_STYLES: Record<string, { bg: string; label: string }> = {
  '대상':    { bg: '#d4af37', label: '대상' },
  '최우수상': { bg: '#4682b4', label: '최우수상' },
  '탑툰상':  { bg: '#c71585', label: '탑툰상' },
  '우수상':  { bg: '#20b2aa', label: '우수상' },
  '특별상':  { bg: '#5f9ea0', label: '특별상' },
  '본선':    { bg: '#778899', label: '본선' },
};

const AwardBadge: React.FC<{ award: string | null | undefined }> = ({ award }) => {
  if (!award || !AWARD_STYLES[award]) return null;
  const { bg, label } = AWARD_STYLES[award];
  return (
    <span className="novel-detail-award-badge fw-bold" style={{ backgroundColor: bg, color: '#fff', borderRadius: '0.35rem', padding: '0.15em 0.55em', fontSize: '0.78rem', whiteSpace: 'nowrap', alignSelf: 'center' }}>
      {label}
    </span>
  );
};

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

const ContestNovelDetailsCard: React.FC<ContestNovelDetailsCardProps> = ({ details }) => {
  if (!details) return null;

  const { View = 0, Like = 0, Fav = 0, Alr = 0, Eps = 0 } = details;
  const likeToViewRatio = (View > 0 && Like != null) ? Like / View : null;
  const novelUrl = `https://novelpia.com/novel/${details.ID}`;

  return (
    <div className="novel-detail-header">
      <div className="novel-detail-header-inner">
        {/* Title row */}
        <div className="novel-detail-title-row">
          <AwardBadge award={details.award} />
          <h1 className="novel-detail-title">{details.Title}</h1>
          <a href={novelUrl} target="_blank" rel="noopener noreferrer" className="novel-detail-ext-link" aria-label="노벨피아에서 보기">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
              <polyline points="15 3 21 3 21 9" />
              <line x1="10" y1="14" x2="21" y2="3" />
            </svg>
          </a>
        </div>

        {/* Contest label */}
        <div className="novel-detail-contest-label">우주최강 공모전</div>

        {/* Author */}
        <div className="novel-detail-author">
          <Link to={`/authors/${details.AuthorID}`}>{details.AuthorName}</Link>
        </div>

        {/* Tags */}
        {details.Tags.length > 0 && (
          <div className="novel-detail-tags">
            {details.Tags.map(tag => (
              <Badge pill bg="secondary" className="fw-bold fs-tag-badge" key={tag}>#{tag}</Badge>
            ))}
          </div>
        )}

        {/* Stats */}
        <div className="novel-stats-row">
          <StatBlock label="조회" value={formatNum(View)} />
          <StatBlock label="추천" value={formatNum(Like)} />
          <StatBlock label="선호" value={formatNum(Fav)} />
          <StatBlock label="알람" value={formatNum(Alr)} />
          <StatBlock label="회차" value={Eps.toLocaleString()} />
          <div className="novel-stats-divider" />
          <StatBlock label="추천비" value={likeToViewRatio != null ? `${(likeToViewRatio * 100).toFixed(2)}%` : '-'} />
        </div>

        {/* Synopsis */}
        {details.Synopsis && (
          <p className="novel-detail-synopsis">{details.Synopsis.trim()}</p>
        )}
      </div>
    </div>
  );
};

export default ContestNovelDetailsCard;
