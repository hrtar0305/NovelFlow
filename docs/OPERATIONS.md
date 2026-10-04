# 운영 / 배포

각 컴포넌트의 배포 방식과 재배포 체크리스트입니다. 아키텍처는 [ARCHITECTURE.md](./ARCHITECTURE.md)를 참고하세요.

## 배포 방식 요약

| 컴포넌트 | 방식 |
|----------|------|
| `crawler/`, `contests/2025/contest_detail_parser/` | Docker 이미지 → Amazon ECR → Lambda |
| `contests/2026/` (수집기·팬아웃·파서·적재·상태 머신·스케줄) | `bash contests/2026/deploy.sh [infra\|code\|orchestration\|schedule\|alarm]` — 파서는 이미지, 나머지는 zip |
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

# ⚠️ crawler 이미지는 Lambda 두 개가 공유한다. 반드시 둘 다 갱신할 것.
for FN in np-trend-crawler-get-ranking np-trend-crawler-get-novel-data; do
  aws lambda update-function-code --function-name $FN --image-uri $R/np-trend/crawler:<TAG>
done
```

> ⚠️ **ECR 은 최신 이미지만 남기는 운영이라, 한쪽만 갱신하면 다른 쪽이 삭제된 다이제스트를
> 가리키게 됩니다.** 그 상태로 스케줄이 돌면 파이프라인 첫 단계부터 실패합니다.
> 갱신 후 아래로 전수 확인하세요.
>
> ```bash
> for f in $(aws lambda list-functions --query 'Functions[?PackageType==`Image`].FunctionName' --output text); do
>   echo "$f  $(aws lambda get-function --function-name $f --query 'Code.ImageUri' --output text)"
> done
> ```
>
> 같은 이유로 **이전 이미지로의 롤백은 보장되지 않습니다** — 되돌리려면 이전 커밋에서
> 다시 빌드해야 합니다.

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
- consolidate 는 메모리 **1769MB**(= vCPU 1개)입니다. 사용량은 약 930MB(500편 비압축 원본 368MB + 중복 제거)인데,
  1024MB 에서는 여유가 9%뿐이었고 넘치면 재실행 정책상 처음부터 다시 돕니다. 코드가 단일 스레드라 1769MB 보다
  올려도 빨라지지 않습니다. 실측(결정 2026-10-04): 1024MB 17.3초 → 1769MB 14.0초(gzip 풀기·zstd 압축이 절반, SQS 받기는 그대로).
- `data_ingestion` 의 S3 트리거에는 접미사 필터가 없어도 됩니다 — 코드가 확장자로
  거릅니다. 다만 파일명이 `YYYY-MM-DD` 가 아니면 날짜별 집계를 건너뜁니다.

배포 순서: **`data_ingestion` 먼저**(`.jsonl` 읽기 추가) → `consolidate`(`.jsonl` 쓰기)
→ 크롤러 이미지. 반대로 하면 그날 적재가 빕니다.

## 큐 purge (두 파이프라인 공통)

purge 는 Lambda 가 아니라 **상태 머신 첫 단계**(`aws-sdk:sqs:purgeQueue`)에서 하고, 곧바로
**Wait 65초**를 둡니다. purge 는 끝나는 데 최대 60초가 걸리고 그 사이 보낸 메시지를 지울 수
있습니다(AWS 문서가 60초 대기를 권장). 2026-09-11 공모전이 이 때문에 작업 599건을 잃었습니다.
근거는 DECISIONS.md 「purge 는 상태 머신에서, 60초 기다린 뒤 보낸다」.

- 상태 머신 실행 역할 `NpTrendCrawlerStepFunctionExecutionRole` 에 세 큐에 대한
  `sqs:PurgeQueue` 권한이 있어야 합니다(인라인 정책 `PurgePipelineQueues`).
- **배포 순서: 상태 머신 먼저 → Lambda 나중.** 상태 머신만 바뀐 동안에는 옛 Lambda 가 한 번 더
  purge 할 뿐 지금과 같습니다. 반대로 Lambda 가 먼저 바뀌면 그 사이 실행은 큐를 전혀 비우지
  않아 전날 결과가 섞입니다.
- 데일리 purge 제거는 crawler 이미지 변경입니다 — 위의 "Lambda 두 개 갱신"을 지키세요.

## 실패 알림 (Discord 멘션 + 이메일)

**즉시 알림은 Discord**(NovelFlow 서버, 실패·ALARM 은 본인 멘션), **기록은 이메일**(SNS 토픽
`np-trend-crawler-failure-notifications`)입니다. Gmail 앱 푸시는 필터를 걸어도 오지 않아 즉시
알림 수단에서 뺐습니다.

| 리소스 | 잡는 것 | 보내는 곳 |
|---|---|---|
| EventBridge 규칙 `novelflow-pipeline-failure` | 두 상태 머신의 `FAILED`·`TIMED_OUT`·`ABORTED` | Discord(멘션) + 이메일 |
| 알람 `novelflow-daily-no-success-26h`, `novelflow-contest-no-success-26h` | `ExecutionsSucceeded` 가 26시간 연속 0 — **실행 자체가 없는 날**(스케줄 비활성·시작 실패)까지 | 이메일(알람 액션) + Discord(아래 규칙) |
| 알람 `np-trend-crawler-dlq-alarm` (기존) | 스케줄러가 데일리 상태 머신을 시작하지 못해 DLQ 에 남김(그날 수집이 아예 안 돌았을 수 있음) | 이메일 + Discord |
| EventBridge 규칙 `novelflow-alarm-state` | 위 세 알람의 상태 변경 | Discord — ALARM 은 멘션, ALARM→OK 는 멘션 없이, 그 외(생성 직후 등)는 보내지 않음 |

### Discord 알림 Lambda `novelflow-discord-notify`

코드 `utils/discord_notify.py`(표준 라이브러리만, 파일 하나). 역할 `novelflow-discord-notify-role`
(로그 권한만). 환경변수 `DISCORD_WEBHOOK_URL`(비밀 — 커밋 금지), `DISCORD_MENTION_USER_ID`.

- **알림은 카드(embed) 한 장**입니다 — 색 띠(빨강 실패 · 주황 확인 필요 · 파랑 참고 · 초록 해제 · 회색 시험), 제목
  `파이프라인 · 날짜 · 무슨 일`, 쉬운 말 설명, 원문 오류(인용), `👉 해야 할 일`. 파이프라인이 보내는 알림은
  `{"notice": {"level", "pipeline", "date", "title", "lines", "fields", "errors", "action", "test", "run"}, "mention"}` 형식이고
  (필드 설명은 `utils/discord_notify.py` 머리말), 실패·알람 이벤트도 Lambda 가 같은 카드로 바꿉니다. 오류 이름별 설명과
  해야 할 일은 `ERROR_HELP`·`DEFAULT_ACTION`·`ALARMS` 에 있습니다 — 새 오류·알람을 만들면 여기도 한 줄 더하세요.
- **시험 실행(입력에 `dry_run`·`test_mode`)은 회색 카드 + 🧪 표시**입니다. 결과 알림은 "실제로는 아무것도 저장하지 않았습니다"를 먼저 쓰고
  멘션하지 않지만, **시험 실행의 실패는 운영과 똑같이 멘션합니다** — 운영도 같은 코드를 쓰므로 같은 오류가 납니다.
- **배포 순서: 알림 Lambda 먼저.** 새 Lambda 는 옛 형식(`content`)도 받지만, 옛 Lambda 는 새 형식(`notice`)을 `Unsupported event` 로
  버립니다. 비동기 호출이라 어디에도 실패가 남지 않습니다(성인작 0편 멘션 포함). 알림 Lambda 를 되돌릴 때도 같은 이유로 조심하세요.
- **자동화 메시지(CI/CD 등)도 이 Lambda 로 보냅니다.** 입구를 하나로 모읍니다. 텍스트(`content`)도 그대로 받습니다.

      aws lambda invoke --function-name novelflow-discord-notify --cli-binary-format raw-in-base64-out \
        --payload '{"content":"배포 완료: crawler 1.5.0","mention":false}' /dev/stdout

  멘션이 필요한 일에만 `"mention": true`. 채널을 멘션 알림만 받도록 해 두었으므로 멘션을 남발하면
  실패 알림의 신호가 흐려집니다.
- 멘션은 `allowed_mentions` 로 지정 사용자 한 명만 허용 — 원인 문자열에 `@everyone` 이 섞여도 무시됩니다.
- 코드 갱신: `cd utils && zip -q /tmp/dn.zip discord_notify.py && aws lambda update-function-code --function-name novelflow-discord-notify --zip-file fileb:///tmp/dn.zip`
- 웹훅을 새로 만들면 환경변수만 바꾸면 됩니다. 로그(30일 보존)에는 URL 을 남기지 않습니다.

- 규칙이 토픽에 게시하려면 토픽 정책의 `AllowNovelFlowFailureRule` 문장이 필요합니다(이 규칙 ARN 으로 한정).
- **실패 이벤트만으로는 부족합니다.** 실행이 시작되지 않으면 실패 이벤트도 없습니다 — 성공 부재 알람이 그 빈틈을 덮습니다.
- 상태 머신 이름을 바꾸면 규칙 패턴의 `stateMachineArn` 과 알람 차원도 같이 바꾸세요. 안 바꾸면 **조용히 감시가 끊깁니다.**
- 알림 경로 점검: Fail 상태 하나짜리 임시 상태 머신을 만들어 규칙 패턴에 잠시 넣고 실행 → 메일 확인 → 되돌리고 삭제.
  운영 상태 머신으로 시험하지 마세요(큐를 purge 합니다).

## 설정 / 시크릿

> 현재 AWS 리소스 식별자는 기존 프로젝트명인 `NP-Trend`/`np-trend`를 유지합니다. 코드의 식별자를 변경하려면 Parameter Store, ECR, Lambda 및 Step Functions 리소스를 함께 마이그레이션해야 합니다.

- 노벨피아 로그인: AWS Parameter Store `/NP-Trend/NOVELPIA_ID`, `/NP-Trend/NOVELPIA_PASS`.
- 공모전 스캔 상태: `/NP-Trend/Contest2025/LastCheckedID`, `/NP-Trend/Contest2025/RecheckIDs`.
- 백엔드 수상작 ID: 환경변수 (`webapp/backend/.env.example` 참고).
- 프론트: `VITE_API_BASE_URL`, Algolia 키 (`webapp/frontend/.env.example` 참고).

## 스케줄 (EventBridge, KST)

- 데일리 랭킹 파이프라인: 매일 21:00 — 스케줄 입력 `{"target_novel_count": 500, "scheduled": true}`. `scheduled` 가 있는 실행만
  `RUN_LOCK#<KST 날짜>`(NovelRanks, Date=`LOCK`)를 잡아 중복 전달을 건너뛴다. **손으로 다시 돌릴 때는 `scheduled` 를 빼면 된다**(잠금 없음).
  실패하면 상태 머신이 60초 뒤 purge 부터 **한 번 자동 재실행**한다(복구하면 멘션 없는 알림). **22:00 KST 이후 시작하는 시도는
  `LateRunRefused` 로 거절**된다 — 그 뒤엔 그날을 다시 받을 수 없다(결정 2026-10-04). 시험은 `{"test_mode": true}`(목록만 받고 쓰기·purge·잠금 없음),
  재시도 경로 시험은 여기에 `"fail_first_attempt": true`.
  로그인 쿠키는 get-ranking 이 SSM SecureString `/NP-Trend/AUTH_COOKIES` 에 쓰고 버전만 넘긴다 — 크롤러 이미지와 두 상태 머신
  (NpTrendCrawlerWorkflow·NpTrendCrawlerExpressWorkflow)은 함께 바꿔야 한다(필드 `auth_cookies_version`).
- 2025 공모전 파이프라인: 매일 14:00
- 2026 공모전(이름은 `NovelFlowContest2026*`):
  - 준비 실행 `NovelFlowContest2026Prep`: 매일 11:30·23:30 — 수집기 Lambda 직접 호출(`mode: prep`). 새 번호 훑기 + 재확인(짝수 번호 = 오전, 홀수 = 밤) + 새 작가의 다른 작품.
  - 본 수집 `NovelFlowContest2026Daily`: 매일 00:00 → `NovelFlowContest2026DMapWorkflow`(기록 날짜 = 실행 시작 − 12시간). 날짜 잠금 `RUN_LOCK#{date}` 로 중복 전달을 건너뛴다.
  - SQS 판은 2026-10-04 삭제했다(DMap 판만 남음).
  - **하루의 값은 자정 값이다(결정 2026-10-04).** 실패하면 60초 뒤 한 번 자동 재실행한다. 노벨피아에서 다시 받는 시도는
    D+1 00:00 + 60분 안(자정 5분 전 이후)에 시작해야 하고, 벗어나면 `LateRefetchRefused` 로 거절된다. 수동 `{"target_date": "YYYY-MM-DD"}` 도 같다.
  - 첫 시도의 실패 상태(오류·어디까지 했나)는 상태 버킷 `runs/{date}/{실행 이름}/attempt-errors/` 에 남고 적재·실패 알림에 요약된다.
  - **받기는 끝났는데 적재가 실패한 날**: 원본 재계산 `{"reprocess": true, "target_date": "YYYY-MM-DD"}`(마감 없음). 먼저 `"dry_run": true` 로
    운영 행과 견준다. 원본에 없는 작품이 자정 기대 목록의 5%를 넘으면 `ReprocessIncomplete` — 확인했으면 `"accept_partial": true`.
    장부는 `failures/{date}-reprocess.json`. 2026-10-04 이전 원본에는 회차 조회수가 없어 잔류율이 비어 나온다.
  - 그림자 실행(쓰기 없음): `{"skip_discovery": true, "raw": false, "dry_run": true, "target_date": "YYYY-MM-DD"}`, 재실행 경로 시험은 `"fail_first_attempt": true` 추가.
  - 매일의 결과·결손 장부: 상태 버킷 `failures/{date}.json`. 결손이 있으면 Discord 로 멘션 없는 경고, 실패는 멘션.

## 알람 (CloudWatch → 이메일 + Discord `novelflow-alarm-state`)

| 알람 | 무엇을 잡나 |
|---|---|
| `novelflow-daily-no-success-26h` / `novelflow-contest-no-success-26h`(2025) / `novelflow-contest-2026-no-success-26h` | 하루 넘게 성공한 실행이 없음 — 실행 자체가 시작되지 않은 날까지. 시험 실행의 성공도 성공으로 센다 |
| `np-trend-crawler-dlq-alarm` | 데일리 예약 실행이 시작되지 못해 스케줄러 DLQ 에 남음 |
| `novelflow-contest-2026-collector-errors` | 2026 ID 수집기(준비 실행·자정) 오류 |
| `novelflow-daily-ingestion-errors` | 데일리 적재 Lambda 오류 — S3 트리거(비동기)는 2번 재시도 뒤 조용히 버리고, 상태 머신은 이미 성공이라 실패 알림이 없다 |

`novelflow-alarm-state` 규칙은 알람 ARN 목록을 패턴으로 가진다 — `put-rule` 은 패턴을 통째로 바꾸므로, 알람을 더할 때는 목록 전체를 다시 적는다
(`contests/2026/deploy.sh` 의 `collector_alarm` 이 그 목록을 가진다). 데일리 성인작 0편 경고는 알람이 아니라 consolidate 가 알림 Lambda 를 직접 부른다.

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
      --query "stateMachines[?name=='NpTrendCrawlerWorkflow'].stateMachineArn" --output text)
    # 리포의 정의 파일 이름은 NovelFlow* 지만 배포된 상태 머신 이름은 NpTrend* 다.
    # 공모전: NpTrendContestDataPipelineMainWorkflow
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
