import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import NovelCover from '../NovelCover';
import type { RankingNovel } from '../../utils/rankingQuery';
import { formatDateDot, formatInt } from '../../utils/format';

const COUNT = 5; // 모자이크는 1위(세로 2칸) + 2~5위(2×2) 정확히 5칸

interface ShowcaseProps { top: RankingNovel[]; movers: RankingNovel[]; showcaseDate?: string; tableDate: string | null; }

function Poster({ novel, chip, meta, cls }: { novel: RankingNovel; chip: ReactNode; meta: ReactNode; cls: string }) {
  return (
    <Link to={`/novels/${novel.ID}`} className={`media-rank-card media-rank-card--poster media-rank-card--link ${cls}`} aria-label={`${novel.Title} 상세 보기`}>
      {/* 칩은 표지 안에 둔다 — 띠(overlay)가 position: relative라 그 안에 두면 제목 옆으로 내려온다. */}
      <div className="media-rank-card__cover">
        <NovelCover url={novel.ThumbnailURL} title={novel.Title} imageClassName="media-rank-card__cover-image" />
        <div className="media-rank-card__rank">{chip}</div>
      </div>
      <div className="media-rank-card__overlay">
        <div className="media-rank-card__title">{novel.Title}</div>
        <div className="media-rank-card__meta">{meta}</div>
      </div>
    </Link>
  );
}

export default function Showcase({ top, movers, showcaseDate, tableDate }: ShowcaseProps) {
  if (top.length === 0 && movers.length === 0) return null;
  // 쇼케이스는 늘 최신 수집일이다. 과거 날짜의 표를 볼 때만 기준일을 붙인다.
  const stamp = showcaseDate && tableDate && showcaseDate !== tableDate ? `${formatDateDot(showcaseDate).slice(5)} 기준` : null;
  return (
    <div className="showcase-section">
      <div className="ranking-showcase-split">
        {top.length > 0 ? (
          <section className="ranking-showcase-group ranking-showcase-group--top">
            <div className="ranking-showcase-group__header">
              <h2 className="ranking-showcase-group__title">상위 5작품</h2>
              {stamp ? <span className="ranking-showcase-group__meta">{stamp}</span> : null}
            </div>
            <div className="ranking-showcase-top-grid">
              {top.slice(0, COUNT).map((n, i) => (
                <Poster key={`top-${n.ID}`} novel={n} chip={n.Ranking} cls={`media-rank-card--split media-rank-card--rank-${i + 1}`}
                  meta={<><span className="mini-kpi">{n.AuthorName}</span><span className="mini-kpi">점수 {formatInt(n.Score)}</span></>} />
              ))}
            </div>
          </section>
        ) : null}
        {movers.length > 0 ? (
          <section className="ranking-showcase-group ranking-showcase-group--rising">
            <div className="ranking-showcase-group__header">
              <h2 className="ranking-showcase-group__title">급상승 5작품</h2>
              {stamp ? <span className="ranking-showcase-group__meta">{stamp}</span> : null}
            </div>
            <div className="ranking-showcase-rising-grid">
              {movers.slice(0, COUNT).map((n, i) => {
                const jump = typeof n.rank_change === 'number' ? n.rank_change : null;
                return (
                  <Poster key={`mover-${n.ID}`} novel={n} chip={jump != null ? `▲${jump}` : 'NEW'}
                    cls={`media-rank-card--split media-rank-card--mover media-rank-card--mover-${i + 1}`}
                    meta={jump != null
                      ? <span className="rank-move"><span className="rank-move__from">{n.Ranking + jump}위</span><i className="mv-arrow" aria-hidden="true" /><span className="rank-move__to">{n.Ranking}위</span></span>
                      : <span className="rank-move__to">{n.Ranking}위</span>} />
                );
              })}
            </div>
          </section>
        ) : null}
      </div>
    </div>
  );
}
