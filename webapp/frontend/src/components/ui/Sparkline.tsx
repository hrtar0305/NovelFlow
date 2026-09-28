import { rankPath } from '../../utils/sparkline';

interface SparklineProps { ranks: (number | null)[]; width: number; height: number; showBest?: boolean; label: string; }

export default function Sparkline({ ranks, width, height, showBest = false, label }: SparklineProps) {
  const { d, last, best } = rankPath(ranks, width, height);
  if (!d) return <span className="sparkline sparkline--empty">{label}</span>;
  return (
    <svg className="sparkline" width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label}>
      <path d={d} fill="none" stroke="var(--np-accent)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
      {showBest && best ? (
        <>
          <circle cx={best.x} cy={best.y} r={3.5} fill="var(--np-accent)" />
          <text x={best.x} y={Math.max(10, best.y - 8)} textAnchor="middle" className="sparkline__label">{best.rank}위</text>
        </>
      ) : null}
      {last ? <circle cx={last.x} cy={last.y} r={4} fill="var(--np-canvas)" stroke="var(--np-accent)" strokeWidth={2} /> : null}
    </svg>
  );
}
