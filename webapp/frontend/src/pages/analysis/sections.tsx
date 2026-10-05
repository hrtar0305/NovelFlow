import { useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import InlineNums, { type InlineNum } from '../../components/ui/InlineNums';
import { formatDateDot, formatInt } from '../../utils/format';
import type { AnalysisReport, ReportWork, ReportLeaver, TagLift, TagCombo, DiagnoseWork } from './types';

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
const Table = ({ head, rows }: { head: ReactNode[]; rows: { key: string; cells: ReactNode[] }[] }) => (
  <div className="an-table-wrap">
    <table className="an-table">
      <thead><tr>{head.map((h, i) => <th key={i} scope="col">{h}</th>)}</tr></thead>
      <tbody>{rows.map(r => <tr key={r.key}>{r.cells.map((c, i) => <td key={i} data-label={typeof head[i] === 'string' ? head[i] : undefined}>{c}</td>)}</tr>)}</tbody>
    </table>
  </div>
);

const Empty = ({ children }: { children: ReactNode }) => <p className="empty-line">{children}</p>;

// ── 새로 들어온 작품과 빠진 작품 ─────────────────────────────────────────────

/** 부분집합에서 유난히 많이 달린 태그 한 줄. 개수가 아니라 배수(이 목록 비율 ÷ 전체 비율) 순이다 —
 *  개수 순이면 어느 목록에서나 원래 흔한 태그가 위에 온다. */
const TagLiftLine = ({ label, rows, date }: { label: string; rows: TagLift[]; date: string }) => (rows.length ? (
  <p className="an-tagline">
    <span className="an-tagline__label">{label}</span>
    {rows.map((t, i) => (
      <span key={t.tag}>
        {i > 0 ? ' · ' : null}
        <Link to={`/novels/rankings/${date}?tag=${encodeURIComponent(t.tag)}`}>{t.tag}</Link>
        <span className="an-tagline__x" title={`${t.count}편 · 전체 목록보다 ${t.lift.toFixed(1)}배 자주 달림`}> ×{t.lift.toFixed(1)}</span>
      </span>
    ))}
  </p>
) : null);

export const FlowSection = ({ report }: { report: AnalysisReport }) => {
  const { entrants, leavers, totals, entrant_tags, leaver_tags, entrants_basis: b } = report;
  const list = (items: ReactNode[]) => <ol className="an-list">{items}</ol>;
  return (
    <Section title="새로 들어온 작품과 빠진 작품"
      nums={[
        { label: '들어온 작품', value: `${formatInt(totals.entrants)}편` },
        { label: '빠진 작품', value: `${formatInt(totals.leavers)}편` },
        { label: '마지막 날 목록', value: `${formatInt(totals.end_works)}편` },
      ]}
      foot={<>
        들어온 작품은 수집을 시작한 {formatDateDot(b.first_collected)} 이후 이 기간에 처음 랭킹 목록에 든 작품입니다(첫날에 없던 {formatInt(b.checked)}편 중 예전에 든 적이 있는 {formatInt(b.returning)}편을 뺐습니다).
        빠진 작품의 제목·태그는 첫날 기준이고, 목록에서 빠졌다는 것이 연재를 멈췄다는 뜻은 아닙니다. ×는 전체 목록보다 몇 배 자주 달렸는지입니다.
      </>}>
      <div className="an-split">
        <div>
          <h3>새로 들어온 작품</h3>
          {entrants.length === 0 ? <Empty>이 기간에 새로 들어온 작품이 없습니다.</Empty> : list(entrants.slice(0, 15).map((n: ReportWork) => (
            <li key={n.id}>
              <span className="an-list__rank">{rankText(n.rank)}</span>
              <Work id={n.id} title={n.title} author={n.author} />
              <span className="an-list__meta">최고 {rankText(n.best_rank)} · {formatInt(n.eps)}화{n.added_eps ? ` (+${n.added_eps})` : ''}</span>
            </li>
          )))}
          <TagLiftLine label="많이 달린 태그" rows={entrant_tags} date={report.end} />
        </div>
        <div>
          <h3>빠진 작품</h3>
          {leavers.length === 0 ? <Empty>이 기간에 빠진 작품이 없습니다.</Empty> : list(leavers.slice(0, 15).map((n: ReportLeaver) => (
            <li key={n.id}>
              <span className="an-list__rank">{rankText(n.rank_at_start)}</span>
              <Work id={n.id} title={n.title} author={n.author} />
              <span className="an-list__meta">최고 {rankText(n.best_rank)} · {formatInt(n.eps)}화{n.added_eps > 0 ? ` (+${n.added_eps})` : ''} · {formatDateDot(n.last_seen).slice(5)}까지</span>
            </li>
          )))}
          <TagLiftLine label="많이 달린 태그" rows={leaver_tags} date={report.start} />
        </div>
      </div>
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
        { label: '평균 이동', value: c.footrule != null ? <>{c.footrule.toFixed(1)}계단{c.random_move != null ? <span className="an-soft"> (무작위라면 {c.random_move.toFixed(0)})</span> : null}</> : '–' },
        { label: '절반은', value: c.median_move != null ? `${c.median_move.toFixed(0)}계단 안` : '–' },
        { label: '크게 움직인 10%', value: c.p90_move != null ? `${c.p90_move.toFixed(0)}계단+` : '–' },
        { label: '순서 유지도', value: c.kendall_tau != null ? c.kendall_tau.toFixed(2) : '–' },
      ]}
      foot={<>첫날과 마지막 날 목록에 다 있는 {formatInt(c.common)}편의 순위를 견줬습니다. 순서 유지도는 1이면 순서 그대로, 0이면 무작위, −1이면 완전히 뒤집힌 것입니다. 목록에서 빠진 것은 인기가 식었다는 뜻일 수도, 표시 범위 밖으로 한 칸 나갔다는 뜻일 수도 있습니다.</>}>
      <Table head={['지금 순위대', '작품', '첫날에도 있던 작품', '비율']}
        rows={c.bands.map(b => ({
          key: b.label,
          cells: [b.label, b.rate != null ? `${formatInt(b.total)}편` : '–', b.rate != null ? `${formatInt(b.stayed)}편` : '–', <b key="r">{pct(b.rate)}</b>],
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
        { label: '연재', value: `${formatInt(p.growing)}편` },
        { label: '주당 중앙값', value: f(p.median) },
        { label: '상위 10%', value: `${f(p.p90)}+` },
        { label: '최대', value: f(p.max) },
        { label: '변동 없음', value: `${formatInt(p.flat)}편` },
      ]}
      foot="완결과 휴재를 가를 데이터가 없어, '변동 없음'은 이 기간에 관측된 회차 수가 그대로였다는 뜻입니다. 회차가 많다고 좋은 작품이라는 뜻은 아닙니다.">
      {p.top.length === 0 ? <Empty>이 기간에 회차가 늘어난 작품이 없습니다.</Empty> : (
        <Table head={['지금 순위', '제목', '늘어난 회차', '주당', '전체 회차']}
          rows={p.top.map(n => ({
            key: n.id,
            cells: [rankText(n.rank), <Work key="w" id={n.id} title={n.title} author={n.author} />, <b key="a">+{formatInt(n.added_eps)}</b>, f(n.per_week), `${formatInt(n.eps)}화`],
          }))} />
      )}
    </Section>
  );
};

// ── 읽은 사람 대비 추천이 많은 작품 ──────────────────────────────────────────

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
    <Section title="읽은 사람 대비 추천이 많은 작품"
      nums={[
        { label: '견준 작품', value: `${formatInt(r.counted)}편` },
        { label: '기간 조회 증가', value: `${formatInt(r.floor_delta_view)} 이상` },
      ]}
      foot="작품 전체 누적이 아니라 이 기간에 늘어난 추천 수 ÷ 늘어난 조회수입니다. 증가분이 작으면 몇 건에 비율이 출렁여 하한을 뒀습니다.">
      <div className="an-split">
        <div><h3>지금 100위 안</h3>{list(r.top)}</div>
        <div><h3>지금 100위 밖</h3>{list(r.hidden)}</div>
      </div>
    </Section>
  );
};

// ── 회차를 넘겨도 독자가 남는 작품 ───────────────────────────────────────────

export const RetentionSection = ({ report }: { report: AnalysisReport }) => (
  <Section title="회차를 넘겨도 독자가 남는 작품"
    foot="초반 잔류 = 30화 조회수 ÷ 1화 조회수, 최신 잔류 = 최신화 조회수 ÷ 30화 전 조회수(흔히 쓰는 연독률과는 다른 값). 두 값을 후보 안 백분위로 바꿔 평균한 순서이고, 마지막 7일에 회차가 늘어난(지금 연재 중인) 작품만 넣었습니다 — 연재가 멈추면 최신화 조회수가 계속 차서 최신 잔류가 올라갑니다.">
    {report.retention.rows.length === 0 ? <Empty>해당 작품이 없습니다.</Empty> : (
      <Table head={['지금 순위', '제목', '늘어난 회차', '초반 잔류', '최신 잔류']}
        rows={report.retention.rows.map(n => ({
          key: n.id,
          cells: [rankText(n.rank), <Work key="w" id={n.id} title={n.title} author={n.author} />, `+${formatInt(n.added_eps)}`, <b key="e">{pct(n.early)}</b>, <b key="r">{pct(n.recent)}</b>],
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
        value: <span className={target?.band != null && quartiles[target.band] === qt ? 'an-on' : undefined}>평균 {Math.max(1, Math.round(qt.min))}~{qt.max ? `${Math.round(qt.max)}위` : ''}</span>,
      }))}
      foot="순위대는 이 기간 목록의 4분위이고, 작품의 순위는 기간 평균 순위입니다 — 마지막 날 순위 하나로 정하면 그날 우연히 튄 작품이 엉뚱한 구간에 들어갑니다.">
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
            <Table head={['지표', '이 작품', '순위대 중앙값', '순위대 안 위치']}
              rows={rows.map(r => ({ key: r.label, cells: [r.label, <b key="m">{r.mine}</b>, r.med, `상위 ${Math.max(1, Math.round(r.top * 100))}%`] }))} />
          )}
        </>
      ) : null}
    </Section>
  );
};

// ── 함께 달리는 태그 ─────────────────────────────────────────────────────────

const Combos = ({ rows, unit }: { rows: TagCombo[]; unit: string }) => (rows.length === 0 ? <Empty>함께 달린 횟수가 충분한 조합이 없습니다.</Empty> : (
  <ol className="an-list an-list--combo">
    {rows.map(c => (
      <li key={c.tags.join('|')}>
        <span className="an-combo">{c.tags.map((t, i) => <span key={t}>{i > 0 ? <i> + </i> : null}{t}</span>)}</span>
        <span className="an-list__meta">{formatInt(c.count)}편 · {unit} <b>{c.lift.toFixed(1)}배</b></span>
      </li>
    ))}
  </ol>
));

export const TagSection = ({ report }: { report: AnalysisReport }) => (
  <Section title="함께 달리는 태그"
    foot="흔한 태그끼리는 그냥 자주 만나므로 횟수가 아니라 배수로 줄 세웠습니다. 두 태그는 우연히 만날 때보다 몇 배인지(10편 이상), 세 태그는 그 안의 가장 강한 두 태그 짝에 나머지 하나가 우연히 붙을 때보다 몇 배인지(6편 이상)이고, 달린 작품이 절반 이상 겹치는 짝은 뺐습니다.">
    <div className="an-split">
      <div><h3>두 태그</h3><Combos rows={report.tags.pairs} unit="우연의" /></div>
      <div><h3>세 태그</h3><Combos rows={report.tags.triples} unit="짝 대비" /></div>
    </div>
  </Section>
);
