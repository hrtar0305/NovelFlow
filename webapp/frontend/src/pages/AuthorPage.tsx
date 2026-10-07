import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { getAuthorNovels, getAvailableDates } from '../services/api';
import PageTitle from '../components/ui/PageTitle';
import TagLinks from '../components/ui/TagLinks';
import NovelCover from '../components/NovelCover';
import RankTable, { type RankColumn } from '../components/ranking/RankTable';
import { formatDateKo, formatInt, formatMan } from '../utils/format';

/**
 * 작가(2026-09-30 개편). 포스터 2열 격자와 카드 안 태그 칩 대신 일간 표와 같은 행 —
 * 표지 · 제목 · 회차 · 조회 · 선호 · 오늘 순위 · 태그(텍스트 링크).
 * 작품마다 가진 값은 그 작품의 마지막 기록(Date)이다. 마지막 기록이 최신 수집일이 아니면
 * 오늘 순위 대신 '순위 밖'과 마지막 기록을 적는다.
 */

interface AuthorNovel {
  ID: string;
  Date: string;
  Ranking: number | null;
  Title: string;
  AuthorName: string;
  Eps: number;
  View: number;
  Fav: number;
  Tags: string[];
  ThumbnailURL?: string | null;
}

type SortKey = 'rank' | 'Eps' | 'View' | 'Fav';
type Sort = { key: SortKey; direction: 'ascending' | 'descending' };

export default function AuthorPage() {
  const { authorId } = useParams<{ authorId: string }>();
  const [novels, setNovels] = useState<AuthorNovel[] | null>(null);
  const [latest, setLatest] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sort, setSort] = useState<Sort>({ key: 'View', direction: 'descending' });

  useEffect(() => {
    getAvailableDates()
      .then(r => setLatest([...(r.data.available_dates as string[] ?? [])].sort().at(-1) ?? null))
      .catch(() => setLatest(null));
  }, []);

  useEffect(() => {
    if (!authorId) return;
    let cancelled = false;
    setNovels(null);
    setError(null);
    getAuthorNovels(authorId)
      .then(r => { if (!cancelled) setNovels(Array.isArray(r.data) ? r.data : []); })
      .catch((err: { response?: { status?: number } }) => {
        if (cancelled) return;
        if (err.response?.status === 404) setNovels([]);
        else setError('작품 목록을 불러오지 못했습니다.');
      });
    return () => { cancelled = true; };
  }, [authorId]);

  const todayRank = useCallback((n: AuthorNovel) => (latest && n.Date === latest && n.Ranking != null ? n.Ranking : null), [latest]);

  const rows = useMemo(() => {
    const list = [...(novels ?? [])];
    const v = (n: AuthorNovel) => (sort.key === 'rank' ? todayRank(n) : n[sort.key]);
    const sign = sort.direction === 'ascending' ? 1 : -1;
    // 값 없는 행(오늘 순위 밖)은 방향과 무관하게 끝. 동점은 조회 많은 순.
    return list.sort((a, b) => {
      const va = v(a);
      const vb = v(b);
      if (va == null && vb == null) return b.View - a.View;
      if (va == null) return 1;
      if (vb == null) return -1;
      return va !== vb ? (va - vb) * sign : b.View - a.View;
    });
  }, [novels, sort, todayRank]);

  const onSort = (key: string) => setSort(s => (s.key === key
    ? { key: s.key, direction: s.direction === 'ascending' ? 'descending' : 'ascending' }
    : { key: key as SortKey, direction: key === 'rank' ? 'ascending' : 'descending' }));
  const strongIf = (key: SortKey, v: ReactNode) => (sort.key === key ? <b className="rank-strong">{v}</b> : v);

  const rankCell = (n: AuthorNovel) => {
    const r = todayRank(n);
    if (r != null) return strongIf('rank', `${formatInt(r)}위`);
    return (
      <span className="author-out" title={n.Ranking != null ? `마지막 기록 ${formatDateKo(n.Date)} ${n.Ranking}위` : undefined}>
        순위 밖<small>{formatDateKo(n.Date)}{n.Ranking != null ? ` ${formatInt(n.Ranking)}위` : ''}</small>
      </span>
    );
  };
  const tagHref = (t: string) => `/novels/rankings?tag=${encodeURIComponent(t)}`;

  const columns: RankColumn<AuthorNovel>[] = [
    { key: 'title', header: '제목', width: 'minmax(0,1fr)',
      render: n => (
        <span className="rank-titlecell">
          <span className="rank-cover"><NovelCover url={n.ThumbnailURL} title={n.Title} imageClassName="rank-cover__img" /></span>
          <Link to={`/novels/${n.ID}`} className="rank-title">{n.Title || '(제목 없음)'}</Link>
        </span>
      ) },
    { key: 'eps', header: '회차', width: '64px', sortKey: 'Eps', render: n => strongIf('Eps', formatInt(n.Eps)) },
    { key: 'view', header: '조회', width: '80px', sortKey: 'View', render: n => strongIf('View', formatMan(n.View)) },
    { key: 'fav', header: '선호', width: '72px', sortKey: 'Fav', render: n => strongIf('Fav', formatInt(n.Fav)) },
    { key: 'rank', header: '오늘 순위', width: '96px', sortKey: 'rank', render: rankCell },
    { key: 'tags', header: '태그', width: 'minmax(0,1fr)', render: n => <TagLinks tags={n.Tags ?? []} hrefFor={tagHref} /> },
  ];

  const mobileRow = (n: AuthorNovel) => (
    <div className="rank-mrow rank-mrow--author">
      <span className="rank-cover"><NovelCover url={n.ThumbnailURL} title={n.Title} imageClassName="rank-cover__img" /></span>
      <div className="rank-mrow__main">
        <Link to={`/novels/${n.ID}`} className="rank-title rank-title--wrap">{n.Title || '(제목 없음)'}</Link>
        <p>{formatInt(n.Eps)}화 · 조회 <b>{formatMan(n.View)}</b> · 선호 {formatInt(n.Fav)} · {todayRank(n) != null ? <b>오늘 {todayRank(n)}위</b> : '순위 밖'}</p>
        <TagLinks tags={n.Tags ?? []} hrefFor={tagHref} />
      </div>
    </div>
  );

  const name = novels?.[0]?.AuthorName;
  const totalView = (novels ?? []).reduce((s, n) => s + (n.View || 0), 0);
  const ranked = (novels ?? []).filter(n => todayRank(n) != null).length;

  return (
    <div className="page-shell author-page">
      <PageTitle title={name || '작가'}
        meta={novels && novels.length > 0
          ? `랭킹에 든 작품 ${formatInt(novels.length)}편 · 총 조회 ${formatMan(totalView)}${ranked ? ` · 오늘 순위에 ${ranked}편` : ''}`
          : undefined} />

      {error ? <p className="empty-line">{error} <button type="button" className="link-button" onClick={() => window.location.reload()}>다시 시도</button></p>
        : novels == null ? <div className="rank-skeleton" aria-busy="true">{Array.from({ length: 4 }, (_, i) => <div key={i} />)}</div>
        : (
          <div className="author-table">
            <RankTable ariaLabel="작가의 작품" rows={rows} rowKey={n => n.ID} columns={columns} rowHeight={84} compactBelow={900}
              sort={sort} onSort={onSort} renderMobileRow={mobileRow}
              emptyText="이 작가의 작품이 랭킹에 든 기록이 없습니다." />
          </div>
        )}
    </div>
  );
}
