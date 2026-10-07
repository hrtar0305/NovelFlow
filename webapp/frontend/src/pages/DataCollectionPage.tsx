import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { getAvailableDates } from '../services/api';
import PageTitle from '../components/ui/PageTitle';
import { formatDateDot, formatInt } from '../utils/format';

/**
 * 수집 및 랭킹 기준 — 읽는 문서다(2026-09-29 개편).
 *
 * 이 사이트 숫자의 출처·뜻·한계를 사용자에게 밝히는 페이지다. 수집 파이프라인의 내부
 * (요청 방식, 저장 전 검사, AWS 구성, 운영비)는 사용자에게 필요 없어 GitHub 문서
 * (docs/ARCHITECTURE.md)에만 둔다.
 *
 * 접는 UI는 쓰지 않는다 — 공개가 목적인 페이지가 내용을 클릭 뒤에 숨기면 앞뒤가 맞지 않는다.
 * 수집 실적은 문장 대신 기록 자체(하루 한 칸, 빠진 날은 빈칸)로 보이고 /api/dates 에서
 * 매번 계산해 숫자가 낡지 않게 한다.
 */

const COLLECTION_START = '2024-12-23';
const RANKING_URL = 'https://novelpia.com/top100/all/weekly/view/all/all/';

type CollectionRecord = {
  days: { date: string; collected: boolean }[];
  collected: number;
  total: number;
  missing: string[];
  latest: string;
};

const buildRecord = (available: string[]): CollectionRecord | null => {
  if (available.length === 0) return null;
  const have = new Set(available);
  const latest = [...available].sort().at(-1)!;
  const days: { date: string; collected: boolean }[] = [];
  const missing: string[] = [];
  const cursor = new Date(`${COLLECTION_START}T00:00:00Z`);
  const end = new Date(`${latest}T00:00:00Z`);
  while (cursor <= end) {
    const iso = cursor.toISOString().slice(0, 10);
    const collected = have.has(iso);
    days.push({ date: iso, collected });
    if (!collected) missing.push(iso);
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return { days, collected: days.length - missing.length, total: days.length, missing, latest };
};

const koDate = (iso: string) => { const [y, m, d] = iso.split('-').map(Number); return `${y}년 ${m}월 ${d}일`; };

/**
 * 하루 한 칸. 연속된 날은 한 덩어리로 합쳐 그린다(610여 칸을 하나씩 그리면 비정수 배율에서
 * 굵기가 들쭉날쭉해진다). 빠진 날은 하루라도 보이도록 최소 폭을 준다.
 */
const RecordStrip = ({ record }: { record: CollectionRecord }) => {
  const W = 1000;
  const H = 28;
  const step = W / record.days.length;
  const runs = useMemo(() => {
    const acc: { start: number; len: number; collected: boolean }[] = [];
    record.days.forEach(d => {
      const last = acc.at(-1);
      if (last && last.collected === d.collected) last.len += 1;
      else acc.push({ start: last ? last.start + last.len : 0, len: 1, collected: d.collected });
    });
    return acc;
  }, [record.days]);

  return (
    <figure className="doc-record">
      <svg className="doc-record__strip" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img"
        aria-label={`${koDate(COLLECTION_START)}부터 ${koDate(record.latest)}까지 ${record.total}일 중 ${record.collected}일 수집, ${record.missing.length}일 빠짐`}>
        {runs.map(r => (
          <rect key={r.start} x={r.start * step} y={0} height={H}
            width={r.collected ? r.len * step : Math.max(r.len * step, 2.4)}
            className={r.collected ? 'doc-record__day' : 'doc-record__gap'} />
        ))}
      </svg>
      <figcaption className="doc-record__caption">
        <span>{formatDateDot(COLLECTION_START)}</span>
        <span>{formatDateDot(record.latest)}</span>
      </figcaption>
      <p className="doc-record__missing">
        빠진 날 {record.missing.length > 0 ? record.missing.map(formatDateDot).join(' · ') : '없음'}
      </p>
    </figure>
  );
};

/** 용어와 뜻. 넓은 화면에서는 두 칸, 좁은 화면에서는 위아래로. */
const Term = ({ term, children }: { term: string; children: ReactNode }) => (
  <>
    <dt>{term}</dt>
    <dd>{children}</dd>
  </>
);

const DataCollectionPage = () => {
  const [available, setAvailable] = useState<string[]>([]);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    getAvailableDates()
      .then(r => setAvailable(r.data.available_dates || []))
      .catch(() => setFailed(true));
  }, []);

  const record = useMemo(() => buildRecord(available), [available]);

  return (
    <div className="page-shell doc-page">
      <PageTitle
        title="수집 및 랭킹 기준"
        meta={record
          ? `${koDate(COLLECTION_START)}부터 매일 · ${formatInt(record.total)}일 중 ${formatInt(record.collected)}일 수집`
          : failed ? '수집 기록을 불러오지 못했습니다.' : '수집 기록을 불러오는 중'}
      />

      {record ? <RecordStrip record={record} /> : null}

      <section className="doc-sec">
        <h2>무엇을 모으나</h2>
        <p>
          노벨피아 <a href={RANKING_URL} target="_blank" rel="noopener noreferrer">7일 조회순 전체 랭킹</a>을
          매일 밤 9시(한국 시간)에 한 번 저장합니다. 랭킹 페이지에서 '더 보기'로 볼 수 있는 순위를 500위까지 저장합니다.
          2025년 7월 20일까지는 300위까지만 모았습니다.
        </p>
        <p>
          작품마다 상세 페이지를 한 번씩 더 읽어 조회수, 추천, 선호, 회차 수, 태그, 줄거리, 연재 상태를 함께 남깁니다.
          작품 본문은 읽지 않습니다.
        </p>
        <p>
          로그인한 상태로 읽습니다. 로그인하지 않으면 성인 등급 작품이 랭킹에서 빠지고 그 자리를 다른 작품이 채워,
          노벨피아가 매긴 순위와 목록의 4분의 1가량이 달라집니다.
        </p>
      </section>

      <section className="doc-sec">
        <h2>숫자 읽는 법</h2>
        <dl className="doc-terms">
          <Term term="점수">노벨피아 7일 조회순 랭킹의 점수입니다. 목록에 1.2K처럼 줄여 표시된 값을 되돌린 것이라 끝자리는 원래 없습니다.</Term>
          <Term term="조회수">작품 페이지의 누적 조회수입니다. 두 날짜 사이의 차이는 누적이 늘어난 양이지 그날 하루의 조회수가 아닙니다.</Term>
          <Term term="순위 변동">하루 전 목록의 같은 작품과 비교합니다. 하루 전 목록에 없으면 NEW입니다. 신작, 다시 들어온 작품, 전날 수집이 빠진 날의 작품이 모두 NEW로 보입니다.</Term>
          <Term term="추천비">추천 수 ÷ 누적 조회수입니다.</Term>
          <Term term="초반 잔류">
            30화 조회수 ÷ 1화 조회수입니다. 프롤로그가 있으면 프롤로그를 1화로 칩니다. 회차가 30개에 못 미치면 계산하지 않고 –로 둡니다.
            흔히 쓰는 연독률과는 다른 값입니다.
          </Term>
          <Term term="최신 잔류">
            최신화 조회수 ÷ 30화 전 회차의 조회수입니다. 최신화는 그날 올라온 회차를 빼고, 올린 날짜가 표시된 회차 중
            가장 최근 것입니다. 갓 올라온 회차는 조회수가 덜 쌓였기 때문입니다. 흔히 쓰는 연독률과는 다른 값입니다.
          </Term>
          <Term term="연재 상태">그날 작품 페이지에 붙어 있던 배지입니다. 연재중, 완결, 연재지연, 연재중단으로 나뉩니다. 2026년 9월 5일 랭킹부터 기록돼 있습니다.</Term>
          <Term term="인기 점수">태그 랭킹의 순서 기준입니다. 그날 순위 작품이 받은 랭킹 점수 가운데 그 태그가 달린 작품들이 차지하는 몫(%)이라, 노벨피아 점수가 큰 상위 작품일수록 크게 반영됩니다. 한 작품에 태그가 여럿이라 태그끼리 더하면 100%를 넘습니다.</Term>
        </dl>
      </section>

      <section className="doc-sec">
        <h2>공모전은 기준이 다릅니다</h2>
        <div className="doc-table-wrap">
          <table className="doc-table doc-table--compare">
            <thead>
              <tr><th scope="col"><span className="visually-hidden">항목</span></th><th scope="col">일간 랭킹</th><th scope="col">공모전</th></tr>
            </thead>
            <tbody>
              <tr><th scope="row">저장 시각</th><td data-label="일간 랭킹">매일 밤 9시</td><td data-label="공모전">2026: 매일 자정(그날 0~24시) · 2025: 매일 오후 2시</td></tr>
              <tr><th scope="row">대상</th><td data-label="일간 랭킹">7일 조회순 전체 랭킹</td><td data-label="공모전">공모전 참여 작품</td></tr>
              <tr><th scope="row">로그인</th><td data-label="일간 랭킹">함</td><td data-label="공모전">하지 않음</td></tr>
              <tr><th scope="row">작품 수</th><td data-label="일간 랭킹">500편 (2025년 7월 20일까지 300편)</td><td data-label="공모전">공모전 참여 전체 작품</td></tr>
              <tr><th scope="row">순위</th><td data-label="일간 랭킹">노벨피아 순위 그대로</td><td data-label="공모전">2026: 전날보다 늘어난 누적 조회수 순(일간 순위). 전날 이후 등록된 작품은 누적 조회수 전체가 그날 증가분이고, 전날 값을 알 수 없는 작품(잠시 비공개였던 작품 등)은 그날 순위에서 뺍니다 · 2025: 누적 조회수 순. 모두 여기서 매김</td></tr>
              <tr><th scope="row">태그 점수</th><td data-label="일간 랭킹">인기 점수(랭킹 점수 점유율) · 100위 안 작품 수</td><td data-label="공모전">2026: 일간 순위 기준으로 같은 방식(인기 점수는 그날 늘어난 조회수의 점유율) · 2025: 누적 순위 기준 선형·역순위·로그 점수</td></tr>
              <tr><th scope="row">잔류율 회차</th><td data-label="일간 랭킹">그날 올라온 회차를 뺌</td><td data-label="공모전">2026: 자정에 모으므로 전날 올라온 회차까지 뺌(최신화가 늘 하루 넘게 지난 회차)</td></tr>
              <tr><th scope="row">비교하는 전날</th><td data-label="일간 랭킹">달력 기준 하루 전</td><td data-label="공모전">실제로 수집한 직전 날</td></tr>
              <tr><th scope="row">수집 시작</th><td data-label="일간 랭킹">2024년 12월 23일</td><td data-label="공모전">2026: 2026년 10월 1일(개막일) · 2025: 2025년 10월 2일</td></tr>
            </tbody>
          </table>
        </div>
      </section>

      <section className="doc-sec">
        <h2>주의할 점</h2>
        <ul className="doc-list">
          <li>7일 동안 쌓인 조회로 매긴 순위입니다. 어제 하루 잘 나온 작품이 바로 올라오지는 않습니다.</li>
          <li>노벨피아의 다른 순위는 조회수 말고도 다른 요소를 반영하는 별개의 집계라, 여기 순위와 다를 수 있습니다.</li>
          <li>밤 9시 한 시점의 순위라 다른 시각에 노벨피아에서 본 순위와 다를 수 있습니다.</li>
          <li>수집이 빠진 날은 위 기록의 빈칸입니다. 그다음 날은 비교할 전날이 없어 순위 변동이 모두 NEW로 보입니다.</li>
          <li>삭제되거나 비공개로 바뀐 작품은 상세를 읽을 수 없어, 순위 자리는 지키되 제목을 'N/A'로 두고 조회수와 회차 수는 0으로 남깁니다.</li>
          <li>작품 상세의 순위 추이에서 순위권 밖이었던 날은 선이 끊겨 보입니다.</li>
        </ul>
      </section>

      <section className="doc-sec doc-sec--last">
        <h2>출처와 권리</h2>
        <p>
          모든 원본 데이터의 출처는 노벨피아입니다. 작품 제목, 줄거리, 표지, 태그의 권리는 노벨피아와 각 작가에게 있습니다.
          작품 본문은 수집하지도 다시 배포하지도 않고, 광고나 유료 기능이 없는 비영리 사이트입니다.
        </p>
        <p>
          노벨피아에는 정해진 시각에만 접속하고, 이 사이트를 열 때는 저장해 둔 기록만 보여 줍니다.
          표지 이미지는 복제하지 않고 노벨피아 주소를 그대로 불러옵니다. 권리자의 요청은{' '}
          <a href="https://github.com/hrtar0305/NovelFlow/issues" target="_blank" rel="noopener noreferrer">GitHub 이슈</a>로 받습니다.
        </p>
      </section>
    </div>
  );
};

export default DataCollectionPage;
