import { format, parseISO } from 'date-fns';
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip as RechartsTooltip,
} from 'recharts';

/**
 * 태그 하나의 순위 추이.
 *
 * 태그 트렌드와 태그 랭킹이 같은 그림을 그린다. 태그 랭킹의 선택 패널은 원래
 * 오늘의 값 넷(등장/집중도/인기 점수/변동)만 보여줬는데, 그건 지도 툴팁이 이미
 * 하는 일이라 클릭하면 같은 내용이 두 군데에 떴다. 툴팁은 '오늘'을, 패널은
 * '추이'를 맡게 나눈 뒤로 이 차트가 패널의 본체가 됐다.
 */
export type TagRankPoint = { date: string; rank: number; count: number; score: number; lift: number | null };

const TagRankChart = ({ points }: { points: TagRankPoint[] }) => {
  // 순위는 작을수록 좋으므로 축을 뒤집는다. 위로 올라가면 순위가 오른 것.
  const ranks = points.map(p => p.rank);
  const pad = Math.max(2, Math.round((Math.max(...ranks) - Math.min(...ranks)) * 0.15));
  const data = points.map(p => ({
    label: format(parseISO(p.date), 'MM.dd'),
    순위: p.rank,
    작품: p.count,
    점수: Number(p.score.toFixed(2)),
  }));

  return (
    <>
      <div className="tag-trend-chart">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 12, bottom: 4, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--np-border)" vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: 11, fill: 'var(--np-text-secondary)' }}
              tickLine={false} axisLine={{ stroke: 'var(--np-border)' }} />
            <YAxis reversed domain={[Math.max(1, Math.min(...ranks) - pad), Math.max(...ranks) + pad]}
              tick={{ fontSize: 11, fill: 'var(--np-text-secondary)' }} tickLine={false} axisLine={false}
              width={38} allowDecimals={false} />
            <RechartsTooltip
              contentStyle={{
                background: 'var(--np-surface-raised)', border: '1px solid var(--np-border-strong)',
                borderRadius: 'var(--np-radius-sm)', fontSize: '0.82rem',
              }}
              labelStyle={{ color: 'var(--np-text-heading)' }}
              formatter={(v: number, name: string) => [name === '순위' ? `${v}위` : v, name]}
            />
            <Line type="monotone" dataKey="순위" stroke="var(--np-accent)" strokeWidth={2}
              dot={{ r: 3, fill: 'var(--np-accent)' }} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <p className="tag-trend-chart__note">위로 갈수록 순위가 높습니다</p>
    </>
  );
};

export default TagRankChart;
