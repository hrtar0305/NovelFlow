import { useCallback, useMemo, useRef } from 'react';
import {
  ResponsiveContainer, ScatterChart, Scatter, XAxis, YAxis,
  CartesianGrid, Label, ReferenceLine, ReferenceArea, Tooltip,
} from 'recharts';
import { describeRankChange } from '../../utils/rankChange';
import { DAILY_RULES, ZONE_LABEL, formatShare, formatTop, zoneLines, type ZonedTag, type ZoneKey, type ZoneRules } from '../../utils/tagZones';

/**
 * 태그 지형 지도 — 가로 작품 수(로그), 세로 100위 안 비율(DECISIONS 2026-10-06, 하루 판정).
 * 선 두 개(흔한 태그 기준 cut, 평균 비율 p0)로 칸이 넷 생기지만 구역은 셋이다 — 오른쪽 위 대세, 오른쪽 아래 과포화,
 * 왼쪽 위의 숨은 강자 영역(평균의 1.5배 이상)만 옅게 칠하고, 나머지는 이름 없는 회색 바탕(사용자 결정 A).
 * 원 크기는 없앴다 — 인기 점수가 가로축(작품 수)과 거의 같은 정보라 두 번 그리게 된다. 점 색이 곧 구역.
 * 세로 상한은 평균의 3배로 둔다(데일리 60%). 공모전은 평균이 3% 대라 고정 % 면 점이 바닥에 깔린다. 넘는 점은 ▲로 위 끝에.
 */

const ZONE_COLOR: Record<ZoneKey, string> = {
  mainstream: 'var(--np-zone-mainstream)',
  gem: 'var(--np-zone-gem)',
  saturated: 'var(--np-zone-saturated)',
};
const NONE_COLOR = 'var(--np-zone-none)';

type MapTag = ZonedTag & { top100: number; ranked_total: number };
type Plotted = MapTag & { share: number; sharePlotted: number; isClamped: boolean; held: boolean };
type ShapeProps = { cx?: number; cy?: number; payload?: Plotted; 'data-recharts-item-index'?: number };

interface Props {
  rows: MapTag[];
  rules?: ZoneRules;
  /** 표에서 마우스를 올린 태그·펼친 태그 */
  active: string | null;
  /** 검색·구역 필터 중이면 맞는 태그만 진하게 */
  matches: Set<string> | null;
  onPick: (tag: string) => void;
  onHover: (tag: string | null) => void;
}

/** 1·2·5 × 10^k 눈금(도메인 안) — 공모전은 작품 수가 2,000 을 넘어 고정 눈금이 200 에서 끊겼다. */
function logTicks(lo: number, hi: number): number[] {
  const out: number[] = [];
  for (let e = Math.floor(Math.log10(Math.max(1, lo))); 10 ** e <= hi; e++) {
    for (const m of [1, 2, 5]) {
      const v = m * 10 ** e;
      if (v >= lo && v <= hi) out.push(v);
    }
  }
  return out;
}

const MapTip = ({ active, payload }: { active?: boolean; payload?: { payload: Plotted }[] }) => {
  const d = active && payload?.[0]?.payload;
  if (!d) return null;
  const chg = describeRankChange(d.rank_change);
  return (
    <div className="chart-tip">
      <b>{d.Rank}위 {d.tag}</b>
      {d.zone ? <span style={{ color: `var(--np-zone-${d.zone}-text)` }}>{ZONE_LABEL[d.zone]}{d.edge ? ' · 경계' : ''}</span> : null}
      {chg.kind !== 'none' ? <span>전날 대비 {chg.label}</span> : null}
      <span>작품 {d.count}편 · 100위 안 {formatTop(d)} · 인기 점수 {formatShare(d.score_share)}</span>
      {d.held ? <span>100위 안 {d.top100}편 — 판단 보류</span> : null}
    </div>
  );
};

export default function TagTerrainMap({ rows, rules = DAILY_RULES, active, matches, onPick, onHover }: Props) {
  const lines = zoneLines(rows[0]?.ranked_total, rules);
  const yMax = (lines?.p0 ?? 0.2) * 3;

  const countDomain = useMemo(() => {
    const counts = rows.map(d => d.count);
    return [Math.min(...counts) * 0.8, Math.max(...counts) * 1.35] as [number, number];
  }, [rows]);
  const xTicks = useMemo(() => logTicks(countDomain[0], countDomain[1]), [countDomain]);

  const data = useMemo<Plotted[]>(() => rows.map(t => {
    const share = t.count > 0 ? t.top100 / t.count : 0;
    return {
      ...t, share, sharePlotted: Math.min(share, yMax), isClamped: share > yMax,
      // 왼쪽 위(숨은 강자 영역)에 있지만 100위 안 작품이 모자라 구역을 붙이지 않은 점
      held: !!lines && !t.zone && t.count < lines.cut && share >= lines.gemShare - 1e-9,
    };
  }), [rows, yMax, lines]);

  // 이름표 우선순위: 구역마다 인기 점수 순으로 번갈아(대세 1위 · 숨은 강자 1위 · 과포화 1위 · 대세 2위 …) — 한 줄로 세우면
  // 점수가 작은 숨은 강자가 전부 밀렸다. 회색 점은 가리킬 때만.
  const labelPriority = useMemo(() => {
    const within = new Map<string, number>();
    for (const z of ['mainstream', 'gem', 'saturated'] as ZoneKey[]) {
      data.filter(t => t.zone === z).sort((a, b) => (b.score_share ?? 0) - (a.score_share ?? 0)).forEach((t, i) => within.set(t.tag, i));
    }
    return [...within.entries()].sort((a, b) => a[1] - b[1]).reduce((m, [tag], i) => m.set(tag, i), new Map<string, number>());
  }, [data]);

  const dot = useCallback((props: unknown) => {
    const { cx, cy, payload } = props as ShapeProps;
    if (cx == null || cy == null || !payload) return <g />;
    const on = payload.tag === active;
    const r = on ? 7 : payload.zone ? 5 : 4;
    const common = {
      fill: payload.zone ? ZONE_COLOR[payload.zone] : NONE_COLOR,
      stroke: on ? 'var(--np-text-heading)' : 'var(--np-canvas)',
      strokeWidth: on ? 2.2 : 1,
      style: { cursor: 'pointer' },
      onClick: () => onPick(payload.tag),
      onMouseEnter: () => onHover(payload.tag),
      onMouseLeave: () => onHover(null),
    };
    const fade = matches && !matches.has(payload.tag) ? 0.12 : 1;
    return (
      <g opacity={fade}>
        {payload.isClamped
          ? <polygon points={`${cx},${cy - r} ${cx - r},${cy + r * 0.7} ${cx + r},${cy + r * 0.7}`} fillOpacity={payload.zone ? 0.85 : 0.6} {...common} />
          : <circle cx={cx} cy={cy} r={r} fillOpacity={payload.zone ? 0.85 : 0.55} {...common} />}
      </g>
    );
  }, [active, matches, onPick, onHover]);

  // 이름표는 점과 다른 층(두 번째 Scatter)에 — 한 층이면 뒤에 그린 점이 앞 이름표를 덮는다. 실제 좌표로 우선순위 순으로 훑으며
  // 이미 놓인 이름표와 겹치지 않을 때만 붙인다(▲ 도 예외 없이 — 공모전 위쪽에서 여럿이 겹쳐 읽을 수 없었다). 렌더 패스마다 초기화.
  const boxes = useRef<{ x1: number; y1: number; x2: number; y2: number }[]>([]);
  const label = useCallback((props: unknown) => {
    const p = props as ShapeProps;
    const { cx, cy, payload } = p;
    if ((p['data-recharts-item-index'] ?? 0) === 0) boxes.current = [];
    if (cx == null || cy == null || !payload) return <g />;
    const on = payload.tag === active;
    if (matches && !matches.has(payload.tag)) return <g />;
    if (!on && (labelPriority.get(payload.tag) ?? 999) >= 20) return <g />;
    const halfW = payload.tag.length * 6 + 4;
    const candidates = payload.isClamped ? [cy + 18] : [cy - 9, cy + 18];
    for (const y of candidates) {
      const box = { x1: cx - halfW, y1: y - 11, x2: cx + halfW, y2: y + 3 };
      const hit = boxes.current.some(b => box.x1 < b.x2 && b.x1 < box.x2 && box.y1 < b.y2 && b.y1 < box.y2);
      if (!hit || on) {
        boxes.current.push(box);
        return <text x={cx} y={y} textAnchor="middle" className={`tag-map__label${on ? ' is-on' : ''}`} style={{ pointerEvents: 'none' }}>{payload.tag}</text>;
      }
    }
    return <g />;
  }, [active, matches, labelPriority]);

  const zoneName = (z: ZoneKey, position: 'insideTopLeft' | 'insideTopRight' | 'insideBottomRight') => ({
    value: ZONE_LABEL[z], position, dy: position.startsWith('insideTop') ? 16 : -6, dx: position.endsWith('Left') ? 6 : -6,
    className: `tag-map__zone tag-map__zone--${z}`,
  });
  const axisTick = { fontSize: 11, fill: 'var(--np-text-secondary)' };
  // 눈금은 반듯한 값(1·2·5 단위) — 평균의 배수로 두면 공모전에서 1.7% · 3.4% · 6.7% 처럼 끊겼다. 평균은 가로선 이름표가 말한다.
  const yStep = [0.01, 0.02, 0.05, 0.1, 0.2].find(st => yMax / st <= 7) ?? 0.2;
  const yTicks = Array.from({ length: Math.floor(yMax / yStep + 1e-9) + 1 }, (_, i) => Math.round(i * yStep * 1000) / 1000);
  const pctTick = (v: number) => `${Math.round(v * 1000) / 10}%`;

  return (
    <div className="tag-map__chart">
      <ResponsiveContainer width="100%" height="100%">
        <ScatterChart margin={{ top: 28, right: 22, bottom: 30, left: 6 }}>
          <CartesianGrid stroke="var(--np-border)" strokeDasharray="3 3" vertical={false} />
          {lines ? (
            <>
              <ReferenceArea x1={countDomain[0]} x2={lines.cut} y1={lines.gemShare} y2={yMax} fill="var(--np-zone-gem)" fillOpacity={0.07}
                ifOverflow="hidden" label={zoneName('gem', 'insideTopLeft')} />
              <ReferenceArea x1={lines.cut} x2={countDomain[1]} y1={lines.p0} y2={yMax} fillOpacity={0} ifOverflow="hidden" label={zoneName('mainstream', 'insideTopRight')} />
              <ReferenceArea x1={lines.cut} x2={countDomain[1]} y1={0} y2={lines.p0} fillOpacity={0} ifOverflow="hidden" label={zoneName('saturated', 'insideBottomRight')} />
              <ReferenceLine y={lines.p0} stroke="var(--np-text-secondary)" strokeDasharray="4 4" strokeOpacity={0.6}
                label={{ value: `평균 ${pctTick(lines.p0)}`, position: 'insideLeft', dy: -8, className: 'tag-map__avg' }} />
              <ReferenceLine x={lines.cut} stroke="var(--np-text-secondary)" strokeDasharray="4 4" strokeOpacity={0.6}
                label={{ value: `${lines.cut}편`, position: 'insideBottomLeft', dx: 4, className: 'tag-map__avg' }} />
            </>
          ) : null}
          <XAxis type="number" dataKey="count" name="작품 수" scale="log" domain={countDomain}
            stroke="var(--np-border)" tick={axisTick} tickLine={false} ticks={xTicks}>
            <Label value="작품 수" position="insideBottom" offset={-16} style={axisTick} />
          </XAxis>
          <YAxis type="number" dataKey="sharePlotted" name="100위 안 비율" domain={[0, yMax]} ticks={yTicks}
            tickFormatter={pctTick} allowDataOverflow stroke="var(--np-border)" tick={axisTick} tickLine={false} width={44}>
            <Label value="↑ 100위 안 비율" position="insideTopLeft" offset={-20} style={axisTick} />
          </YAxis>
          <Tooltip content={<MapTip />} cursor={false} isAnimationActive={false} />
          <Scatter data={data} isAnimationActive={false} shape={dot} />
          <Scatter data={data} isAnimationActive={false} shape={label} legendType="none" tooltipType="none" style={{ pointerEvents: 'none' }} />
        </ScatterChart>
      </ResponsiveContainer>
    </div>
  );
}
