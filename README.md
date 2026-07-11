# NovelFlow — 웹소설 랭킹 데이터 파이프라인 및 트렌드 분석 서비스

노벨피아의 일별 랭킹 데이터를 수집·분석하는 데이터 엔지니어링 프로젝트입니다.
서버리스 ETL 파이프라인으로 데이터를 수집하고, 웹 애플리케이션으로 시각화합니다.

[![Live Site](https://img.shields.io/badge/Live-Site-blue?style=for-the-badge)](https://d2ti06wylez2yq.cloudfront.net/)

---

## 주요 기능

| 기능 | 설명 |
|------|------|
| **소설 랭킹** | 일별 상위 500개 소설 랭킹 및 순위 변동 추이 |
| **태그 랭킹** | 랭킹 데이터 기반 태그별 점수 및 순위 |
| **소설 상세** | 개별 소설의 지표 상세 및 기간별 트렌드 차트 |
| **작가 페이지** | 특정 작가의 작품 목록 조회 |
| **공모전 랭킹** | 연도별 공모전 참가작 랭킹 (잔류율, 추천비 포함) |
| **공모전 태그 랭킹** | 공모전 참가작 기반 태그 점수 및 순위 |
| **데이터 트렌드 분석** | 상승/하락/인기/변동성 높은 태그 시각화 |
| **고급 태그 필터** | `AND`, `OR`, `NOT`, 괄호를 활용한 복합 태그 검색 |
| **반응형 UI** | 데스크탑·모바일 최적화 인터페이스, 다크/라이트 테마 |

---

## 기술 스택

| 분류 | 기술 |
|------|------|
| **데이터 파이프라인** | Python, AWS Step Functions, AWS Lambda, Amazon SQS, Playwright, BeautifulSoup, Requests |
| **저장소** | Amazon DynamoDB, Amazon S3 |
| **웹 앱 백엔드** | FastAPI, Mangum, AWS Lambda |
| **웹 앱 프론트엔드** | React, TypeScript, Vite, Bootstrap 5, Recharts, Algolia |
| **인프라** | Amazon EventBridge, AWS Parameter Store, Amazon CloudFront, Amazon ECR |

---

## ETL 파이프라인 구조

두 개의 독립적인 서버리스 ETL 파이프라인이 AWS Step Functions으로 오케스트레이션되고 Amazon EventBridge로 스케줄링됩니다.

### 1. 데일리 랭킹 파이프라인 (`crawler/`)

```
EventBridge (매일 오후 9시 KST)
  └─▶ Step Functions (Standard Workflow)
        ├─▶ Lambda: get_ranking_list
        │     ├ SQS 큐 Purge
        │     ├ Parameter Store에서 로그인 정보 조회
        │     ├ Playwright로 노벨피아 로그인 및 상위 500개 소설 크롤링
        │     └ 소설 목록(ID, 순위, 점수) 반환
        │
        ├─▶ Express Workflow (Map, MaxConcurrency: 20)
        │     └─▶ Lambda: parse_novel_details (소설 1개당)
        │           ├ 소설 상세 페이지 스크래핑 (제목, 작가, 태그, 조회수 등)
        │           ├ 에피소드 목록 조회 → 첫/최신 에피소드 조회수 수집 (잔류율 계산용)
        │           ├ 접근 불가 소설은 Placeholder 생성
        │           └ 결과를 SQS로 전송
        │
        └─▶ Lambda: consolidate_data
              ├ SQS에서 500개 메시지 수집
              ├ 수량 검증 (500개 불일치 시 실패)
              ├ EarlyRetentionRate / RecentRetentionRate 계산
              ├ CSV 생성 → S3 업로드
              └ SQS 메시지 삭제

S3 업로드 트리거
  └─▶ Lambda: data_ingestion
        ├ CSV 파싱 → DynamoDB 저장
        ├ 태그 트렌드 통계 계산 및 저장
        └ AVAILABLE_DATES 메타데이터 업데이트
```

**주요 설계 결정:**

- **SQS 버퍼 패턴**: 파싱(Lambda × 20 병렬)과 저장(consolidate) 단계를 SQS로 분리해 내결함성을 확보했습니다. 파싱 중 일부 Lambda가 실패해도 성공한 결과는 큐에 보존되며, 수량 검증을 통해 부분 성공 상태를 조기에 감지합니다.
- **원자적 커밋 패턴**: "검증 → S3 업로드 → SQS 삭제" 순서를 엄격히 유지합니다. 업로드 전 검증 실패 시 큐 메시지가 남아 재처리가 가능하고, 업로드 성공 후에만 메시지를 삭제해 데이터 유실을 방지합니다.
- **BONUS 회차 스킵**: 에피소드 목록이 BONUS 회차로 시작하는 경우 최대 3페이지까지 탐색하여 정규 에피소드(EP.N 형식)만 추출합니다.

### 2. 공모전 데이터 파이프라인 (`contests/2025/`)

1,800개 이상의 공모전 소설을 처리해야 하므로, Express Workflow의 **5분 실행 시간 제한**을 그대로 사용하면 파이프라인 전체가 타임아웃됩니다. 이를 우회하기 위해 Standard Workflow 내에서 SQS 큐를 폴링하는 Wait & Check 루프 패턴을 채택했습니다.

```
EventBridge (매일 오후 2시 KST)
  └─▶ Step Functions (Standard Workflow)
        ├─▶ Lambda: get_id_list_from_s3
        │     ├ Task/Result SQS 큐 Purge
        │     └ S3에서 공모전 소설 ID 목록 조회 → Task 큐로 Fan-out
        │
        ├─▶ Wait & Check 루프
        │     └─▶ Lambda: check_completion (Result 큐 메시지 수 확인)
        │           └ 목표 수 미달 시 일정 시간 대기 후 재확인
        │
        └─▶ Lambda: consolidate_contest_data
              ├ Result 큐에서 전체 메시지 수집 및 중복 제거
              ├ 수량 검증
              ├ EarlyRetentionRate / RecentRetentionRate 계산
              └ DynamoDB 저장

Lambda: parser (SQS Task 큐 트리거, 배치 크기: 80, Reserved Concurrency: 40)
  ├ 소설 상세 페이지 스크래핑
  ├ 에피소드 조회수 수집 (BONUS 회차 스킵, 최대 3페이지 탐색)
  └ 결과를 Result 큐로 전송
```

**설계 포인트**: parser Lambda는 Task 큐를 직접 트리거로 받아 Standard Workflow 외부에서 독립 실행됩니다. Standard Workflow는 5분 제한이 없으므로, parser들이 모두 완료될 때까지 Wait & Check 루프로 대기한 뒤 consolidate를 실행합니다. Express Workflow를 완전히 우회하면서도 파이프라인의 오케스트레이션 가시성은 유지됩니다.

### 웹 애플리케이션

```
CloudFront
  ├─▶ S3 (React SPA 정적 파일)
  └─▶ Lambda (FastAPI 백엔드 via Mangum)
        └─▶ DynamoDB 조회
```

---

## 데이터 수집 전략

### 수집 데이터

| 항목 | 내용 |
|------|------|
| **소스** | 노벨피아 실시간 랭킹 (7일 조회순, 전체 유형) |
| **범위** | 상위 500개 소설 (2025.07.20 이전: 300개) |
| **주기** | 매일 오후 9시 (KST) |
| **공모전** | 우주최강 공모전 참가작 전수, 매일 오후 2시 (KST) |

### 수집 지표

| 지표 | 설명 |
|------|------|
| `View` | 누적 조회수 |
| `Like` | 추천수 |
| `Fav` | 선호작 등록수 |
| `Alr` | 알람 등록수 |
| `Eps` | 등록 회차 수 |
| `Score` | 랭킹 점수 |
| `EarlyRetentionRate` | **초반 잔류률** — `30화 조회수 / 1화 조회수` (30화 미만 시 최신화 기준). 1화를 읽은 독자 중 30화까지 읽은 비율을 직접 나타냅니다. |
| `RecentRetentionRate` | **최신 잔류율** — `최신화 조회수 / (최신화 역순 30번째 화 조회수)`. 최근 연재 구간의 이탈률을 측정합니다. |
| `like_to_view_ratio` | 추천비 — `Like / View` (저장 없이 API에서 실시간 계산) |
| `Tags` | 태그 목록 |
| `Synopsis` | 줄거리 |

> **잔류율 계산 방식에 대하여**: 초기에는 기하평균(`(V_30/V_1)^(1/29)`) 방식을 사용했으나, 대부분의 소설이 92~99% 구간에 집중되어 차이를 체감하기 어려웠습니다. 현재는 단순 비율(`V_30 / V_1`)을 사용하여 "1화를 본 독자 중 30화까지 읽은 비율"이라는 직관적인 수치를 제공합니다.

### 7일 랭킹을 사용하는 이유

24시간 랭킹은 최근 24시간 이내에 에피소드를 업로드한 소설만 포함되어 완결작이나 완만한 업로드 작품이 제외됩니다. **7일 랭킹**은 1주일간의 누적 조회수를 기반으로 더 안정적이고 포괄적인 인기 지표를 제공하므로 트렌드 분석에 적합합니다.

---

## 로컬 개발 환경

### 백엔드

```bash
cd webapp/backend

# .env 파일 생성 (수상작 ID 등 환경변수 설정)
cp .env.example .env  # 또는 직접 작성

# 실행
python api/main.py
```

`.env` 파일 형식:
```
GRAND_PRIZE_IDS_2025=...
TOP_EXCELLENCE_AWARD_IDS_2025=...
TOPTOON_AWARD_IDS_2025=...
WINNER_AWARD_IDS_2025=...
SPECIAL_AWARD_IDS_2025=...
FINALIST_IDS_2025=...
```

### 프론트엔드

```bash
cd webapp/frontend
npm install
npm run dev
```

### 크롤러 배포

크롤러(`crawler/`, `contests/2025/contest_detail_parser/`)는 Docker 이미지로 빌드하여 Amazon ECR에 푸시합니다.

```bash
cd crawler

# 빌드
docker build -t np-trend/crawler .

# ECR 로그인
aws ecr get-login-password --region ap-northeast-2 | \
  docker login --username AWS --password-stdin \
  <ACCOUNT_ID>.dkr.ecr.ap-northeast-2.amazonaws.com

# 태그 및 푸시
docker tag np-trend/crawler:latest \
  <ACCOUNT_ID>.dkr.ecr.ap-northeast-2.amazonaws.com/np-trend/crawler:<TAG>
docker push \
  <ACCOUNT_ID>.dkr.ecr.ap-northeast-2.amazonaws.com/np-trend/crawler:<TAG>
```

`data-pipeline/`은 zip 배포 방식을 사용합니다:

```bash
cd data-pipeline
zip -r data_ingestion_lambda.zip data_ingestion.py package/
```

---

## 디렉토리 구조

```
NP-Trend/
├── crawler/                         # 데일리 랭킹 크롤러 (Docker/Lambda)
│   ├── app.py                       # get_ranking_list, parse_novel_details
│   ├── consolidate_data.py          # consolidate_data (S3 업로드)
│   ├── NpTrendCrawlerWorkflow.json  # Step Functions 표준 워크플로우 정의
│   └── NpTrendCrawlerExpressWorkflow.json
│
├── contests/2025/                   # 공모전 데이터 파이프라인
│   ├── contest_id_collector/        # 공모전 소설 ID 수집
│   └── contest_detail_parser/       # 공모전 소설 상세 파싱 (Docker/Lambda)
│
├── data-pipeline/                   # S3 → DynamoDB 적재 Lambda
│   ├── data_ingestion.py
│   └── update_search_index.py       # DynamoDB Streams → Algolia 동기화
│
├── utils/
│   └── lambda_warmer.py             # Lambda 콜드 스타트 방지
│
└── webapp/
    ├── backend/
    │   └── api/main.py              # FastAPI 백엔드 (Lambda via Mangum)
    └── frontend/
        └── src/
            ├── pages/               # 페이지 컴포넌트
            ├── components/          # 공통 컴포넌트
            ├── hooks/               # 커스텀 훅
            ├── services/            # API 호출 함수
            ├── utils/               # 공통 유틸리티 (태그 필터 등)
            └── styles/custom.css    # 전역 스타일 (다크/라이트 테마)
```

---

## 향후 계획

- **썸네일 기반 랭킹 뷰**: 현재 테이블 형태의 랭킹 표시 외에, 소설 표지 이미지를 활용한 카드/그리드 형식의 뷰 추가. 보다 직관적인 탐색 경험을 제공하는 것이 목표입니다.
- **카테고리 뷰**: "현재 트렌드", "급상승", "오래된 숨은 명작" 등 큐레이션 카테고리별로 소설을 브라우징할 수 있는 기능. 단순 순위 나열이 아닌, 독자가 원하는 상황에 맞는 작품을 발견하는 경험을 목표로 합니다.

---

## License

This project is licensed under the [MIT License](LICENSE.md).
