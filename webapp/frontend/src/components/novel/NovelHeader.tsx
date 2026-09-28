import { Link } from 'react-router-dom';
import NovelCover from '../NovelCover';
import ChangeMark from '../ui/ChangeMark';
import InlineNums from '../ui/InlineNums';
import TagLinks from '../ui/TagLinks';
import { formatDateKo, formatInt, formatMan, formatRatio } from '../../utils/format';
import type { CurrentRank } from '../../utils/currentRank';

export interface NovelHeaderDetails {
  ID: string; Title?: string | null; AuthorName?: string | null; AuthorID?: string | null; Eps?: number | null;
  View?: number | null; Like?: number | null; Fav?: number | null; Synopsis?: string | null; Tags?: string[];
  ThumbnailURL?: string | null; EarlyRetentionRate?: number | null; RecentRetentionRate?: number | null;
}

export default function NovelHeader({ details, current, backTo }: { details: NovelHeaderDetails; current: CurrentRank; backTo: { to: string; label: string } }) {
  const novelUrl = `https://novelpia.com/novel/${details.ID.includes('#') ? details.ID.split('#')[1] : details.ID}`;
  const ratio = details.View && details.View > 0 && details.Like != null ? details.Like / details.View : null;
  return (
    <>
      <Link to={backTo.to} className="detail-back">‹ {backTo.label}</Link>
      <header className="detail-head">
        <div className="detail-head__cover"><NovelCover url={details.ThumbnailURL} title={details.Title} imageClassName="detail-head__cover-img" /></div>
        <div>
          <h1 className="detail-head__title">{details.Title || '(제목 없음)'}</h1>
          <p className="detail-head__by">
            {details.AuthorID ? <Link to={`/authors/${details.AuthorID}`}>{details.AuthorName}</Link> : details.AuthorName}
            {details.Eps != null ? <> · 연재 {formatInt(details.Eps)}화</> : null}
            {' · '}<a href={novelUrl} target="_blank" rel="noopener noreferrer">노벨피아에서 보기</a>
          </p>
          <div className="detail-head__now">
            {current.kind === 'ranked' ? (
              <><span className="detail-head__rank">{current.rank}<small>위</small></span>
                <span className="detail-head__chg"><ChangeMark value={current.change} />{typeof current.change === 'number' ? <span>전일 대비</span> : null}</span></>
            ) : current.kind === 'out' ? (
              <span className="detail-head__out">순위권 밖 · 마지막 기록 {formatDateKo(current.lastDate)} {current.lastRank}위</span>
            ) : null}
          </div>
          <InlineNums items={[
            { label: '조회', value: formatMan(details.View) },
            { label: '추천', value: formatMan(details.Like) },
            { label: '선호', value: formatMan(details.Fav) },
            { label: '추천비', value: formatRatio(ratio, 2) },
            { label: '초반 잔류', value: formatRatio(details.EarlyRetentionRate, 0) },
            { label: '최신 잔류', value: formatRatio(details.RecentRetentionRate, 0) },
          ]} />
        </div>
      </header>
    </>
  );
}

/** 작품 소개·태그. 스펙 순서(머리 → 차트 → 소개 → 태그)대로 페이지가 차트 뒤에 둔다. */
export function NovelDetailSections({ details }: { details: NovelHeaderDetails }) {
  return (
    <>
      {details.Synopsis ? <section className="detail-sec"><h2 className="detail-sec__h">작품 소개</h2><p className="detail-synopsis">{details.Synopsis}</p></section> : null}
      {details.Tags && details.Tags.length > 0 ? (
        <section className="detail-sec detail-sec--tags">
          <TagLinks tags={details.Tags} limit={details.Tags.length} hrefFor={t => `/novels/rankings?tag=${encodeURIComponent(t)}`} />
        </section>
      ) : null}
    </>
  );
}
