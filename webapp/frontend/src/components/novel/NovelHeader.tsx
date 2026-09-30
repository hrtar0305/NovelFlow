import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { BoxArrowUpRight } from 'react-bootstrap-icons';
import NovelCover from '../NovelCover';
import ChangeMark from '../ui/ChangeMark';
import InlineNums, { type InlineNum } from '../ui/InlineNums';
import TagLinks from '../ui/TagLinks';
import { formatDateKo, formatInt, formatMan, formatRatio } from '../../utils/format';
import { formatSerialDays } from '../../utils/novelFacts';
import type { CurrentRank } from '../../utils/currentRank';

export interface NovelHeaderDetails {
  ID: string; Title?: string | null; AuthorName?: string | null; AuthorID?: string | null; Eps?: number | null;
  Score?: number | null; View?: number | null; Like?: number | null; Fav?: number | null; Alr?: number | null;
  Synopsis?: string | null; Tags?: string[]; ThumbnailURL?: string | null;
  EarlyRetentionRate?: number | null; RecentRetentionRate?: number | null;
  FirstEpView?: number | null; FirstEpNum?: number | null; Ep30View?: number | null; Ep30Num?: number | null;
  RecentBaseView?: number | null; RecentBaseNum?: number | null; TargetLatestEpView?: number | null; TargetLatestEpNum?: number | null;
  serial_status?: string | null; serial_days?: string | null; life_pick_rank?: number | null; badges?: string[]; age_rating?: string | null;
}

/** 연재 상태 강조. 알약 배지 대신 글자 색·굵기로만 — 사이트 전체에서 배지 패턴을 걷어냈다(DECISIONS 2026-09-30).
 *  연재중단·연재지연은 경고색, 완결은 진하게, 연재중과 모르는 상태는 굵게만. */
const STATUS_TONE: Record<string, string> = { 연재중단: 'warn', 연재지연: 'warn', 완결: 'done' };

const ok = (v?: number | null): v is number => typeof v === 'number' && v >= 0;

/** 잔류율 옆에 흐리게 붙이는 근거: '1화 6,609 → 30화 2,223'. 값이 없으면 비운다. */
const basis = (aNum?: number | null, aView?: number | null, bNum?: number | null, bView?: number | null) => (
  ok(aNum) && ok(aView) && ok(bNum) && ok(bView)
    ? <span className="detail-head__basis">{formatInt(aNum)}화 {formatInt(aView)} → {formatInt(bNum)}화 {formatInt(bView)}</span>
    : null
);

/** 작품 소개. 길면 네 줄에서 접고 '더 보기'로 편다. */
function Synopsis({ text }: { text: string }) {
  const ref = useRef<HTMLParagraphElement>(null);
  const [open, setOpen] = useState(false);
  const [long, setLong] = useState(false);
  useLayoutEffect(() => {
    const el = ref.current;
    if (el && !open) setLong(el.scrollHeight > el.clientHeight + 2);
  }, [text, open]);
  return (
    <div className="detail-head__synopsis">
      <p ref={ref} className={open ? undefined : 'is-clamped'}>{text}</p>
      {long || open ? <button type="button" className="link-button" onClick={() => setOpen(o => !o)}>{open ? '접기' : '더 보기'}</button> : null}
    </div>
  );
}

/**
 * 작품 머리(2026-09-30 개편). 랭킹 표에 있는 값은 모두 여기에도 있고, 표에 없는 것(알람 · 인생픽 · 연재 요일 ·
 * 배지 · 이용 등급 · 잔류율의 근거 조회수)을 더한다. 작품 소개와 태그도 머리 안에 둔다.
 * byExtra: 작가 줄 끝에 붙일 문구(공모전 이름·수상). nums: 한 줄 수치를 바꿀 때(공모전은 잔류율이 없다).
 */
export default function NovelHeader({ details, current, backTo, byExtra, nums, tagHref }: {
  details: NovelHeaderDetails; current: CurrentRank; backTo: { to: string; label: string };
  byExtra?: ReactNode; nums?: InlineNum[]; tagHref?: (tag: string) => string;
}) {
  const novelUrl = `https://novelpia.com/novel/${details.ID.includes('#') ? details.ID.split('#')[1] : details.ID}`;
  const ratio = details.View && details.View > 0 && details.Like != null ? details.Like / details.View : null;
  const days = formatSerialDays(details.serial_days);
  const facts = [
    details.serial_status,
    details.Eps != null ? `${formatInt(details.Eps)}화` : null,
    days,
    ...(details.badges ?? []),
    details.age_rating,
  ].filter((v): v is string => !!v);

  const popularity: InlineNum[] = nums ?? [
    { label: '점수', value: formatInt(details.Score) },
    { label: '조회', value: formatMan(details.View) },
    { label: '추천', value: formatMan(details.Like) },
    { label: '선호', value: formatInt(details.Fav) },
    { label: '알람', value: formatInt(details.Alr) },
    ...(details.life_pick_rank != null ? [{ label: '인생픽', value: `${formatInt(details.life_pick_rank)}위` }] : []),
  ];
  const ratios: InlineNum[] | null = nums ? null : [
    { label: '추천비', value: formatRatio(ratio, 2) },
    { label: '초반 잔류', value: <>{formatRatio(details.EarlyRetentionRate, 0)}{details.EarlyRetentionRate != null ? basis(details.FirstEpNum, details.FirstEpView, details.Ep30Num, details.Ep30View) : null}</> },
    { label: '최신 잔류', value: <>{formatRatio(details.RecentRetentionRate, 0)}{details.RecentRetentionRate != null ? basis(details.RecentBaseNum, details.RecentBaseView, details.TargetLatestEpNum, details.TargetLatestEpView) : null}</> },
  ];

  return (
    <>
      <Link to={backTo.to} className="detail-back">‹ {backTo.label}</Link>
      <header className="detail-head">
        <div className="detail-head__cover"><NovelCover url={details.ThumbnailURL} title={details.Title} imageClassName="detail-head__cover-img" /></div>
        <div className="detail-head__body">
          <h1 className="detail-head__title">{details.Title || '(제목 없음)'}</h1>
          <p className="detail-head__by">
            {details.AuthorID ? <Link to={`/authors/${details.AuthorID}`}>{details.AuthorName}</Link> : <span>{details.AuthorName}</span>}
            {byExtra ? <span className="detail-head__extra">{byExtra}</span> : null}
            <a href={novelUrl} target="_blank" rel="noopener noreferrer" className="detail-head__ext" aria-label="노벨피아에서 보기" title="노벨피아에서 보기">
              <BoxArrowUpRight size={14} aria-hidden="true" />
            </a>
          </p>
          {facts.length ? (
            <p className="detail-head__facts">
              {facts.map((f, i) => (
                <span key={`${f}-${i}`} className={i === 0 && details.serial_status ? `detail-head__status is-${STATUS_TONE[details.serial_status] ?? 'plain'}` : undefined}>{f}</span>
              ))}
            </p>
          ) : null}
          <div className="detail-head__now">
            {current.kind === 'ranked' ? (
              <>
                <span className="detail-head__rank">{current.rank}<span className="detail-head__unit">위</span></span>
                <ChangeMark value={current.change} />
              </>
            ) : current.kind === 'out' ? (
              <span className="detail-head__out">순위권 밖 · 마지막 기록 {formatDateKo(current.lastDate)} {current.lastRank}위</span>
            ) : null}
          </div>
          <InlineNums items={popularity} />
          {ratios ? <InlineNums items={ratios} /> : null}
        </div>
        {/* 작품 소개·태그는 표지 아래부터 전체 폭으로 — 표지 옆 오른쪽 칸에 두면 표지 아래가 통째로 비었다. */}
        {details.Synopsis || (details.Tags && details.Tags.length > 0) ? (
          <section className="detail-intro" aria-labelledby="detail-intro-h">
            <h2 id="detail-intro-h" className="detail-intro__h">작품 소개</h2>
            {details.Synopsis ? <Synopsis text={details.Synopsis} /> : null}
            {details.Tags && details.Tags.length > 0 ? (
              <TagLinks tags={details.Tags} limit={details.Tags.length} wrap hrefFor={tagHref ?? (t => `/novels/rankings?tag=${encodeURIComponent(t)}`)} />
            ) : null}
          </section>
        ) : null}
      </header>
    </>
  );
}
