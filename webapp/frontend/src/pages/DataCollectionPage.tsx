import { useEffect, useMemo, useState } from 'react';
import { getAvailableDates } from '../services/api';

/**
 * 데이터 수집 및 랭킹 기준.
 *
 * 이 페이지의 일은 하나다 — **이 사이트 숫자의 출처와 한계를 밝히는 것**.
 * 그래서 설계 결정 두 가지가 나머지를 지배한다.
 *
 * 1) 접는 UI를 쓰지 않는다. 공개가 목적인 페이지가 정작 그 내용을 클릭 뒤에
 *    숨기면 앞뒤가 맞지 않는다. 길어지더라도 전부 펼쳐 둔다.
 *
 * 2) 수집 실적은 문장이 아니라 **기록 자체**로 보여준다. 하루 한 칸씩 610개를
 *    그리고 빠진 날은 구멍으로 남긴다. "99.3%"라고 쓰는 것보다 정직하고,
 *    /api/dates에서 매번 계산하므로 **하드코딩된 숫자가 낡지 않는다**.
 *    이전 판이 "최대 1시간 지연", "약 38만 개" 같은 값을 오래 달고 있었던 것이
 *    바로 그 문제였다.
 *
 * 수치 표기 규칙: 측정값은 tabular 숫자로 고정폭 표기한다(계기 눈금의 관례).
 * 산문은 본문 서체 그대로 둔다.
 */

const COLLECTION_START = '2024-12-23';

type Record = {
  days: { date: string; collected: boolean }[];
  collected: number;
  total: number;
  missing: string[];
  latest: string | null;
};

const buildRecord = (available: string[]): Record | null => {
  if (available.length === 0) return null;
  const have = new Set(available);
  const sorted = [...available].sort();
  const latest = sorted[sorted.length - 1];

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

/**
 * 하루 한 칸. 빠진 날은 눈에 더 띄게 남긴다 — 가리는 것이 이 페이지의 목적에 반한다.
 *
 * 하루당 rect를 하나씩 그리면(610개, 한 칸 1.4px) 비정수 배율에서 굵기가 들쭉날쭉해져
 * 모아레가 생긴다. 연속된 날을 한 덩어리로 합쳐 면으로 그리고, 빠진 날만 구멍으로 뚫는다.
 * 결손일은 하루라도 보여야 하므로 최소 폭을 준다(정확한 날짜는 아래 목록에 적는다).
 */
const RecordStrip = ({ record }: { record: Record }) => {
  const { days } = record;
  const W = 1000;
  const H = 44;
  const step = W / days.length;

  const runs = useMemo(() => {
    const acc: { start: number; len: number; collected: boolean }[] = [];
    days.forEach(d => {
      const last = acc[acc.length - 1];
      if (last && last.collected === d.collected) last.len += 1;
      else acc.push({ start: acc.length ? acc[acc.length - 1].start + acc[acc.length - 1].len : 0, len: 1, collected: d.collected });
    });
    return acc;
  }, [days]);

  // 시작·끝 라벨과 겹치는 연도는 적지 않는다.
  const yearMarks = days
    .map((d, i) => ({ d, i }))
    .filter(({ d }) => d.date.endsWith('-01-01'))
    .map(({ d, i }) => ({ year: d.date.slice(0, 4), pct: (i / days.length) * 100 }))
    .filter(m => m.pct > 12 && m.pct < 88);

  return (
    <figure className="record">
      <svg
        className="record__strip"
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={`${COLLECTION_START}부터 ${record.latest}까지 ${record.total}일 중 ${record.collected}일 수집, ${record.missing.length}일 결손`}
      >
        {runs.map(r =>
          r.collected ? (
            <rect key={r.start} x={r.start * step} y={0} width={r.len * step} height={H} className="record__day" />
          ) : (
            <rect
              key={r.start}
              x={r.start * step}
              y={0}
              width={Math.max(r.len * step, 2.4)}
              height={H}
              className="record__gap"
            />
          ),
        )}
      </svg>
      <div className="record__axis">
        <span>{COLLECTION_START}</span>
        {yearMarks.map(m => (
          <span key={m.year} className="record__axis-year" style={{ left: `${m.pct}%` }}>
            {m.year}
          </span>
        ))}
        <span>{record.latest}</span>
      </div>
      <figcaption className="record__caption">
        <span className="record__stat">
          <b className="num">{record.collected}</b>일 수집
        </span>
        <span className="record__stat record__stat--miss">
          <b className="num">{record.missing.length}</b>일 결손
        </span>
        <span className="record__missing">
          {record.missing.length > 0 ? record.missing.join(' · ') : '없음'}
        </span>
      </figcaption>
    </figure>
  );
};

/** 라벨-값-주석 한 줄. 카드 대신 기록부 행으로 읽히게 한다. */
const Row = ({ label, value, children }: { label: string; value?: string; children: React.ReactNode }) => (
  <div className="ledger__row">
    <div className="ledger__label">{label}</div>
    <div className="ledger__body">
      {value && <div className="ledger__value num">{value}</div>}
      <p className="ledger__note">{children}</p>
    </div>
  </div>
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
    <div className="page-shell data-collection-page">
      <header className="dc-head">
        <p className="dc-head__eyebrow">수집 기록</p>
        <h1 className="dc-head__title">
          이 사이트의 숫자는<br />어디서 왔나
        </h1>
        <p className="dc-head__lede">
          노벨피아의 7일 조회순 랭킹을 매일 21시에 한 번 찍어 보관합니다.
          아래는 그 기록과, 이 숫자를 어디까지 믿을 수 있는지입니다.
        </p>
      </header>

      {record ? (
        <RecordStrip record={record} />
      ) : (
        <div className="record record--placeholder">
          {failed ? '수집 기록을 불러오지 못했습니다.' : '수집 기록을 불러오는 중'}
        </div>
      )}

      <section className="dc-section">
        <h2 className="dc-section__title">어디서, 어떻게</h2>
        <div className="ledger">
          <Row label="출처" value="7일 조회순 · 전체">
            <a className="dc-link" href="https://novelpia.com/top100/all/weekly/view/all/all/" target="_blank" rel="noopener noreferrer">
              노벨피아 랭킹 페이지
            </a>
            의 순위를 그대로 받아 적습니다. 공개 페이지에는 100위까지 보이지만 같은 랭킹을 500위까지 받아옵니다.
          </Row>
          <Row label="범위" value="Top 500">
            2025년 7월 20일까지는 300위까지만 모았습니다. 그 이전 날짜는 범위가 더 좁습니다.
          </Row>
          <Row label="시각" value="매일 21:00 KST">
            고정 스케줄이라 실행 시각이 흔들리지 않습니다. 500건을 다 읽는 데 2분 남짓 걸리고, 그 직후 사이트에 반영됩니다.
          </Row>
          <Row label="방법">
            랭킹 목록은 페이지를 훑는 것이 아니라, 같은 랭킹을 내려주는 노벨피아 내부 목록 요청을 한 번 호출해 500건을 한꺼번에 받습니다.
            작품별 상세는 그 목록의 작품 번호로 하나씩 더 읽습니다.
          </Row>
          <Row label="접속 상태" value="로그인 + 성인 모드">
            비로그인으로 받으면 성인 등급 작품이 랭킹에서 빠지고 그 자리를 다른 작품이 채웁니다.
            건수는 그대로 500건이라 수집은 성공한 것처럼 보이지만 목록의 4분의 1가량이 다른 작품으로 바뀝니다.
            노벨피아가 매긴 순위를 그대로 남기려면 로그인 세션이 필요합니다.
          </Row>
          <Row label="회차 조회수">
            잔류율에 쓰는 회차별 조회수는 랭킹에도 작품 상세에도 없습니다. 회차 목록을 오래된 순 2페이지, 최신 순 5페이지까지 읽고
            필요한 회차의 조회수만 따로 요청해 얻습니다. 공지나 외전이 섞이면 계산이 어긋나므로 회차 번호와 날짜, 조회수 표시를 모두 갖춘 것만 셉니다.
          </Row>
        </div>
      </section>

      <section className="dc-section">
        <h2 className="dc-section__title">화면의 숫자</h2>
        <p className="dc-section__lede">
          노벨피아가 준 값과 여기서 계산한 값이 섞여 있습니다.
        </p>
        <div className="split">
          <div className="split__side">
            <h3 className="split__head">받아 적은 것</h3>
            <dl className="split__list">
              <dt>점수</dt>
              <dd>7일 조회순 랭킹 점수. 목록에 1.2K, 3.4M처럼 줄여 표시된 값을 되돌린 것이라 끝자리는 원래부터 없습니다.</dd>
              <dt>조회수</dt>
              <dd>작품 상세의 누적 조회수. 랭킹 점수와는 집계 기준이 달라 둘의 비율은 맞지 않습니다. 날짜 간 차이는 누적값이 늘어난 양이지 그날의 조회수가 아닙니다.</dd>
              <dt>순위 · 회차 수 · 태그 · 줄거리</dt>
              <dd>작품 상세에서 읽은 그대로입니다.</dd>
            </dl>
          </div>
          <div className="split__side split__side--calc">
            <h3 className="split__head">여기서 만든 것</h3>
            <dl className="split__list">
              <dt>순위 변동</dt>
              <dd>어제 500위 목록의 같은 작품과 비교합니다. 어제 목록에 없으면 'New'인데, 신작과 재진입, 결손일 다음날이 모두 같은 'New'로 나옵니다.</dd>
              <dt>초반 잔류</dt>
              <dd>
                30번째 회차 조회수 ÷ 1번째 회차 조회수. 30화는 노벨피아 무료분(첫 15화)의 두 배입니다.
                회차가 30개에 못 미치는 작품은 계산하지 않고 '-'로 둡니다.
              </dd>
              <dt>최신 잔류</dt>
              <dd>
                최신화 조회수 ÷ 그보다 30화 앞선 회차의 조회수. 최신화는 조회수가 아직 덜 쌓인 상태라
                오늘 연재한 작품은 낮게, 며칠 쉰 작품은 높게 나옵니다. 새 회차는 사흘이 지나도 조회수가
                10% 남짓 더 차오릅니다.
              </dd>
              <dt>잔류율을 읽을 때</dt>
              <dd>
                작가 커뮤니티에서 쓰는 '연독률'과는 기준이 다릅니다. 그쪽은 4화를 기준으로 재고 여기는
                1화를 기준으로 재기 때문에 같은 작품이라도 여기 숫자가 더 낮게 나옵니다.
                돌아다니는 기준표를 이 숫자에 그대로 대면 안 됩니다. 회차 수가 아주 다른 작품끼리
                비교하는 것도 피하는 편이 좋습니다 — 긴 작품일수록 최신 잔류가 높게 나오는 경향이 있습니다.
              </dd>
              <dt>인기 점수</dt>
              <dd>태그를 가진 작품들의 순위 가중합(Σ 1/ln(순위+1))이라 단순 등장 횟수와 다릅니다.</dd>
              <dt>상위권 집중도</dt>
              <dd>
                상위 100위에서의 등장 비율 ÷ 그 아래 400위에서의 등장 비율. 1.0이 '순위와 무관'입니다.
                등장 5작품 미만은 계산하지 않고, 분모가 100·400 고정값이라 목록에서 빠진 작품이 있으면 값이 조금 작게 나옵니다.
                2026년 4월 13일 이전 날짜는 상위 100위 집계 자체가 없어 지형 분류 대신 목록으로만 보여줍니다.
              </dd>
            </dl>
          </div>
        </div>
      </section>

      <section className="dc-section">
        <h2 className="dc-section__title">데일리와 공모전</h2>
        <p className="dc-section__lede">두 수집은 기준이 다릅니다. 같은 '순위'라는 말이 서로 다른 것을 가리킵니다.</p>
        <div className="dc-table-wrap">
          <table className="dc-table">
            <thead>
              <tr><th /><th>데일리 랭킹</th><th>공모전</th></tr>
            </thead>
            <tbody>
              <tr><th>실행 시각</th><td className="num">매일 21:00 KST</td><td className="num">매일 14:00 KST</td></tr>
              <tr><th>원본</th><td>7일 조회순 · 전체 랭킹</td><td>2025 공모전 참가작 전수</td></tr>
              <tr><th>접속 상태</th><td>로그인 + 성인 모드</td><td>비로그인</td></tr>
              <tr><th>건수</th><td className="num">500건 (2025-07-20까지 300건)</td><td className="num">4,719건</td></tr>
              <tr><th>순위</th><td>노벨피아 원본 그대로</td><td>누적 조회수 내림차순으로 직접 매김</td></tr>
              <tr><th>'전날' 기준</th><td>달력 기준 하루 전</td><td>실제 직전 수집일</td></tr>
              <tr><th>시작일</th><td className="num">2024-12-23</td><td className="num">2025-10-02</td></tr>
            </tbody>
          </table>
        </div>
      </section>

      <section className="dc-section">
        <h2 className="dc-section__title">믿어도 되는 근거</h2>
        <div className="ledger">
          <Row label="저장 전 검사">
            건수만 세는 검사로는 못 잡는 실패가 둘 있습니다. 노벨피아 화면 구조가 바뀌어 내용을 못 읽는 경우, 로그인이 풀려 목록 구성이 통째로 바뀌는 경우.
            둘 다 건수는 500건이라 그대로 통과합니다. 그래서 읽기에 실패한 항목이 5%를 넘거나, 전날보다 누적 조회수가 줄어든 작품이 100건을 넘으면 저장하지 않습니다.
            누적 조회수는 줄어들 수 없으므로 대량 감소는 다른 날짜를 읽었다는 뜻입니다.
          </Row>
          <Row label="저장 순서">
            검사를 통과해야 파일을 저장하고, 저장이 끝나야 원본 메시지를 지웁니다. 그래서 반쯤 저장된 날짜가 남지 않습니다.
          </Row>
          <Row label="읽지 못한 작품">
            삭제되었거나 비공개로 바뀐 작품은 상세를 읽을 수 없습니다. 순위 자리를 비우지 않고 제목이 'N/A (…)'인 자리표시로 채웁니다.
            순위의 연속성을 지키기 위해서고, 조회수와 회차 수는 0으로 남습니다. 비공개는 되돌릴 수 있어 다음날 정상 수집되는 경우가 많습니다.
          </Row>
          <Row label="빠진 날">
            위 기록의 구멍이 그날입니다. 이유는 적지 않습니다. 남아 있는 것은 날짜뿐이고, 그럴듯한 사유를 붙이면 이 페이지의 다른 수치도 같은 무게로 의심받습니다.
            결손일 다음날은 비교할 전날이 없어 순위 변동이 전부 'New'로 나옵니다.
          </Row>
          <Row label="구성">
            AWS 서버리스입니다. 스케줄러가 워크플로를 깨우고, 랭킹 목록을 한 번에 받은 뒤 작품 상세를 최대 20개씩 병렬로 읽습니다.
            각 단계는 다섯 번까지 재시도합니다. 서버를 상시 띄우지 않아 월 운영비는 0.5달러를 넘지 않습니다.
          </Row>
        </div>
      </section>

      <section className="dc-section">
        <h2 className="dc-section__title">알아 두실 것</h2>
        <ul className="caveats">
          <li>여기 순위는 7일 누적 조회순입니다. 어제 하루 잘 나온 작품이 바로 올라오지는 않습니다.</li>
          <li>노벨피아 공식 순위는 조회수를 단순히 누적하는 방식이 아니라 다른 요소도 반영하는 별개의 집계입니다. 두 순위는 서로 다릅니다.</li>
          <li>매일 21시 한 시점의 장면이라 다른 시각에 노벨피아에서 본 순위와 다를 수 있습니다.</li>
          <li>날짜별 조회수 차이는 누적 조회수가 늘어난 양입니다. 그날의 조회수로 읽으면 안 됩니다.</li>
          <li>순위권 밖으로 밀린 날은 데이터가 없습니다. 추세 그래프에서 그 날은 501위(2025-07-20 이전 구간은 301위)로 찍히는데, 실제 순위가 아니라 '순위권 밖' 표시입니다.</li>
        </ul>
      </section>

      <footer className="dc-foot">
        <p>
          모든 원본 데이터의 출처는 노벨피아입니다. 제목, 줄거리, 표지, 태그의 권리는 노벨피아와 각 작가에게 있습니다.
          작품 본문은 수집하지도, 다시 배포하지도 않습니다. 개인 포트폴리오 목적의 비영리 사이트이고 광고나 유료 기능이 없습니다.
        </p>
        <p>
          원본 서버 부담을 줄이려고 정해진 시각에만 읽습니다. 데일리는 순위 목록 한 번의 요청과 상위 500건의 상세를 동시 20건까지,
          공모전은 참가작 상세를 하루 한 번 읽습니다. 화면의 숫자는 모두 저장된 스냅샷이라 페이지를 열 때 노벨피아를 호출하지 않습니다.
          다만 표지 이미지는 복제하지 않고 노벨피아 주소를 그대로 참조하므로, 그 이미지만 브라우저가 노벨피아에서 직접 받아옵니다.
        </p>
      </footer>
    </div>
  );
};

export default DataCollectionPage;
