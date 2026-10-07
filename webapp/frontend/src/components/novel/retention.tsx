import type { InlineNum } from '../ui/InlineNums';
import type { NovelHeaderDetails } from './NovelHeader';
import { formatInt, formatRatio } from '../../utils/format';

const ok = (v?: number | null): v is number => typeof v === 'number' && v >= 0;

/** 잔류율 옆에 흐리게 붙이는 근거: '1화 6,609 → 30화 2,223'. 값이 없으면 비운다. */
const basis = (aNum?: number | null, aView?: number | null, bNum?: number | null, bView?: number | null) => (
  ok(aNum) && ok(aView) && ok(bNum) && ok(bView)
    ? <span className="detail-head__basis">{formatInt(aNum)}화 {formatInt(aView)} → {formatInt(bNum)}화 {formatInt(bView)}</span>
    : null
);

/** 작품 머리의 초반·최신 잔류(근거 조회수 포함). 일간 상세 머리(NovelHeader)와 공모전 2026~ 상세가 같이 쓴다.
 *  유효 회차 30 미만이면 '–' — 대체 계산으로 채우지 않는다. */
export const retentionNums = (d: NovelHeaderDetails): InlineNum[] => [
  { label: '초반 잔류', value: <>{formatRatio(d.EarlyRetentionRate, 0)}{d.EarlyRetentionRate != null ? basis(d.FirstEpNum, d.FirstEpView, d.Ep30Num, d.Ep30View) : null}</> },
  { label: '최신 잔류', value: <>{formatRatio(d.RecentRetentionRate, 0)}{d.RecentRetentionRate != null ? basis(d.RecentBaseNum, d.RecentBaseView, d.TargetLatestEpNum, d.TargetLatestEpView) : null}</> },
];
