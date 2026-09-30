import { useCallback, useMemo, useRef } from 'react';
import {
  ResponsiveContainer, ScatterChart, Scatter, XAxis, YAxis, ZAxis,
  CartesianGrid, Label, ReferenceLine, ReferenceArea, Tooltip,
} from 'recharts';
import { describeRankChange } from '../../utils/rankChange';
import { ZONE_LABEL, formatLift, type ZonedTag, type ZoneKey } from '../../utils/tagZones';

/**
 * 태그 지형 지도 — 가로 등장 작품 수(로그), 세로 상위권 집중도(제곱근), 원 크기 인기 점수.
 * 2026-09-30 개편에서 사분면 배경 칠을 걷었다. 경계선 두 개와 구역 이름으로 분류가 읽히고,
 * 점 색이 곧 구역이라 배경까지 칠하면 같은 정보가 두 겹이 된다.
 */

const ZONE_COLOR: Record<ZoneKey, string> = {
  mainstream: 'var(--np-zone-mainstream)',
  gem: 'var(--np-zone-gem)',
  saturated: 'var(--np-zone-saturated)',
  cold: 'var(--np-zone-cold)',
};

// 집중도 축 상한은 8로 고정한다. 이론상 최대는 400이고 이상치가 자주 나와(2026-08-25 최대 16.0,
// 2위 4.8) 그날 최대에 맞추면 나머지가 눌린다. 8이면 클램프되는 점은 날짜당 1개 안팎이고,
// 날짜가 바뀌어도 축이 같아 어제와 눈으로 비교된다. 8을 넘는 태그는 축 맨 위에 ▲로 그린다.
const LIFT_CLAMP = 8;
// 제곱근 공간의 선형 축. Recharts의 sqrt 스케일은 음수 도메인을 못 써 집중도 0인 원이 아래 절반 잘린다.
const LIFT_TICKS = [0, 0.5, 1, 2, 4, 8];
const LIFT_AXIS_MIN = -0.3;
const LIFT_AXIS_MAX = Math.sqrt(9.2);
const LIFT_MID = 1;

type MapTag = ZonedTag & { zone: ZoneKey; local_lift: number };
type Plotted = MapTag & { liftPlotted: number; isClamped: boolean };
type ShapeProps = { cx?: number; cy?: number; payload?: Plotted; size?: number; node?: { z?: number }; 'data-recharts-item-index'?: number };
const radius = (p: ShapeProps) => Math.max(4.5, Math.sqrt(Math.abs(p.size ?? p.node?.z ?? 200) / Math.PI));

interface Props {
  rows: MapTag[];
  cut: number;
  /** 표에서 마우스를 올린 태그·펼친 태그 */
  active: string | null;
  /** 검색 중이면 맞는 태그만 진하게 */
  matches: Set<string> | null;
  onPick: (tag: string) => void;
  onHover: (tag: string | null) => void;
}

const MapTip = ({ active, payload }: { active?: boolean; payload?: { payload: Plotted }[] }) => {
  const d = active && payload?.[0]?.payload;
  if (!d) return null;
  const chg = describeRankChange(d.rank_change);
  return (
    <div className="chart-tip">
      <b>{d.Rank}위 {d.tag}</b>
      <span style={{ color: `var(--np-zone-${d.zone}-text)` }}>{ZONE_LABEL[d.zone]}</span>
      {chg.kind !== 'none' ? <span>전날 대비 {chg.label}</span> : null}
      <span>작품 {d.count}편 · 집중도 {formatLift(d.local_lift)} · 인기 점수 {d.power_score.toFixed(2)}</span>
    </div>
  );
};

export default function TagTerrainMap({ rows, cut, active, matches, onPick, onHover }: Props) {
  // 사용량은 멱함수 분포(중앙값 ~17, 최대 ~225)라 로그 축. 양쪽 여유는 가장 큰 원의 반지름 몫이다.
  const countDomain = useMemo(() => {
    const counts = rows.map(d => d.count);
    return [Math.min(...counts) * 0.78, Math.max(...counts) * 1.6] as [number, number];
  }, [rows]);

  const data = useMemo<Plotted[]>(() => rows.map(t => ({
    ...t,
    liftPlotted: Math.sqrt(Math.min(t.local_lift, LIFT_CLAMP)),
    isClamped: t.local_lift > LIFT_CLAMP,
  })), [rows]);

  // 라벨 우선순위: 인기 점수 순위와 집중도 순위를 정규화해 더한다 — '판타지'류와 '제작'류가 함께 뽑힌다.
  const labelPriority = useMemo(() => {
    const n = data.length || 1;
    const byPower = new Map<string, number>();
    [...data].sort((a, b) => b.power_score - a.power_score).forEach((t, i) => byPower.set(t.tag, i / n));
    const byLift = new Map<string, number>();
    [...data].sort((a, b) => b.local_lift - a.local_lift).forEach((t, i) => byLift.set(t.tag, i / n));
    return [...data]
      .map(t => ({ tag: t.tag, score: (byPower.get(t.tag) ?? 1) + (byLift.get(t.tag) ?? 1) }))
      .sort((a, b) => a.score - b.score)
      .reduce((m, t, i) => m.set(t.tag, i), new Map<string, number>());
  }, [data]);

  const dot = useCallback((props: unknown) => {
    const p = props as ShapeProps;
    const { cx, cy, payload } = p;
    if (cx == null || cy == null || !payload) return <g />;
    const r = radius(p);
    const on = payload.tag === active;
    const common = {
      fill: ZONE_COLOR[payload.zone],
      stroke: on ? 'var(--np-text-heading)' : 'var(--np-canvas)',
      strokeWidth: on ? 2.4 : 1,
      style: { cursor: 'pointer' },
      onClick: () => onPick(payload.tag),
      onMouseEnter: () => onHover(payload.tag),
      onMouseLeave: () => onHover(null),
    };
    return (
      <g opacity={matches && !matches.has(payload.tag) ? 0.15 : 1}>
        {payload.isClamped
          ? <polygon points={`${cx},${cy - r} ${cx - r},${cy + r * 0.7} ${cx + r},${cy + r * 0.7}`} fillOpacity={on ? 0.95 : 0.75} {...common} />
          : <circle cx={cx} cy={cy} r={on ? r + 2.5 : r} fillOpacity={on ? 0.95 : 0.65} {...common} />}
      </g>
    );
  }, [active, matches, onPick, onHover]);

  // 라벨은 원과 다른 층(두 번째 Scatter)에 그린다 — 한 층에 두면 뒤에 그려진 원이 앞 라벨을 덮는다.
  // 원 70개 안팎 중 겹치는 쌍이 많아, Recharts가 준 실제 좌표로 우선순위 순으로 훑으며
  // 이미 놓인 라벨과 겹치지 않을 때만 붙인다. 렌더 패스마다(index 0) 초기화한다.
  const boxes = useRef<{ x1: number; y1: number; x2: number; y2: number }[]>([]);
  const label = useCallback((props: unknown) => {
    const p = props as ShapeProps;
    const { cx, cy, payload } = p;
    if ((p['data-recharts-item-index'] ?? 0) === 0) boxes.current = [];
    if (cx == null || cy == null || !payload) return <g />;
    const on = payload.tag === active;
    if (matches && !matches.has(payload.tag)) return <g />;
    const force = on || payload.isClamped;
    if (!force && (labelPriority.get(payload.tag) ?? 999) >= 18) return <g />;
    const r = radius(p);
    const halfW = payload.tag.length * 6 + 4;
    // 클램프된 점은 축 맨 위라 위쪽에 구역 이름이 있다 — 아래만 쓴다.
    const candidates = payload.isClamped ? [cy + r + 15] : [cy - r - 6, cy + r + 15];
    for (const y of candidates) {
      const box = { x1: cx - halfW, y1: y - 11, x2: cx + halfW, y2: y + 3 };
      const hit = boxes.current.some(b => box.x1 < b.x2 && b.x1 < box.x2 && box.y1 < b.y2 && b.y1 < box.y2);
      if (!hit || force) {
        boxes.current.push(box);
        return <text x={cx} y={y} textAnchor="middle" className={`tag-map__label${on ? ' is-on' : ''}`} style={{ pointerEvents: 'none' }}>{payload.tag}</text>;
      }
    }
    return <g />;
  }, [active, matches, labelPriority]);

  const zoneName = (z: ZoneKey, position: 'insideTopLeft' | 'insideTopRight' | 'insideBottomLeft' | 'insideBottomRight') => ({
    value: ZONE_LABEL[z], position, dy: position.startsWith('insideTop') ? 18 : -6, dx: position.endsWith('Left') ? 6 : -6,
    className: `tag-map__zone tag-map__zone--${z}`,
  });
  const axisTick = { fontSize: 11, fill: 'var(--np-text-secondary)' };

  return (
    <div className="tag-map__chart">
      <ResponsiveContainer width="100%" height="100%">
        <ScatterChart margin={{ top: 40, right: 26, bottom: 34, left: 8 }}>
          <CartesianGrid stroke="var(--np-border)" strokeDasharray="3 3" />
          {/* 칠은 없이 구역 이름만 단다. */}
          <ReferenceArea x1={countDomain[0]} x2={cut} y1={LIFT_MID} y2={LIFT_AXIS_MAX} fillOpacity={0} ifOverflow="hidden" label={zoneName('gem', 'insideTopLeft')} />
          <ReferenceArea x1={cut} x2={countDomain[1]} y1={LIFT_MID} y2={LIFT_AXIS_MAX} fillOpacity={0} ifOverflow="hidden" label={zoneName('mainstream', 'insideTopRight')} />
          <ReferenceArea x1={countDomain[0]} x2={cut} y1={LIFT_AXIS_MIN} y2={LIFT_MID} fillOpacity={0} ifOverflow="hidden" label={zoneName('cold', 'insideBottomLeft')} />
          <ReferenceArea x1={cut} x2={countDomain[1]} y1={LIFT_AXIS_MIN} y2={LIFT_MID} fillOpacity={0} ifOverflow="hidden" label={zoneName('saturated', 'insideBottomRight')} />
          <XAxis type="number" dataKey="count" name="등장 작품 수" scale="log" domain={countDomain}
            stroke="var(--np-border)" tick={axisTick} tickLine={false} ticks={[5, 10, 20, 50, 100, 200]}>
            <Label value="작품 수 (로그 눈금)" position="insideBottom" offset={-18} style={axisTick} />
          </XAxis>
          <YAxis type="number" dataKey="liftPlotted" name="상위권 집중도"
            domain={[LIFT_AXIS_MIN, LIFT_AXIS_MAX]} ticks={LIFT_TICKS.map(Math.sqrt)}
            tickFormatter={(v: number) => String(Math.round(v * v * 10) / 10)} allowDataOverflow
            stroke="var(--np-border)" tick={axisTick} tickLine={false}>
            <Label value="↑ 상위권 집중도" position="insideTopLeft" offset={-22} style={axisTick} />
          </YAxis>
          <ReferenceLine y={LIFT_MID} stroke="var(--np-text-secondary)" strokeDasharray="4 4" strokeOpacity={0.55} />
          <ReferenceLine x={cut} stroke="var(--np-text-secondary)" strokeDasharray="4 4" strokeOpacity={0.55} />
          <ZAxis type="number" dataKey="power_score" range={[90, 950]} name="인기 점수" />
          <Tooltip content={<MapTip />} cursor={false} isAnimationActive={false} />
          <Scatter data={data} isAnimationActive={false} shape={dot} />
          <Scatter data={data} isAnimationActive={false} shape={label} legendType="none" tooltipType="none" style={{ pointerEvents: 'none' }} />
        </ScatterChart>
      </ResponsiveContainer>
    </div>
  );
}
