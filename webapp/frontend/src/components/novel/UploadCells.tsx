import { useId } from 'react';
import type { UploadsState } from '../../utils/uploads';

/**
 * 연재 줄의 칸들(SVG <g>). 작품 상세 지표와 랭킹 행 펼침이 같은 규칙으로 그린다. 값은 연재 기록(실제 회차 목록)의 날짜별 화 수다.
 * 범례 없이 읽히게 모양으로 가른다(2026-10-05 사용자):
 *  - 올린 날: 색으로 채운 칸(두 화 이상이고 칸이 넓으면 안에 수)
 *  - 쉰 날(확정): 빗금 칸
 *  - 확정할 수 없는 날(아직 안 끝난 날에 안 보임 · 마지막 확인 뒤 · 다 받지 못한 앞부분): ?
 *  - 첫 회차 앞(아직 없던 작품): 빈칸
 * 받는 중이면 칸 자리에 깜빡이는 막대 하나, 실패하면 아무것도 그리지 않는다(어느 쪽도 ? 로 칠하지 않는다 — 틀린 정보다).
 */
export default function UploadCells({ dates, days, X, cw, h, y = 0, hover = null, showCount = true }: {
  dates: string[]; days: UploadsState; X: (i: number) => number; cw: number; h: number; y?: number; hover?: number | null; showCount?: boolean;
}) {
  const hatch = `hatch-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const rx = Math.min(3, h / 4);
  if (days === 'error' || dates.length === 0) return null;
  if (days === 'loading') {
    const x0 = X(0) - cw / 2;
    return <rect x={x0} y={y + h / 2 - Math.min(3, h / 4)} width={X(dates.length - 1) + cw / 2 - x0} height={Math.min(6, h / 2)} rx={3} className="mx-day__loading" />;
  }
  return (
    <g>
      <defs>
        <pattern id={hatch} width={3} height={3} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <line x1={0} y1={0} x2={0} y2={3} className="mx-day__hatch" />
        </pattern>
      </defs>
      {dates.map((date, i) => {
        const x = X(i);
        const n = days[date];
        const on = hover === i ? ' is-on' : '';
        if (n === 'before') return null;
        if (n == null) {
          return <text key={date} x={x} y={y + h / 2} dy="0.35em" textAnchor="middle" fontSize={Math.min(15, h * 0.8)} className="mx-day__q">?</text>;
        }
        if (n === 0) {
          return <rect key={date} x={x - cw / 2} y={y} width={cw} height={h} rx={rx} fill={`url(#${hatch})`} className={`mx-day is-rest${on}`} />;
        }
        return (
          <g key={date}>
            <rect x={x - cw / 2} y={y} width={cw} height={h} rx={rx} className={`mx-day is-up${on}`} />
            {showCount && n > 1 && cw >= 14 && h >= 14 ? <text x={x} y={y + h / 2 + 4} textAnchor="middle" className="mx-day__n">{n}</text> : null}
          </g>
        );
      })}
    </g>
  );
}
