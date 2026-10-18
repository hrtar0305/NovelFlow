import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { getAnalysisReport } from '../services/api';
import { SkeletonBox, Stale } from '../components/ui/Loading';
import PageTitle from '../components/ui/PageTitle';
import type { AnalysisReport } from './analysis/types';
import {
  FlowSection, PaceSection, RatioSection, DiagnoseSection, TagSection,
} from './analysis/sections';
import { formatDateDot } from '../utils/format';

/**
 * 분석 — "요즘 랭킹판에 무슨 일이 있었나"를 작품 단위로 답하는 리포트(2026-09-30 개편).
 *
 * **기간 전체를 쓴다. 표본을 뽑지 않는다.** 날짜당 랭킹이 340KB라 90일을 브라우저에서 모으는 건
 * 페이로드 30MB로 불가능해, 적재가 날짜마다 16KB 압축 스냅샷(`RSNAP#<date>`)을 남기고
 * 백엔드가 `batch_get_item` 한 번으로 계산한다. 이 페이지는 그 결과를 받아 그리기만 한다.
 *
 * 기간은 고정 프리셋(7/30/90일)이다 — 고정하면 하루에 창마다 한 번만 계산되고 CDN이 받아 준다. 고른 기간은 `?days=` 로 남긴다
 * (공유·새로고침에서 30일로 돌아가지 않게).
 */
const DAYS = [7, 30, 90] as const;
type Days = (typeof DAYS)[number];

export default function AnalysisDashboardPage() {
  const [params, setParams] = useSearchParams();
  const days: Days = DAYS.find(d => String(d) === params.get('days')) ?? 30;
  const setDays = (d: Days) => setParams(d === 30 ? {} : { days: String(d) }, { replace: true });
  const [report, setReport] = useState<AnalysisReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    getAnalysisReport(days)
      .then(res => { if (alive) setReport(res.data as AnalysisReport); })
      .catch(err => {
        if (!alive) return;
        setReport(null);
        setError(err?.response?.status === 404 ? '이 기간에 쓸 수 있는 수집 기록이 아직 부족합니다.' : '리포트를 불러오지 못했습니다.');
      })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [days, retry]);

  // 빠진 날이 있을 때만 적는다 — '수집일 N일 전체'를 굳이 밝히면 뭔가 빼는 게 있나 하고 읽힌다.
  // 기간을 바꾸는 동안 이전 기간의 날짜를 흐리게 둔다 — 지우면 제목 줄이 한 줄 줄었다 늘며 아래가 밀린다(2026-10-18).
  const meta = report
    ? <span className={loading ? 'is-stale-text' : undefined}>{formatDateDot(report.start)} ~ {formatDateDot(report.end)}{report.dates_missing > 0 ? ` · 수집이 없는 ${report.dates_missing}일 제외` : ''}</span>
    : '\u00a0'; // 처음 받는 동안에도 줄을 비워 두어 아래가 밀리지 않게

  return (
    <div className="page-shell analysis-page">
      <PageTitle title="분석"
        nav={
          <div className="period-pick" role="group" aria-label="기간">
            {DAYS.map(d => (
              <button key={d} type="button" className={d === days ? 'is-on' : undefined} aria-pressed={d === days} onClick={() => setDays(d)}>{d}일</button>
            ))}
          </div>
        }
        meta={meta} />

      {error ? <p className="empty-line">{error} <button type="button" className="link-button" onClick={() => setRetry(n => n + 1)}>다시 시도</button></p>
        : !report ? (
          <div aria-busy="true">{Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="an-sec"><SkeletonBox style={{ height: 22, width: 240, maxWidth: '60%' }} /><SkeletonBox style={{ height: 260, marginTop: 14 }} /></div>
          ))}</div>
        ) : (
          <Stale loading={loading}>
            {/* 요약은 하루 세 번(7/30/90일) 미리 만들어 `AISUMMARY#<days>`에 둔다. 없으면 자리를 숨긴다. */}
            {report.ai_summary ? (
              <section className="an-summary" aria-label="기간 요약">
                <p>{report.ai_summary.text}</p>
                <p className="an-summary__by">요약 · {formatDateDot(report.end)} 수집분까지를 바탕으로 자동 생성{report.ai_summary.model ? ` · ${report.ai_summary.model}` : ''}</p>
              </section>
            ) : null}
            <FlowSection report={report} />
            <PaceSection report={report} />
            <RatioSection report={report} />
            <DiagnoseSection report={report} />
            <TagSection report={report} />
          </Stale>
        )}
    </div>
  );
}
