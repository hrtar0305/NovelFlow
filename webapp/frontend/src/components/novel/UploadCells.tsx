import type { MetricPoint } from '../../utils/metricSeries';

/**
 * 연재 줄의 칸들(SVG <g>). 작품 상세 지표와 랭킹 행 펼침이 같은 규칙으로 그린다.
 *  - 올린 날: 채운 칸(두 화 이상이고 칸이 넓으면 안에 수)
 *  - 쉰 날: 테두리만 있는 칸
 *  - 여러 날치(직전 기록이 하루 전이 아님): 점선 칸 — 그 사이 어느 날 올렸는지는 모른다
 *  - 알 수 없는 날(그날 기록 없음 = 순위권 밖, 또는 전날 기록이 없어 견줄 수 없음): 가운데 짧은 회색 선
 */
export default function UploadCells({ points, X, cw, h, y = 0, hover = null, showCount = true }: {
  points: MetricPoint[]; X: (i: number) => number; cw: number; h: number; y?: number; hover?: number | null; showCount?: boolean;
}) {
  return (
    <g>
      {points.map((p, i) => {
        const x = X(i);
        if (!p.rec || !p.d || p.d.eps == null) {
          return <line key={p.date} x1={x - Math.min(cw / 2, 5)} x2={x + Math.min(cw / 2, 5)} y1={y + h / 2} y2={y + h / 2} className="mx-day__unknown" />;
        }
        const on = p.d.eps > 0;
        const multi = p.span > 1;
        const cls = `mx-day${on ? ' is-up' : ' is-rest'}${multi ? ' is-multi' : ''}${hover === i ? ' is-on' : ''}`;
        return (
          <g key={p.date}>
            <rect x={x - cw / 2} y={y} width={cw} height={h} rx={Math.min(3, h / 4)} className={cls} />
            {showCount && on && p.d.eps > 1 && cw >= 14 && h >= 14 ? <text x={x} y={y + h / 2 + 4} textAnchor="middle" className={`mx-day__n${multi ? ' is-multi' : ''}`}>{p.d.eps}</text> : null}
          </g>
        );
      })}
    </g>
  );
}
