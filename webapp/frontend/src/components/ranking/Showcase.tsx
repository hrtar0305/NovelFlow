import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import NovelCover from '../NovelCover';

const COUNT = 5; // 모자이크는 1위(세로 2칸) + 2~5위(2×2) 정확히 5칸

/** 쇼케이스 한 칸. 일간 랭킹과 공모전(일간 순위)이 같은 배치를 쓰므로 페이지가 이 모양으로 바꿔 넘긴다. */
export interface ShowcaseItem {
  id: string;
  href: string;
  title: string;
  cover?: string | null;
  author?: string | null;
  rank: number;
  /** 상위 칸의 오른쪽 수치(예: '점수 525,800', '+10,595'). */
  stat: ReactNode;
  /** 급상승 칸: 오른 계단 수. null 이면 NEW. */
  jump?: number | null;
}

interface ShowcaseProps {
  top: ShowcaseItem[];
  movers: ShowcaseItem[];
}

function Poster({ item, chip, meta, cls }: { item: ShowcaseItem; chip: ReactNode; meta: ReactNode; cls: string }) {
  return (
    <Link to={item.href} className={`media-rank-card media-rank-card--poster media-rank-card--link ${cls}`} aria-label={`${item.title} 상세 보기`}>
      {/* 칩은 표지 안에 둔다 — 띠(overlay)가 position: relative라 그 안에 두면 제목 옆으로 내려온다. */}
      <div className="media-rank-card__cover">
        <NovelCover url={item.cover} title={item.title} imageClassName="media-rank-card__cover-image" />
        <div className="media-rank-card__rank">{chip}</div>
      </div>
      <div className="media-rank-card__overlay">
        <div className="media-rank-card__title">{item.title}</div>
        <div className="media-rank-card__meta">{meta}</div>
      </div>
    </Link>
  );
}

export default function Showcase({ top, movers }: ShowcaseProps) {
  if (top.length === 0 && movers.length === 0) return null;
  return (
    <div className="showcase-section">
      {/* 급상승이 없는 날(공모전 일간 순위가 처음 생긴 날)은 상위 묶음이 폭을 다 쓴다. */}
      <div className={`ranking-showcase-split${movers.length === 0 || top.length === 0 ? ' ranking-showcase-split--single' : ''}`}>
        {top.length > 0 ? (
          <section className="ranking-showcase-group ranking-showcase-group--top">
            <div className="ranking-showcase-group__header">
              <h2 className="ranking-showcase-group__title">상위 5작품</h2>
            </div>
            <div className="ranking-showcase-top-grid">
              {top.slice(0, COUNT).map((n, i) => (
                <Poster key={`top-${n.id}`} item={n} chip={n.rank} cls={`media-rank-card--split media-rank-card--rank-${i + 1}`}
                  meta={<>{n.author ? <span className="mini-kpi">{n.author}</span> : null}<span className="mini-kpi">{n.stat}</span></>} />
              ))}
            </div>
          </section>
        ) : null}
        {movers.length > 0 ? (
          <section className="ranking-showcase-group ranking-showcase-group--rising">
            <div className="ranking-showcase-group__header">
              <h2 className="ranking-showcase-group__title">급상승 5작품</h2>
            </div>
            <div className="ranking-showcase-rising-grid">
              {movers.slice(0, COUNT).map((n, i) => {
                const jump = n.jump ?? null;
                return (
                  <Poster key={`mover-${n.id}`} item={n} chip={jump != null ? `▲${jump}` : 'NEW'}
                    cls={`media-rank-card--split media-rank-card--mover media-rank-card--mover-${i + 1}`}
                    meta={jump != null
                      ? <span className="rank-move"><span className="rank-move__from">{n.rank + jump}위</span><i className="mv-arrow" aria-hidden="true" /><span className="rank-move__to">{n.rank}위</span></span>
                      : <span className="rank-move__to">{n.rank}위</span>} />
                );
              })}
            </div>
          </section>
        ) : null}
      </div>
    </div>
  );
}

/** 쇼케이스 자리의 빈 틀 — 처음 들어와 값이 없을 때. 같은 격자(고정 높이)를 써서 값이 와도 아래가 밀리지 않는다. */
export function ShowcaseSkeleton() {
  const cards = (kind: 'rank' | 'mover') => Array.from({ length: COUNT }, (_, i) => (
    <div key={i} className={`media-rank-card media-rank-card--poster media-rank-card--split media-rank-card--${kind}-${i + 1} skeleton-box`} />
  ));
  return (
    <div className="showcase-section" aria-busy="true">
      <div className="ranking-showcase-split">
        <section className="ranking-showcase-group ranking-showcase-group--top">
          <div className="ranking-showcase-group__header"><h2 className="ranking-showcase-group__title">상위 5작품</h2></div>
          <div className="ranking-showcase-top-grid">{cards('rank')}</div>
        </section>
        <section className="ranking-showcase-group ranking-showcase-group--rising">
          <div className="ranking-showcase-group__header"><h2 className="ranking-showcase-group__title">급상승 5작품</h2></div>
          <div className="ranking-showcase-rising-grid">{cards('mover')}</div>
        </section>
      </div>
    </div>
  );
}
