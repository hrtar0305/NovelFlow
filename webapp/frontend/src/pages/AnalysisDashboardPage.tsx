import TrendCard from './../components/TrendCard';

const AnalysisDashboardPage = () => {
  return (
    <div className="p-4 lg:container mx-auto">
      <div className="mb-3">
        <h1 className="h2 mb-2 ps-0">데이터 분석</h1>
        <p className="text-muted mb-0">다양한 데이터 기반 분석 정보를 보여줍니다.</p>
      </div>

      <div className="row">
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