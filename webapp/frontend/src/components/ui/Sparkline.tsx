import { rankPath } from '../../utils/sparkline';

interface SparklineProps { ranks: (number | null)[]; width: number; height: number; label: string; }

export default function Sparkline({ ranks, width, height, label }: SparklineProps) {
  const { d, last } = rankPath(ranks, width, height);
  if (!d) return <span className="sparkline sparkline--empty">{label}</span>;
  return (
    <svg className="sparkline" width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label}>
      <path d={d} fill="none" stroke="var(--np-accent)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
      {last ? <circle cx={last.x} cy={last.y} r={4} fill="var(--np-canvas)" stroke="var(--np-accent)" strokeWidth={2} /> : null}
    </svg>
  );
}
