import { Link } from 'react-router-dom';
import Sparkline from '../ui/Sparkline';
import { formatDateKo, formatInt } from '../../utils/format';
import type { TagSeriesResponse } from '../../utils/tagTrends';
import { formatTop } from '../../utils/tagZones';


interface Props {
  tag: string;
  /** 표가 보여 주는 날짜 */
  date: string;
  series: TagSeriesResponse | 'loading' | 'error';
  /** 이 태그가 달린 작품을 보는 곳(일간 랭킹 태그 필터) */
  novelsHref: string;
}

/** 행을 누르면 그 자리에서 14일 순위선과 처음 → 끝 값, 그 태그의 작품 보기. */
export default function TagRowExpand({ tag, date, series, novelsHref }: Props) {
  const go = <Link to={novelsHref} className="row-expand__go" onClick={e => e.stopPropagation()}>'{tag}' 작품 보기</Link>;
  if (series === 'loading') return <div className="row-expand row-expand--tag row-expand--loading" aria-busy="true">불러오는 중{go}</div>;
  const row = series === 'error' ? undefined : series.tags[tag];
  if (series === 'error' || !row || !row.rank.some(r => r != null)) {
    return <div className="row-expand row-expand--tag">{series === 'error' ? '추이를 불러오지 못했습니다.' : '최근 기록이 없습니다.'}{go}</div>;
  }
  const first = row.rank.findIndex(r => r != null);
  const last = row.rank.length - 1 - [...row.rank].reverse().findIndex(r => r != null);
  const days = row.rank.filter(r => r != null).length;
  return (
    <div className="row-expand row-expand--tag">
      <div>
        <Sparkline ranks={row.rank} width={300} height={46} label={`${series.dates.length}일 순위 추이`} />
        <div className="row-expand__cap"><span>{formatDateKo(series.dates[0])}</span><span>{formatDateKo(date)}</span></div>
      </div>
      <p className="row-expand__facts">
        {first >= 0 && first !== last ? <>{formatDateKo(series.dates[first])} <b>{row.rank[first]}위</b> → </> : null}
        {formatDateKo(series.dates[last])} <b>{row.rank[last]}위</b>
        {' · '}작품 <b>{formatInt(row.count[last])}편</b>
        {row.top?.[last] != null && row.count[last] ? <>{' · '}100위 안 <b>{formatTop({ count: row.count[last]!, top100: row.top[last] })}</b></> : null}
        {days < series.dates.length ? <> · {series.dates.length}일 중 {days}일 집계</> : null}
      </p>
      {go}
    </div>
  );
}
