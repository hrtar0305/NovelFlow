import { useState, useEffect, useCallback } from 'react';
import { Spinner, Alert } from 'react-bootstrap';
import { getAnalysisReport } from '../services/api';
import PageHero from '../components/ui/PageHero';
import type { AnalysisReport } from './analysis/types';
import {
  FlowSection, ChurnSection, PaceSection,
  RatioSection, RetentionSection, DiagnoseSection, TagSection,
} from './analysis/sections';

/**
 * 데이터 분석 — "요즘 랭킹판에 무슨 일이 있었나"를 작품 단위로 답하는 리포트.
 *
 * **기간 전체를 쓴다. 표본을 뽑지 않는다.** 한때 30일 창에서 4개 날짜만 받아 비교했는데,
 * 기간을 정했으면 그 기간 데이터를 다 써야 한다. 그런데 날짜당 랭킹은 364행 340KB이고
 * 조회가 웜 0.37초·콜드 30초라 90일을 브라우저에서 모으는 건 페이로드 30MB로 불가능했다.
 * 그래서 **계산을 백엔드로 옮겼다** — 적재 파이프라인이 날짜마다 16KB 압축 스냅샷
 * (`RSNAP#<date>`)을 남기고, 백엔드가 `batch_get_item` 한 번으로 다 읽어 계산한다.
 * 이 페이지는 그 결과 하나를 받아 그리기만 한다.
 *
 * 기간은 고정 프리셋(7/30/90일)이다. 자유 선택이면 매번 다른 창을 계산해야 해
 * 캐시가 듣지 않는다 — 고정하면 하루에 창마다 한 번만 계산되고 CDN이 받아 준다.
 *
 * 태그 트렌드 링크는 여기 두지 않는다. 리포트가 길어서 맨 아래 링크는 있는지도
 * 모르게 되므로 헤더 내비로 올렸다.
 */
const DAYS = [7, 30, 90] as const;
type Days = (typeof DAYS)[number];

const AnalysisDashboardPage = () => {
  const [days, setDays] = useState<Days>(30);
  const [report, setReport] = useState<AnalysisReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    getAnalysisReport(days)
      .then(res => { if (alive) { setReport(res.data as AnalysisReport); setLoading(false); } })
      .catch(err => {
        if (!alive) return;
        setError(err?.response?.status === 404
          ? '이 기간에 쓸 수 있는 수집 스냅샷이 아직 부족합니다'
          : '리포트를 불러오지 못했습니다');
        setLoading(false);
      });
    return () => { alive = false; };
  }, [days]);

  const pick = useCallback((d: Days) => setDays(d), []);

  return (
    <div className="page-shell analysis-page">
      <PageHero title="데이터 분석" />

      <div className="report-bar">
        <div className="report-bar__presets" role="group" aria-label="기간">
          {DAYS.map(d => (
            <button
              key={d}
              type="button"
              className={`report-preset ${d === days ? 'is-active' : ''}`.trim()}
              aria-pressed={d === days}
              onClick={() => pick(d)}
            >
              최근 {d}일
            </button>
          ))}
        </div>
        {report && (
          /* '수집일 N일 전체'는 적지 않는다 — 최근 30일을 골랐으면 그 30일을 다 쓴다고
             읽는 게 당연하고, 굳이 밝히면 오히려 뭔가 빼는 게 있나 하고 읽힌다.
             실제로 빠진 날이 있을 때만 그 사실을 적는다. */
          <p className="report-bar__range">
            {report.start.replace(/-/g, '.')} ~ {report.end.replace(/-/g, '.')}
            {report.dates_missing > 0 && (
              <span> · 수집이 없는 {report.dates_missing}일 제외</span>
            )}
          </p>
        )}
      </div>

      {error && <div className="page-banner-inner mt-3"><Alert variant="danger">{error}</Alert></div>}
      {loading && <div className="text-center py-5"><Spinner animation="border" /></div>}

      {!loading && !error && report && (
        <>
          <PeriodSummary report={report} />
          <FlowSection report={report} />
          <ChurnSection report={report} />
          <PaceSection report={report} />
          <RatioSection report={report} />
          <RetentionSection report={report} />
          <DiagnoseSection report={report} />
          <TagSection report={report} />
        </>
      )}
    </div>
  );
};

/**
 * 기간 요약 — 아래 섹션들의 수치를 사람 말로 옮긴 자리.
 *
 * **요청마다 모델을 부르지 않는다.** 기간이 7·30·90일 세 개뿐이라 하루에 세 번만
 * 만들면 되고, 그래야 응답 시간과 비용이 예측 가능하다. 적재가 끝난 뒤 요약을 만들어
 * `AISUMMARY#<days>` 아이템에 넣어 두면 이 화면이 그것을 읽는다.
 *
 * 아직 생성 경로가 없어 백엔드가 `null` 을 주므로 지금은 빈 영역만 보인다. 자리를
 * 미리 잡아 두는 이유는, 요약이 붙는 순간 아래 섹션 전체가 '그 요약의 근거'로 읽히도록
 * 화면 구조를 먼저 정해 두는 것이 낫기 때문이다.
 */
const PeriodSummary = ({ report }: { report: AnalysisReport }) => {
  const s = report.ai_summary;
  return (
    <section className="report-summary" aria-label="기간 요약">
      <h2 className="report-summary__title">이 기간 요약</h2>
      {s ? (
        <>
          <p className="report-summary__text">{s.text}</p>
          <p className="report-summary__by">
            아래 수치를 근거로 생성된 요약입니다
            {s.generated_at && ` · ${s.generated_at.slice(0, 16).replace('T', ' ')}`}
            {s.model && ` · ${s.model}`}
          </p>
        </>
      ) : (
        <p className="report-summary__pending">
          이 기간의 요약은 아직 준비되지 않았습니다. 아래 수치가 요약의 근거입니다.
        </p>
      )}
    </section>
  );
};

export default AnalysisDashboardPage;
