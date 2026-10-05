import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { getContestNovelTrend, getNovelTrend } from '../../services/api';
import UploadCells from '../novel/UploadCells';
import { formatDateKo } from '../../utils/format';
import { previousCalendarDay } from '../../utils/currentRank';
import { windowOf } from '../../utils/trendSummary';
import { buildMetricPoints, summarizeMetrics, uploadStats, type MetricRow } from '../../utils/metricSeries';
import { contestTrendRow, type ContestTrendRow } from '../../utils/contestNovels';

const WINDOW = 30;
// 펼침 높이를 줄이려고 선은 넓고 낮게, 제목·기간은 선 왼쪽 작은 이름표로 접었다(2026-10-04).
const W = 260;
const H = 40;
const P = 6;
/** 연재 줄 폭·높이 — 순위선 옆, 소개글 앞(2026-10-05: 소개가 짧으면 오른쪽이 비었다). */
const UW = 168;
const UH = 12;

interface Props {
  novelId: string;
  date: string;
  /** 그 표의 수집일들(일간 랭킹 / 그 공모전) */
  availableDates: Set<string>;
  synopsis?: string | null;
  /**
   * 공모전 표에서 펼칠 때. 순위는 그해 대표 순위(2025 누적, 2026~ 일간), 비교는 **실제 직전 수집일**(달력 −1 아님 —
   * DECISIONS 2026-07-01), 링크는 공모전 작품 상세. 작품 소개는 목록에 없어 추이 응답에서 꺼낸다.
   */
  contest?: { year: string; daily: boolean };
}

/**
 * 랭킹 표의 행 펼침. **표에 없는 것 두 가지만** 둔다(2026-10-04 축소 — 자세한 것은 작품 상세에서):
 * 최근 30일 순위선(지금·최고) / 연재 줄(그 기간에 올린 날) / 작품 소개 2줄 / 작품 정보 보기 — 한 줄로 늘어놓아 높이를 줄인다. 연재 줄·기간 증가량·연재 상태는 상세로 옮겼다.
 * 펼칠 때 30일 + 기준일 하루치를 한 번 받는다. 공모전 표도 같은 펼침을 쓴다(`contest`).
 * 위치는 표가 정한다 — RankTable `expandFrom="title"` 이 제목 칸 왼쪽에 맞춘다.
 */
export default function NovelRowExpand({ novelId, date, availableDates, synopsis, contest }: Props) {
  // 기준일 = 창 첫날의 '전날'. 일간은 달력 −1, 공모전은 창 바로 앞의 실제 수집일(없으면 첫날은 증가량을 모른다).
  const win31 = useMemo(() => windowOf(availableDates, date, WINDOW + 1), [availableDates, date]);
  const win = win31.length > WINDOW ? win31.slice(1) : win31;
  const start = win[0];
  const base = contest ? (win31.length > WINDOW ? win31[0] : start) : (start ? previousCalendarDay(start) : undefined);
  const [state, setState] = useState<{ rows: (MetricRow & { Synopsis?: string | null })[] } | 'loading' | 'error'>('loading');

  // 부르는 쪽이 `contest` 객체를 매번 새로 만들어도 다시 받지 않게 값으로 의존한다.
  const cYear = contest?.year;
  const cDaily = contest?.daily ?? false;
  useEffect(() => {
    if (!start || !base) return;
    let cancelled = false;
    const req = cYear
      ? getContestNovelTrend(parseInt(cYear, 10), novelId, base, date)
        .then(r => (r.data as ContestTrendRow[]).map(d => contestTrendRow(d, cDaily)))
      : getNovelTrend(novelId, base, date).then(r => r.data as MetricRow[]);
    req.then(rows => { if (!cancelled) setState({ rows }); }).catch(() => { if (!cancelled) setState('error'); });
    return () => { cancelled = true; };
  }, [novelId, start, base, date, cYear, cDaily]);

  const points = useMemo(() => {
    if (typeof state !== 'object' || !start || !base) return [];
    // 추이 API는 수집하지 않은 날도 빈 행으로 채운다 — 수집한 날(과 기준일)만 남긴다.
    const keep = new Set([...win, base]);
    return buildMetricPoints(state.rows.filter(r => keep.has(r.Date) && (availableDates.has(r.Date) || r.Date === base)),
      cYear ? 'collection' : 'calendar', start);
  }, [state, win, start, base, availableDates, cYear]);

  if (state === 'loading') return <div className="novel-expand novel-expand--loading" aria-busy="true">불러오는 중</div>;
  if (state === 'error') return <div className="novel-expand novel-expand--loading">추이를 불러오지 못했습니다.</div>;

  const s = summarizeMetrics(points);
  const up = uploadStats(points);
  const n = points.length;
  // 칸 폭은 30일 기준으로 고정하고 오른쪽(마지막 날)에 붙인다 — 기간이 짧으면(공모전 초반 4일) 칸이 늘어나 줄 전체를 덮었다.
  const slot = (UW - 6) / (WINDOW - 1);
  const UX = (i: number) => UW - 3 - (n - 1 - i) * slot;
  const ucw = Math.max(2, slot - 1.5);
  const upSummary = up.streak > 1 ? <>지금 <b>{up.streak}일</b> 연속</> : up.resting > 0 ? <><b>{up.resting}일째</b> 쉬는 중</>
    : up.known > 0 ? <>{up.known}일 중 <b>{up.uploaded}일</b></> : '기록 없음';
  const X = (i: number) => (n <= 1 ? W / 2 : P + (i / (n - 1)) * (W - 2 * P));
  const ranks = points.map(p => (p.rec ? p.rank : null));
  const vals = ranks.filter((r): r is number => r != null);
  const lo = Math.min(...vals);
  const hi = Math.max(...vals);
  const Y = (r: number) => P + ((r - lo) / (hi - lo || 1)) * (H - 2 * P);
  let d = '';
  let pen = false;
  ranks.forEach((r, i) => {
    if (r == null) { pen = false; return; }
    d += `${pen ? 'L' : 'M'}${X(i).toFixed(1)},${Y(r).toFixed(1)}`;
    pen = true;
  });
  // 끝 표지는 순위가 있는 마지막 날(공모전은 순위 없는 날이 있다 — MetricSummary.rankFirst 설명).
  const bestI = s && s.best.rank != null ? points.indexOf(s.best) : -1;
  const lastI = s?.rankLast ? points.indexOf(s.rankLast) : -1;
  // 마지막 순위는 끝점 오른쪽(선과 겹치지 않게 — 펼침 격자의 간격 안), 최고 순위는 점 위(위쪽 끝이면 아래).
  const label = (i: number, text: string, anchor: 'middle' | 'start') => {
    const y = Y(ranks[i]!);
    return <text x={anchor === 'start' ? X(i) + 8 : Math.min(W - 30, Math.max(24, X(i)))} y={anchor === 'start' ? y + 4 : (y < 16 ? y + 15 : y - 7)} textAnchor={anchor} className="novel-expand__label">{text}</text>;
  };
  const lonely = (i: number) => ranks[i] != null && ranks[i - 1] == null && ranks[i + 1] == null;
  const text = synopsis ?? (typeof state === 'object' ? [...state.rows].reverse().find(r => r.Synopsis)?.Synopsis ?? null : null);

  return (
    <div className="novel-expand">
      <div className="novel-expand__trend">
        <div className="novel-expand__meta">
          <b>{n}일 순위</b>
          <span>{formatDateKo(points[0]?.date ?? start)} – {formatDateKo(date)}</span>
        </div>
        {vals.length > 0 ? (
          <svg width={W} height={H} className="mx-svg novel-expand__svg" role="img" aria-label={`${n}일 순위 추이`}>
            <path d={d} className="mx-rankline" />
            {ranks.map((r, i) => (lonely(i) ? <circle key={i} cx={X(i)} cy={Y(r!)} r={2.6} className="mx-rankdot" /> : null))}
            {bestI >= 0 && bestI !== lastI ? <><circle cx={X(bestI)} cy={Y(ranks[bestI]!)} r={3} className="mx-rankdot" />{label(bestI, `최고 ${ranks[bestI]}위`, 'middle')}</> : null}
            {lastI >= 0 ? <><circle cx={X(lastI)} cy={Y(ranks[lastI]!)} r={4} className="mx-mark" />{label(lastI, `${ranks[lastI]}위`, 'start')}</> : null}
          </svg>
        ) : <p className="novel-expand__none">{contest ? '이 기간에 순위가 매겨진 날이 없습니다.' : '이 기간에 순위권 기록이 없습니다.'}</p>}
      </div>
      <div className="novel-expand__upload">
        <div className="novel-expand__meta novel-expand__meta--row"><b>연재</b><span>{upSummary}</span></div>
        <svg width={UW} height={UH} className="mx-svg" role="img" aria-label={`${n}일 연재`}>
          {/* 30일 자리를 옅은 선으로 깐다 — 기간이 짧으면 칸이 오른쪽에만 있어 왼쪽이 빈 채 떠 보였다. */}
          <line x1={0} x2={UW} y1={UH / 2} y2={UH / 2} className="novel-expand__track" />
          <UploadCells points={points} X={UX} cw={ucw} h={UH} showCount={false} />
        </svg>
      </div>
      {text ? <p className="novel-expand__synopsis">{text}</p> : <p className="novel-expand__synopsis is-empty">작품 소개가 없습니다.</p>}
      <Link to={contest ? `/contests/${contest.year}/novels/${novelId}` : `/novels/${novelId}`} className="novel-expand__go" onClick={e => e.stopPropagation()}>작품 정보 보기</Link>
    </div>
  );
}
