import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { isValid, parseISO } from 'date-fns';
import { CartesianGrid, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis } from 'recharts';
import { Search as SearchIcon } from 'react-bootstrap-icons';
import { getContestAvailableDates, getContestDailyTagRankingsByDate, getContestTagRankingsByDate } from '../services/api';
import DailyTagBoard from '../components/tag/DailyTagBoard';
import { CONTEST_RULES, type DailyTag } from '../utils/tagZones';
import ContestHeader from '../components/contest/ContestHeader';
import RankTable, { type RankColumn } from '../components/ranking/RankTable';
import Footnotes, { FootnoteRef } from '../components/ui/Footnotes';
import { SkeletonRows, Stale } from '../components/ui/Loading';
import { buildContestTagRows, type ContestTag, type ContestTagRow, type ContestTagSort, type ContestTagSortKey } from '../utils/contestTags';
import { formatInt } from '../utils/format';
import { LATEST_CONTEST_YEAR, contestConfig } from '../utils/contest';

/**
 * 공모전 태그 랭킹(2026-09-30 개편). 연도마다 대표 순위를 따른다.
 * - 2026~(일간 순위가 대표): 데일리 태그 랭킹과 같은 2-track 판(`DailyTagBoard`) — 점수가 일간 순위 기준(DECISIONS 2026-10-02).
 * - 2025(누적 순위가 대표): 구 3-track(선형·역순위·로그)을 유지한다(DECISIONS 2026-04). 아래 설명은 이 판의 것.
 * 열 7개를 '합계 / 평균' 전환으로 6열에 담고, 산식은 머리글 옆 주석 번호 → 표 아래 주석.
 * 포지셔닝 맵은 한 색의 진하기(진할수록 상위)로 칠하고, 행 호버 → 점 강조를 상태로 한다.
 */

type Mode = 'sum' | 'avg';
const RANGES = [20, 50, 100];
const NOTES = [
  { id: 'lin', content: <>선형 점수 = 작품마다 (전체 작품 수 − 순위 + 1)을 더한 값. 모든 순위를 같은 간격으로 셉니다.</> },
  { id: 'inv', content: <>역순위 점수 = 작품마다 1 ÷ 순위를 더한 값. 1위에 가까울수록 훨씬 크게 셉니다.</> },
  { id: 'log', content: <>로그 점수 = 작품마다 1 ÷ ln(순위 + 1)을 더한 값. 상위권을 완만하게 더 셉니다.</> },
  { id: 'avg', content: <>평균 = 합계 ÷ 등장 횟수. 태그가 달린 작품 한 편이 평균적으로 얼마나 위에 있는지입니다.</> },
];

/** 로그 눈금용 1·2·5 × 10^k 눈금(데이터 범위 안). */
const logTicks = (min: number, max: number): number[] => {
  const out: number[] = [];
  for (let p = Math.floor(Math.log10(Math.max(1, min))); p <= Math.ceil(Math.log10(Math.max(1, max))); p++) {
    for (const m of [1, 2, 5]) { const v = m * 10 ** p; if (v >= min && v <= max) out.push(v); }
  }
  return out;
};

const fmt = (v: number, digits: number) => (digits === 0 ? formatInt(Math.round(v)) : v.toFixed(digits));

export default function ContestTagRankingsPage() {
  const { year = LATEST_CONTEST_YEAR } = useParams<{ year: string }>();
  // 연도가 바뀌면 판을 새로 만든다(두 판의 상태가 섞이지 않게).
  return contestConfig(year).headline === 'daily' ? <DailyContestTags key={year} /> : <CumulativeContestTags key={year} />;
}

/** 2026~: 일간 순위 기준 태그 점수. 일간 순위가 없는 날(수집 첫날)은 빈 상태. */
function DailyContestTags() {
  const { year = LATEST_CONTEST_YEAR, date: dateParam } = useParams<{ year: string; date?: string }>();
  const cfg = contestConfig(year);
  const navigate = useNavigate();
  const [dates, setDates] = useState<Set<string>>(new Set());
  const [tags, setTags] = useState<DailyTag[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getContestAvailableDates(parseInt(year, 10))
      .then(r => setDates(new Set<string>(r.data.available_dates || [])))
      .catch(() => { setError('조회 가능한 날짜를 불러오지 못했습니다.'); setLoading(false); });
  }, [year]);

  useEffect(() => {
    if (dates.size === 0) return;
    if (!dateParam || !isValid(parseISO(dateParam)) || !dates.has(dateParam)) {
      navigate(`/contests/${year}/tags/rankings/${[...dates].sort().at(-1)}`, { replace: true });
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    getContestDailyTagRankingsByDate(parseInt(year, 10), dateParam)
      .then(r => { if (!cancelled) setTags(Array.isArray(r.data) ? r.data : []); })
      .catch(e => {
        if (cancelled) return;
        setTags([]);
        // 404 = 그날은 일간 순위가 없다(수집 첫날) — 오류가 아니라 빈 상태다.
        if (e?.response?.status !== 404) setError('태그 랭킹을 불러오지 못했습니다.');
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [year, dateParam, dates, navigate]);

  return (
    <div className="page-shell contest-tags-page">
      <ContestHeader year={year} date={dateParam ?? null} availableDates={dates} view="tags"
        onDateChange={d => navigate(`/contests/${year}/tags/rankings/${d}`)}
        onYearChange={y => navigate(`/contests/${y}/tags/rankings`)}
        meta={`${cfg.schedule} · 일간 순위 작품에 달린 태그 · 인기 점수(조회 증가 점유율) 순`} />
      <DailyTagBoard tags={tags} loading={loading} error={error} resetKey={dateParam}
        scoreLabel="조회 증가" rules={CONTEST_RULES}
        ariaLabel="공모전 태그 순위"
        emptyText="이 날짜는 일간 순위가 없어 태그 순위도 없습니다. 일간 순위는 직전 수집일과 비교할 수 있는 다음 날부터 생깁니다."
        // 공모전 태그 시계열 API 가 아직 없어 순위선 없이 그 태그의 참가작 목록으로 가는 길만 둔다(DECISIONS 2026-10-03 의 미룸).
        renderExpanded={t => (
          <div className="row-expand row-expand--tag">
            <span>작품 <b>{formatInt(t.count)}편</b></span>
            <Link to={`/contests/${year}/${dateParam}?tag=${encodeURIComponent(t.tag)}`} className="row-expand__go" onClick={e => e.stopPropagation()}>'{t.tag}' 작품 보기</Link>
          </div>
        )} />
    </div>
  );
}

/** 2025: 누적 순위 기준 구 3-track. */
function CumulativeContestTags() {
  const { year = LATEST_CONTEST_YEAR, date: dateParam } = useParams<{ year: string; date?: string }>();
  const cfg = contestConfig(year);
  const navigate = useNavigate();
  const [dates, setDates] = useState<Set<string>>(new Set());
  const [tags, setTags] = useState<ContestTag[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>('sum');
  const [sort, setSort] = useState<ContestTagSort>({ key: 'score_linear', direction: 'descending' });
  const [range, setRange] = useState(20);
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [hover, setHover] = useState<string | null>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    getContestAvailableDates(parseInt(year, 10))
      .then(r => setDates(new Set<string>(r.data.available_dates || [])))
      .catch(() => { setError('조회 가능한 날짜를 불러오지 못했습니다.'); setLoading(false); });
  }, [year]);

  useEffect(() => {
    if (dates.size === 0) return;
    if (!dateParam || !isValid(parseISO(dateParam)) || !dates.has(dateParam)) {
      navigate(`/contests/${year}/tags/rankings/${[...dates].sort().at(-1)}`, { replace: true });
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    getContestTagRankingsByDate(parseInt(year, 10), dateParam)
      .then(r => { if (!cancelled) setTags(r.data || []); })
      .catch(() => { if (!cancelled) { setTags([]); setError('태그 랭킹을 불러오지 못했습니다.'); } })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [year, dateParam, dates, navigate]);

  const rows = useMemo(() => buildContestTagRows(tags, sort, search), [tags, sort, search]);
  // 지도는 늘 선형 합계 기준 상위 N개다(표 정렬·검색과 무관하게 같은 그림).
  const mapRows = useMemo(() => buildContestTagRows(tags, { key: 'score_linear', direction: 'descending' }, '').slice(0, range), [tags, range]);

  const countRange = useMemo(() => {
    const cs = mapRows.map(r => r.count).filter(c => c > 0);
    return cs.length ? [Math.min(...cs) * 0.9, Math.max(...cs) * 1.1] : [1, 10];
  }, [mapRows]);

  const onSort = (key: string) => setSort(s => ({
    key: key as ContestTagSortKey,
    direction: s.key === key && s.direction === 'descending' ? 'ascending' : 'descending',
  }));
  const pickMode = (m: Mode) => {
    setMode(m);
    // 보고 있던 점수 종류는 그대로 두고 합계 ↔ 평균만 바꾼다.
    setSort(s => {
      const base = s.key.replace(/^(score|avg)_/, '');
      if (s.key === 'count') return s;
      return { ...s, key: `${m === 'sum' ? 'score' : 'avg'}_${base}` as ContestTagSortKey };
    });
  };
  const submitSearch = (e: FormEvent) => {
    e.preventDefault();
    setSearch(searchInput.trim());
    const el = toolbarRef.current;
    if (el && el.getBoundingClientRect().top < 0) window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 72 });
  };

  const k = (name: 'linear' | 'inverse' | 'log') => `${mode === 'sum' ? 'score' : 'avg'}_${name}` as const;
  const strongIf = (key: ContestTagSortKey, v: ReactNode) => (sort.key === key ? <b className="rank-strong">{v}</b> : v);
  const digits = { linear: 0, inverse: mode === 'sum' ? 2 : 4, log: mode === 'sum' ? 1 : 3 };

  const columns: RankColumn<ContestTagRow>[] = [
    { key: 'rank', header: '순위', width: '56px', render: r => <span className={`rank-num${r.Rank <= 3 ? ' is-top' : ''}`}>{r.Rank}</span> },
    { key: 'tag', header: '태그', width: 'minmax(0,1fr)', render: r => <span className="rank-title">{r.tag}</span> },
    { key: 'lin', header: mode === 'sum' ? '선형 점수' : '평균 선형', aside: <FootnoteRef id="lin" n={1} />, width: '120px', sortKey: k('linear'),
      render: r => strongIf(k('linear'), fmt(r[k('linear')], digits.linear)) },
    { key: 'inv', header: mode === 'sum' ? '역순위 점수' : '평균 역순위', aside: <FootnoteRef id="inv" n={2} />, width: '120px', sortKey: k('inverse'),
      render: r => strongIf(k('inverse'), fmt(r[k('inverse')], digits.inverse)) },
    { key: 'log', header: mode === 'sum' ? '로그 점수' : '평균 로그', aside: <FootnoteRef id="log" n={3} />, width: '120px', sortKey: k('log'),
      render: r => strongIf(k('log'), fmt(r[k('log')], digits.log)) },
    { key: 'count', header: '등장 횟수', width: '96px', sortKey: 'count', render: r => strongIf('count', formatInt(r.count)) },
  ];

  const mobileRow = (r: ContestTagRow) => (
    <div className="rank-mrow rank-mrow--tag">
      <div className="rank-mrow__rank"><span className={`rank-num${r.Rank <= 3 ? ' is-top' : ''}`}>{r.Rank}</span></div>
      <div className="rank-mrow__main">
        <span className="rank-title">{r.tag}</span>
        <p>선형 <b>{fmt(r[k('linear')], digits.linear)}</b> · 역순위 <b>{fmt(r[k('inverse')], digits.inverse)}</b> · 로그 <b>{fmt(r[k('log')], digits.log)}</b> · {formatInt(r.count)}회</p>
      </div>
    </div>
  );

  return (
    <div className="page-shell contest-tags-page">
      <ContestHeader year={year} date={dateParam ?? null} availableDates={dates} view="tags"
        onDateChange={d => navigate(`/contests/${year}/tags/rankings/${d}`)}
        onYearChange={y => navigate(`/contests/${y}/tags/rankings`)}
        meta={tags.length ? `${cfg.schedule} · 태그 ${formatInt(tags.length)}개` : cfg.schedule} />

      <div className="rank-toolbar" ref={toolbarRef}>
        <h2 className="rank-toolbar__title">
          태그 순위
          <span className="rank-toolbar__count">{search ? <>검색 결과 <b>{formatInt(rows.length)}</b>개 / {formatInt(tags.length)}개</> : <>{formatInt(tags.length)}개</>}</span>
        </h2>
        <div className="text-toggle" role="radiogroup" aria-label="점수 보기">
          {(['sum', 'avg'] as Mode[]).map(m => (
            <span key={m} className="text-toggle__item">
              <button type="button" role="radio" aria-checked={mode === m} className={mode === m ? 'is-on' : undefined} onClick={() => pickMode(m)}>
                {m === 'sum' ? '합계' : '평균'}
              </button>
              {m === 'avg' ? <FootnoteRef id="avg" n={4} /> : null}
            </span>
          ))}
        </div>
        <form className="toolbar-searchform" role="search" onSubmit={submitSearch}>
          <input className="toolbar-search" type="search" placeholder="태그 검색" aria-label="태그 검색"
            value={searchInput} onChange={e => { setSearchInput(e.target.value); if (e.target.value === '' && search) setSearch(''); }} />
          <button type="submit" className="toolbar-searchbtn" aria-label="검색"><SearchIcon size={15} aria-hidden="true" /></button>
        </form>
      </div>

      {error ? <p className="empty-line">{error}</p>
        : loading && tags.length === 0 ? <SkeletonRows />
        : (
          <Stale loading={loading}><RankTable ariaLabel="공모전 태그 순위" rows={rows} rowKey={r => r.tag} columns={columns} rowHeight={48} collapseAfter={50}
            sort={sort} onSort={onSort} renderMobileRow={mobileRow} onRowHover={r => setHover(r?.tag ?? null)}
            emptyText={tags.length === 0 ? '이 날짜의 태그 랭킹이 없습니다.' : '검색된 태그가 없습니다.'} /></Stale>
        )}

      {!error && tags.length > 0 ? (
        <Stale loading={loading}>
          <Footnotes notes={NOTES} />
          <section className="contest-map">
            <div className="contest-map__head">
              <h2>태그 포지셔닝 맵</h2>
              <div className="text-toggle" role="radiogroup" aria-label="지도에 보일 태그 수">
                {RANGES.map(n => (
                  <button key={n} type="button" role="radio" aria-checked={range === n} className={range === n ? 'is-on' : undefined} onClick={() => setRange(n)}>상위 {n}</button>
                ))}
              </div>
            </div>
            <p className="contest-map__axis">가로 등장 횟수(로그 눈금) · 세로 평균 선형 점수 · 선형 점수 순위가 높을수록 진하게</p>
            <div className="contest-map__chart">
              <ResponsiveContainer width="100%" height={360}>
                <ScatterChart margin={{ top: 12, right: 16, bottom: 8, left: 0 }}>
                  <CartesianGrid stroke="var(--np-border)" />
                  <XAxis type="number" dataKey="count" name="등장 횟수" tick={{ fontSize: 12, fill: 'var(--np-text-secondary)' }} axisLine={{ stroke: 'var(--np-border)' }} tickLine={false}
                    scale="log" domain={countRange} ticks={logTicks(countRange[0], countRange[1])} tickFormatter={v => formatInt(v)} />
                  <YAxis type="number" dataKey="avg_linear" name="평균 선형 점수" tick={{ fontSize: 12, fill: 'var(--np-text-secondary)' }} axisLine={{ stroke: 'var(--np-border)' }} tickLine={false}
                    domain={['auto', 'auto']} tickFormatter={v => formatInt(Math.round(v))} width={56} />
                  <Tooltip cursor={false} isAnimationActive={false} content={({ active, payload }) => {
                    const d = active && payload?.[0]?.payload as ContestTagRow | undefined;
                    if (!d) return null;
                    return (
                      <div className="chart-tip">
                        <b>{d.Rank}위 {d.tag}</b>
                        <span>등장 {formatInt(d.count)}회 · 평균 선형 {formatInt(Math.round(d.avg_linear))}</span>
                      </div>
                    );
                  }} />
                  <Scatter data={mapRows} isAnimationActive={false}
                    shape={(p: unknown) => {
                      const { cx, cy, payload } = p as { cx: number; cy: number; payload: ContestTagRow };
                      if (!Number.isFinite(cx) || !Number.isFinite(cy)) return <g />;
                      const on = hover === payload.tag;
                      const alpha = 1 - ((payload.Rank - 1) / Math.max(1, range - 1)) * 0.72;
                      return (
                        <g>
                          <circle cx={cx} cy={cy} r={on ? 8 : 6} fill="var(--np-accent)" fillOpacity={alpha}
                            stroke={on ? 'var(--np-text-heading)' : 'var(--np-canvas)'} strokeWidth={on ? 2 : 1} />
                          {on ? <text x={cx} y={cy - 12} textAnchor="middle" className="contest-map__label">{payload.tag}</text> : null}
                        </g>
                      );
                    }} />
                </ScatterChart>
              </ResponsiveContainer>
            </div>
          </section>
        </Stale>
      ) : null}
    </div>
  );
}
