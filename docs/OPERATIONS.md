# 운영 / 배포

각 컴포넌트의 배포 방식과 재배포 체크리스트입니다. 아키텍처는 [ARCHITECTURE.md](./ARCHITECTURE.md)를 참고하세요.

## 배포 방식 요약

| 컴포넌트 | 방식 |
|----------|------|
| `crawler/`, `contests/2025/contest_detail_parser/` | Docker 이미지 → Amazon ECR → Lambda |
| `data-pipeline/`, `contests/2025/contest_id_collector/` | zip 배포 (`package/`에 의존성 벤더링) |
| `webapp/backend/` | Lambda (Mangum) — zip 또는 이미지 |
| `webapp/frontend/` | `npm run build` → S3 → CloudFront |

## 크롤러 (Docker/ECR)

> ⚠️ **`docker build` 로 만든 이미지를 Lambda가 거부합니다.** BuildKit이 기본으로 만드는
> OCI index(`application/vnd.oci.image.index.v1+json`)를 Lambda는 받지 않습니다
> (`InvalidParameterValueException: image manifest ... is not supported`).
> 반드시 아래처럼 Docker v2 schema 2로 만들어 푸시하세요.

```bash
cd crawler
R=<ACCOUNT_ID>.dkr.ecr.ap-northeast-2.amazonaws.com
aws ecr get-login-password --region ap-northeast-2 | \
  docker login --username AWS --password-stdin $R

docker buildx build --platform linux/amd64 \
  --provenance=false --sbom=false \
  --output "type=image,name=$R/np-trend/crawler:<TAG>,oci-mediatypes=false,push=true" .

aws lambda update-function-code --function-name np-trend-crawler-get-novel-data \
  --image-uri $R/np-trend/crawler:<TAG>
```

확인: `aws ecr batch-get-image --repository-name np-trend/crawler --image-ids imageTag=<TAG> --query 'images[0].imageManifestMediaType'`
가 `application/vnd.docker.distribution.manifest.v2+json` 이어야 합니다.

<details><summary>참고: 예전 방식(현재는 실패)</summary>

```bash
docker build -t np-trend/crawler .

aws ecr get-login-password --region ap-northeast-2 | \
  docker login --username AWS --password-stdin \
  <ACCOUNT_ID>.dkr.ecr.ap-northeast-2.amazonaws.com

docker tag np-trend/crawler:latest \
  <ACCOUNT_ID>.dkr.ecr.ap-northeast-2.amazonaws.com/np-trend/crawler:<TAG>
docker push \
  <ACCOUNT_ID>.dkr.ecr.ap-northeast-2.amazonaws.com/np-trend/crawler:<TAG>
```
</details>

## zip 배포 (data-pipeline 등)

```bash
cd data-pipeline
zip -r data_ingestion_lambda.zip data_ingestion.py package/
```

**consolidate 는 `raw_store.py` 와 `zstandard` 가 함께 들어가야 합니다** (원본 묶음 압축).
`zstandard` 는 C 확장이라 Lambda 런타임에 맞는 휠을 받아야 합니다:

```bash
mkdir -p /tmp/cdpkg && cp crawler/consolidate_data.py crawler/raw_store.py /tmp/cdpkg/
pip install --target /tmp/cdpkg --platform manylinux2014_x86_64 \
  --python-version 3.13 --only-binary=:all: zstandard
(cd /tmp/cdpkg && zip -r /tmp/consolidate.zip . -x "*/__pycache__/*")
aws lambda update-function-code --function-name np-trend-crawler-consolidate-data \
  --zip-file fileb:///tmp/consolidate.zip
```

## 프론트엔드

```bash
cd webapp/frontend
npm run build          # dist/ 생성 → S3 업로드 → CloudFront 캐시 무효화
```

## 재배포 체크리스트

- [ ] **백엔드(`main.py`) 변경** → 백엔드 Lambda 재배포 (자동 배포 없음).
- [ ] **프론트 변경** → `npm run build` → S3 업로드 → CloudFront invalidation.
- [ ] **크롤러/파서 로직 변경** → Docker 재빌드 → ECR push → Lambda 이미지 갱신.
- [ ] **적재 로직(`data_ingestion.py`) 변경** → zip 재생성 → Lambda 갱신.
- [ ] 스코어링/집계 로직을 바꿨다면 과거 데이터와의 호환성 확인.

## 원본 HTML 레이어 (ELT)

| Lambda | 환경변수 | 값 |
|---|---|---|
| `np-trend-crawler-get-novel-data` | `RAW_HTML_BUCKET` | 원본 버킷 |
| `np-trend-crawler-consolidate-data` | `RAW_HTML_BUCKET` | 같은 버킷 |
| (공모전 파서 — 2026부터) | `RAW_HTML_BUCKET`, `CONTEST_YEAR` | |

- **비워 두면 원본 적재를 건너뜁니다** — 기존 동작 그대로라 되돌리기 수단이기도 합니다.
- 원본 버킷에는 **S3 트리거를 달지 마세요.** 자동 소비자가 없고(재파싱은 수동), 달면
  적재 Lambda가 하루 수백 번 깨어나 곧바로 건너뜁니다.
- 버킷은 **비공개 필수** — 남의 저작물(줄거리·회차 제목)과 댓글 영역이 들어갑니다.
- consolidate 는 메모리 **1024MB** 필요(500편 비압축 원본 368MB). 타임아웃 60초면 충분
  (실측 6.7초). 메모리를 올리면 vCPU도 올라가 오히려 빨라집니다(128MB 8.8초 → 1024MB 6.7초).
- `data_ingestion` 의 S3 트리거에는 접미사 필터가 없어도 됩니다 — 코드가 확장자로
  거릅니다. 다만 파일명이 `YYYY-MM-DD` 가 아니면 날짜별 집계를 건너뜁니다.

배포 순서: **`data_ingestion` 먼저**(`.jsonl` 읽기 추가) → `consolidate`(`.jsonl` 쓰기)
→ 크롤러 이미지. 반대로 하면 그날 적재가 빕니다.

## 설정 / 시크릿

> 현재 AWS 리소스 식별자는 기존 프로젝트명인 `NP-Trend`/`np-trend`를 유지합니다. 코드의 식별자를 변경하려면 Parameter Store, ECR, Lambda 및 Step Functions 리소스를 함께 마이그레이션해야 합니다.

- 노벨피아 로그인: AWS Parameter Store `/NP-Trend/NOVELPIA_ID`, `/NP-Trend/NOVELPIA_PASS`.
- 공모전 스캔 상태: `/NP-Trend/Contest2025/LastCheckedID`, `/NP-Trend/Contest2025/RecheckIDs`.
- 백엔드 수상작 ID: 환경변수 (`webapp/backend/.env.example` 참고).
- 프론트: `VITE_API_BASE_URL`, Algolia 키 (`webapp/frontend/.env.example` 참고).

## 스케줄 (EventBridge, KST)

- 데일리 랭킹 파이프라인: 매일 21:00
- 공모전 파이프라인: 매일 14:00

## 데이터 수집 안내 페이지의 수치

`webapp/frontend/src/pages/DataCollectionPage.tsx`.

**매일 바뀌는 값은 하드코딩하지 않습니다.** 수집 기간·수집일 수·결손일과 그 날짜는
페이지가 열릴 때 `/api/dates`에서 계산합니다. 이전 판이 "최대 1시간 지연", "약 38만 개"
같은 틀린 값을 오래 달고 있었던 이유는 문장이 나빠서가 아니라 **사람이 갱신해야 하는
구조였기 때문**입니다. 새 수치를 넣고 싶어지면 먼저 API에서 뽑을 수 있는지 보세요.

남아 있는 하드코딩 값은 잘 안 바뀌는 것들뿐입니다. 아래를 바꿨다면 페이지도 고치세요.

| 페이지의 서술 | 바뀌는 계기 |
|---|---|
| `COLLECTION_START = '2024-12-23'` | 없음(수집 시작일) |
| 매일 21:00 / 14:00 KST | EventBridge 스케줄 변경 |
| 500건 · 2025-07-20까지 300건 | 크롤러 수집 범위 변경 |
| 500건을 다 읽는 데 2분 남짓 | Step Functions 실행 시간이 눈에 띄게 달라졌을 때 |
| 공모전 4,719건 · 2025-10-02 시작 | 2026 공모전 파이프라인 추가 시 |
| 자리표시 5% · 조회수 감소 100건 | `consolidate_data.py`의 품질 게이트 상수 변경 |
| 동시 20건 · 재시도 5회 · 월 0.5달러 | 워크플로 동시성/재시도 설정, 요금 변화 |
| 2026-04-13 이전엔 상위권 집중도 없음 | 없음(집계 도입일) |

스케줄이 고정인지 확인:

    aws scheduler get-schedule --name run-np-trend-crawler-daily \
      --query '{Expr:ScheduleExpression,TZ:ScheduleExpressionTimezone,Window:FlexibleTimeWindow}'

`FlexibleTimeWindow.Mode`가 `OFF`여야 "고정 스케줄이라 실행 시각이 흔들리지 않습니다"가
성립합니다. 유연 실행 창을 켜면 그 문장을 지우세요.

실행 시간 분포:

    export AWS_DEFAULT_REGION=ap-northeast-2
    arn=$(aws stepfunctions list-state-machines \
      --query "stateMachines[?name=='NovelFlowCrawlerWorkflow'].stateMachineArn" --output text)
    aws stepfunctions list-executions --state-machine-arn "$arn" --max-items 40 \
      --query 'executions[].{S:status,Start:startDate,Stop:stopDate}' --output json

### 하지 말 것

- **작품 ID 최댓값을 "노벨피아 전체 작품 수"로 환산하지 마세요.** 관측된 것은 랭킹에 오른
  작품 중 최댓값이고, 발급 총수의 하한일 뿐입니다.
- **결손일의 사유를 추정해 적지 마세요.** 남아 있는 것은 날짜뿐입니다. 그럴듯한 사유를
  붙이는 순간 페이지의 다른 실측치도 같은 무게로 의심받습니다. 페이지도 "이유는 적지
  않습니다"라고 밝히고 있으니, 사유를 넣으려면 그 문장부터 고쳐야 합니다.
- **성공률 구간 경계에 "무엇을 고쳐서"라는 인과를 붙이지 마세요.** 측정된 것은 날짜와
  비율뿐입니다.
- **"어제 기준", "최근" 같은 상대 표현을 쓰지 마세요.** 정적 빌드물이라 배포 다음 날부터
  거짓이 됩니다. 매일 바뀌는 값이라면 문장이 아니라 API에서 가져오세요.
