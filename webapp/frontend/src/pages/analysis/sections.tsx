import { useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import InlineNums, { type InlineNum } from '../../components/ui/InlineNums';
import { formatDateDot, formatInt } from '../../utils/format';
import type { AnalysisReport, ReportWork, ReportLeaver, TagCombo, DiagnoseWork } from './types';

/**
 * 분석 리포트의 일곱 섹션(2026-09-30 개편). 그래프를 쓰지 않는다 — 막대와 히스토그램은
 * 옆에 적힌 숫자를 다시 그린 것이었다. 섹션마다 h2 + 한 줄 수치 + 표/목록 + 끝에 각주 한 줄.
 * 해명 문구는 제목 아래가 아니라 끝의 한 줄로만 둔다(사실과 다르게 읽힐 수 있는 지점만).
 */

const pct = (v: number | null | undefined, digits = 0) => (v != null ? `${(v * 100).toFixed(digits)}%` : '–');
const rankText = (v: number | null | undefined) => (v != null ? `${formatInt(Math.round(v))}위` : '–');

const Section = ({ title, nums, foot, children }: { title: string; nums?: InlineNum[]; foot?: ReactNode; children: ReactNode }) => (
  <section className="an-sec">
    <h2>{title}</h2>
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
      foot={<>처음 진입은 수집을 시작한 {formatDateDot(b.first_collected)} 이후 처음 목록에 든 작품이고, 빠진 작품의 제목은 첫날 기준입니다.</>}>
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
      <p className="an-tagline">어떤 태그가 뜨고 식었는지는 <Link to="/tags/trends">태그 트렌드</Link>에서 볼 수 있습니다.</p>
    </Section>
  );
};

// ── 순위가 얼마나 움직였나 ───────────────────────────────────────────────────

export const ChurnSection = ({ report }: { report: AnalysisReport }) => {
  const c = report.churn;
  // "평균 80계단"은 그 자체로 크기를 알 수 없다 — 무작위로 섞었을 때의 평균 이동을 옆에 둔다.
  return (
    <Section title="순위가 얼마나 움직였나"
      nums={[
        { label: '평균 순위 이동', value: c.footrule != null ? `${c.footrule.toFixed(1)}계단` : '–' },
        { label: '무작위라면', value: c.random_move != null ? `${c.random_move.toFixed(0)}계단` : '–' },
        { label: '절반은', value: c.median_move != null ? `${c.median_move.toFixed(0)}계단 안` : '–' },
        { label: '크게 움직인 10%', value: c.p90_move != null ? `${c.p90_move.toFixed(0)}계단+` : '–' },
        { label: '순서 일치도', value: c.kendall_tau != null ? c.kendall_tau.toFixed(2) : '–' },
      ]}
      foot={<>첫날과 마지막 날에 다 있는 {formatInt(c.common)}편을 견줬고, 순서 일치도는 1이면 순서 그대로 · 0이면 무작위입니다.</>}>
      <Table head={['지금 순위대', '작품', '첫날에도 있던 작품', '비율']} num={[1, 2, 3]}
        rows={c.bands.map(b => ({
          key: b.label,
          cells: [b.label, b.rate != null ? `${formatInt(b.total)}편` : '–', b.rate != null ? `${formatInt(b.stayed)}편` : '–', pct(b.rate)],
        }))} />
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
        { label: '주당 중앙값', value: f(p.median) },
        { label: '상위 10%', value: `${f(p.p90)}+` },
        { label: '최대', value: f(p.max) },
        { label: '변동 없음', value: `${formatInt(p.flat)}편` },
      ]}
      foot="'변동 없음'은 이 기간 회차 수가 그대로였다는 뜻으로, 완결과 휴재는 가르지 못합니다.">
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
      nums={[
        { label: '견준 작품', value: `${formatInt(r.counted)}편` },
        { label: '기간 조회 증가', value: `${formatInt(r.floor_delta_view)} 이상` },
      ]}
      foot="작품 전체 누적이 아니라 이 기간에 늘어난 추천 수 ÷ 늘어난 조회수입니다.">
      <div className="an-split">
        <div><h3>지금 100위 안</h3>{list(r.top)}</div>
        <div><h3>지금 100위 밖</h3>{list(r.hidden)}</div>
      </div>
    </Section>
  );
};

// ── 회차를 넘겨도 조회가 이어지는 작품 ─────────────────────────────────────

/** 기간을 바꿔도 같다 — 잔류율은 마지막 날 값이고, 후보는 '최근 7일 연재 중'이다(연재가 멈추면 최신화 조회수가 계속 차서
 *  최신 잔류가 오른다). 그래서 회차 열도 기간 전체가 아니라 최근 7일 증가다. */
export const RetentionSection = ({ report }: { report: AnalysisReport }) => (
  <Section title="회차를 넘겨도 조회가 이어지는 작품"
    nums={[
      { label: '최근 7일 연재 중', value: `${formatInt(report.retention.counted)}편` },
      { label: '잔류율 기준', value: formatDateDot(report.end) },
    ]}
    foot="초반 잔류 = 30화 ÷ 1화 조회수, 최신 잔류 = 최신화 ÷ 30화 전 조회수(연독률과 다른 값)이고, 두 값의 순위를 평균해 줄 세웠습니다.">
    {report.retention.rows.length === 0 ? <Empty>해당 작품이 없습니다.</Empty> : (
      // 두 잔류율을 붙여 둔다 — 폰에서 행이 접힐 때 한 줄에 같이 남게.
      <Table head={['지금 순위', '제목', '초반 잔류', '최신 잔류', '최근 7일 회차']} num={[2, 3, 4]}
        rows={report.retention.rows.map(n => ({
          key: n.id,
          cells: [rankText(n.rank), <Work key="w" id={n.id} title={n.title} author={n.author} />, pct(n.early), pct(n.recent), `+${formatInt(n.recent_added_eps ?? 0)}`],
        }))} />
    )}
  </Section>
);

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
      foot="순위대는 이 기간 목록의 4분위이고, 작품의 순위는 하루 튄 값에 끌리지 않게 기간 평균 순위입니다.">
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

/** 기간을 바꿔도 같다 — 마지막 날 목록 하나로 센다. */
export const TagSection = ({ report }: { report: AnalysisReport }) => (
  <Section title="함께 달리는 태그"
    foot={<>{formatDateDot(report.end)} 목록 기준으로, 우연히 만날 때보다(세 태그는 가장 강한 두 태그 짝보다) 몇 배인지 순이고 거의 겹치는 짝은 뺐습니다.</>}>
    <div className="an-split">
      <div><h3>두 태그 <span className="an-h3-note">10편 이상</span></h3><Combos rows={report.tags.pairs} unit="우연의" date={report.end} /></div>
      <div><h3>세 태그 <span className="an-h3-note">6편 이상</span></h3><Combos rows={report.tags.triples} unit="짝 대비" date={report.end} /></div>
    </div>
  </Section>
);
