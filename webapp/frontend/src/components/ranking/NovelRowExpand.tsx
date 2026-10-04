import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { getContestNovelTrend, getNovelTrend } from '../../services/api';
import { formatDateKo } from '../../utils/format';
import { previousCalendarDay } from '../../utils/currentRank';
import { windowOf } from '../../utils/trendSummary';
import { buildMetricPoints, summarizeMetrics, type MetricRow } from '../../utils/metricSeries';
import { contestTrendRow, type ContestTrendRow } from '../../utils/contestNovels';

const WINDOW = 30;
const W = 300;
const H = 48;
const P = 5;

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
 * 최근 30일 순위선(지금·최고) / 작품 소개 3줄 + 작품 정보 보기. 연재 줄·기간 증가량·연재 상태는 상세로 옮겼다.
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
  const n = points.length;
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
  const label = (i: number, text: string, anchor: 'middle' | 'end') => {
    const y = Y(ranks[i]!);
    return <text x={anchor === 'end' ? X(i) - 8 : Math.min(W - 30, Math.max(24, X(i)))} y={y < 16 ? y + (anchor === 'end' ? 4 : 16) : y - 8} textAnchor={anchor} className="novel-expand__label">{text}</text>;
  };
  const lonely = (i: number) => ranks[i] != null && ranks[i - 1] == null && ranks[i + 1] == null;
  const text = synopsis ?? (typeof state === 'object' ? [...state.rows].reverse().find(r => r.Synopsis)?.Synopsis ?? null : null);

  return (
    <div className="novel-expand">
      <div className="novel-expand__charts">
        <div className="novel-expand__h">{n}일 순위</div>
        {vals.length > 0 ? (
          <svg width={W} height={H + 4} className="mx-svg" role="img" aria-label={`${n}일 순위 추이`}>
            <path d={d} className="mx-rankline" />
            {ranks.map((r, i) => (lonely(i) ? <circle key={i} cx={X(i)} cy={Y(r!)} r={2.6} className="mx-rankdot" /> : null))}
            {bestI >= 0 && bestI !== lastI ? <><circle cx={X(bestI)} cy={Y(ranks[bestI]!)} r={3} className="mx-rankdot" />{label(bestI, `최고 ${ranks[bestI]}위`, 'middle')}</> : null}
            {lastI >= 0 ? <><circle cx={X(lastI)} cy={Y(ranks[lastI]!)} r={4} className="mx-mark" />{label(lastI, `${ranks[lastI]}위`, 'end')}</> : null}
          </svg>
        ) : <p className="novel-expand__none">{contest ? '이 기간에 순위가 매겨진 날이 없습니다.' : '이 기간에 순위권 기록이 없습니다.'}</p>}
        <div className="novel-expand__cap"><span>{formatDateKo(points[0]?.date ?? start)}</span><span>{formatDateKo(date)}</span></div>
      </div>
      {text ? <p className="novel-expand__synopsis">{text}</p> : <p className="novel-expand__synopsis is-empty">작품 소개가 없습니다.</p>}
      <div className="novel-expand__side">
        <Link to={contest ? `/contests/${contest.year}/novels/${novelId}` : `/novels/${novelId}`} className="novel-expand__go" onClick={e => e.stopPropagation()}>작품 정보 보기</Link>
      </div>
    </div>
  );
}
