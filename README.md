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

## 아키텍처 한눈에

두 개의 독립적인 서버리스 ETL 파이프라인(데일리 랭킹 / 공모전)이 Step Functions로 오케스트레이션되고 EventBridge로 스케줄링됩니다. 수집된 데이터는 DynamoDB에 적재되고, CloudFront 뒤의 React SPA + FastAPI(Lambda)로 서빙됩니다.

- 데일리 랭킹: 매일 21시 KST, 상위 500개 (2025-07-20 이전 300개)
- 공모전: 매일 14시 KST, 우주최강 공모전 참가작 전수

파이프라인 다이어그램, 데이터 모델, API 엔드포인트 등 상세는 아래 문서를 참고하세요.

---

## 문서

| 문서 | 내용 |
|------|------|
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | ETL 파이프라인 상세, DynamoDB 데이터 모델, API 엔드포인트 |
| [docs/DECISIONS.md](docs/DECISIONS.md) | 의사결정 로그 — "왜 이렇게 했는가" (변경 전 필독) |
| [docs/OPERATIONS.md](docs/OPERATIONS.md) | 배포 방식 및 재배포 체크리스트 |
| [CLAUDE.md](CLAUDE.md) | 코딩 에이전트/기여자용 리포 안내서 |

---

## 빠른 시작

### 백엔드

```bash
cd webapp/backend
cp .env.example .env   # 수상작 ID 등 환경변수 채우기
python api/main.py     # http://localhost:8000
```

### 프론트엔드

```bash
cd webapp/frontend
cp .env.example .env   # API URL / Algolia 키 (필요 시 .env.development, .env.production 분리)
npm install
npm run dev
```

배포 절차는 [docs/OPERATIONS.md](docs/OPERATIONS.md)를 참고하세요.

---

## 디렉토리 구조

```
NovelFlow/
├── crawler/            데일리 랭킹 크롤러 (Docker/Lambda)
├── contests/2025/      공모전 파이프라인 (id_collector, detail_parser)
├── data-pipeline/      S3 → DynamoDB 적재 + Algolia 동기화 Lambda
├── utils/              lambda_warmer 등
├── webapp/
│   ├── backend/api/    FastAPI 백엔드 (Mangum via Lambda)
│   └── frontend/       React + TypeScript + Vite SPA
└── docs/               ARCHITECTURE, DECISIONS, OPERATIONS
```

---

## 향후 계획

- **썸네일 기반 랭킹 뷰**: 테이블 외에 소설 표지를 활용한 카드/그리드 뷰 추가.
- **카테고리 뷰**: "현재 트렌드", "급상승", "숨은 명작" 등 큐레이션 브라우징.

---

## License

This project is licensed under the [MIT License](LICENSE.md).
