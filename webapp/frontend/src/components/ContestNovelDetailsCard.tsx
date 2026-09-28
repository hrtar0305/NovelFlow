import React from 'react';
import NovelCover from './NovelCover';
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
  ThumbnailURL?: string | null;
}

interface ContestNovelDetailsCardProps {
  details: ContestNovelDetails | null;
}

const AWARD_STYLES: Record<string, { label: string; variant: string }> = {
  '대상':    { label: '대상', variant: 'grand' },
  '최우수상': { label: '최우수상', variant: 'excellent' },
  '탑툰상':  { label: '탑툰상', variant: 'toptoon' },
  '우수상':  { label: '우수상', variant: 'winner' },
  '특별상':  { label: '특별상', variant: 'special' },
  '본선':    { label: '본선', variant: 'finalist' },
};

const AwardBadge: React.FC<{ award: string | null | undefined }> = ({ award }) => {
  if (!award || !AWARD_STYLES[award]) return null;
  const { label, variant } = AWARD_STYLES[award];
  return (
    <span className={`contest-detail-award-badge contest-award-badge contest-award-badge--${variant} fw-bold`}>
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

const formatNum = (n: number): string => n.toLocaleString();

const ContestNovelDetailsCard: React.FC<ContestNovelDetailsCardProps> = ({ details }) => {
  if (!details) return null;

  const { View = 0, Like = 0, Fav = 0, Alr = 0, Eps = 0 } = details;
  const likeToViewRatio = (View > 0 && Like != null) ? Like / View : null;
  const novelUrl = `https://novelpia.com/novel/${details.ID.includes('#') ? details.ID.split('#')[1] : details.ID}`;

  return (
    <div className="novel-detail-header contest-novel-detail-header">
      <div className="novel-detail-header-inner">
        <div className="novel-detail-cover">
          <NovelCover
            url={details.ThumbnailURL}
            title={details.Title}
            imageClassName="novel-detail-cover-image"
          />
        </div>
        <div className="novel-detail-main">
          <div className="contest-detail-meta-row">
            <div className="novel-detail-contest-label">우주최강 공모전</div>
            <AwardBadge award={details.award} />
          </div>

          <div className="novel-detail-title-row">
            <h1 className="novel-detail-title">{details.Title || '(제목 없음)'}</h1>
            <a href={novelUrl} target="_blank" rel="noopener noreferrer" className="novel-detail-ext-link" aria-label="노벨피아에서 보기">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                <polyline points="15 3 21 3 21 9" />
                <line x1="10" y1="14" x2="21" y2="3" />
              </svg>
            </a>
          </div>

          <div className="novel-detail-author">
            <Link to={`/authors/${details.AuthorID}`}>{details.AuthorName || '(작자 미상)'}</Link>
          </div>
          {(details.Tags || []).length > 0 && (
            <div className="novel-detail-tags">
              {(details.Tags || []).map(tag => (
                <Badge pill bg="secondary" className="fw-bold fs-tag-badge" key={tag}>#{tag}</Badge>
              ))}
            </div>
          )}

          <div className="novel-stats-stack">
            <div className="novel-stats-row novel-stats-row--primary contest-stats-row">
              <StatBlock label="조회" value={formatNum(View)} />
              <StatBlock label="추천" value={formatNum(Like)} />
              <StatBlock label="선호" value={formatNum(Fav)} />
              <StatBlock label="알람" value={formatNum(Alr)} />
              <StatBlock label="회차" value={Eps.toLocaleString()} />
              <StatBlock label="추천비" value={likeToViewRatio != null ? `${(likeToViewRatio * 100).toFixed(2)}%` : '-'} />
            </div>
          </div>
        </div>
      </div>
      {details.Synopsis && (
        <div className="novel-detail-synopsis-panel">
          <p className="novel-detail-synopsis">{details.Synopsis.trim()}</p>
        </div>
      )}
    </div>
  );
};

export default ContestNovelDetailsCard;
