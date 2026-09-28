import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { getNovelTrend } from '../../services/api';
import Sparkline from '../ui/Sparkline';
import { formatDateKo, formatInt } from '../../utils/format';
import { summarizeWindow, windowOf, type TrendPoint } from '../../utils/trendSummary';

const WINDOW = 30;

interface Props { novelId: string; date: string; availableDates: Set<string>; }

/** 행을 누르면 그 자리에서 30일 순위선·차트인 일수·최고 순위. 펼칠 때 한 번만 부른다. */
export default function NovelRowExpand({ novelId, date, availableDates }: Props) {
  const win = useMemo(() => windowOf(availableDates, date, WINDOW), [availableDates, date]);
  const start = win[0];
  const [state, setState] = useState<{ points: TrendPoint[] } | 'loading' | 'error'>('loading');

  useEffect(() => {
    if (!start) return;
    let cancelled = false;
    getNovelTrend(novelId, start, date)
      .then(r => { if (!cancelled) setState({ points: r.data as TrendPoint[] }); })
      .catch(() => { if (!cancelled) setState('error'); });
    return () => { cancelled = true; };
  }, [novelId, start, date]);

  if (state === 'loading') return <div className="row-expand row-expand--loading" aria-busy="true">불러오는 중</div>;
  if (state === 'error') return <div className="row-expand">추이를 불러오지 못했습니다.</div>;
  const s = summarizeWindow(state.points, win);
  return (
    <div className="row-expand">
      <div>
        <Sparkline ranks={s.ranks} width={300} height={46} label={`${win.length}일 순위 추이`} />
        <div className="row-expand__cap"><span>{formatDateKo(win[0])}</span><span>{formatDateKo(date)}</span></div>
      </div>
      <p className="row-expand__facts">
        {win.length}일 중 <b>{s.days}일</b> 차트인 · 최고 <b>{s.peak != null ? `${s.peak}위` : '–'}</b>
        {s.lastView != null ? <> · 조회 <b>{formatInt(s.lastView)}</b></> : null}
      </p>
      <Link to={`/novels/${novelId}`} className="row-expand__go" onClick={e => e.stopPropagation()}>작품 정보 보기</Link>
    </div>
  );
}
