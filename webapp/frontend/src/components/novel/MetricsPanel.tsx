import { useLayoutEffect, useMemo, useRef, useState, type PointerEvent, type ReactNode } from 'react';
import ChangeMark from '../ui/ChangeMark';
import { formatDateKo, formatInt, formatMan, formatRatio } from '../../utils/format';
import { rankTicks, signed, summarizeMetrics, uploadStats, type MetricPoint } from '../../utils/metricSeries';

/**
 * 작품 상세 '지표' 영역(2026-09-30 개편). 사용자가 고른 기간 동안 한 작품의 지표를 따라가는 곳이다.
 *
 * 요약 한 줄 → 순위 선 하나 → 증가량 묶음(조회 · 추천 · 회차 막대, 점수 선) → 날짜별 표.
 * - 누적값의 선(늘 오르는 선)과 전일 대비를 겹쳐 그리던 주식 차트식 막대, 크게 보기, 구간 확대(Brush)는 없앴다.
 *   기간은 위의 기간 선택이 정하고, 정확한 값은 표가 맡는다.
 * - 모든 줄이 같은 날짜 칸을 쓰고, 한 칸에 올리면 다섯 줄이 함께 강조되며 그날 값이 카드 하나로 뜬다.
 * - 여러 날치 증가량(직전 기록이 하루 전이 아님)은 하루 평균 높이의 점선 막대로 그린다.
 */

interface Props {
  points: MetricPoint[];
  /** 일간은 순위권 밖·점수가 있고, 공모전은 전 작품 순위라 순위권 밖이 없고 점수도 없다. */
  kind: 'daily' | 'contest';
  /** 지금 연재 상태(일간 상세). 완결작은 '며칠째 쉬는 중' 대신 '완결'로 적는다. */
  status?: string | null;
}

const TABLE_FOLD = 14;
const md = (iso: string) => `${+iso.slice(5, 7)}.${+iso.slice(8)}`;

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [w, setW] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.floor(e.contentRect.width)));
    ro.observe(el);
    setW(Math.floor(el.getBoundingClientRect().width));
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

export default function MetricsPanel({ points, kind, status }: Props) {
  const [wrapRef, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const [allRows, setAllRows] = useState(false);
  const summary = useMemo(() => summarizeMetrics(points), [points]);

  const n = points.length;
  const mobile = width > 0 && width < 640;
  const PL = mobile ? 44 : 60;
  const PR = 12;
  const PW = Math.max(1, width - PL - PR);
  const col = PW / Math.max(1, n);
  const X = (i: number) => PL + (i + 0.5) * col;
  const bw = Math.max(2, Math.min(22, col * 0.62));

  const onMove = (e: PointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const i = Math.floor((e.clientX - rect.left - PL) / col);
    setHover(i >= 0 && i < n ? i : null);
  };

  const hl = (h: number) => (hover != null ? <rect x={X(hover) - col / 2} y={0} width={col} height={h} className="mx-hl" /> : null);

  // ── 순위 ──
  const recs = points.filter(p => p.rec && p.rank != null);
  const hasOut = kind === 'daily' && points.some(p => !p.rec);
  const rankSvg = (() => {
    if (recs.length === 0) return null;
    const ranks = recs.map(p => p.rank!);
    const lo = Math.min(...ranks);
    const hi = Math.max(...ranks);
    // 순위 폭이 좁으면(내내 1위 등) 높이를 줄인다 — 넓은 빈 칸에 선 하나만 떠 있지 않게.
    const RH = Math.min(mobile ? 168 : 208, 72 + (hi - lo) * 16 + (hasOut ? 24 : 0));
    const pad = hi === lo ? 0.5 : Math.max(1, (hi - lo) * 0.1);
    const a = Math.max(0.5, lo - pad);
    const b = hi + pad;
    const top = 22;
    const bottom = RH - (hasOut ? 30 : 12);
    const Y = (r: number) => top + ((r - a) / (b - a || 1)) * (bottom - top);
    let d = '';
    let pen = false;
    points.forEach((p, i) => {
      if (!p.rec || p.rank == null) { pen = false; return; }
      d += `${pen ? 'L' : 'M'}${X(i).toFixed(1)},${Y(p.rank).toFixed(1)}`;
      pen = true;
    });
    const idx = (p: MetricPoint) => points.indexOf(p);
    const marks = new Map<number, string>();
    if (summary) {
      marks.set(idx(summary.first), `${summary.first.rank}위`);
      if (summary.best !== summary.first && summary.best !== summary.last) marks.set(idx(summary.best), `최고 ${summary.best.rank}위`);
      marks.set(idx(summary.last), `${summary.last.rank}위`);
    }
    const lonely = (i: number) => points[i].rec && !(points[i - 1]?.rec) && !(points[i + 1]?.rec);
    return (
      <svg width={width} height={RH} className="mx-svg" role="img" aria-label="기간 순위 추이">
        {hl(RH)}
        {(hi === lo ? [lo] : rankTicks(a, b)).map(t => (
          <g key={t}>
            <line x1={PL} x2={PL + PW} y1={Y(t)} y2={Y(t)} className="mx-grid" />
            <text x={PL - 8} y={Y(t) + 4} textAnchor="end" className="mx-tick">{t}위</text>
          </g>
        ))}
        {hasOut ? (
          <>
            <text x={PL - 8} y={RH - 10} textAnchor="end" className="mx-tick">순위 밖</text>
            {points.map((p, i) => (p.rec ? null : <rect key={p.date} x={X(i) - col / 2 + 1} y={RH - 16} width={Math.max(1, col - 2)} height={6} rx={2} className="mx-out" />))}
          </>
        ) : null}
        <path d={d} className="mx-rankline" />
        {points.map((p, i) => (lonely(i) ? <circle key={p.date} cx={X(i)} cy={Y(p.rank!)} r={2.6} className="mx-rankdot" /> : null))}
        {[...marks].map(([i, label]) => {
          const x = X(i);
          const y = Y(points[i].rank!);
          const anchor = x < PL + 34 ? 'start' : x > PL + PW - 34 ? 'end' : 'middle';
          return (
            <g key={i}>
              <circle cx={x} cy={y} r={4} className="mx-mark" />
              <text x={x} y={y < top + 12 ? y + 18 : y - 10} textAnchor={anchor} className="mx-marklabel">{label}</text>
            </g>
          );
        })}
        {hover != null && points[hover].rec && points[hover].rank != null ? <circle cx={X(hover)} cy={Y(points[hover].rank!)} r={4.5} className="mx-rankdot" /> : null}
      </svg>
    );
  })();

  // ── 증가량 묶음 ──
  // 연재 줄: 하루 단위 회차 증가는 거의 늘 1이라 양 대신 '올린 날 / 쉰 날'을 칸으로 칠한다.
  const up = uploadStats(points);
  const uploadTotal = up.known > 0 ? (
    <>{up.known}일 중 <b>{up.uploaded}일</b> 연재
      {status === '완결' ? <> · <b>완결</b></> : up.streak > 1 ? <> · 지금 <b>{up.streak}일</b> 연속</> : up.resting > 0 ? <> · <b className="mx-rest">{up.resting}일째</b> 쉬는 중</> : null}
      {summary?.d.eps != null ? <> · 기간 <b>{signed(summary.d.eps)}화</b></> : null}
    </>
  ) : null;
  type Row = { key: string; label: string; total: ReactNode; kind: 'bar' | 'upload' | 'line'; get: (p: MetricPoint) => number | null };
  const rows: Row[] = [
    { key: 'view', label: '조회 증가', total: summary?.d.view != null ? `+${formatMan(summary.d.view)}` : null, kind: 'bar', get: p => p.d?.view ?? null },
    { key: 'like', label: '추천 증가', total: summary ? signed(summary.d.like) : null, kind: 'bar', get: p => p.d?.like ?? null },
    { key: 'eps', label: '연재', total: uploadTotal, kind: 'upload', get: p => p.d?.eps ?? null },
    ...(kind === 'daily' ? [{ key: 'score', label: '점수', total: summary ? formatInt(summary.last.score) : null, kind: 'line' as const, get: (p: MetricPoint) => p.score }] : []),
  ];
  const rowSvg = (r: Row) => {
    if (r.kind === 'upload') return uploadSvg();
    const h = mobile ? 46 : 56;
    const per = points.map(p => {
      const v = r.get(p);
      if (v == null) return null;
      return r.kind === 'line' ? v : v / Math.max(1, p.span);
    });
    const vals = per.filter((v): v is number => v != null);
    const mx = Math.max(1, ...vals);
    const mn = r.kind === 'line' ? Math.min(...vals) : 0;
    let line = '';
    if (r.kind === 'line') {
      let pen = false;
      per.forEach((v, i) => {
        if (v == null) { pen = false; return; }
        const y = 6 + (1 - (v - mn) / (mx - mn || 1)) * (h - 12);
        line += `${pen ? 'L' : 'M'}${X(i).toFixed(1)},${y.toFixed(1)}`;
        pen = true;
      });
    }
    return (
      <svg width={width} height={h} className="mx-svg" aria-hidden="true">
        {hl(h)}
        <line x1={PL} x2={PL + PW} y1={h - 0.5} y2={h - 0.5} className="mx-grid" />
        {r.kind === 'line' ? <path d={line} className="mx-scoreline" /> : per.map((v, i) => {
          if (v == null || v <= 0) return null;
          const multi = points[i].span > 1;
          const on = hover === i;
          const cls = `mx-bar${multi ? ' is-multi' : ''}${on ? ' is-on' : ''}`;
          const bh = Math.max(1.5, (v / mx) * (h - 6));
          return <rect key={points[i].date} x={X(i) - bw / 2} y={h - 0.5 - bh} width={bw} height={bh} rx={1.5} className={cls} />;
        })}
      </svg>
    );
  };

  function uploadSvg() {
    const h = 24;
    const cw = Math.max(3, Math.min(col - 3, 28));
    return (
      <svg width={width} height={h} className="mx-svg" aria-hidden="true">
        {hl(h)}
        {points.map((p, i) => {
          if (!p.rec || !p.d || p.d.eps == null) return null;
          const on = p.d.eps > 0;
          const multi = p.span > 1;
          const cls = `mx-day${on ? ' is-up' : ' is-rest'}${multi ? ' is-multi' : ''}${hover === i ? ' is-on' : ''}`;
          return (
            <g key={p.date}>
              <rect x={X(i) - cw / 2} y={2} width={cw} height={h - 4} rx={3} className={cls} />
              {on && p.d.eps > 1 && cw >= 14 ? <text x={X(i)} y={h / 2 + 4} textAnchor="middle" className={`mx-day__n${multi ? ' is-multi' : ''}`}>{p.d.eps}</text> : null}
            </g>
          );
        })}
      </svg>
    );
  }

  const step = Math.max(1, Math.ceil(n / (mobile ? 5 : 9)));
  const axis = (
    <svg width={width} height={18} className="mx-svg" aria-hidden="true">
      {points.map((p, i) => ((n - 1 - i) % step === 0 ? <text key={p.date} x={X(i)} y={13} textAnchor="middle" className="mx-tick">{md(p.date)}</text> : null))}
    </svg>
  );

  const tip = (() => {
    if (hover == null || width === 0) return null;
    const p = points[hover];
    const left = X(hover) + (X(hover) > width - 210 ? -196 : 14);
    return (
      <div className="mx-tip" style={{ left }}>
        <div className="mx-tip__d">{formatDateKo(p.date)}</div>
        {!p.rec ? <div>{kind === 'daily' ? '순위권 밖' : '기록 없음'}</div> : (
          <>
            <div>순위 <b>{p.rank != null ? `${formatInt(p.rank)}위` : '–'}</b> <ChangeMark value={p.change} /></div>
            {p.d ? (
              <>
                <div>조회 <b>{signed(p.d.view)}</b> · 추천 <b>{signed(p.d.like)}</b></div>
                <div>선호 <b>{signed(p.d.fav)}</b>{p.d.eps ? <> · 회차 <b>{signed(p.d.eps)}</b></> : null}</div>
                {p.span > 1 ? <div className="mx-tip__note">{p.span}일치 증가량</div> : null}
              </>
            ) : null}
            {kind === 'daily' ? <div>점수 <b>{formatInt(p.score)}</b></div> : null}
          </>
        )}
      </div>
    );
  })();

  const recent = [...points].reverse();
  const shown = allRows ? recent : recent.slice(0, TABLE_FOLD);
  const small = (p: MetricPoint, v: number | null | undefined) => (v ? <small>{signed(v)}{p.span > 1 ? ` · ${p.span}일치` : ''}</small> : null);
  const cols = kind === 'daily' ? 9 : 8;

  return (
    <div className="mx">
      {summary ? (
        <p className="mx-sum">
          {summary.first === summary.last
            ? <>{formatDateKo(summary.last.date)} <b>{summary.last.rank}위</b></>
            : <>{formatDateKo(summary.first.date)} <b>{summary.first.rank}위</b> → {formatDateKo(summary.last.date)} <b>{summary.last.rank}위</b></>}
          {summary.best !== summary.first && summary.best !== summary.last ? <> · 최고 <b>{summary.best.rank}위</b>({formatDateKo(summary.best.date)})</> : null}
          {kind === 'daily' && summary.days < summary.total ? <> · 순위권 <b>{summary.days}일</b>/{summary.total}일</> : null}
          <i>|</i>조회 <b>+{formatMan(summary.d.view)}</b>
          <i>|</i>추천 <b>{signed(summary.d.like)}</b>
          <i>|</i>선호 <b>{signed(summary.d.fav)}</b>
          <i>|</i>회차 <b>{signed(summary.d.eps)}</b>
          {summary.ratio != null ? <><i>|</i>기간 추천비 <b>{formatRatio(summary.ratio, 1)}</b></> : null}
        </p>
      ) : null}

      <div ref={wrapRef} className="mx-stack" onPointerMove={onMove} onPointerLeave={() => setHover(null)}>
        {width > 0 ? (
          <>
            <div className="mx-block">
              <div className="mx-row__h"><span>순위</span></div>
              {rankSvg}
            </div>
            {rows.map(r => (
              <div key={r.key} className="mx-block">
                <div className="mx-row__h"><span>{r.label}</span>{r.total != null ? <span className="mx-row__total">{r.kind === 'upload' ? r.total : <>{r.kind === 'line' ? '마지막 날' : '기간'} <b>{r.total}</b></>}</span> : null}</div>
                {rowSvg(r)}
              </div>
            ))}
            {axis}
            {tip}
          </>
        ) : null}
      </div>
      {points.some(p => p.span > 1) ? <p className="mx-cap">점선 막대는 직전 기록이 하루 전이 아니라 여러 날치 증가량이라, 하루 평균 높이로 그렸습니다.</p> : null}

      <div className="mx-table-wrap">
        <table className="mx-table">
          <thead>
            <tr>
              <th scope="col">날짜</th><th scope="col">순위</th><th scope="col">변동</th>
              {kind === 'daily' ? <th scope="col">점수</th> : null}
              <th scope="col">조회</th><th scope="col">추천</th><th scope="col">선호</th><th scope="col">회차</th><th scope="col">알람</th>
            </tr>
          </thead>
          <tbody>
            {shown.map(p => (
              <tr key={p.date}>
                <td>{formatDateKo(p.date)}</td>
                {!p.rec ? <td colSpan={cols - 1} className="mx-table__out">{kind === 'daily' ? '순위권 밖' : '기록 없음'}</td> : (
                  <>
                    <td><b>{p.rank != null ? `${formatInt(p.rank)}위` : '–'}</b></td>
                    <td><ChangeMark value={p.change} /></td>
                    {kind === 'daily' ? <td>{formatInt(p.score)}</td> : null}
                    <td>{formatMan(p.view)}{small(p, p.d?.view)}</td>
                    <td>{formatInt(p.like)}{small(p, p.d?.like)}</td>
                    <td>{formatInt(p.fav)}{small(p, p.d?.fav)}</td>
                    <td>{formatInt(p.eps)}{small(p, p.d?.eps)}</td>
                    <td>{formatInt(p.alr)}</td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {recent.length > TABLE_FOLD ? (
        <button type="button" className="link-button mx-more" onClick={() => setAllRows(v => !v)}>
          {allRows ? '접기' : `${recent.length - TABLE_FOLD}일 더 보기`}
        </button>
      ) : null}
    </div>
  );
}
