import type { UploadDays } from '../../utils/uploads';

/**
 * 연재 줄의 칸들(SVG <g>). 작품 상세 지표와 랭킹 행 펼침이 같은 규칙으로 그린다. 값은 연재 기록(실제 회차 목록)의 날짜별 화 수다.
 *  - 올린 날: 채운 칸(두 화 이상이고 칸이 넓으면 안에 수)
 *  - 쉰 날: 테두리만 있는 칸
 *  - 모르는 날(마지막 확인 뒤, 다 받지 못한 기록의 앞, 기록 없는 작품): 가운데 짧은 회색 선
 */
export default function UploadCells({ dates, days, X, cw, h, y = 0, hover = null, showCount = true }: {
  dates: string[]; days: UploadDays; X: (i: number) => number; cw: number; h: number; y?: number; hover?: number | null; showCount?: boolean;
}) {
  return (
    <g>
      {dates.map((date, i) => {
        const x = X(i);
        const n = days[date];
        if (n == null) {
          return <line key={date} x1={x - Math.min(cw / 2, 5)} x2={x + Math.min(cw / 2, 5)} y1={y + h / 2} y2={y + h / 2} className="mx-day__unknown" />;
        }
        const on = n > 0;
        const cls = `mx-day${on ? ' is-up' : ' is-rest'}${hover === i ? ' is-on' : ''}`;
        return (
          <g key={date}>
            <rect x={x - cw / 2} y={y} width={cw} height={h} rx={Math.min(3, h / 4)} className={cls} />
            {showCount && n > 1 && cw >= 14 && h >= 14 ? <text x={x} y={y + h / 2 + 4} textAnchor="middle" className="mx-day__n">{n}</text> : null}
          </g>
        );
      })}
    </g>
  );
}
