# 작업 로그 (branch: edit_tag)

임시 메모용 파일입니다. 어떤 PC에서 무슨 작업을 했는지 기록합니다.

---

## PC-B (다른 PC, 2026-04-09)

### 태그 랭킹 UI 개선
- `webapp/frontend/src/pages/TagRankingsPage.tsx`
  - 테이블 컬럼 9개 → 5개로 간소화 (인기 점수, 등장 횟수, 변동)
  - 산점도(ScatterChart) → 가로 막대 차트(BarChart)로 교체
  - "트렌드 분석" 링크 버튼 추가
  - 모바일 카드뷰에 rank_change 배지 추가

### 태그 랭킹 전일 비교 (rank_change)
- `webapp/backend/api/main.py`
  - `TagRankData` 모델에 `rank_change` 필드 추가
  - `get_tags_by_date()`: 전날 STATS 아이템 조회 후 rank_change 계산

### 태그 스코어링 개편 (Two-Track 구조)
핵심 논의: 기존 3개 스코어링(InverseLinear, InverseRank, Log)이 중복이고 인기도 편향 문제가 있었음.
**결론: Power Score + Local Lift 투트랙으로 개편**

- `data-pipeline/data_ingestion.py`
  - InverseLinear, InverseRank 계산 제거
  - `TagCountsTop100` 집계 추가 (rank <= 100만 카운트)
  - `count < 2` 태그 pruning 추가 (DynamoDB 400KB 방어)

- `webapp/backend/api/main.py`
  - `TagRankData` 모델: `score_linear`, `score_inverse` 제거 → `power_score`, `local_lift` 추가
  - `_compute_local_lift()` 헬퍼 추가: `top100_rate / max(bottom400_rate, 1/400)`
  - rank_change 기준도 log 스코어로 변경

- `webapp/frontend/src/pages/TagRankingsPage.tsx`
  - `power_score`, `local_lift` 기반으로 전면 교체
  - `LocalLiftCell`: 1.5↑ 초록 / 1.0↓ 빨강 색상 구분

### 태그 트렌드 분석 페이지 개편 (작가용 2×2 매트릭스)
기존 5개 카테고리(급상승/하락/스테디셀러/격동/주목) → 작가 기획 관점의 4개로 재편.
크리티컬 버그 수정 포함: `analyze_tag_trends()`가 삭제된 `TagWeightedScoresInverseLinear` 참조하던 문제.

- `webapp/backend/api/main.py` (`analyze_tag_trends()` L828~)
  - ProjectionExpression: `TagWeightedScoresInverseLinear` → `TagWeightedScoresLogarithmic + TagCountsTop100 + TagCounts`
  - `period_local_lift` 추가: 기간 전체 count 합산 후 한 번 계산 (Simpson's Paradox 방지)
    - `min_count = max(5, days×2)` 미만이면 null
  - 2×2 매트릭스 카테고리 분류 (분위 기준: `np.percentile`, 하드코딩 없음)
    - `trend_leader`: slope > 0 + lift ≥ 중앙값 → 지금 뜨는 트렌드
    - `broad_popular`: slope > 0 + lift 낮음 → 대중적이지만 경쟁 치열
    - `efficient_niche`: slope ≤ 0 + lift ≥ 75th percentile → 틈새지만 상위권 집중
    - `declining`: slope < 0 → 수요 감소

- `webapp/frontend/src/pages/TagTrendsPage.tsx`
  - 타입/카테고리 인터페이스 신규 4개 키로 교체
  - hover(OverlayTrigger/Tooltip) → click(SelectedTagPanel) 방식으로 전환 (모바일 대응)
  - `SelectedTagPanel` 신규 컴포넌트: 기울기·로컬리프트·평균점수 + X축 날짜 라인차트
  - `analysisDates` 상태 추가: API 호출 전 날짜 배열 생성 → 차트 X축에 실제 날짜 표시

### 배포 필요 작업
- `data_ingestion.py` Lambda 재배포 → 이후 크롤 데이터부터 `TagCountsTop100` 적재 시작
  - 재배포 전 날짜 범위는 `period_local_lift: null` 표시 (정상 동작)
- 백엔드(`main.py`) 재배포 필요
- 프론트엔드 빌드 & 배포 필요

---

## PC-A (원래 PC)

> 여기에 작업 내용 추가
