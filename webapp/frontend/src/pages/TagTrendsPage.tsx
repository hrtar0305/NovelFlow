import { useState, useEffect, useMemo, useCallback } from 'react';
import { Spinner, Alert } from 'react-bootstrap';
import { format, parseISO, subDays } from 'date-fns';
import { getAvailableDates, getTagSeries } from '../services/api';
import TagRankChart from '../components/tag/TagRankChart';
import { Link } from 'react-router-dom';
import PageHero from '../components/ui/PageHero';
import PanelCard from '../components/ui/PanelCard';
import DateRangePicker from '../components/novel/DateRangePicker';

/**
 * 태그 트렌드 — 정한 기간 동안 무엇이 바뀌었나.
 *
 * 이전 판은 백엔드의 4분류 API(trend_leader / broad_popular / efficient_niche /
 * declining)를 그대로 그렸는데 두 가지가 문제였다.
 *
 * 1) 보여주는 수치가 '기울기 +0.051', '로컬 리프트', '평균 총합 점수'였다.
 *    독자·작가가 "이게 좋은 건가"에 답할 수 없는 값이고, 태그 랭킹이 쓰는 말
 *    (작품 수 / 집중도 / 인기 점수)과도 달랐다.
 * 2) 4분류가 태그 랭킹의 4분면과 하는 일이 겹쳤다. 태그 랭킹이 '오늘의 지형'을
 *    맡으므로 여기는 '기간 동안의 변화'만 맡는다.
 *
 * 그래서 기간 안의 **모든 수집일**을 한 번에 받아(`/api/trends/tags/series`)
 * 태그별 시계열을 만들고, 시작과 끝을 비교해 뜬 태그·식은 태그·새로 들어온 태그·
 * 사라진 태그로 나눈다. 태그를 고르면 그 시계열을 차트로 보여준다.
 */

/** 기본 기간. 짧게 잡아야 '요즘'이 읽힌다. */
const DEFAULT_DAYS = 7;

/** 꼬리 태그 배제 하한. 이걸 두지 않으면 순위 변동 상위가 전부 1~2작품짜리로 찬다
 *  (실측: 하한 없을 때 최대 +93계단이 '1작품 → 7작품'짜리였다).
 *  태그 랭킹의 집중도 산출 하한과 같은 값이다. */
const MIN_WORKS = 5;

type SeriesResponse = {
  dates: string[];
  tags: Record<string, {
    rank: (number | null)[];
    count: (number | null)[];
    score: (number | null)[];
    lift: (number | null)[];
  }>;
};

type Edge = { tag: string; rank: number; count: number };

type Point = { date: string; rank: number; count: number; score: number; lift: number | null };
type TagTrend = {
  tag: string;
  series: Point[];
  first: Point;
  last: Point;
  scoreChange: number;   // 인기 점수 변화율 (0.42 = +42%)
  rankChange: number;    // + 면 순위가 올랐다
  bestRank: number;      // 기간 중 가장 높았던 순위
  worstRank: number;
  spike: number;         // 시작·끝 중 나은 쪽보다 기간 최고가 몇 계단 위였나
  swing: number;         // 최고~최저 폭
};

/** 태그판 전체가 얼마나 뒤집혔는지. 소설 쪽 리포트와 같은 지표를 쓴다. */
type Churn = {
  footrule: number | null;   // 양쪽에 다 있는 태그의 평균 |순위 변동|
  tau: number | null;        // 1 = 순서 그대로, 0 = 무작위
  common: number;
  startTags: number;
  endTags: number;
};

/** 태그판 전체가 얼마나 갈렸나. 양쪽에 다 있는 태그의 평균 순위 이동과 Kendall tau.
 *
 *  평균 이동은 "전원이 제자리면 0"이라 화면에서 바로 읽히고, tau 는 −1~1로 묶여 있어
 *  기간 길이가 달라도 비교된다. 소설 쪽 리포트와 같은 지표를 써서 두 화면이 같은 말을
 *  하게 한다. */
const computeChurn = (tags: SeriesResponse['tags'], lastIdx: number): Churn | null => {
  const a = new Map<string, number>();
  const b = new Map<string, number>();
  for (const [tag, s] of Object.entries(tags)) {
    if (s.rank[0] != null) a.set(tag, s.rank[0]);
    if (s.rank[lastIdx] != null) b.set(tag, s.rank[lastIdx]);
  }
  const common = [...b.keys()].filter(t => a.has(t));
  if (common.length < 2) return null;

  const footrule = common.reduce((acc, t) => acc + Math.abs(a.get(t)! - b.get(t)!), 0) / common.length;
  let con = 0;
  let dis = 0;
  for (let i = 0; i < common.length; i += 1) {
    for (let j = i + 1; j < common.length; j += 1) {
      const s2 = (a.get(common[i])! - a.get(common[j])!) * (b.get(common[i])! - b.get(common[j])!);
      if (s2 > 0) con += 1;
      else if (s2 < 0) dis += 1;
    }
  }
  return {
    footrule, tau: con + dis ? (con - dis) / (con + dis) : null,
    common: common.length, startTags: a.size, endTags: b.size,
  };
};

const formatLift = (v?: number | null) => (v != null ? `${v.toFixed(1)}×` : '-');
const formatPct = (v: number) => `${v >= 0 ? '+' : ''}${Math.round(v * 100)}%`;

const SelectedTagPanel = ({ trend, onClose }: { trend: TagTrend; onClose: () => void }) => (
  <section className="selected-tag-panel">
    <div className="selected-tag-panel__header">
      <div>
        <div className="selected-tag-panel__eyebrow">선택한 태그</div>
        <h2 className="selected-tag-panel__title">{trend.tag}</h2>
      </div>
      <button type="button" className="selected-tag-panel__close" onClick={onClose} aria-label="선택 해제">×</button>
    </div>

    <div className="selected-tag-panel__metrics">
      <span>순위<strong>{trend.first.rank}위<i className="mv-arrow" aria-hidden="true" />{trend.last.rank}위</strong></span>
      <span>등장<strong>{trend.first.count}작품<i className="mv-arrow" aria-hidden="true" />{trend.last.count}작품</strong></span>
      <span>인기 점수<strong>{trend.first.score.toFixed(1)}<i className="mv-arrow" aria-hidden="true" />{trend.last.score.toFixed(1)} ({formatPct(trend.scoreChange)})</strong></span>
      <span>집중도<strong>{formatLift(trend.first.lift)}<i className="mv-arrow" aria-hidden="true" />{formatLift(trend.last.lift)}</strong></span>
    </div>

    <TagRankChart points={trend.series} />
  </section>
);

const TagTrendsPage = () => {
  const [availableDates, setAvailableDates] = useState<string[]>([]);
  const [startDate, setStartDate] = useState<Date | null>(null);
  const [endDate, setEndDate] = useState<Date | null>(null);
  const [series, setSeries] = useState<SeriesResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedTag, setSelectedTag] = useState<string | null>(null);

  useEffect(() => {
    getAvailableDates()
      .then(res => {
        const ds: string[] = res.data.available_dates ?? [];
        setAvailableDates(ds);
        if (ds.length) {
          const latest = parseISO(ds[0]);
          setEndDate(latest);
          setStartDate(subDays(latest, DEFAULT_DAYS - 1));
        }
      })
      .catch(() => setError('수집된 날짜를 불러오지 못했습니다'));
  }, []);

  const windowDates = useMemo(() => {
    if (!startDate || !endDate) return [];
    const s = format(startDate, 'yyyy-MM-dd');
    const e = format(endDate, 'yyyy-MM-dd');
    return availableDates.filter(d => d >= s && d <= e).sort();
  }, [availableDates, startDate, endDate]);

  useEffect(() => {
    if (windowDates.length < 2) { setSeries(null); return; }
    let cancelled = false;
    setLoading(true); setError(null);
    // 기간 전체를 한 번에 받는다. 날짜를 하나씩 부르면 날짜당 약 0.4초라
    // 30일이면 12초가 넘는데, 백엔드가 batch_get_item으로 묶어 읽으면 3초다.
    getTagSeries(windowDates[0], windowDates[windowDates.length - 1])
      .then(res => { if (!cancelled) setSeries(res.data as SeriesResponse); })
      .catch(() => { if (!cancelled) setError('태그 데이터를 불러오지 못했습니다'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [windowDates]);

  const { risers, fallers, entered, left, spikes, swings, churn, trendMap } = useMemo(() => {
    const empty = {
      risers: [] as TagTrend[], fallers: [] as TagTrend[],
      entered: [] as Edge[], left: [] as Edge[],
      spikes: [] as TagTrend[], swings: [] as TagTrend[],
      churn: null as Churn | null, trendMap: new Map<string, TagTrend>(),
    };
    if (!series || series.dates.length < 2) return empty;

    const { dates, tags } = series;
    const lastIdx = dates.length - 1;
    const map = new Map<string, TagTrend>();
    const entered: Edge[] = [];
    const left: Edge[] = [];

    for (const [tag, s] of Object.entries(tags)) {
      const points: Point[] = [];
      for (let i = 0; i < dates.length; i += 1) {
        if (s.rank[i] == null) continue;
        points.push({ date: dates[i], rank: s.rank[i]!, count: s.count[i] ?? 0, score: s.score[i] ?? 0, lift: s.lift[i] });
      }
      if (!points.length) continue;

      const inFirst = s.rank[0] != null;
      const inLast = s.rank[lastIdx] != null;
      // 기간 시작에는 없다가 마지막 날 있는 태그 / 그 반대
      if (!inFirst && inLast) { entered.push({ tag, rank: s.rank[lastIdx]!, count: s.count[lastIdx] ?? 0 }); continue; }
      if (inFirst && !inLast) { left.push({ tag, rank: s.rank[0]!, count: s.count[0] ?? 0 }); continue; }
      if (points.length < 2) continue;

      const first = points[0];
      const last = points[points.length - 1];
      const ranks = points.map(p => p.rank);
      const bestRank = Math.min(...ranks);
      const worstRank = Math.max(...ranks);
      map.set(tag, {
        tag, series: points, first, last,
        scoreChange: first.score > 0 ? (last.score - first.score) / first.score : 0,
        rankChange: first.rank - last.rank,
        bestRank, worstRank,
        // 시작·끝만 보면 안 보이는 값. 기간 중 치솟았다 돌아온 태그를 잡는다.
        spike: Math.min(first.rank, last.rank) - bestRank,
        swing: worstRank - bestRank,
      });
    }

    const eligible = [...map.values()].filter(t => t.first.count >= MIN_WORKS && t.last.count >= MIN_WORKS);
    // 화면에 보이는 값(순위 변동)으로 정렬해야 목록 순서가 납득된다.
    // 순위 변동은 동률이 많으므로 인기 점수 변화율을 2차 기준으로 쓴다.
    const byRise = (a: TagTrend, b: TagTrend) => (b.rankChange - a.rankChange) || (b.scoreChange - a.scoreChange);
    const up = eligible.filter(t => t.rankChange > 0).sort(byRise);
    const down = eligible.filter(t => t.rankChange < 0).sort((a, b) => -byRise(a, b));

    // 끝점 비교가 놓치는 것: 기간 중 치솟았다 제자리로 돌아온 태그.
    // 실측(30일): '스트리머' 74위 → 71위인데 기간 중 58위까지 갔었다.
    //
    // **고정 문턱을 쓰지 않는다.** 기간이 짧으면 스파이크도 작다 —
    // 30일 창은 +8 이상이 5개인데 7일 창은 최대가 +6이라 8로 자르면 늘 빈 목록이 된다.
    // 대신 3계단(관측 노이즈 경계)만 넘으면 상위 10개를 보여주고, 값을 칩에 적는다.
    const spikes = eligible.filter(t => t.spike >= 3)
      .sort((a, b) => b.spike - a.spike).slice(0, 10);

    // 출렁인 태그. '꾸준한 태그'는 만들지 않는다 — 상위권은 작품 수가 압도적이라
    // 변동폭이 전부 0이고(판타지·하렘·현대판타지…) 목록이 무의미해진다.
    const swings = eligible.filter(t => t.series.length >= 4)
      .sort((a, b) => b.swing - a.swing).slice(0, 10);

    return {
      risers: up.slice(0, 12),
      fallers: down.slice(0, 12),
      entered: entered.sort((a, b) => a.rank - b.rank),
      left: left.sort((a, b) => a.rank - b.rank),
      spikes, swings,
      churn: computeChurn(tags, lastIdx),
      trendMap: map,
    };
  }, [series]);

  const handleSelect = useCallback((tag: string) => {
    setSelectedTag(prev => (prev === tag ? null : tag));
  }, []);

  const selected = selectedTag ? trendMap.get(selectedTag) ?? null : null;
  const availableDateObjs = useMemo(() => availableDates.map(d => parseISO(d)), [availableDates]);

  /** 기간 중 최고점을 보여주는 칩. 시작·끝만으로는 안 보이는 값이 요점이다. */
  const renderSpikeChip = (t: TagTrend) => (
    <button
      type="button"
      key={t.tag}
      className={`tag-zone-chip ${t.tag === selectedTag ? 'is-active' : ''}`.trim()}
      onClick={() => handleSelect(t.tag)}
    >
      <span className="tag-zone-chip__name">{t.tag}</span>
      <span className="tag-zone-chip__meta">
        기간 중 {t.bestRank}위 (+{t.spike}) · 지금 {t.last.rank}위
      </span>
    </button>
  );

  const renderSwingChip = (t: TagTrend) => (
    <button
      type="button"
      key={t.tag}
      className={`tag-zone-chip ${t.tag === selectedTag ? 'is-active' : ''}`.trim()}
      onClick={() => handleSelect(t.tag)}
    >
      <span className="tag-zone-chip__name">{t.tag}</span>
      <span className="tag-zone-chip__meta">
        {t.bestRank}~{t.worstRank}위 · {t.swing}계단
      </span>
    </button>
  );

  const renderTrendChip = (t: TagTrend) => (
    <button
      type="button"
      key={t.tag}
      className={`tag-zone-chip ${t.tag === selectedTag ? 'is-active' : ''}`.trim()}
      onClick={() => handleSelect(t.tag)}
    >
      <span className="tag-zone-chip__name">{t.tag}</span>
      <span className="tag-zone-chip__meta">
        {t.first.rank}위<i className="mv-arrow" aria-hidden="true" />{t.last.rank}위 · {t.first.count}<i className="mv-arrow" aria-hidden="true" />{t.last.count}작품
      </span>
    </button>
  );

  const renderEdgeChip = (e: Edge, suffix: string) => (
    <span key={e.tag} className="tag-zone-chip tag-zone-chip--static">
      <span className="tag-zone-chip__name">{e.tag}</span>
      <span className="tag-zone-chip__meta">{e.count}작품 · {e.rank}위{suffix}</span>
    </span>
  );

  const rangeLabel = series && series.dates.length >= 2
    ? `${format(parseISO(series.dates[0]), 'yyyy.MM.dd')} ~ ${format(parseISO(series.dates[series.dates.length - 1]), 'yyyy.MM.dd')}`
    : '';

  return (
    <div className="page-shell tag-trends-page">
      {/* 헤더 내비에서 태그 트렌드를 뺐으므로(태그 하나로 묶음) 두 페이지를 서로 잇는다.
          계획 3에서 태그 페이지 안의 전환으로 바뀐다. */}
      <PageHero
        title="태그 트렌드"
        titleAction={<Link to="/tags/rankings" className="page-hero__switch">오늘 랭킹</Link>}
      />

      <div className="tag-trend-range">
        <DateRangePicker
          startDate={startDate}
          endDate={endDate}
          availableDates={availableDateObjs}
          novelAvailableDatesSet={new Set(availableDates)}
          onStartDateChange={setStartDate}
          onEndDateChange={setEndDate}
          noMargin
          /* 선택 가능한 날짜는 이미 흰 글자로 구분된다. 점을 또 찍을 이유가 없다.
             (소설 상세는 '이 작품의 데이터가 있는 날'이 따로라 점이 필요하다) */
          showNovelDataIndicator={false}
        />
      </div>

      {error && <Alert variant="danger">{error}</Alert>}
      {loading && (
        <div className="text-center py-5">
          <Spinner animation="border" />
          <p className="tag-trend-loading">기간 데이터를 불러오는 중입니다</p>
        </div>
      )}

      {!loading && !error && series && series.dates.length >= 2 && (
        <>
          {churn && (
            <div className="report-kpis report-kpis--lead tag-trend-kpis">
              <span>
                <b>{churn.footrule != null ? churn.footrule.toFixed(0) : '-'}</b>계단
                <i>평균 순위 이동</i>
              </span>
              <span>
                <b>{churn.tau != null ? churn.tau.toFixed(2) : '-'}</b>
                <i>순서 일치도 (1 = 그대로)</i>
              </span>
              <span>
                <b>{churn.startTags}</b><i className="mv-arrow" aria-hidden="true" /><b>{churn.endTags}</b>
                <i>태그 수</i>
              </span>
              <span>
                <b>{churn.common}</b>개
                <i>양쪽에 다 있음</i>
              </span>
            </div>
          )}

          {selected && <SelectedTagPanel trend={selected} onClose={() => setSelectedTag(null)} />}

          <div className="tag-trend-grid">
            <PanelCard title="뜬 태그" meta={`순위가 오른 순 · ${MIN_WORKS}작품 이상`}>
              <div className="tag-zone-chip-list">
                {risers.length ? risers.map(renderTrendChip) : <p className="tag-trend-empty">해당하는 태그가 없습니다</p>}
              </div>
            </PanelCard>

            <PanelCard title="식은 태그" meta={`순위가 내린 순 · ${MIN_WORKS}작품 이상`}>
              <div className="tag-zone-chip-list">
                {fallers.length ? fallers.map(renderTrendChip) : <p className="tag-trend-empty">해당하는 태그가 없습니다</p>}
              </div>
            </PanelCard>

            <PanelCard title="새로 들어온 태그" meta={`기간 시작일 목록에는 없던 태그 ${entered.length}개`}>
              <div className="tag-zone-chip-list">
                {entered.length ? entered.slice(0, 24).map(e => renderEdgeChip(e, '')) : <p className="tag-trend-empty">없습니다</p>}
              </div>
            </PanelCard>

            <PanelCard title="사라진 태그" meta={`기간 마지막 날 목록에서 빠진 태그 ${left.length}개`}>
              <div className="tag-zone-chip-list">
                {left.length ? left.slice(0, 24).map(e => renderEdgeChip(e, '였음')) : <p className="tag-trend-empty">없습니다</p>}
              </div>
            </PanelCard>
          </div>

          <div className="tag-trend-grid">
            <PanelCard
              title="기간 중 치솟았던 태그"
              meta={`시작·끝 순위보다 높이 갔던 태그 ${spikes.length}개 · 기간이 길수록 잘 잡힙니다`}
            >
              <div className="tag-zone-chip-list">
                {spikes.length ? spikes.map(renderSpikeChip)
                  : <p className="tag-trend-empty">해당하는 태그가 없습니다</p>}
              </div>
              <p className="report-caveat">
                위의 뜬·식은 태그는 시작과 끝만 견주므로, 기간 중간에 올랐다 제자리로
                돌아온 태그는 거기서 보이지 않습니다
              </p>
            </PanelCard>

            <PanelCard
              title="많이 출렁인 태그"
              meta={`기간 중 최고~최저 폭이 큰 순 · ${MIN_WORKS}작품 이상`}
            >
              <div className="tag-zone-chip-list">
                {swings.length ? swings.map(renderSwingChip)
                  : <p className="tag-trend-empty">해당하는 태그가 없습니다</p>}
              </div>
              <p className="report-caveat">
                반대편(꾸준한 태그)은 두지 않았습니다 — 상위권은 작품 수가 압도적이라
                변동폭이 대부분 0이라 목록이 되지 않습니다
              </p>
            </PanelCard>
          </div>

          <p className="tag-trend-foot">
            {rangeLabel} · 기간 안의 모든 수집일을 비교합니다
          </p>
        </>
      )}
    </div>
  );
};

export default TagTrendsPage;
