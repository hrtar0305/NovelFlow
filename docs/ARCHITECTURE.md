# 아키텍처

NovelFlow는 세 개의 독립적인 서버리스 파이프라인(데일리 랭킹 / 2025 공모전 / 2026 공모전)과 이를 시각화하는 웹 애플리케이션으로 구성됩니다. 파이프라인은 AWS Step Functions로 오케스트레이션되고 Amazon EventBridge로 스케줄링됩니다.

| 파이프라인 | 시각(KST) | 규모 | 구조 |
|---|---|---|---|
| 데일리 랭킹 | 매일 21:00 | 상위 500편 | Standard + Express Map(동시 20) → SQS → consolidate |
| 2025 공모전 | 매일 14:00 | 4,719편 전수 | SQS Task/Result 큐 + 완료 폴링 |
| 2026 공모전 | 매일 00:00 | 참가작 전수(3,500편+) | Standard + Distributed Map(묶음 단위) + 대조·재시도 |

> "왜 이렇게 설계했는가"는 [DECISIONS.md](./DECISIONS.md)를 참고하세요.

---

## 1. 데일리 랭킹 파이프라인 (`crawler/`, `data-pipeline/`)

```
EventBridge (매일 오후 9시 KST)
  └─▶ Step Functions (Standard Workflow)
        ├─▶ SQS 큐 Purge (SDK 통합) → Wait 65초   ← purge 완료 전 메시지는 지워질 수 있다
        ├─▶ Lambda: get_ranking_list (crawler/app.py)
        │     ├ Parameter Store에서 로그인 정보 조회
        │     ├ Playwright로 노벨피아 로그인 + 성인 모드 ON
        │     ├ 쿠키를 requests 세션에 주입 → 상위 500개 랭킹 크롤링
        │     └ 소설 목록(ID, 순위, 점수) + 쿠키 버전 반환(쿠키 본체는 SSM SecureString /NP-Trend/AUTH_COOKIES)
        │
        ├─▶ Express Workflow (Map, MaxConcurrency: 20)
        │     └─▶ Lambda: parse_novel_details (소설 1개당, crawler/app.py)
        │           ├ 상세 페이지 스크래핑 (제목/작가/태그/조회수/썸네일)
        │           ├ 에피소드 목록 → 첫/30화/최신/역순30번째 조회수 (잔류율용)
        │           ├ 배지/연재상태 수집 (p.in-badge)
        │           ├ 쓸 수 없는 페이지(경고창·잘린 응답·셀렉터 없음)는 2·5초 뒤 다시 받고,
        │           │  끝내 안 될 때만 사유를 단 Placeholder (잔류율 재료만 빠지면 그 부분만 한 번 더)
        │           └ 결과 + **원본 HTML(gzip+base64, 약 122KB)** 를 SQS로 전송
        │
        └─▶ Lambda: consolidate_data (crawler/consolidate_data.py)
              ├ SQS에서 500개 메시지 수집 + 수량 검증
              ├ 품질 게이트: 남은 Placeholder 2% 초과·누적 조회수 감소 10건 초과면 커밋 중단,
              │  1건이라도 있으면 Discord 경고 (성인작 0편도 경고 — 로그인 풀림 신호)
              ├ 원본을 항목에서 분리 (NDJSON·DynamoDB 로 새어 나가면 안 된다)
              ├ EarlyRetentionRate / RecentRetentionRate 계산
              ├ NDJSON 생성 → S3 업로드  ── (원자적 커밋)
              ├ 원본 하루치를 zstd 로 묶어 raw 버킷에 1회 PUT (약 4MB)
              └ SQS 메시지 삭제

S3 업로드 트리거 (`{date}.jsonl`)
  └─▶ Lambda: data_ingestion (data-pipeline/data_ingestion.py)
        ├ CSV 파싱 → DynamoDB(NovelRanks) 저장
        ├ 태그 트렌드 통계 계산·저장 (STATS#<date>)
        └ AVAILABLE_DATES 메타데이터 갱신

DynamoDB Streams
  └─▶ Lambda: update_search_index (data-pipeline/update_search_index.py)
        └ 소설/작가를 Algolia 인덱스에 동기화
```

에피소드 파싱은 BONUS 회차를 스킵하고 정규 회차(EP.N)만 추출하며, 중복 페이지 감지로 API의 마지막 페이지 반복 반환을 방어합니다(`crawler/app.py`의 early/recent window 루프).

## 1-b. 원본 HTML 레이어 (ELT)

두 파이프라인 모두 수집한 HTML 원본을 S3에 남깁니다. 파싱 규칙이 바뀌거나 새 필드가
필요해지면 **재크롤링 없이 과거를 소급 처리**할 수 있습니다(`scripts/reparse_raw.py`).
설계 근거와 실측은 [DECISIONS.md](./DECISIONS.md)의 「ETL → ELT」 항목을 보세요.

```
데일리   크롤러 → SQS(gzip+base64) → consolidate 가 하루치를 묶어 1회 PUT
         raw/{date}.jsonl.zst              약 4MB/일 · 편당 8.9KB

공모전   2026 파서가 Map 묶음 단위로 묶어 PUT   (2025 파서는 같은 코드가 있지만 꺼져 있음)
         contest/2026/{date}/{request_id}.jsonl.zst   편당 약 4KB (10/01~08 실측 93MB · 22,313편)
```

묶는 단위가 다른 이유는 규모입니다. 공모전 수천 편의 비압축 원본은 수 GB라(4,719편 기준 3.5GB)
consolidate가 전건을 들면 Lambda 메모리가 5GB대가 됩니다. 묶음(20편) 단위면 20편 × 753KB =
15MB뿐입니다. 데일리 500편은 368MB라 consolidate에서 한 번에 묶어도 됩니다.

형식은 **줄 단위 JSON을 zstd로 묶은 것**입니다. 한 줄이 소설 하나이고, 그 안에 받은
페이지가 순서대로 들어 있습니다(URL·POST 파라미터·상태 코드 포함). CSRF 토큰 같은
비밀값은 값만 치환하고 구조는 보존합니다.

## 2. 공모전 데이터 파이프라인 (`contests/2025/`)

참가작 전수를 처리해야 해 Express Workflow의 5분 제한을 우회합니다([DECISIONS.md](./DECISIONS.md) 참조). 참가작 풀은 접수 기간(2025-10) 동안 약 1,800건에서 **4,719건**으로 성장한 뒤 동결됐습니다(2025-10-31 이후 id_collector 미실행). 파이프라인은 매일 이 4,719건 전수를 재수집합니다.

```
EventBridge (매일 오후 2시 KST)
  └─▶ Step Functions (Standard Workflow, 제한 20분)
        ├─▶ Task/Result SQS 큐 Purge (SDK 통합) → Wait 65초
        ├─▶ Lambda: get_id_list_from_s3 (contest_detail_parser/app.py)
        │     └ S3의 공모전 ID 목록을 Task 큐로 Fan-out (batch 10, 부분 실패 시 예외)
        │
        ├─▶ Wait & Check 루프
        │     └─▶ Lambda: check_completion (Result 큐 유니크 ID 수 확인)
        │
        └─▶ Lambda: consolidate_contest_data
              ├ Result 큐 전체 수집 + 중복 제거(최초 타임스탬프 우선) + 수량 검증
              ├ View 기준 Rank 부여, 태그 통계(3-track) 계산
              └ DynamoDB(ContestStats2025) 저장 + CONTEST_AVAILABLE_DATES 갱신

Lambda: parser (SQS Task 큐 트리거, batch 80, Reserved Concurrency 40)
  ├ 상세 페이지 스크래핑 (익명 세션 — DECISIONS 참조)
  ├ 결과를 Result 큐로 전송
  └ **배치 단위 원본 묶음**을 raw 버킷에 1회 PUT  ← 2025 파이프라인은 꺼 둠
       (`RAW_HTML_BUCKET` 이 비어 있으면 건너뜀)

별도: contest_id_collector/app.py — novel_id를 증분 스캔하며 공모전 배지 보유작 ID를 수집해 S3에 저장
```

파서는 쓸 수 없는 페이지를 묶음 끝에서 2·5초 뒤 다시 받습니다(남은 시간이 60초 아래면 멈춤). 적재는 ParsingFailed 2% 초과,
하루 사이 새로 접근 불가가 된 작품 500편 초과면 쓰지 않습니다.

## 2-b. 2026 공모전 파이프라인 (`contests/2026/`)

2025와 같은 SQS 구조로 시작했다가 2026-10-02 자정분부터 **Distributed Map** 판으로 돕니다. 하루의 값은 자정 값이라,
00:00에 시작해 마감(D+1 01:00) 안에서만 받고 실패하면 한 번 자동 재실행합니다. 배포는 `bash contests/2026/deploy.sh`.

```
EventBridge Scheduler (매일 00:00 KST)             ← 11:30·23:30 에는 수집기만 '준비 실행'
  └─▶ Step Functions (Standard)
        ├ ResolveDate → 날짜 잠금(RUN_LOCK#<date>, 중복 전달 방지)
        ├ DiscoverIds   수집기 Lambda: 끝 번호부터 새 참가작을 찾고 노벨피아 표시 수와 견줌
        ├ ParseMap      Distributed Map(ItemBatcher, 자식 Express) → 파서 Lambda가 묶음을 받아
        │               상세·잔류율을 파싱하고 원본을 zstd 로 묶어 S3에 PUT. 실패는 묶음 안에 가둔다
        ├ Reconcile     고정한 기대 목록과 대조 → 빠진 작품만 30초·120초 뒤 다시 Map (최대 2라운드)
        ├ Consolidate   일간 순위(전날 대비 조회 증가)·태그 통계·작가 정보를 붙여 DynamoDB 적재,
        │               실패 장부 failures/<date>.json, 결손 2% 초과면 쓰지 않음(TooManyMissing)
        └ HistoryMap    작품별 회차 목록으로 연재 기록 갱신(아래 2-c)
```

- **원본 재계산(`reprocess`)**: 받기는 끝났는데 적재가 실패한 날은 자정에 저장한 원본 묶음을 다시 해석해 적재합니다(노벨피아에 다시 요청하지 않으므로 마감 없음).
- **그림자 실행(`dry_run`)**: 같은 흐름을 쓰기 없이 돌려 운영 행과 필드·값을 견줍니다. 배포 전 검증에 씁니다.
- **기성/신인**: 수집기가 작가의 다른 작품 목록을 원문 그대로 받아 두고(이 요청만 로그인 세션 — 익명은 19금 작품을 뺀다), 판정은 백엔드가 합니다(웹 개편과 함께 배포).

## 2-c. 연재 기록 (`NovelFlowEpisodeHistory`)

'그날 회차를 올렸나'는 회차 수의 전날 대비 차이로 셀 수 없습니다(삭제와 업로드가 겹치면 가려진다). 그래서 데일리 상세 수집과
2026 공모전 HistoryMap이 작품의 **실제 회차 목록**(회차 번호 → 목록에 찍힌 날짜)을 받아 작품별 한 항목에 누적합니다.
이미 아는 회차는 다시 받지 않고 새로 생긴 쪽만 이어 받습니다. 화면의 연재 기록은 `/api/uploads` 하나를 씁니다(웹 개편 배포 후).

---

## 3. 데이터 수집 전략

| 항목 | 내용 |
|------|------|
| 소스 | 노벨피아 실시간 랭킹 (7일 조회순, 전체 유형) |
| 범위 | 상위 500개 (2025-07-20 이전: 300개) |
| 데일리 주기 | 매일 오후 9시 KST |
| 공모전 | 참가작 전수 — 2025(우주최강): 매일 오후 2시 · 2026: 매일 자정(KST) |

### 수집·계산 지표

| 지표 | 설명 |
|------|------|
| `View` / `Like` / `Fav` / `Alr` / `Eps` | 누적 조회수 / 추천수 / 선호작수 / 알람수 / 회차수 |
| `Score` | 랭킹 점수 |
| `EarlyRetentionRate` | 초반 잔류율 = `30번째 유효 회차 조회수 / 1번째 유효 회차 조회수`. **유효 회차 30개 미만이면 산출하지 않음(`None`)** |
| `RecentRetentionRate` | 최신 잔류율 = `최신화 조회수 / 최신화 역순 30번째 조회수` |
| `like_to_view_ratio` | 추천비 = `Like / View` (저장 없이 API에서 실시간 계산) |
| `Tags` / `Synopsis` | 태그 목록 / 줄거리 |

잔류율/스코어링 산식의 배경은 [DECISIONS.md](./DECISIONS.md)를 참고하세요.

> **잔류율을 손대기 전에 읽을 것** — 30화 기준(무료분 15화×2), 1화 분모, 최신화를 그대로
> 쓰는 이유는 전부 의도된 선택이고 근거가 실측과 함께 DECISIONS.md의
> '잔류율 산식을 업계 관행과 대조' 항목에 있습니다. 커뮤니티에서 통용되는 연독률
> (`(최신−3)화 / 4화`)로 갈아타면 회차 수 편향의 **방향만 뒤집힙니다**(우리 +0.70 → 커뮤니티식 −0.64).
> 그리고 우리 값은 조회수 기반이라 노벨피아 공식 '독자지수'(감상인원 기반)와 다른 것입니다.

---

## 4. DynamoDB 데이터 모델

랭킹·공모전 테이블은 PK=`ID`, SK=`Date` 구조이며(연재 기록 테이블만 PK=`NovelId` 단일 키), 실제 데이터 항목과 메타/통계용 특수 항목이 같은 테이블에 공존합니다.

### `NovelRanks` (데일리)

| 항목 종류 | ID | Date | 주요 속성 |
|-----------|----|----|-----------|
| 소설 스냅샷 | `<소설ID>` | `<수집일>` | Title, AuthorID, View, Like, Tags, ThumbnailURL, 잔류율 원본(FirstEpView 등) |
| 태그 통계 | `STATS#<date>` | `<date>` | TagCounts, TagCountsTop100, TagWeightedScoresLogarithmic |
| 날짜 메타 | `AVAILABLE_DATES` | `ALL_DATES` | dates (수집 완료된 날짜 set) |

- **GSI `DateRankIndex`** (PK Date): 특정 날짜 전체 랭킹 조회.
- **GSI `AuthorIDIndex`** (PK AuthorID): 작가별 작품 조회.
- **DynamoDB Streams** → `update_search_index` → Algolia.

### `ContestStats2025` (공모전)

| 항목 종류 | ID | Date | 주요 속성 |
|-----------|----|----|-----------|
| 소설 스냅샷 | `<소설ID>` | `<date>` | Title, View, Like, Tags, Rank(View 기준) |
| 태그 통계 | `TAG_STATS#<date>` | `<date>` | TagCounts, 3-track 점수(InverseLinear/InverseRank/Logarithmic) |
| 날짜 메타 | `CONTEST_AVAILABLE_DATES` | `METADATA` | dates set |

- **GSI `DateViewIndex`** (PK Date): 특정 날짜 전체 공모전 조회.

### `NovelFlowContest2026` (2026 공모전)

| 항목 종류 | ID | Date | 주요 속성 |
|-----------|----|----|-----------|
| 소설 스냅샷 | `<소설ID>` | `<date>` | 2025 필드 + DailyRank·ViewDelta(일간 순위), IsAdult·Badges·SerialStatus, AuthorOtherNovels(기성 판정 원문), 잔류율 원본 |
| 일간 태그 통계 | `DAILY_TAG_STATS#<date>` | `<date>` | 일간 순위 기준 태그 점수(대표) — 구 3-track `TAG_STATS#` 도 비교용으로 계속 |
| 날짜 메타 · 잠금 | `CONTEST_AVAILABLE_DATES` / `RUN_LOCK#<date>` | `METADATA` / `LOCK` | 수집일 목록 / 예약 실행 날짜 잠금 |

### `NovelFlowEpisodeHistory` (연재 기록)

| 항목 | 키 | 주요 속성 |
|---|---|---|
| 작품별 회차 목록 | `NovelId` | Episodes(회차 → [목록 날짜, …]), CheckedAt |

### `NovelRanks` 의 특수 항목

소설 스냅샷과 태그 통계 외에 `RSNAP#<date>`(분석 리포트용 압축 스냅샷 — 날짜당 랭킹 340KB 를 16KB 병렬 배열로),
`ADULT_BLOCKLIST`(과거 전 기간 성인작 목록), `RUN_LOCK#<date>`(날짜 잠금)가 같은 테이블에 있습니다. 전체 스캔·날짜 조회 때 걸러야 합니다.

---

## 5. 웹 애플리케이션

```
CloudFront
  ├─▶ S3 (React SPA 정적 파일)
  └─▶ Lambda (FastAPI 백엔드 via Mangum) ─▶ DynamoDB 조회
```

- 백엔드: `webapp/backend/api/main.py`. Decimal→int/float 변환, Cache-Control 헤더, 내부 예외는 서버 로그로만(클라이언트엔 일반 메시지).
- 프론트: `webapp/frontend/` (React + TypeScript + Vite + Bootstrap 5 + Recharts + Algolia). 응답은 `services/api.ts`에서 TTL 캐시.

### API 엔드포인트

**데일리**

| 메서드 | 경로 | 설명 |
|--------|------|------|
| GET | `/api/ranks/latest-date` | 최신 수집일 |
| GET | `/api/dates` | 전체 수집일 목록 |
| GET | `/api/ranks/novels/showcase` | 최신 스냅샷 상단 쇼케이스(TOP/급상승) |
| GET | `/api/ranks/novels/{date}` | 특정일 전체 소설 랭킹(+순위변동·잔류율) |
| GET | `/api/novels/{novel_id}/latest` | 소설 최신 상세 |
| GET | `/api/trends/novels/{novel_id}/{start}/{end}` | 소설 기간별 트렌드(공백 padding) |
| GET | `/api/trends/novels/{novel_id}/available-dates` | 소설 데이터 존재 날짜 |
| GET | `/api/ranks/tags/{date}` | 특정일 태그 랭킹(power_score·local_lift) |
| GET | `/api/authors/{author_id}` | 작가 작품 목록 |
| GET | `/api/trends/tags/analysis/{start}/{end}` | 태그 트렌드 2×2 매트릭스 분석 |

**공모전** (`{year}`는 현재 2025만 지원)

| 메서드 | 경로 | 설명 |
|--------|------|------|
| GET | `/api/contests/{year}/latest-date` | 최신 수집일 |
| GET | `/api/contests/{year}/available-dates` | 전체 수집일 |
| GET | `/api/contests/{year}/showcase` | 수상작 쇼케이스(최대 11) |
| GET | `/api/contests/{year}/{date}` | 특정일 공모전 랭킹(view_change 기준) |
| GET | `/api/contests/{year}/novels/{novel_id}/latest` | 공모전 소설 최신 상세 |
| GET | `/api/trends/contests/{year}/novels/{novel_id}/...` | 공모전 소설 트렌드/날짜 |
| GET | `/api/contests/{year}/ranks/tags/{date}` | 공모전 태그 랭킹(3-track) |
