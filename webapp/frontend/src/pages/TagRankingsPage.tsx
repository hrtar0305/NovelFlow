import { Fragment, useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { Spinner, Alert } from 'react-bootstrap';
import { useParams, useNavigate } from 'react-router-dom';
import { format, parseISO, isValid, subDays } from 'date-fns';
import { getTagRankingsByDate, getAvailableDates, getTagSeries } from '../services/api';
import TagRankChart, { type TagRankPoint } from '../components/tag/TagRankChart';
import CalendarPicker from '../components/CalendarPicker';
import TagSearchControl from '../components/TagSearchControl';
import {
  ResponsiveContainer, ScatterChart, Scatter, XAxis, YAxis, ZAxis,
  CartesianGrid, Label, ReferenceLine, ReferenceArea, Tooltip as RechartsTooltip,
} from 'recharts';
import PageHero from '../components/ui/PageHero';
import PanelCard from '../components/ui/PanelCard';

type TagSortKey = 'Rank' | 'rank_change' | 'count' | 'local_lift' | 'power_score';

/**
 * 지표 설명. **'상위권 집중도'와 '인기 점수'는 이름만으로 뜻이 통하지 않는다** —
 * 둘 다 이 사이트가 만든 파생 지표이고 노벨피아가 보여 주는 값이 아니다.
 * 그래서 같은 문구를 표 머리글·선택 패널·표 아래 각주 세 곳에 같이 쓴다.
 *
 * 산식은 백엔드와 한 글자도 어긋나면 안 된다(`main.py` 의 `_compute_local_lift`,
 * 적재의 `TagWeightedScoresLogarithmic`). 식을 바꾸면 여기도 함께 바꿀 것.
 */
const METRIC_HINTS: Record<string, string> = {
  Rank: '인기 점수가 높은 순서입니다.',
  rank_change: '전날 집계와 비교한 순위 변동입니다. 과거 날짜를 보고 있으면 그 날짜의 전날과 비교합니다.',
  count: '이 태그가 달린 작품이 그날 목록에 몇 편 있었는지입니다.',
  local_lift:
    '상위 100위에서의 등장 비율 ÷ 100위 밖에서의 등장 비율. '
    + '1.0이면 상위권과 그 밖에 고르게 있고, 2.0이면 상위권에 두 배로 몰려 있다는 뜻입니다. '
    + '5편 미만인 태그는 값이 심하게 튀어 산출하지 않습니다.',
  power_score:
    '이 태그가 달린 작품마다 1/ln(순위+1)을 더한 값. '
    + '상위권 작품이 더 크게 반영되지만 1위와 500위의 차이가 약 9배로 눌려 있어, '
    + '한 작품이 점수를 독차지하지 않습니다. 많이 쓰이면서 상위권에도 있는 태그가 높게 나옵니다.',
};

/** 표에서 정렬할 수 있는 열. 각 열을 처음 누르면 '보고 싶은 쪽'이 위로 온다 —
 *  순위는 1위부터, 나머지는 큰 값부터. 태그 이름은 정렬 대상이 아니다. */
const TAG_COLUMNS: { key: TagSortKey; label: string; short: string; first: 'asc' | 'desc' }[] = [
  { key: 'Rank', label: '순위', short: '순위', first: 'asc' },
  { key: 'rank_change', label: '변동', short: '변동', first: 'desc' },
  { key: 'count', label: '작품 수', short: '작품', first: 'desc' },
  { key: 'local_lift', label: '상위권 집중도', short: '집중도', first: 'desc' },
  { key: 'power_score', label: '인기 점수', short: '점수', first: 'desc' },
];

/** 정렬용 수치. 값이 없는 칸은 방향과 무관하게 항상 뒤로 보낸다 —
 *  집중도가 없는 태그(5작품 미만)가 내림차순 맨 위를 차지하면 표가 쓸모없어진다. */
const sortValue = (t: Tag, key: TagSortKey): number | null => {
  if (key === 'rank_change') {
    // 'New'는 전날 없던 태그다. 상승/하락 어느 쪽도 아니므로 수치 정렬에서 뺀다.
    return typeof t.rank_change === 'number' ? t.rank_change : null;
  }
  if (key === 'local_lift') return t.local_lift ?? null;
  return t[key] ?? null;
};

/** 표의 변동 칸. 0과 '없음'을 같은 기호로 뭉뚱그리지 않는다 — 툴팁과 같은 규칙이다. */
const RankChangeCell = ({ value }: { value?: number | 'New' | null }) => {
  if (value === 'New') return <span className="tag-rank-move tag-rank-move--new">NEW</span>;
  if (value === null || value === undefined) return <span className="tag-rank-move tag-rank-move--none" aria-label="비교할 전날 데이터 없음">·</span>;
  if (value === 0) return <span className="tag-rank-move tag-rank-move--flat" aria-label="변동 없음">—</span>;
  return value > 0
    ? <span className="tag-rank-move tag-rank-move--up">▲{value}</span>
    : <span className="tag-rank-move tag-rank-move--down">▼{Math.abs(value)}</span>;
};

/** 선택 패널이 보여줄 추이 길이. 지도는 '오늘의 지형'이라 기간 선택은 두지 않는다. */
const HISTORY_DAYS = 14;

// --- TYPE DEFINITIONS ---
type SeriesResponse = {
  dates: string[];
  tags: Record<string, {
    rank: (number | null)[]; count: (number | null)[];
    score: (number | null)[]; lift: (number | null)[];
  }>;
};

interface Tag {
  Rank: number;
  tag: string;
  power_score: number;
  local_lift?: number | null;
  count: number;
  rank_change?: number | 'New' | null;
}

/**
 * 태그 지형 4분면. 이 페이지의 목적은 순위 나열이 아니라
 * "오늘 어떤 태그가 통했는가"라는 인사이트 전달이라서,
 * 사용량(등장 작품 수) × 성과(상위권 집중도)로 태그를 미리 분류해 보여준다.
 *
 *  - mainstream 대세      : 많이 쓰이고 상위권에서도 강함
 *  - gem        숨은 강자 : 적게 쓰이지만 쓰면 상위권
 *  - saturated  과포화    : 많이 쓰이지만 상위권 비중은 낮음
 *  - cold       약세      : 적게 쓰이고 상위권에도 잘 없음
 *
 * 사용량 경계는 그날 분포의 상위 25%(P75)로 잡는다 — 고정 숫자는 표본이
 * 300→500으로 바뀐 과거 날짜에서 깨진다. 성과 경계는 집중도 1.0
 * (상위 100위 안/밖 등장 비율이 같은 지점)이라 설명이 자명하다.
 */
type ZoneKey = 'mainstream' | 'gem' | 'saturated' | 'cold';

/**
 * 4분면 패널의 배치 순서. 위 지도의 사분면과 자리가 같아야 한다.
 *
 *   지도            패널(2열)
 *   숨은강자 | 대세   숨은강자 | 대세
 *   약세    | 과포화  약세    | 과포화
 *
 * 객체 선언 순서(mainstream, gem, saturated, cold)를 그대로 쓰면 지도와 좌우가
 * 뒤집혀서, 지도에서 오른쪽 위에 있던 '대세'를 패널에선 왼쪽 위에서 찾아야 한다.
 */
const ZONE_PANEL_ORDER: ZoneKey[] = ['gem', 'mainstream', 'cold', 'saturated'];

const ZONES: Record<ZoneKey, { label: string; desc: string; color: string }> = {
  mainstream: { label: '오늘의 대세', desc: '많이 쓰이고 상위권에서도 강함', color: 'var(--np-accent)' },
  gem: { label: '숨은 강자', desc: '적게 쓰이지만 쓰면 상위권', color: 'var(--np-chart-3)' },
  saturated: { label: '과포화', desc: '많이 쓰이지만 상위권 비중은 낮음', color: 'var(--np-warning)' },
  cold: { label: '오늘 약세', desc: '적게 쓰이고 상위권에도 잘 없음', color: 'var(--np-text-secondary)' },
};

/** 순위 변동을 한 구절로 만든다.
 *
 *  **'어제'가 아니라 '전날'이다.** 백엔드는 화면에 띄운 날짜의 캘린더 −1일과 비교하므로
 *  (`main.py` 의 `prev_date`), 과거 날짜를 골라 보고 있으면 '어제'는 틀린 말이 된다.
 *
 *  비교할 전날이 없으면 null 을 돌려주고 호출부가 구절 자체를 뺀다 — 예전처럼 `-`
 *  하나만 두면 '움직이지 않았다'인지 '비교할 데이터가 없다'인지 구분되지 않는다
 *  (1위 태그가 '어제 대비 -'로 보였다).
 *
 *  'New' 는 '전날 집계에 없던 태그'라는 뜻이지 '오늘 만들어진 태그'가 아니다. */
const formatDayChange = (rankChange?: number | 'New' | null) => {
  if (rankChange === 'New') return '전날엔 없던 태그';
  if (rankChange === 0) return '전날과 같음';
  if (rankChange === null || rankChange === undefined) return null;
  return rankChange > 0 ? `전날보다 ▲${rankChange}` : `전날보다 ▼${Math.abs(rankChange)}`;
};

const getRankChangeTone = (rankChange?: number | 'New' | null) => {
  if (rankChange === 'New') return 'accent';
  if (typeof rankChange === 'number' && rankChange > 0) return 'positive';
  if (typeof rankChange === 'number' && rankChange < 0) return 'negative';
  return 'muted';
};

const formatLift = (lift?: number | null) => (lift != null ? `${lift.toFixed(1)}×` : '-');

const formatMonthDay = (iso: string) => format(parseISO(iso), 'M.d');

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const QuadrantTooltip = ({ active, payload }: any) => {
  if (active && payload && payload.length) {
    const data = payload[0].payload;
    const zone = ZONES[data.zone as ZoneKey];
    const dayChange = formatDayChange(data.rank_change);
    return (
      <div className="custom-tooltip tag-bubble-tooltip">
        <p className="tag-bubble-tooltip__title">{data.tag}</p>
        {zone && <p style={{ color: zone.color }}>{zone.label}</p>}
        <p>{data.Rank}위{dayChange ? ` · ${dayChange}` : ''}</p>
        <p>등장 {data.count}작품 · 집중도 {formatLift(data.lift)}</p>
        <p>인기 점수 {data.power_score.toFixed(2)}</p>
      </div>
    );
  }
  return null;
};

// --- MAIN COMPONENT ---
const TagRankingsPage = () => {
  const [tags, setTags] = useState<Tag[]>([]);
  const [date, setDate] = useState<Date | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [availableDatesSet, setAvailableDatesSet] = useState<Set<string>>(new Set());
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [hoveredTag, setHoveredTag] = useState<string | null>(null);
  const [expandedZones, setExpandedZones] = useState<Set<ZoneKey>>(new Set());
  // 전체 순위표의 정렬. 기본은 순위 오름차순 — 이 표의 존재 이유가 '1위부터 보기'다.
  const [tableSort, setTableSort] = useState<{ key: TagSortKey; dir: 'asc' | 'desc' }>(
    { key: 'Rank', dir: 'asc' },
  );
  // 선택한 태그의 최근 추이. 태그를 처음 고를 때만 받아 오고, 날짜가 바뀌면 버린다.
  const [history, setHistory] = useState<{ date: string; data: SeriesResponse } | null>(null);
  const hasFetchedDates = useRef(false);
  const selectedPanelRef = useRef<HTMLElement | null>(null);

  const { date: dateParam } = useParams();
  const navigate = useNavigate();

  const handleTagSelect = useCallback((tag: string) => {
    setSelectedTag(prev => (prev === tag ? null : tag));
  }, []);

  const handleSearchChange = useCallback((term: string) => {
    setSearchTerm(term);
  }, []);

  const handleDateChange = (newDate: Date | null) => {
    if (newDate && (!date || format(newDate, 'yyyy-MM-dd') !== format(date, 'yyyy-MM-dd'))) {
      navigate(`/tags/rankings/${format(newDate, 'yyyy-MM-dd')}`);
    }
  };

  const toggleZoneExpand = useCallback((zone: ZoneKey) => {
    setExpandedZones(prev => {
      const next = new Set(prev);
      if (next.has(zone)) next.delete(zone); else next.add(zone);
      return next;
    });
  }, []);

  useEffect(() => {
    if (hasFetchedDates.current) return;
    hasFetchedDates.current = true;
    const fetchAvailableDates = async () => {
      try {
        const response = await getAvailableDates();
        const fetchedDates: string[] = response.data.available_dates || [];
        setAvailableDatesSet(new Set(fetchedDates));
      } catch {
        setError('조회 가능한 날짜 목록을 불러오는 데 실패했습니다.');
      }
    };
    fetchAvailableDates();
  }, []);

  useEffect(() => {
    if (availableDatesSet.size === 0) return;
    if (dateParam && isValid(parseISO(dateParam)) && availableDatesSet.has(dateParam)) {
      const fetchRankings = async () => {
        setLoading(true);
        setError(null);
        try {
          setDate(parseISO(dateParam));
          const response = await getTagRankingsByDate(dateParam);
          setTags(response.data || []);
        } catch {
          setError('태그 랭킹을 불러오는 데 실패했습니다.');
          setTags([]);
        } finally {
          setLoading(false);
        }
      };
      fetchRankings();
    } else {
      const latestDate = Array.from(availableDatesSet)[0];
      if (latestDate) navigate(`/tags/rankings/${latestDate}`, { replace: true });
    }
  }, [dateParam, navigate, availableDatesSet]);

  // 집중도가 계산된 태그(등장 5작품 이상)만 지형 분류 대상이다.
  // 5작품 미만은 통계 노이즈라 적재 단계에서 이미 집중도를 계산하지 않는다.
  const eligible = useMemo(() => (
    tags.filter(t => t.local_lift != null).map(t => ({ ...t, lift: t.local_lift as number }))
  ), [tags]);

  const hasLift = eligible.length > 0;

  // 주류/니치 경계: 그날 등장 작품 수 분포의 P75
  const mainstreamCut = useMemo(() => {
    if (!hasLift) return 0;
    const counts = eligible.map(t => t.count).sort((a, b) => a - b);
    return counts[Math.min(counts.length - 1, Math.floor(counts.length * 0.75))];
  }, [eligible, hasLift]);

  const zoneOf = useCallback((t: { count: number; lift: number }): ZoneKey => {
    if (t.count >= mainstreamCut) return t.lift >= 1 ? 'mainstream' : 'saturated';
    return t.lift >= 1 ? 'gem' : 'cold';
  }, [mainstreamCut]);

  const classified = useMemo(() => (
    eligible.map(t => ({ ...t, zone: zoneOf(t) }))
  ), [eligible, zoneOf]);

  const zoneLists = useMemo(() => {
    const lists: Record<ZoneKey, typeof classified> = { mainstream: [], gem: [], saturated: [], cold: [] };
    for (const t of classified) lists[t.zone].push(t);
    // 존마다 "무엇이 중요한가"가 달라 정렬 기준을 달리한다:
    // 대세는 지배력, 숨은 강자는 집중도, 과포화/약세는 사용량
    // (많이 쓰는데 안 통하는 것이 더 중요한 정보).
    lists.mainstream.sort((a, b) => b.power_score - a.power_score);
    lists.gem.sort((a, b) => b.lift - a.lift);
    lists.saturated.sort((a, b) => b.count - a.count);
    lists.cold.sort((a, b) => b.count - a.count);
    return lists;
  }, [classified]);

  // 오늘의 브리핑 4장 — 4분면 대표 하나씩. 4분면 중 둘만 보여주면 "많이 쓰는데 안
  // 통하는 태그"처럼 정작 유용한 경고가 빠진다.
  //
  // 최대 상승/하락 2장이 여기 있었는데 뺐다. 구역이 아니라 움직임이라 나머지 4장과
  // 성격이 다르고, 값도 아래 '오늘 뜬/식은 태그' 목록의 첫 줄과 똑같아 중복이었다.
  const briefing = useMemo(() => {
    if (tags.length === 0) return null;
    return {
      mainstream: zoneLists.mainstream[0] ?? null,
      gem: zoneLists.gem[0] ?? null,
      saturated: zoneLists.saturated[0] ?? null,
      cold: zoneLists.cold[0] ?? null,
    };
  }, [tags, zoneLists]);

  const risers = useMemo(() => (
    (tags.filter(t => typeof t.rank_change === 'number' && (t.rank_change as number) > 0) as (Tag & { rank_change: number })[])
      .sort((a, b) => b.rank_change - a.rank_change).slice(0, 6)
  ), [tags]);
  const fallers = useMemo(() => (
    (tags.filter(t => typeof t.rank_change === 'number' && (t.rank_change as number) < 0) as (Tag & { rank_change: number })[])
      .sort((a, b) => a.rank_change - b.rank_change).slice(0, 6)
  ), [tags]);
  const newcomers = useMemo(() => (
    tags.filter(t => t.rank_change === 'New').sort((a, b) => b.power_score - a.power_score).slice(0, 6)
  ), [tags]);

  const searchResults = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    if (!term) return null;
    return tags.filter(t => t.tag.toLowerCase().includes(term)).slice(0, 30);
  }, [tags, searchTerm]);

  const searchMatchSet = useMemo(() => (
    searchResults ? new Set(searchResults.map(t => t.tag)) : null
  ), [searchResults]);

  const selectedTagData = useMemo(() => {
    const base = tags.find(t => t.tag === selectedTag);
    if (!base) return null;
    const lift = base.local_lift;
    return { ...base, zone: lift != null ? zoneOf({ count: base.count, lift }) : null };
  }, [tags, selectedTag, zoneOf]);

  useEffect(() => {
    if (selectedTag && !tags.some(t => t.tag === selectedTag)) setSelectedTag(null);
  }, [tags, selectedTag]);

  // 태그를 처음 고를 때 최근 HISTORY_DAYS일치를 한 번만 받는다. 응답에 그날의 모든
  // 태그가 들어 있으므로 이후 어떤 태그를 눌러도 추가 호출이 없다(api.ts에서 5분 캐시).
  // 날짜를 바꾸면 키가 달라져 다시 받는다.
  useEffect(() => {
    if (!selectedTag || !date) return;
    const key = format(date, 'yyyy-MM-dd');
    if (history?.date === key) return;
    let alive = true;
    getTagSeries(format(subDays(date, HISTORY_DAYS - 1), 'yyyy-MM-dd'), key)
      .then(res => { if (alive) setHistory({ date: key, data: res.data }); })
      .catch(() => { if (alive) setHistory(null); });   // 추이는 부가 정보라 실패해도 조용히 넘어간다
    return () => { alive = false; };
  }, [selectedTag, date, history?.date]);

  // 전체 순위표에 뿌릴 행. 집중도가 없는 태그(5작품 미만)도 순위는 있으므로 전부 넣는다 —
  // 지도·존 카드는 집중도가 있어야 성립하지만 '랭킹'은 그렇지 않다.
  const tableRows = useMemo(() => {
    const rows = [...tags];
    const { key, dir } = tableSort;
    const sign = dir === 'asc' ? 1 : -1;
    rows.sort((a, b) => {
      const va = sortValue(a, key);
      const vb = sortValue(b, key);
      if (va === null && vb === null) return a.Rank - b.Rank;
      if (va === null) return 1;          // 값 없는 행은 방향과 무관하게 뒤로
      if (vb === null) return -1;
      if (va !== vb) return (va - vb) * sign;
      return a.Rank - b.Rank;             // 동점은 언제나 순위 순
    });
    return rows;
  }, [tags, tableSort]);

  const requestTableSort = useCallback((key: TagSortKey) => {
    setTableSort(prev => (prev.key === key
      ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
      : { key, dir: TAG_COLUMNS.find(c => c.key === key)?.first ?? 'desc' }));
  }, []);

  const tableSortAttr = (key: TagSortKey) =>
    (tableSort.key === key ? (tableSort.dir === 'asc' ? 'ascending' : 'descending') : 'none');

  // 차트에 넘길 점들. 아직 안 왔거나 그날 없던 태그면 null이고, 패널은 오늘 값만 보여준다.
  const selectedHistory = useMemo<TagRankPoint[] | null>(() => {
    if (!selectedTag || !history) return null;
    const row = history.data.tags[selectedTag];
    if (!row) return null;
    const pts = history.data.dates.map((d, i) => ({
      date: d, rank: row.rank[i], count: row.count[i], score: row.score[i], lift: row.lift[i],
    })).filter(p => p.rank != null && p.count != null && p.score != null) as TagRankPoint[];
    return pts.length >= 2 ? pts : null;
  }, [selectedTag, history]);

  // 패널을 여는 경로가 다섯이다 — 지도 원, 표 행, 브리핑 카드, 존 칩, 변동 목록.
  // 표가 690px이라 어디에 두든 어떤 경로에서는 화면 밖이 된다. 그래서 위치로 풀지 않고,
  // **안 보일 때만** 끌어온다(`block: 'nearest'` — 이미 보이면 스크롤하지 않는다).
  //
  // `selectedHistory`도 의존성에 넣는다. 패널이 뜬 직후에 한 번만 스크롤하면
  // 몇 초 뒤 14일 차트가 도착해 패널이 200px→408px로 자라면서 다시 화면을 벗어난다
  // (실측 37%만 보였다). 차트가 붙은 뒤 한 번 더 맞춘다.
  useEffect(() => {
    if (!selectedTag) return;
    selectedPanelRef.current?.scrollIntoView({ block: 'nearest' });
  }, [selectedTag, selectedHistory]);

  // 축 도메인. 사용량은 멱함수 분포(중앙값 ~17 vs 최대 ~225)라 로그 축.
  // 양쪽 여유는 원 반지름을 감수하기 위한 것이다 — 가장 많이 쓰인 태그는 인기 점수도
  // 가장 높아 원이 제일 크므로(반지름 최대 17px) 좁은 화면에서 오른쪽 경계에 스친다.
  const countDomain = useMemo(() => {
    if (!hasLift) return [1, 10] as [number, number];
    const counts = eligible.map(d => d.count);
    return [Math.min(...counts) * 0.78, Math.max(...counts) * 1.6] as [number, number];
  }, [eligible, hasLift]);

  // 집중도 축 상한을 8로 고정한다.
  //
  // 집중도의 이론상 최대는 400(분모를 max(하위400,1)로 깔았기 때문)이고, 실제로도
  // 이상치가 자주 나온다 — 2026-08-25는 최대 16.0인데 2위가 4.8이었다. 축을 그날
  // 최대값에 맞추면 이상치 하나 때문에 나머지가 눌린다(중앙값이 축 높이의 24%까지
  // 내려갔다). 상한을 8로 고정하면 여러 날짜 실측에서 클램프되는 점은 날짜당 1개뿐이고
  // 중앙값이 37~40%로 올라온다. 날짜가 바뀌어도 축이 같아 어제와 눈으로 비교된다.
  //
  // 8을 넘는 태그는 축 맨 위에 고정해 그리고 위쪽을 향한 삼각형으로 표시한다.
  // 값 자체는 툴팁·구역 카드에 정확히 나오므로 정보가 사라지지는 않는다.
  const LIFT_CLAMP = 8;

  // 집중도 축은 Recharts의 `scale="sqrt"` 대신 **제곱근 공간의 선형 축**으로 만든다.
  //
  // 이유: sqrt 스케일은 음수 도메인을 못 쓴다. 그래서 집중도 0인 태그(원의 중심이
  // x축 선에 놓임)가 아래 절반 잘리는 문제를 축 padding으로 우회했는데, 4분면 배경은
  // 데이터 좌표로 그려지므로 padding만큼 위아래에 색 없는 띠가 생겼다.
  //
  // 값을 미리 sqrt로 변환해 선형 축에 올리면 눈금 간격은 sqrt 스케일과 완전히 동일하고
  // (0을 보존하면서 왜도를 줄이는 목적 그대로), 도메인을 0 아래로 내릴 수 있어
  // 원이 잘리지도 띠가 생기지도 않는다. 눈금은 실제 집중도 값으로 다시 표기한다.
  const LIFT_TICKS = [0, 0.5, 1, 2, 4, 8];
  const LIFT_AXIS_MIN = -0.3;              // 원 반지름을 감수할 아래 여유
  const LIFT_AXIS_MAX = Math.sqrt(9.2);    // 클램프(8) 위로 약간의 머리 공간
  const LIFT_MID = 1;                      // sqrt(1) = 1, 강세/약세 경계

  const chartData = useMemo(() => classified.map(t => ({
    ...t,
    liftPlotted: Math.sqrt(Math.min(t.lift, LIFT_CLAMP)),
    isClamped: t.lift > LIFT_CLAMP,
  })), [classified]);

  // 라벨 우선순위. 값이 큰 태그일수록 먼저 자리를 잡는다.
  // 지배력(인기 점수)과 특이성(집중도)을 모두 반영해야 "판타지"류와 "제작"류가
  // 함께 뽑힌다. 순위를 정규화해 더하는 방식으로 한쪽에 쏠리지 않게 한다.
  const labelPriority = useMemo(() => {
    const n = chartData.length || 1;
    const powerRank = new Map<string, number>();
    [...chartData].sort((a, b) => b.power_score - a.power_score)
      .forEach((t, i) => powerRank.set(t.tag, i / n));
    const liftRank = new Map<string, number>();
    [...chartData].sort((a, b) => b.lift - a.lift)
      .forEach((t, i) => liftRank.set(t.tag, i / n));
    return [...chartData]
      .map(t => ({ tag: t.tag, score: (powerRank.get(t.tag) ?? 1) + (liftRank.get(t.tag) ?? 1) }))
      .sort((a, b) => a.score - b.score)
      .reduce((m, t, i) => m.set(t.tag, i), new Map<string, number>());
  }, [chartData]);

  // 이미 배치한 라벨의 화면 사각형. 렌더 패스마다 초기화한다.
  //
  // 원 68개 중 겹치는 쌍이 27개라, 미리 고른 태그에 무조건 라벨을 붙이면 서로
  // 겹치거나 남의 원 위에 얹힌다. 그래서 Recharts가 계산해 준 실제 좌표(cx, cy)를
  // 받아 우선순위 순으로 훑으며 "이미 놓인 라벨과 겹치지 않을 때만" 배치한다.
  // 여유가 있는 곳에는 라벨이 더 많이 붙고, 빽빽한 곳에는 대표만 남는다.
  const labelBoxesRef = useRef<{ x1: number; y1: number; x2: number; y2: number }[]>([]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const quadrantShape = useCallback((props: any) => {
    const { cx, cy, payload, node } = props;
    const index = props['data-recharts-item-index'] ?? 0;
    // 각 렌더 패스는 index 0부터 시작한다. 그때 배치 기록을 비운다.
    if (index === 0) labelBoxesRef.current = [];
    if (cx == null || cy == null || !payload) return <g />;

    const rawSize = (props.size ?? node?.z ?? 200) as number;
    const isActive = payload.tag === selectedTag || payload.tag === hoveredTag;
    const dimmed = searchMatchSet ? !searchMatchSet.has(payload.tag) : false;
    const r = Math.max(4.5, Math.sqrt(Math.abs(rawSize) / Math.PI));
    const zone = ZONES[payload.zone as ZoneKey];

    // 라벨을 붙일지 결정한다. 선택·호버 중이거나 클램프된 이상치는 항상 붙인다.
    let labelY: number | null = null;
    const rank = labelPriority.get(payload.tag) ?? 999;
    const force = isActive || payload.isClamped;
    if (!dimmed && (force || rank < 18)) {
      const halfW = payload.tag.length * 6 + 4;
      // 위/아래 후보. 클램프된 점은 축 최상단에 붙어 있어 위쪽에 구역 이름
      // (숨은 강자 / 오늘의 대세)이 있으므로 아래쪽만 쓴다.
      const candidates = payload.isClamped
        ? [cy + r + 15]
        : [cy - r - 6, cy + r + 15];
      for (const candidate of candidates) {
        const box = { x1: cx - halfW, y1: candidate - 11, x2: cx + halfW, y2: candidate + 3 };
        const hit = labelBoxesRef.current.some(b =>
          box.x1 < b.x2 && b.x1 < box.x2 && box.y1 < b.y2 && b.y1 < box.y2);
        if (!hit || force) {
          labelBoxesRef.current.push(box);
          labelY = candidate;
          break;
        }
      }
    }

    return (
      <g>
        {payload.isClamped ? (
          // 축 상한을 넘은 태그. 원 대신 위쪽 삼각형으로 "더 위에 있다"를 표시한다.
          <polygon
            points={`${cx},${cy - r} ${cx - r},${cy + r * 0.7} ${cx + r},${cy + r * 0.7}`}
            fill={zone.color}
            fillOpacity={dimmed ? 0.1 : isActive ? 0.9 : 0.7}
            stroke={isActive ? 'var(--np-text-heading)' : 'var(--np-border-strong)'}
            strokeWidth={isActive ? 2.4 : 1}
            strokeOpacity={dimmed ? 0.2 : 1}
            style={{ cursor: 'pointer' }}
            onClick={() => handleTagSelect(payload.tag)}
            onMouseEnter={() => setHoveredTag(payload.tag)}
            onMouseLeave={() => setHoveredTag(null)}
          />
        ) : (
          <circle
            cx={cx}
            cy={cy}
            r={isActive ? r + 2.5 : r}
            fill={zone.color}
            fillOpacity={dimmed ? 0.1 : isActive ? 0.9 : 0.6}
            stroke={isActive ? 'var(--np-text-heading)' : 'var(--np-border-strong)'}
            strokeWidth={isActive ? 2.4 : 1}
            strokeOpacity={dimmed ? 0.2 : 1}
            style={{ cursor: 'pointer' }}
            onClick={() => handleTagSelect(payload.tag)}
            onMouseEnter={() => setHoveredTag(payload.tag)}
            onMouseLeave={() => setHoveredTag(null)}
          />
        )}
        {labelY != null && (
          <text
            x={cx}
            y={labelY}
            textAnchor="middle"
            className={`tag-quadrant-label ${isActive ? 'tag-quadrant-label--active' : ''}`.trim()}
            style={{ pointerEvents: 'none' }}
          >
            {payload.tag}
          </text>
        )}
      </g>
    );
  }, [handleTagSelect, hoveredTag, selectedTag, labelPriority, searchMatchSet]);


  const noLiftCount = tags.length - eligible.length;
  // 패널 색 띠는 패널이 실제로 보여주는 구간을 따른다. 14일 추이를 띄워 놓고
  // 색만 전날 변동을 따르면 초록 띠 아래에 14일 하락이 적히는 일이 생긴다.
  const selectedTone = useMemo(() => {
    if (!selectedHistory) return getRankChangeTone(selectedTagData?.rank_change);
    const moved = selectedHistory[0].rank - selectedHistory[selectedHistory.length - 1].rank;
    return moved > 0 ? 'positive' : moved < 0 ? 'negative' : 'muted';
  }, [selectedHistory, selectedTagData?.rank_change]);

  const renderTagChip = (t: Tag, zoneKey?: ZoneKey) => (
    <button
      type="button"
      key={t.tag}
      className={`tag-zone-chip ${zoneKey ? `tag-zone-chip--${zoneKey}` : ''} ${t.tag === selectedTag ? 'is-active' : ''}`.trim()}
      onClick={() => handleTagSelect(t.tag)}
      onMouseEnter={() => setHoveredTag(t.tag)}
      onMouseLeave={() => setHoveredTag(null)}
    >
      <span className="tag-zone-chip__name">{t.tag}</span>
      <span className="tag-zone-chip__meta">
        {t.count}작품{t.local_lift != null ? ` · 집중도 ${formatLift(t.local_lift)}` : ''}
      </span>
    </button>
  );

  const ZONE_PREVIEW = 12;

  // 전체 순위표. 페이지 이름이 '태그 랭킹'인데 1위부터 차례로 볼 수 있는 곳이
  // 여태 없었다 — 존 카드는 존마다 정렬 기준이 다르고(대세=인기 점수, 숨은 강자=집중도,
  // 나머지=작품 수), 순위는 지도 툴팁과 선택 패널에만 잠깐 떴다.
  const rankingTable = (
    <PanelCard
      title="전체 태그 순위"
      meta={date ? `${format(date, 'yyyy.MM.dd')} · ${tags.length}개` : `${tags.length}개`}
      className="ranking-table-panel tag-rank-table-panel"
      bodyClassName="ranking-table-panel__body"
    >
      <div className="custom-table-wrapper tag-rank-table-scroll">
        <table className="custom-table table tag-rank-table">
          <thead>
            <tr>
              {TAG_COLUMNS.map(c => (
                <Fragment key={c.key}>
                  <th
                    aria-sort={tableSortAttr(c.key)}
                    onClick={() => requestTableSort(c.key)}
                    className="cursor-pointer sortable-header"
                    data-col={c.key}
                    /* 파생 지표는 마우스를 올리면 산식이 뜬다. 터치 기기에는 hover 가
                       없으므로 표 아래 각주에 같은 내용을 글로도 둔다. */
                    title={METRIC_HINTS[c.key]}
                  >
                    {/* 값은 390px 에서도 다 들어가는데 헤더만 넘쳐서 옆 칸과 겹쳤다.
                        좁은 화면에서는 짧은 쪽으로 바꾼다. */}
                    <span className="tag-rank-table__th-full">{c.label}</span>
                    <span className="tag-rank-table__th-short">{c.short}</span>
                  </th>
                  {c.key === 'rank_change' && <th data-col="tag">태그</th>}
                </Fragment>
              ))}
            </tr>
          </thead>
          <tbody>
            {tableRows.map(t => (
              <tr
                key={t.tag}
                className={t.tag === selectedTag ? 'is-active' : undefined}
                onClick={() => handleTagSelect(t.tag)}
              >
                <td data-col="Rank">{t.Rank}</td>
                <td data-col="rank_change"><RankChangeCell value={t.rank_change} /></td>
                <td data-col="tag" title={t.tag}>
                  <button type="button" className="tag-rank-table__name">{t.tag}</button>
                </td>
                <td data-col="count">{t.count}</td>
                <td data-col="local_lift">{formatLift(t.local_lift)}</td>
                <td data-col="power_score">{t.power_score.toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {/* 두 파생 지표는 이름만으로 알 수 없으므로 산식을 표 바로 아래에 둔다.
          머리글 hover 와 같은 내용이지만 터치 기기에는 hover 가 없다. */}
      <ul className="tag-rank-table__legend">
        <li><b>상위권 집중도</b> 상위 100위에서의 등장 비율 ÷ 100위 밖에서의 등장 비율. 1.0이면 고르게, 클수록 상위권에 몰려 있음 (5편 미만은 —)</li>
        <li><b>인기 점수</b> 태그가 달린 작품마다 1/ln(순위+1)을 더한 값. 상위권이 더 크게 반영되되 1위와 500위 차이는 약 9배. <b>태그 순위가 이 점수 순</b></li>
      </ul>
    </PanelCard>
  );

  return (
    <div className="page-shell tag-rankings-page">
      <PageHero
        title="태그 랭킹"
      />

      <div className="tag-ranking-control-bar">
        <div className="tag-ranking-control-bar__item">
          <span className="tag-ranking-control-bar__label">날짜</span>
          <CalendarPicker selectedDate={date} onDateChange={handleDateChange} availableDates={availableDatesSet} />
        </div>
        <div className="tag-ranking-control-bar__search">
          <span className="tag-ranking-control-bar__label">검색</span>
          <TagSearchControl onSearchChange={handleSearchChange} />
        </div>
      </div>

      {loading && <div className="text-center py-5"><Spinner animation="border" /></div>}
      {error && <div className="page-banner-inner mt-3"><Alert variant="danger">{error}</Alert></div>}

      {!loading && !error && (
        tags.length > 0 ? (
          <>
            {/* 검색 결과: 분류·지도와 별개로, 찾는 태그를 바로 짚는 용도 */}
            {searchResults && (
              <PanelCard
                title="검색 결과"
                meta={searchResults.length > 0 ? `${searchResults.length}개` : '일치하는 태그 없음'}
                className="tag-search-results"
              >
                {searchResults.length > 0 && (
                  <div className="tag-zone-card__chips">
                    {searchResults.map(t => renderTagChip(t))}
                  </div>
                )}
              </PanelCard>
            )}

            {/* 오늘의 브리핑 — 4분면 대표 하나씩 */}
            {briefing && (
              <section className="tag-briefing" aria-label="오늘의 태그 브리핑">
                {(['mainstream', 'gem', 'saturated', 'cold'] as const).map(key => {
                  const item = briefing[key];
                  const label = ZONES[key].label;
                  return item && (
                  <button
                    type="button"
                    key={key}
                    className={`tag-brief-card tag-brief-card--${key} ${item.tag === selectedTag ? 'is-active' : ''}`.trim()}
                    onClick={() => handleTagSelect(item.tag)}
                    onMouseEnter={() => setHoveredTag(item.tag)}
                    onMouseLeave={() => setHoveredTag(null)}
                  >
                    <span className="tag-brief-card__label">
                      <i className={`tag-zone-dot tag-zone-dot--${key}`} />{label}
                    </span>
                    <span className="tag-brief-card__name">{item.tag}</span>
                    <span className="tag-brief-card__meta">{item.count}작품 · 집중도 {formatLift(item.local_lift)}</span>
                  </button>
                  );
                })}
              </section>
            )}

            {/* 선택된 태그 지표 — 브리핑 4장 바로 아래다.
                브리핑 카드를 누르면 그 태그의 추이가 **바로 다음 자리**에 열려야 한다.
                표(690px) 아래에 두었을 때는 카드를 눌러도 화면에 변화가 없어 보였다.
                지도·칩·표에서 열 때 화면을 벗어나는 문제는 위치가 아니라
                `scrollIntoView({ block: 'nearest' })` 가 맡는다 — 이미 보이면
                스크롤하지 않으므로 어느 경로에서 열어도 어색하지 않다. */}
            {selectedTagData && (
              <section ref={selectedPanelRef} className={`selected-tag-panel selected-tag-panel--${selectedTone}`}>
                <div className="selected-tag-panel__header">
                  <div>
                    <div className="selected-tag-panel__eyebrow">
                      선택한 태그{selectedTagData.zone ? ` · ${ZONES[selectedTagData.zone].label}` : ''}
                    </div>
                    <h2 className="selected-tag-panel__title">{selectedTagData.tag}</h2>
                  </div>
                  <button type="button" className="selected-tag-panel__close" onClick={() => setSelectedTag(null)} aria-label="선택 해제">×</button>
                </div>
                {selectedHistory ? (
                  <>
                    {/* 이 패널의 모든 수치는 아래 차트와 같은 구간을 쓴다. 기준을 적지 않으면
                        차트는 14일인데 위 수치는 무슨 기준인지 알 수 없다. 실제 수집일이
                        빠질 수 있으므로 '14일'이 아니라 응답이 준 첫 날짜를 그대로 쓴다. */}
                    <p className="selected-tag-panel__basis">
                      {formatMonthDay(selectedHistory[0].date)} ~ {formatMonthDay(selectedHistory[selectedHistory.length - 1].date)}
                      {' · '}수집일 {selectedHistory.length}일
                    </p>
                    <div className="selected-tag-panel__metrics">
                      <span title={METRIC_HINTS.Rank}>순위<strong>{selectedHistory[0].rank}위<i className="mv-arrow" aria-hidden="true" />{selectedHistory[selectedHistory.length - 1].rank}위</strong></span>
                      <span title={METRIC_HINTS.count}>등장<strong>{selectedHistory[0].count}작품<i className="mv-arrow" aria-hidden="true" />{selectedHistory[selectedHistory.length - 1].count}작품</strong></span>
                      <span title={METRIC_HINTS.local_lift}>상위권 집중도<strong>{formatLift(selectedHistory[0].lift)}<i className="mv-arrow" aria-hidden="true" />{formatLift(selectedHistory[selectedHistory.length - 1].lift)}</strong></span>
                      <span title={METRIC_HINTS.power_score}>인기 점수<strong>{selectedHistory[0].score.toFixed(2)}<i className="mv-arrow" aria-hidden="true" />{selectedHistory[selectedHistory.length - 1].score.toFixed(2)}</strong></span>
                    </div>
                    <TagRankChart points={selectedHistory} />
                  </>
                ) : (
                  /* 추이를 아직 못 받았거나 그날 없던 태그. 오늘 값만 보여주되 여기서도
                     기준을 밝힌다 — 위와 아래가 다른 기준이라는 걸 사용자가 알아야 한다. */
                  <>
                    <p className="selected-tag-panel__basis">
                      {date ? format(date, 'M월 d일') : '오늘'} 기준
                    </p>
                    <div className="selected-tag-panel__metrics">
                      <span title={METRIC_HINTS.Rank}>순위<strong>{selectedTagData.Rank}위</strong></span>
                      <span title={METRIC_HINTS.count}>등장<strong>{selectedTagData.count}작품</strong></span>
                      <span title={METRIC_HINTS.local_lift}>상위권 집중도<strong>{formatLift(selectedTagData.local_lift)}</strong></span>
                      <span title={METRIC_HINTS.power_score}>인기 점수<strong>{selectedTagData.power_score.toFixed(2)}</strong></span>
                    </div>
                  </>
                )}
              </section>
            )}

            {/* 전체 순위표는 지도보다 위다. 페이지 이름이 '태그 랭킹'이므로
                첫 화면 근처에 1위가 있어야 한다. 지도는 그 다음 '왜 그런가'를 맡는다. */}
            {rankingTable}

            {hasLift ? (
              <>
                {/* 태그 지형 지도 */}
                <PanelCard
                  title="태그 지형 지도"
                  meta={`${date ? format(date, 'yyyy.MM.dd') : '-'} · 태그 ${classified.length}개${noLiftCount ? ` (등장 5작품 미만 ${noLiftCount}개 제외)` : ''}`}
                  className="tag-quadrant-card"
                >
                  <div className="tag-ranking-chart-area tag-ranking-chart-area--bubble">
                    <ResponsiveContainer width="100%" height="100%">
                      <ScatterChart margin={{ top: 40, right: 26, bottom: 34, left: 8 }}>
                        <CartesianGrid stroke="var(--np-border-subtle)" strokeDasharray="3 3" />
                        {/* 4분면 배경. 경계가 곧 분류 기준이라 지도만 봐도 분류가 읽힌다. */}
                        <ReferenceArea x1={countDomain[0]} x2={mainstreamCut} y1={LIFT_MID} y2={LIFT_AXIS_MAX} fill="var(--np-chart-3)" fillOpacity={0.05} ifOverflow="hidden"
                          label={{ value: '숨은 강자', position: 'insideTopLeft', dy: 18, dx: 6, className: 'tag-quadrant-zone-name tag-quadrant-zone-name--gem' }} />
                        <ReferenceArea x1={mainstreamCut} x2={countDomain[1]} y1={LIFT_MID} y2={LIFT_AXIS_MAX} fill="var(--np-accent)" fillOpacity={0.05} ifOverflow="hidden"
                          label={{ value: '오늘의 대세', position: 'insideTopRight', dy: 18, dx: -6, className: 'tag-quadrant-zone-name tag-quadrant-zone-name--mainstream' }} />
                        <ReferenceArea x1={countDomain[0]} x2={mainstreamCut} y1={LIFT_AXIS_MIN} y2={LIFT_MID} fill="var(--np-text-secondary)" fillOpacity={0.04} ifOverflow="hidden"
                          label={{ value: '오늘 약세', position: 'insideBottomLeft', dy: -6, dx: 6, className: 'tag-quadrant-zone-name tag-quadrant-zone-name--cold' }} />
                        <ReferenceArea x1={mainstreamCut} x2={countDomain[1]} y1={LIFT_AXIS_MIN} y2={LIFT_MID} fill="var(--np-warning)" fillOpacity={0.05} ifOverflow="hidden"
                          label={{ value: '과포화', position: 'insideBottomRight', dy: -6, dx: -6, className: 'tag-quadrant-zone-name tag-quadrant-zone-name--saturated' }} />
                        <XAxis
                          type="number"
                          dataKey="count"
                          name="등장 작품 수"
                          scale="log"
                          domain={countDomain}
                          stroke="var(--np-text-secondary)"
                          tick={{ fontSize: 11, fill: 'var(--np-text-secondary)' }}
                          tickLine={false}
                          ticks={[5, 10, 20, 50, 100, 200]}
                        >
                          <Label value="등장 작품 수 (로그 축)" position="insideBottom" offset={-18} style={{ fontSize: 11, fill: 'var(--np-text-secondary)' }} />
                        </XAxis>
                        <YAxis
                          type="number"
                          dataKey="liftPlotted"
                          name="상위권 집중도"
                          /* 집중도는 0~3에 몰리고 소수 이상치만 10+라 제곱근 축.
                             로그는 0(상위 100위 미등장)을 그릴 수 없다. */
                          domain={[LIFT_AXIS_MIN, LIFT_AXIS_MAX]}
                          ticks={LIFT_TICKS.map(Math.sqrt)}
                          tickFormatter={(v: number) => String(Math.round(v * v * 10) / 10)}
                          allowDataOverflow
                          stroke="var(--np-text-secondary)"
                          tick={{ fontSize: 11, fill: 'var(--np-text-secondary)' }}
                          tickLine={false}
                        >
                          <Label value="↑ 상위권 집중도" position="insideTopLeft" offset={-22} style={{ fontSize: 11, fill: 'var(--np-text-secondary)' }} />
                        </YAxis>
                        <ReferenceLine y={LIFT_MID} stroke="var(--np-text-secondary)" strokeDasharray="4 4" strokeOpacity={0.55} />
                        <ReferenceLine x={mainstreamCut} stroke="var(--np-text-secondary)" strokeDasharray="4 4" strokeOpacity={0.55} />
                        <ZAxis type="number" dataKey="power_score" range={[90, 950]} name="인기 점수" />
                        <RechartsTooltip content={<QuadrantTooltip />} cursor={{ strokeDasharray: '3 3' }} isAnimationActive={false} />
                        <Scatter data={chartData} isAnimationActive={false} shape={quadrantShape} />
                      </ScatterChart>
                    </ResponsiveContainer>
                  </div>
                  {/* 각주는 축 두 개와 원 크기, 그리고 '왜 어떤 원에만 이름이 있나'만
                      남긴다. 주류 기준선·클램프 규칙은 지도를 읽는 데 필요 없고,
                      제외된 태그 수는 위 헤더로 옮겼다. */}
                  <ul className="tag-quadrant-footnote">
                    <li><b>가로</b> 그 태그를 단 작품이 몇 개인지</li>
                    <li><b>세로</b> 그중 상위 100위에 얼마나 몰렸는지 (1.0이면 순위와 무관)</li>
                    <li><b>원 크기</b> 인기 점수</li>
                    <li><b>이름</b> 눈에 띄는 태그에만. 나머지는 원에 커서를 올리면 나옵니다</li>
                  </ul>
                </PanelCard>

                {/* 4분면 상세 — 지도의 각 구역을 목록으로 */}
                <div className="tag-zone-grid">
                  {ZONE_PANEL_ORDER.map(zoneKey => {
                    const list = zoneLists[zoneKey];
                    const expanded = expandedZones.has(zoneKey);
                    const shown = expanded ? list : list.slice(0, ZONE_PREVIEW);
                    return (
                      <PanelCard
                        key={zoneKey}
                        title={<span className="tag-zone-card__title"><i className={`tag-zone-dot tag-zone-dot--${zoneKey}`} />{ZONES[zoneKey].label}</span>}
                        meta={`${ZONES[zoneKey].desc} · ${list.length}개`}
                        className={`tag-zone-card tag-zone-card--${zoneKey}`}
                      >
                        {list.length > 0 ? (
                          <>
                            <div className="tag-zone-card__chips">
                              {shown.map(t => renderTagChip(t, zoneKey))}
                            </div>
                            {list.length > ZONE_PREVIEW && (
                              <button type="button" className="tag-zone-card__more" onClick={() => toggleZoneExpand(zoneKey)}>
                                {expanded ? '접기' : `+${list.length - ZONE_PREVIEW}개 더 보기`}
                              </button>
                            )}
                          </>
                        ) : (
                          <p className="tag-zone-card__empty">이 구역에 해당하는 태그가 없습니다.</p>
                        )}
                      </PanelCard>
                    );
                  })}
                </div>
              </>
            ) : (
              /* 구 수집분(상위 100 통계 이전)은 집중도가 없어 지형 분류가 불가능하다.
                 인기 점수 상위만 보여주고 이유를 밝힌다. */
              <PanelCard
                title="인기 태그"
                meta="상위권 집중도 통계 도입 이전 수집분이라 인기 점수 순으로만 표시"
                className="tag-legacy-card"
              >
                <div className="tag-zone-card__chips">
                  {[...tags].sort((a, b) => b.power_score - a.power_score).slice(0, 40).map(t => renderTagChip(t))}
                </div>
              </PanelCard>
            )}

            {/* 전날 대비 움직임 */}
            {(risers.length > 0 || fallers.length > 0 || newcomers.length > 0) && (
              <div className="tag-mover-grid">
                <PanelCard title="오늘 뜬 태그" meta="전날 대비 순위 상승" className="tag-mover-card">
                  <ol className="tag-mover-list">
                    {risers.map(t => (
                      <li key={t.tag}>
                        <button type="button" className={`tag-mover-item ${t.tag === selectedTag ? 'is-active' : ''}`} onClick={() => handleTagSelect(t.tag)}>
                          <span className="tag-mover-item__name">{t.tag}</span>
                          <span className="tag-mover-item__delta tag-mover-item__delta--up">▲{t.rank_change}</span>
                        </button>
                      </li>
                    ))}
                    {risers.length === 0 && <li className="tag-mover-empty">오늘은 없습니다</li>}
                  </ol>
                </PanelCard>
                <PanelCard title="오늘 식은 태그" meta="전날 대비 순위 하락" className="tag-mover-card">
                  <ol className="tag-mover-list">
                    {fallers.map(t => (
                      <li key={t.tag}>
                        <button type="button" className={`tag-mover-item ${t.tag === selectedTag ? 'is-active' : ''}`} onClick={() => handleTagSelect(t.tag)}>
                          <span className="tag-mover-item__name">{t.tag}</span>
                          <span className="tag-mover-item__delta tag-mover-item__delta--down">▼{Math.abs(t.rank_change)}</span>
                        </button>
                      </li>
                    ))}
                    {fallers.length === 0 && <li className="tag-mover-empty">오늘은 없습니다</li>}
                  </ol>
                </PanelCard>
                <PanelCard title="새로 진입" meta="전날 집계에 없던 태그" className="tag-mover-card">
                  <ol className="tag-mover-list">
                    {newcomers.map(t => (
                      <li key={t.tag}>
                        <button type="button" className={`tag-mover-item ${t.tag === selectedTag ? 'is-active' : ''}`} onClick={() => handleTagSelect(t.tag)}>
                          <span className="tag-mover-item__name">{t.tag}</span>
                          <span className="tag-mover-item__delta tag-mover-item__delta--new">NEW</span>
                        </button>
                      </li>
                    ))}
                    {newcomers.length === 0 && <li className="tag-mover-empty">오늘은 없습니다</li>}
                  </ol>
                </PanelCard>
              </div>
            )}
          </>
        ) : (
          <div className="page-banner-inner mt-3">
            <Alert variant="info" className="text-center">해당 날짜에 대한 태그 랭킹 데이터가 없습니다.</Alert>
          </div>
        )
      )}
    </div>
  );
};

export default TagRankingsPage;
