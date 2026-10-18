import { useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import InlineNums, { type InlineNum } from '../../components/ui/InlineNums';
import { formatDateDot, formatInt } from '../../utils/format';
import type { AnalysisReport, ReportWork, ReportLeaver, TagCombo, DiagnoseWork } from './types';

/**
 * 분석 리포트의 다섯 섹션(2026-09-30 개편, 2026-10-18 '순위가 얼마나 움직였나' · '잔류율' 섹션 삭제 — 기간과 무관하게 거의 같은 값이었다). 그래프를 쓰지 않는다 — 막대와 히스토그램은
 * 옆에 적힌 숫자를 다시 그린 것이었다. 섹션마다 h2 + 한 줄 수치 + 표/목록 + 끝에 각주 한 줄.
 * 해명 문구는 제목 아래가 아니라 끝의 한 줄로만 둔다(사실과 다르게 읽힐 수 있는 지점만).
 */

const pct = (v: number | null | undefined, digits = 0) => (v != null ? `${(v * 100).toFixed(digits)}%` : '–');
const rankText = (v: number | null | undefined) => (v != null ? `${formatInt(Math.round(v))}위` : '–');

const Section = ({ title, note, nums, foot, children }: { title: string; note?: string; nums?: InlineNum[]; foot?: ReactNode; children: ReactNode }) => (
  <section className="an-sec">
    <h2>{title}{note ? <span className="an-h3-note">{note}</span> : null}</h2>
    {nums ? <InlineNums items={nums} /> : null}
    {children}
    {foot ? <p className="an-sec__foot">{foot}</p> : null}
  </section>
);

const Work = ({ id, title, author }: { id: string; title: string | null; author: string | null }) => (
  <span className="an-work">
    <Link to={`/novels/${id}`} className="an-work__title">{title || '(제목 없음)'}</Link>
    {author ? <span className="an-work__author">{author}</span> : null}
  </span>
);

/** 표. 몇십 줄이라 가상화가 필요 없다. 좁은 화면에서는 행마다 제목 한 줄 + 이름표 붙은 수치로 접는다(`data-label` — 가로로 밀면
 *  이 섹션의 핵심 수치(잔류율·주당)가 화면 밖에 있었다). */
const Table = ({ head, rows, num = [] }: { head: ReactNode[]; rows: { key: string; cells: ReactNode[] }[]; /** 오른쪽 정렬할 숫자 열 */ num?: number[] }) => {
  const cls = (i: number) => (num.includes(i) ? 'an-num' : undefined);
  return (
    <div className="an-table-wrap">
      <table className="an-table">
        <thead><tr>{head.map((h, i) => <th key={i} scope="col" className={cls(i)}>{h}</th>)}</tr></thead>
        <tbody>{rows.map(r => <tr key={r.key}>{r.cells.map((c, i) => <td key={i} className={cls(i)} data-label={typeof head[i] === 'string' ? head[i] : undefined}>{c}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
};

const Empty = ({ children }: { children: ReactNode }) => <p className="empty-line">{children}</p>;

// ── 새로 들어온 작품과 빠진 작품 ─────────────────────────────────────────────

/** 들어온 = 지금 있고 첫날 없던 작품, 빠진 = 첫날 있고 지금 없는 작품 — 같은 기준이라 두 수가 견줄 만하다(2026-10-07).
 *  어떤 태그가 뜨고 식었는지는 여기서 세지 않는다 — 작품 수 배수로 세던 '많이 달린 태그'가 인기 점수로 재는 태그 트렌드와
 *  반대로 말해 그쪽으로 넘겼다. */
export const FlowSection = ({ report }: { report: AnalysisReport }) => {
  const { entrants, leavers, totals, entrants_basis: b } = report;
  const list = (items: ReactNode[]) => <ol className="an-list">{items}</ol>;
  return (
    <Section title="새로 들어온 작품과 빠진 작품"
      nums={[
        { label: '들어온 작품', value: `${formatInt(totals.entrants)}편` },
        { label: '그중 처음 진입', value: `${formatInt(totals.first_entrants)}편` },
        { label: '빠진 작품', value: `${formatInt(totals.leavers)}편` },
        { label: '마지막 날 목록', value: `${formatInt(totals.end_works)}편` },
      ]}
      foot={<>들어온 작품 = 마지막 날 목록에 있고 첫날 없던 작품 · 빠진 작품 = 첫날 있고 마지막 날 없는 작품 · 처음 진입 = 수집 시작({formatDateDot(b.first_collected)}) 뒤 처음 목록에 든 작품</>}>
      <div className="an-split">
        <div>
          <h3>새로 들어온 작품 <span className="an-h3-note">지금 순위순</span></h3>
          {entrants.length === 0 ? <Empty>이 기간에 새로 들어온 작품이 없습니다.</Empty> : list(entrants.map((n: ReportWork) => (
            <li key={n.id}>
              <span className="an-list__rank">{rankText(n.rank)}</span>
              <Work id={n.id} title={n.title} author={n.author} />
              <span className="an-list__meta">{n.first ? '처음 진입 · ' : ''}최고 {rankText(n.best_rank)} · {formatInt(n.eps)}화{n.added_eps ? ` (+${n.added_eps})` : ''}</span>
            </li>
          )))}
        </div>
        <div>
          <h3>빠진 작품 <span className="an-h3-note">첫날 순위순</span></h3>
          {leavers.length === 0 ? <Empty>이 기간에 빠진 작품이 없습니다.</Empty> : list(leavers.map((n: ReportLeaver) => (
            <li key={n.id}>
              <span className="an-list__rank">{rankText(n.rank_at_start)}</span>
              <Work id={n.id} title={n.title} author={n.author} />
              <span className="an-list__meta">최고 {rankText(n.best_rank)} · {formatInt(n.eps)}화{n.added_eps > 0 ? ` (+${n.added_eps})` : ''} · {formatDateDot(n.last_seen).slice(5)}까지</span>
            </li>
          )))}
        </div>
      </div>
    </Section>
  );
};

// ── 회차가 많이 올라온 작품 ──────────────────────────────────────────────────

export const PaceSection = ({ report }: { report: AnalysisReport }) => {
  const p = report.pace;
  const f = (v: number | null) => (v != null ? `${v.toFixed(1)}화` : '–');
  return (
    <Section title="회차가 많이 올라온 작품"
      nums={[
        { label: '회차 늘어난 작품', value: `${formatInt(p.growing)}편` },
        { label: '회차 그대로', value: `${formatInt(p.flat)}편` },
      ]}
      foot="늘어난 회차 = 마지막 날 회차 − 첫날 회차 · 주당 = 늘어난 회차 ÷ 관측 일수 × 7 · 회차 그대로 = 완결 · 휴재를 가르지 않음">
      {p.top.length === 0 ? <Empty>이 기간에 회차가 늘어난 작품이 없습니다.</Empty> : (
        <Table head={['지금 순위', '제목', '늘어난 회차', '주당', '전체 회차']} num={[2, 3, 4]}
          rows={p.top.map(n => ({
            key: n.id,
            cells: [rankText(n.rank), <Work key="w" id={n.id} title={n.title} author={n.author} />, `+${formatInt(n.added_eps)}`, f(n.per_week), `${formatInt(n.eps)}화`],
          }))} />
      )}
    </Section>
  );
};

// ── 조회 대비 추천이 많은 작품 ──────────────────────────────────────────

export const RatioSection = ({ report }: { report: AnalysisReport }) => {
  const r = report.period_ratio;
  // 순위로 가르는 이유는 중복 때문이다 — 추천비 상위가 전부 100위 밖이면 같은 작품이 두 번 나왔다.
  // 위아래로 쌓으면 아래가 '못한 쪽'처럼 읽혀 좌우로 둔다.
  const list = (rows: ReportWork[]) => (rows.length === 0 ? <Empty>해당 작품이 없습니다.</Empty> : (
    <ol className="an-list">
      {rows.map(n => (
        <li key={n.id}>
          <span className="an-list__rank an-list__rank--value">{pct(n.period_ratio, 1)}</span>
          <Work id={n.id} title={n.title} author={n.author} />
          <span className="an-list__meta">{rankText(n.rank)} · {formatInt(n.eps)}화</span>
        </li>
      ))}
    </ol>
  ));
  return (
    <Section title="조회 대비 추천이 많은 작품"
      nums={[{ label: '견준 작품', value: `${formatInt(r.counted)}편` }]}
      foot={<>기간 추천비 = 기간 추천 증가 ÷ 기간 조회 증가(조회 증가 {formatInt(r.floor_delta_view)} 이상인 작품만)</>}>
      <div className="an-split">
        <div><h3>지금 100위 안</h3>{list(r.top)}</div>
        <div><h3>지금 100위 밖</h3>{list(r.hidden)}</div>
      </div>
    </Section>
  );
};

// ── 작품 하나를 같은 순위대와 견주기 ─────────────────────────────────────────

const DIAGNOSE_METRICS: { key: keyof DiagnoseWork; label: string; fmt: (v: number) => string }[] = [
  { key: 'score', label: '점수', fmt: v => formatInt(Math.round(v)) },
  { key: 'delta_view', label: '기간 조회 증가', fmt: v => formatInt(Math.round(v)) },
  { key: 'period_ratio', label: '기간 추천비', fmt: v => `${(v * 100).toFixed(1)}%` },
  { key: 'per_week', label: '주당 회차', fmt: v => `${v.toFixed(1)}화` },
  { key: 'eps', label: '회차', fmt: v => `${formatInt(v)}화` },
  { key: 'early', label: '초반 잔류', fmt: v => `${(v * 100).toFixed(0)}%` },
  { key: 'recent', label: '최신 잔류', fmt: v => `${(v * 100).toFixed(0)}%` },
];

const median = (vs: number[]) => {
  const s = [...vs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

export const DiagnoseSection = ({ report }: { report: AnalysisReport }) => {
  const [q, setQ] = useState('');
  const [pickedId, setPickedId] = useState<string | null>(null);
  const { works, quartiles } = report.diagnose;

  const hits = useMemo(() => {
    const t = q.trim();
    if (!t) return [];
    return works.filter(w => (w.title ?? '').includes(t) || (w.author ?? '').includes(t)).slice(0, 8);
  }, [q, works]);
  const target = useMemo(() => works.find(w => w.id === pickedId) ?? null, [works, pickedId]);
  const peers = useMemo(() => (target?.band != null ? works.filter(w => w.band === target.band) : []), [works, target]);
  const rows = useMemo(() => {
    if (!target || peers.length < 5) return [];
    return DIAGNOSE_METRICS.flatMap(m => {
      const mine = target[m.key];
      if (typeof mine !== 'number') return [];
      const vals = peers.map(p => p[m.key]).filter((v): v is number => typeof v === 'number');
      if (vals.length < 5) return [];
      return [{ label: m.label, mine: m.fmt(mine), med: m.fmt(median(vals)), top: 1 - vals.filter(v => v < mine).length / vals.length }];
    });
  }, [target, peers]);
  const band = target?.band != null ? quartiles[target.band] : null;

  return (
    <Section title="작품 하나를 같은 순위대와 견주기"
      nums={quartiles.map(qt => ({
        label: qt.label,
        value: <span className={target?.band != null && quartiles[target.band] === qt ? 'an-on' : undefined}>평균 {Math.max(1, Math.round(qt.min))}{qt.max ? `~${Math.round(qt.max)}위` : '위~'}</span>,
      }))}
      foot="순위대 = 이 기간 목록을 기간 평균 순위로 4등분 · 순위대 안 위치 = 같은 순위대에서 이 작품 이상인 작품의 비율">
      <div className="an-search">
        <input type="search" className="toolbar-search" value={q} onChange={e => setQ(e.target.value)} placeholder="제목 또는 작가" aria-label="견줄 작품 검색" />
        {hits.length > 0 ? (
          <ul className="an-search__hits">
            {hits.map(w => (
              <li key={w.id}>
                <button type="button" onClick={() => { setPickedId(w.id); setQ(''); }}>
                  <b>{w.title}</b><span>{w.author} · 평균 {rankText(w.avg_rank)}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      {target ? (
        <>
          <p className="an-picked">
            <Work id={target.id} title={target.title} author={target.author} />
            <span className="an-list__meta">평균 {rankText(target.avg_rank)} · 최고 {rankText(target.best_rank)}{band ? ` · ${band.label} ${formatInt(peers.length)}편과 견줌` : ''}</span>
            <button type="button" className="link-button" onClick={() => setPickedId(null)}>선택 해제</button>
          </p>
          {rows.length === 0 ? <Empty>같은 순위대에 견줄 작품이 부족합니다.</Empty> : (
            <Table head={['지표', '이 작품', '순위대 중앙값', '순위대 안 위치']} num={[1, 2, 3]}
              rows={rows.map(r => ({ key: r.label, cells: [r.label, <b key="m">{r.mine}</b>, r.med, `상위 ${Math.max(1, Math.round(r.top * 100))}%`] }))} />
          )}
        </>
      ) : null}
    </Section>
  );
};

// ── 함께 달리는 태그 ─────────────────────────────────────────────────────────

const Combos = ({ rows, unit, date }: { rows: TagCombo[]; unit: string; date: string }) => (rows.length === 0 ? <Empty>함께 달린 횟수가 충분한 조합이 없습니다.</Empty> : (
  <ol className="an-list an-list--combo">
    {rows.map(c => (
      <li key={c.tags.join('|')}>
        <span className="an-combo">{c.tags.map((t, i) => (
          <span key={t}>{i > 0 ? <i> + </i> : null}<Link to={`/novels/rankings/${date}?tag=${encodeURIComponent(t)}`}>{t}</Link></span>
        ))}</span>
        <span className="an-list__meta">{formatInt(c.count)}편 · {unit} {c.lift.toFixed(1)}배</span>
      </li>
    ))}
  </ol>
));

/** 기간을 바꿔도 같다 — 마지막 날 목록 하나로 센다. 그래서 제목 옆에 그 날짜를 적는다(아래 끝 문장에만 있으면 기간 값으로 읽혔다). */
export const TagSection = ({ report }: { report: AnalysisReport }) => (
  <Section title="함께 달리는 태그" note={`${formatDateDot(report.end)} 목록`}
    foot="두 태그 배수 = 함께 달린 작품 수 ÷ 우연히 만날 기대값(두 태그 작품 수의 곱 ÷ 목록 편수) · 세 태그 배수 = 그중 가장 강한 두 태그 짝 대비 · 거의 겹치는 짝(같은 말인 태그)은 제외">
    <div className="an-split">
      <div><h3>두 태그 <span className="an-h3-note">10편 이상</span></h3><Combos rows={report.tags.pairs} unit="우연의" date={report.end} /></div>
      <div><h3>세 태그 <span className="an-h3-note">6편 이상</span></h3><Combos rows={report.tags.triples} unit="짝 대비" date={report.end} /></div>
    </div>
  </Section>
);
