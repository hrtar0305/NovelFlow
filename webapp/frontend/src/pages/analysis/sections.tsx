import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip as RechartsTooltip, ReferenceLine,
} from 'recharts';
import PanelCard from '../../components/ui/PanelCard';
import type {
  AnalysisReport, ReportWork, ReportLeaver, TagLift, TagCombo, DiagnoseWork,
} from './types';

const pctOf = (v: number | null | undefined) => (v != null ? `${Math.round(v * 100)}%` : '-');
const ratioPct = (v: number | null | undefined) => (v != null ? `${(v * 100).toFixed(1)}%` : '-');
const dot = (d: string) => d.replace(/-/g, '.');

/** 섹션 껍데기. 제목 아래 설명 문구는 쓰지 않는다 — 사실과 다르게 읽힐 수 있는
 *  지점만 맨 아래 작은 글씨로 붙인다. */
const Section = ({ title, meta, caveat, children }: {
  title: string; meta?: string; caveat?: string; children: React.ReactNode;
}) => (
  <PanelCard title={title} meta={meta} className="report-section">
    {children}
    {caveat && <p className="report-caveat">{caveat}</p>}
  </PanelCard>
);

const NovelLink = ({ id, title, author }: { id: string; title: string | null; author: string | null }) => (
  <Link to={`/novels/${id}`} className="report-novel">
    <span className="report-novel__title">{title || '(제목 없음)'}</span>
    {author && <span className="report-novel__author">{author}</span>}
  </Link>
);

/** 부분집합에서 유난히 많이 달린 태그.
 *
 *  **줄 세우는 기준은 개수가 아니라 배수다.** 개수로 정렬하면 어느 부분집합에서나
 *  '로맨스판타지'처럼 원래 흔한 태그가 위에 오고, 그건 그 집단의 특징이 아니다.
 *  배수 = (이 목록에서의 등장 비율) ÷ (전체 목록에서의 등장 비율) 이라 "전체보다
 *  몇 배 자주 달렸나"를 뜻한다. 대신 개수도 함께 적어 배수만 크고 뜻이 없는 값을
 *  사람이 걸러낼 수 있게 한다(2편짜리 3.5배 같은 것 — 하한도 걸려 있다). */
const TagBars = ({ rows, total }: { rows: TagLift[]; total: number }) => (
  <ul className="report-bars">
    {rows.map(t => (
      <li key={t.tag}>
        <span className="report-bars__label">{t.tag}</span>
        <span className="report-bars__track">
          {/* 막대 길이는 정렬 기준과 같은 값(배수)으로 그린다. share 로 그렸더니
              전부 5% 미만이라 여덟 개가 똑같이 비어 보였다. */}
          <span className="report-bars__fill"
            style={{ width: `${Math.max(6, (t.lift / (rows[0]?.lift || 1)) * 100)}%` }} />
        </span>
        <span className="report-bars__value"
          title={`이 목록 ${total}편 중 ${t.count}편(${Math.round(t.share * 100)}%)에 달렸습니다. 전체 목록에서의 등장 비율보다 ${t.lift.toFixed(1)}배 높습니다.`}>
          {t.count}편 · 전체의 {t.lift.toFixed(1)}배
        </span>
      </li>
    ))}
  </ul>
);

// ─────────────────────────────────────────────────────────────────────────────
// 들어온 작품 / 빠진 작품 — 가로로 나란히 견준다
// ─────────────────────────────────────────────────────────────────────────────

export const FlowSection = ({ report }: { report: AnalysisReport }) => {
  const { entrants, leavers, totals, entrant_tags, leaver_tags, entrants_basis } = report;

  /** 판정 근거를 한 구절로. 확인 범위가 수집 전 기간이므로 그렇게 적을 수 있다.
   *
   *  **'500위 안'이라고 쓰지 않는다.** 수집 범위가 2025-07-20 이전에는 상위 300위였다.
   *  "처음 500위 안에 들었다"고 하면 그 시절 301~500위를 아예 관측하지 못했다는 사실이
   *  문장에서 사라진다. '랭킹 목록'이 정확한 말이다. */
  const basis = `수집을 시작한 ${dot(entrants_basis.first_collected)} 이후 이 기간에 처음으로 랭킹 목록에 든 작품입니다`
    + ` (기간 첫날에 없던 ${entrants_basis.checked}편을 확인해 예전에 든 적이 있는 ${entrants_basis.returning}편을 뺐습니다.`
    + ' 수집 범위는 2025년 7월까지 상위 300위, 이후 500위)';

  return (
    <Section
      title="500위 안에 새로 들어온 작품과 빠져나간 작품"
      meta={`들어온 ${totals.entrants}편 · 빠진 ${totals.leavers}편`}
      caveat={`${basis}. 빠진 작품의 제목·태그는 기간 첫날 기준이며, 목록에서 빠졌다는 것이 연재를 멈췄다는 뜻은 아닙니다`}
    >
      <div className="report-split">
        <div className="report-split__col">
          <h3 className="report-subtitle">새로 들어온 작품</h3>
          {entrants.length === 0 ? <p className="report-empty">없습니다</p> : (
            <ul className="report-flowlist">
              {entrants.slice(0, 15).map((n: ReportWork) => (
                <li key={n.id}>
                  <NovelLink id={n.id} title={n.title} author={n.author} />
                  {/* 순위·회차 표기를 빠진 작품과 같은 순서·같은 형식으로 맞춘다.
                      한쪽만 증감을 적으면 같은 값을 견주는 목록으로 읽히지 않는다. */}
                  <span className="report-flowlist__meta">
                    지금 {n.rank}위 · 최고 {n.best_rank}위
                    {' · '}{n.eps}화{n.added_eps != null && n.added_eps > 0 && ` (+${n.added_eps})`}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="report-split__col">
          <h3 className="report-subtitle">빠져나간 작품</h3>
          {leavers.length === 0 ? <p className="report-empty">없습니다</p> : (
            <ul className="report-flowlist">
              {leavers.slice(0, 15).map((n: ReportLeaver) => (
                <li key={n.id}>
                  <NovelLink id={n.id} title={n.title} author={n.author} />
                  <span className="report-flowlist__meta">
                    첫날 {n.rank_at_start}위 · 최고 {n.best_rank}위
                    {' · '}{n.eps}화{n.added_eps > 0 && ` (+${n.added_eps})`}
                    {' · '}{dot(n.last_seen).slice(5)}까지 관측
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {(entrant_tags.length > 0 || leaver_tags.length > 0) && (
        <div className="report-subblock report-split">
          <div className="report-split__col">
            <h3 className="report-subtitle">
              들어온 작품에 유난히 많은 태그
              <i className="report-subtitle__hint">전체 목록보다 몇 배 자주 달렸나</i>
            </h3>
            {entrant_tags.length
              ? <TagBars rows={entrant_tags} total={totals.entrants} />
              : <p className="report-empty">표본이 부족합니다</p>}
          </div>
          <div className="report-split__col">
            <h3 className="report-subtitle">
              빠진 작품에 유난히 많은 태그
              <i className="report-subtitle__hint">전체 목록보다 몇 배 자주 달렸나</i>
            </h3>
            {leaver_tags.length
              ? <TagBars rows={leaver_tags} total={totals.leavers} />
              : <p className="report-empty">표본이 부족합니다</p>}
          </div>
        </div>
      )}
    </Section>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// 순위판이 얼마나 갈렸나 — 하나의 수 + 구간별 보조
// ─────────────────────────────────────────────────────────────────────────────

export const ChurnSection = ({ report }: { report: AnalysisReport }) => {
  const c = report.churn;

  /** "평균 80계단"은 그 자체로 크기를 알 수 없다 — 목록이 500편이면 80계단은 작고
   *  50편이면 완전히 뒤집힌 것이다. 그래서 **순위를 무작위로 섞었을 때의 평균 이동**을
   *  기준선으로 두고 그 대비 비율을 앞세운다. 0%면 전원 제자리, 100%면 사실상 무작위,
   *  150%가 이론적 최대(완전 역순)다. 합성 데이터로 세 경우를 다 확인했다. */
  const vsRandom = (c.footrule != null && c.random_move)
    ? c.footrule / c.random_move : null;

  return (
    <Section
      title="같은 작품들의 순위가 얼마나 움직였나"
      meta={`${dot(report.start)} ~ ${dot(report.end)} · 양쪽에 다 있는 ${c.common}편`}
      caveat="'목록에서 빠짐'은 인기가 식었다는 뜻일 수도, 순위가 표시 범위 밖으로 한 칸 나갔다는 뜻일 수도 있습니다"
    >
      <div className="report-kpis report-kpis--lead">
        <span title="순위를 무작위로 다시 섞었을 때의 평균 이동을 100%로 본 값입니다. 0%는 전원 제자리, 100%는 사실상 무작위입니다.">
          <b>{vsRandom != null ? Math.round(vsRandom * 100) : '-'}</b>%
          <i>뒤섞인 정도 (100% = 무작위)</i>
        </span>
        <span>
          <b>{c.median_move != null ? c.median_move.toFixed(0) : '-'}</b>계단
          <i>절반은 이만큼 안에서 움직였다</i>
        </span>
        <span>
          <b>{c.footrule != null ? c.footrule.toFixed(0) : '-'}</b>계단
          <i>평균 이동{c.random_move != null && ` · 무작위였다면 ${c.random_move.toFixed(0)}계단`}</i>
        </span>
        <span>
          <b>{c.turnover != null ? Math.round(c.turnover * 100) : '-'}</b>%
          <i>목록 교체율</i>
        </span>
      </div>

      <p className="report-note">
        {c.p90_move != null && <>움직임이 큰 상위 10%는 <b>{c.p90_move.toFixed(0)}계단</b> 넘게 옮겨 갔습니다. </>}
        {c.kendall_tau != null && <>순서 유지도는 <b>{c.kendall_tau.toFixed(2)}</b>입니다 (1 = 순서 그대로, 0 = 무작위, −1 = 완전 역순).</>}
      </p>

      <h3 className="report-subtitle">
        지금 이 순위대에 있는 작품 중 기간 첫날에도 목록에 있던 비율
      </h3>
      <ul className="report-bars report-bars--wide">
        {c.bands.map(b => (
          <li key={b.label}>
            <span className="report-bars__label">{b.label}</span>
            <span className="report-bars__track">
              <span className="report-bars__fill" style={{ width: b.rate != null ? `${b.rate * 100}%` : '0%' }} />
            </span>
            <span className="report-bars__value">
              {b.rate != null ? `${b.total}편 중 ${b.stayed}편 (${pctOf(b.rate)})` : '표시된 작품 없음'}
            </span>
          </li>
        ))}
      </ul>
    </Section>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// 연재 페이스 — 순위표가 아니라 분포
// ─────────────────────────────────────────────────────────────────────────────

export const PaceSection = ({ report }: { report: AnalysisReport }) => {
  const p = report.pace;
  const data = useMemo(
    () => p.histogram.filter(h => h.count > 0).map(h => ({ label: h.label, 작품: h.count })),
    [p.histogram],
  );

  return (
    <Section
      title="이 기간에 회차가 많이 올라온 작품"
      meta={`연재 ${p.growing}편 · 회차 변동 없음 ${p.flat}편`}
      caveat="완결과 휴재를 구분할 수 있는 데이터가 없습니다 — '변동 없음'은 이 기간에 관측된 회차 수가 그대로였다는 뜻입니다. 회차가 많다고 좋은 작품이라는 뜻은 아니며, 분포의 오른쪽 끝을 어떻게 볼지는 보는 사람의 판단입니다"
    >
      {/* 분포만 두었을 때는 "그래서 어떤 작품이"에 답하지 못해 쓸 데가 없었다.
          표를 먼저 두고 분포를 그 뒤에 둔다 — 표가 답이고 분포는 그 답이 전체
          가운데 어디쯤인지 보여주는 배경이다. */}
      {p.top.length > 0 && (
        <div className="custom-table-wrapper report-table-scroll">
          <table className="custom-table table report-table">
            <thead>
              <tr>
                <th data-col="rank">지금 순위</th>
                <th data-col="title">제목</th>
                <th data-col="added">늘어난 회차</th>
                <th data-col="week">주당</th>
                <th data-col="eps">전체 회차</th>
              </tr>
            </thead>
            <tbody>
              {p.top.map(n => (
                <tr key={n.id}>
                  <td data-col="rank">{n.rank}</td>
                  <td data-col="title"><NovelLink id={n.id} title={n.title} author={n.author} /></td>
                  <td data-col="added">+{n.added_eps}</td>
                  <td data-col="week">{n.per_week != null ? `${n.per_week.toFixed(1)}화` : '-'}</td>
                  <td data-col="eps">{n.eps}화</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h3 className="report-subtitle">
        전체 분포에서 어디쯤인가
        <i className="report-subtitle__hint">주당 회차 · 연재 {p.growing}편</i>
      </h3>
      <div className="report-kpis">
        <span><b>{p.median != null ? p.median.toFixed(1) : '-'}</b>화<i>주당 중앙값</i></span>
        <span><b>{p.p90 != null ? p.p90.toFixed(1) : '-'}</b>화<i>상위 10% 경계</i></span>
        <span><b>{p.max != null ? p.max.toFixed(1) : '-'}</b>화<i>관측 최대</i></span>
        <span><b>{p.flat}</b>편<i>회차 변동 없음</i></span>
      </div>

      <div className="report-chart report-chart--short">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 8, right: 12, bottom: 4, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--np-border)" vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: 11, fill: 'var(--np-text-secondary)' }}
              tickLine={false} axisLine={{ stroke: 'var(--np-border)' }} />
            <YAxis width={38} tick={{ fontSize: 11, fill: 'var(--np-text-secondary)' }}
              tickLine={false} axisLine={false} allowDecimals={false} />
            {/* `cursor` 를 지정하지 않으면 recharts 가 기본 회색(#ccc) 사각형을
                막대 뒤에 깔아, 다크 테마에서 **하얀 캔들**처럼 보인다. 눌렀을 때
                밝아지는 `activeBar` 도 같은 이유로 직접 지정한다. */}
            <RechartsTooltip
              cursor={{ fill: 'var(--np-surface-alt)', fillOpacity: 0.7 }}
              contentStyle={{
                background: 'var(--np-surface-raised)', border: '1px solid var(--np-border-strong)',
                borderRadius: 'var(--np-radius-sm)', fontSize: '0.82rem',
              }}
              labelStyle={{ color: 'var(--np-text-heading)' }}
              formatter={(v: number) => [`${v}편`, '작품']}
              labelFormatter={(l: string) => `주당 ${l}화`}
            />
            {p.median != null && (
              <ReferenceLine x={data.find(d => {
                const [lo, hi] = d.label.split('~');
                const l = Number(lo);
                const h = hi ? Number(hi) : Infinity;
                return p.median! >= l && p.median! < h;
              })?.label} stroke="var(--np-accent)" strokeDasharray="4 3" />
            )}
            <Bar dataKey="작품" fill="var(--np-accent)" radius={[3, 3, 0, 0]} isAnimationActive={false}
              activeBar={{ fill: 'var(--np-accent-strong, var(--np-accent))' }} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <p className="tag-trend-chart__note">점선이 중앙값입니다</p>
    </Section>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// 기간 추천비
// ─────────────────────────────────────────────────────────────────────────────

export const RatioSection = ({ report }: { report: AnalysisReport }) => {
  const r = report.period_ratio;

  /** 한 줄로 압축한다. 예전에는 카드마다 "100명 중 몇 명이 추천을 눌렀습니다"를
   *  덧붙였는데, 그건 옆의 백분율을 말로 옮긴 것뿐이라 자리만 차지하고 목록을
   *  짧게 만들었다. 같은 높이에 두 배 많은 작품을 넣는 쪽이 낫다. */
  const row = (n: ReportWork) => (
    <li key={n.id}>
      <b className="report-ratiolist__value">{ratioPct(n.period_ratio)}</b>
      <NovelLink id={n.id} title={n.title} author={n.author} />
      <span className="report-ratiolist__meta">{n.rank}위 · {n.eps}화</span>
    </li>
  );

  return (
    <Section
      title="읽은 사람 대비 추천이 많은 작품"
      caveat={`작품 전체 누적이 아니라 이 기간에 늘어난 조회수와 추천수의 비율입니다 — 오래전 회차의 추천은 들어가지 않습니다. 기간 조회 증가가 ${(r.floor_delta_view / 1000).toFixed(0)}천 이상인 ${r.counted}편만 넣었습니다(증가분이 작으면 몇 건에 비율이 출렁입니다)`}
    >
      {/* 순위로 가르는 이유는 중복 때문이다 — 추천비 상위가 전부 100위 밖이면 같은
          카드가 두 번 나왔다(실측 12건 전부 겹쳤다). 위아래로 쌓으면 아래쪽이 '못한
          쪽'처럼 읽히므로 **좌우로 나란히** 둔다. 둘은 같은 지표이고 순위만 다르다. */}
      <div className="report-split">
        <div className="report-split__col">
          <h3 className="report-subtitle">
            지금 100위 안
            <i className="report-subtitle__hint">상위권에서 반응이 좋은 작품</i>
          </h3>
          {r.top.length
            ? <ul className="report-ratiolist">{r.top.map(row)}</ul>
            : <p className="report-empty">해당 작품이 없습니다</p>}
        </div>
        <div className="report-split__col">
          <h3 className="report-subtitle">
            지금 100위 밖
            <i className="report-subtitle__hint">순위와 별개로 반응이 좋은 작품</i>
          </h3>
          {r.hidden.length
            ? <ul className="report-ratiolist">{r.hidden.map(row)}</ul>
            : <p className="report-empty">해당 작품이 없습니다</p>}
        </div>
      </div>
    </Section>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// 잔류율 — 연재 중인 작품만
// ─────────────────────────────────────────────────────────────────────────────

export const RetentionSection = ({ report }: { report: AnalysisReport }) => (
  <Section
    title="회차를 넘겨도 독자가 남아 있는 작품"
    meta={`${report.retention.rows.length}편`}
    caveat="초반 잔류는 30번째 유효 회차의 조회수를 1화 조회수로 나눈 값, 최신 잔류는 최신화를 그 30회차 전으로 나눈 값입니다(30화 미만은 산출하지 않습니다). 두 값을 그냥 더하면 분포가 넓은 쪽이 순서를 혼자 정하므로, 각각을 후보군 안 백분위로 바꿔 평균한 순서입니다. 이 기간에 회차가 늘어난 작품만 넣었습니다 — 연재가 멈추면 최신화 조회수가 계속 차서 최신 잔류가 올라가기 때문입니다"
  >
    {report.retention.rows.length === 0 ? <p className="report-empty">해당 작품이 없습니다</p> : (
      <div className="custom-table-wrapper report-table-scroll">
        <table className="custom-table table report-table">
          <thead>
            <tr>
              <th data-col="rank">순위</th>
              <th data-col="title">제목</th>
              <th data-col="added">늘어난 회차</th>
              <th data-col="early" title="30번째 유효 회차의 조회수 ÷ 1화 조회수">초반 잔류</th>
              <th data-col="recent" title="최신화 조회수 ÷ 그보다 30회차 전 회차의 조회수">최신 잔류</th>
            </tr>
          </thead>
          <tbody>
            {report.retention.rows.map(n => (
              <tr key={n.id}>
                <td data-col="rank">{n.rank}</td>
                <td data-col="title"><NovelLink id={n.id} title={n.title} author={n.author} /></td>
                <td data-col="added">+{n.added_eps}</td>
                <td data-col="early">{pctOf(n.early)}</td>
                <td data-col="recent">{pctOf(n.recent)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )}
  </Section>
);

// ─────────────────────────────────────────────────────────────────────────────
// 같은 순위대와 견주기
// ─────────────────────────────────────────────────────────────────────────────

const DIAGNOSE_METRICS: { key: keyof DiagnoseWork; label: string; fmt: (v: number) => string }[] = [
  { key: 'score', label: '점수', fmt: v => v.toLocaleString() },
  { key: 'delta_view', label: '기간 조회 증가', fmt: v => v.toLocaleString() },
  { key: 'period_ratio', label: '기간 추천비', fmt: v => `${(v * 100).toFixed(1)}%` },
  { key: 'per_week', label: '주당 회차', fmt: v => `${v.toFixed(1)}화` },
  { key: 'eps', label: '회차', fmt: v => `${v}화` },
  { key: 'early', label: '초반 잔류', fmt: v => `${(v * 100).toFixed(1)}%` },
  { key: 'recent', label: '최신 잔류', fmt: v => `${(v * 100).toFixed(1)}%` },
];

export const DiagnoseSection = ({ report }: { report: AnalysisReport }) => {
  const [q, setQ] = useState('');
  const [pickedId, setPickedId] = useState<string | null>(null);
  const works = report.diagnose.works;

  const hits = useMemo(() => {
    const t = q.trim();
    if (!t) return [];
    return works.filter(w => (w.title ?? '').includes(t) || (w.author ?? '').includes(t)).slice(0, 8);
  }, [q, works]);

  const target = useMemo(() => works.find(w => w.id === pickedId) ?? null, [works, pickedId]);
  const peers = useMemo(
    () => (target?.band != null ? works.filter(w => w.band === target.band) : []),
    [works, target],
  );
  const rows = useMemo(() => {
    if (!target || peers.length < 5) return [];
    return DIAGNOSE_METRICS.flatMap(m => {
      const mine = target[m.key];
      if (typeof mine !== 'number') return [];
      const vals = peers.map(p => p[m.key]).filter((v): v is number => typeof v === 'number');
      if (vals.length < 5) return [];
      return [{
        label: m.label, value: m.fmt(mine),
        pct: vals.filter(v => v < mine).length / vals.length,
      }];
    });
  }, [target, peers]);

  const band = target?.band != null ? report.diagnose.quartiles[target.band] : null;

  return (
    <Section
      title="작품 하나를 같은 순위대와 견주기"
      meta={band ? `${band.label} · 비교 대상 ${peers.length}편` : '작품을 찾아 선택하세요'}
      caveat="순위대는 이 기간 목록의 4분위이고, 작품의 순위는 기간 평균 순위입니다 — 마지막 날 순위 하나로 정하면 그날 우연히 튄 작품이 엉뚱한 구간에 들어갑니다"
    >
      <div className="report-quartiles">
        {report.diagnose.quartiles.map((qt, i) => (
          <span key={qt.label} className={target?.band === i ? 'is-active' : undefined}>
            {qt.label}
            <i>평균 {Math.round(qt.min)}~{qt.max ? Math.round(qt.max) : '∞'}위 · {qt.count}편</i>
          </span>
        ))}
      </div>

      <div className="report-search">
        <input type="search" value={q} onChange={e => setQ(e.target.value)}
          placeholder="제목 또는 작가" aria-label="작품 검색" />
        {hits.length > 0 && (
          <ul className="report-search__hits">
            {hits.map(w => (
              <li key={w.id}>
                <button type="button" onClick={() => { setPickedId(w.id); setQ(''); }}>
                  <span>{w.title}</span><span>{w.author} · 평균 {w.avg_rank}위</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {target && rows.length > 0 && (
        <div className="report-diagnose">
          <div className="report-diagnose__head">
            <NovelLink id={target.id} title={target.title} author={target.author} />
            <span className="report-diagnose__rank">평균 {target.avg_rank}위 · 최고 {target.best_rank}위</span>
            <button type="button" className="report-clear" onClick={() => setPickedId(null)}>선택 해제</button>
          </div>
          <ul className="report-bars report-bars--wide">
            {rows.map(r => (
              <li key={r.label}>
                <span className="report-bars__label">{r.label}</span>
                <span className="report-bars__track">
                  <span className="report-bars__fill" style={{ width: `${r.pct * 100}%` }} />
                </span>
                <span className="report-bars__value">{r.value} · 구간 상위 {Math.round((1 - r.pct) * 100)}%</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {target && rows.length === 0 && (
        <p className="report-empty">같은 구간에 비교할 작품이 부족합니다</p>
      )}
    </Section>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// 태그 조합 — 쌍 / 3개 / 신규 진입작 / 동반 태그
// ─────────────────────────────────────────────────────────────────────────────

const ComboList = ({ rows, empty }: { rows: TagCombo[]; empty: string }) => (
  rows.length === 0 ? <p className="report-empty">{empty}</p> : (
    <ul className="report-pairs">
      {rows.map(c => (
        <li key={c.tags.join('|')}>
          <span className="report-pairs__tags">
            {c.tags.map((t, i) => (
              <span key={t}>{i > 0 && <i>＋</i>}{t}</span>
            ))}
          </span>
          <span className="report-pairs__value">{c.count}편 · 평소의 {c.lift.toFixed(1)}배</span>
        </li>
      ))}
    </ul>
  )
);

export const TagSection = ({ report }: { report: AnalysisReport }) => {
  const t = report.tags;
  return (
    <Section
      title="함께 달리는 태그"
      meta={`쌍 ${t.pairs.length} · 3개 조합 ${t.triples.length}`}
      caveat="흔한 태그끼리는 그냥 자주 만나므로, 횟수가 아니라 각자 흔한 정도 대비 몇 배로 함께 나오는지로 줄 세웠습니다"
    >
      <h3 className="report-subtitle">두 태그 조합</h3>
      <ComboList rows={t.pairs} empty="함께 달린 횟수가 충분한 조합이 없습니다" />

      <h3 className="report-subtitle">세 태그 조합</h3>
      <ComboList rows={t.triples} empty="함께 달린 횟수가 충분한 조합이 없습니다" />

      <h3 className="report-subtitle">이 기간에 들어온 작품에서만</h3>
      <ComboList rows={t.entrant_pairs} empty="표본이 부족합니다" />

      <h3 className="report-subtitle">많이 쓰인 태그에 무엇이 함께 달리나</h3>
      {t.companions.length === 0 ? <p className="report-empty">표본이 부족합니다</p> : (
        <ul className="report-companions">
          {t.companions.map(c => (
            <li key={c.tag}>
              <span className="report-companions__head">{c.tag}<i>{c.count}편</i></span>
              <span className="report-companions__with">
                {c.with.map(w => (
                  <span key={w.tag}>{w.tag}<i>{w.count}</i></span>
                ))}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
};
