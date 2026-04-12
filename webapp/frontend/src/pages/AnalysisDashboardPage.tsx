import { OverlayTrigger, Tooltip } from 'react-bootstrap';
import TrendCard from './../components/TrendCard';
import { InfoCircle } from 'react-bootstrap-icons';

const AnalysisDashboardPage = () => {
  return (
    <div className="np-page-container">
      <div className="d-flex align-items-center gap-2 mb-2">
        <h1 className="h2 mb-0 fs-page-title">데이터 분석</h1>
        <OverlayTrigger
          placement="bottom"
          overlay={
            <Tooltip id="analysis-description-tooltip">
              다양한 데이터 기반 분석 정보를 보여줍니다.
            </Tooltip>
          }
        >
          <span className="d-md-none page-banner-info-icon" style={{ cursor: 'pointer' }}>
            <InfoCircle />
          </span>
        </OverlayTrigger>
      </div>
      <p className="text-muted mb-3 d-none d-md-block">다양한 데이터 기반 분석 정보를 보여줍니다.</p>

      <div className="row analysis-card-container">
        <div className="col-md-6 col-lg-4 mb-4">
          <TrendCard
            title="태그 트렌드"
            description="지정된 기간 동안의 태그 순위 변화를 분석합니다."
            to="/trends/tags"
          />
        </div>
        {/* 추가적인 트렌드 분석 기능 카드를 여기에 추가할 수 있습니다. */}
      </div>
    </div>
  );
};

export default AnalysisDashboardPage;