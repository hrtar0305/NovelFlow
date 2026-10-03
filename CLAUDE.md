# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

이 파일은 코딩 에이전트(및 사람)를 위한 리포 안내서입니다. 작업 시작 전에 읽어주세요.

## 이 프로젝트가 하는 일

노벨피아 일별 랭킹을 수집·분석하는 서버리스 데이터 엔지니어링 프로젝트입니다. 전체 그림은 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), 설계 근거는 [docs/DECISIONS.md](docs/DECISIONS.md)를 보세요.

### 큰 그림 (여러 파일을 읽어야 보이는 것)

- **데이터 흐름**: 크롤러(`crawler/app.py`, Step Functions가 소설 1편당 Lambda 1회) → SQS →
  `crawler/consolidate_data.py`가 수량 검증 후 `{date}.jsonl`을 S3에 커밋 + 원본 HTML 묶음을 raw 버킷에 PUT
  → S3 트리거로 `data-pipeline/data_ingestion.py`가 DynamoDB 적재 → Streams로 `update_search_index.py`가 Algolia 동기화.
  공모전 2025(`contests/2025/`)는 Express 5분 제한 때문에 SQS Task/Result 큐 + 완료 폴링 구조로 따로 돕니다.
  2026(`contests/2026/`)은 같은 구조로 시작해 2026-10-02 자정분부터 Distributed Map 판으로 돕니다(SQS 판은 되돌리기용으로 남김).
- **DynamoDB는 테이블당 PK=`ID`, SK=`Date` 하나에 특수 항목이 섞여 있습니다.** 소설 스냅샷 외에
  `STATS#<date>`(태그 통계), `RSNAP#<date>`(분석 리포트용 압축 스냅샷), `AVAILABLE_DATES`,
  `ADULT_BLOCKLIST`, `RUN_LOCK#<date>`(예약 실행 날짜 잠금)가 같은 테이블에 있습니다. 전체 스캔·날짜 조회 코드를 짤 때 이 항목들을 걸러야 합니다.
- **백엔드는 `webapp/backend/api/main.py` 한 파일**(엔드포인트 + 정책 초크 포인트)이고, 분석 리포트 계산만
  `analysis_report.py`로 분리돼 있습니다. 이 모듈은 I/O도 성인작 판정도 하지 않습니다 — 이미 걸러진 데이터만 받습니다.
- **적재 시점에 판정을 굳히지 않습니다.** `RSNAP`·백필 스크립트 모두 `IsAdult`를 그대로 싣고, 판정은 백엔드
  `_is_adult_item()` 한 곳에서만 합니다(차단 목록이 나중에 갱신돼도 과거에 반영되도록).
- **과거 데이터 소급은 재크롤링이 아니라 `scripts/`로 합니다**: `reparse_raw.py`(원본 HTML에서 새 필드 추출,
  `EXTRACTORS`에 추가), `backfill_ranking_snapshots.py`(RSNAP 소급), `build_adult_blocklist.py`(차단 목록 생성).
  셋 다 실제 AWS 리소스를 건드리니 **먼저 `--dry-run`**으로 돌리세요.

## ⚠️ 변경 전 반드시 확인

**겉보기엔 버그·비효율처럼 보여도 의도된 설계인 경우가 있습니다.** 아래를 "고치기" 전에 [docs/DECISIONS.md](docs/DECISIONS.md)를 먼저 확인하세요. 대표적으로:

- **데일리는 캘린더 -1일, 공모전은 실제 수집일 기준**으로 previous date를 계산합니다. 통일하지 마세요 (공모전 `view_change`가 깨짐).
- **공모전 파서는 인증 쿠키를 쓰지 않습니다.** 익명 세션이 의도입니다.
- **데일리의 로그인·성인 모드는 표지가 아니라 커버리지 때문입니다.** 빼면 랭킹에서 성인작이 통째로 빠지고(실측 26.4%), 수량 검증도 못 잡습니다. 단순화 명목으로 제거 금지.
- **공모전 태그는 구 3-track 스코어링**을 유지합니다(데일리만 2-track 개편됨).
- **성인작 판정은 등급 배지 `p.in-badge span.b_19`**입니다. `span.b_19`로 넓히면 회차 배지까지 잡히고, 정규식으로 HTML을 훑으면 `<script>` 안 템플릿 문자열 때문에 일반작이 전부 오판됩니다. 표지 이미지나 태그로 판정하려는 시도는 실측으로 폐기됐습니다.
- **성인작은 포트폴리오 기간 동안 표시에서 제외**됩니다 — 판정은 `ADULT_BLOCKLIST`(과거 전 기간) **∪** `IsAdult`(매일 갱신)의 합집합이며(`_is_adult_item()`), 둘 중 하나만 쓰면 빈틈이 생깁니다. 목록은 `_apply_content_policy_all()`, 단건은 `_apply_content_policy()`만 지나야 하고 우회 경로를 만들지 마세요. `HIDE_ADULT_CONTENT=false`로 끕니다.
- **모든 표지는 동일하게 기본 블러 + 토글입니다.** 성인작은 애초에 목록·상세에 도달하지 않으므로 성인작 전용 표지 단계(잠금 등)를 두지 않습니다.
- **Algolia 검색은 의도적으로 필터하지 않습니다.** 별도 색인이라 백엔드 필터가 닿지 않고 제목 검색에 노출되지만, 목적이 존재 은폐가 아니라 배려이므로 그대로 둡니다.
- **태그 랭킹은 뺄셈으로 필터합니다**(`_tag_stats_without_blocked`). 세 지표가 소설 단위 단순 합이라 성립합니다. 목적은 점수 정확도가 아니라 목록에서 태그 이름을 없애는 것입니다. 차단 목록은 600초 캐시되니 검증 시 주의하세요.
- **표지 마스킹은 포트폴리오 기간 한정 일시 정책**입니다. 이걸 근거로 인증 쿠키 파이프라인을 건드리지 마세요(표지를 가리는 것과 표지 데이터를 확보하는 것은 별개).
- **표지를 그리는 유일한 경로는 `NovelCover`**이고, 백엔드는 `_prepare_cover_fields()` 하나를 지납니다. 표지 URL 정리와 `is_adult` 부여를 다시 분리하지 마세요(누락이 타입 체크를 통과합니다).
- **잔류율(초반/최신)의 30화·1화 기준은 의도된 선택입니다.** 커뮤니티에서 통용되는
  연독률은 `(최신−3)화 / 4화`지만 그건 문피아의 편당 결제 구조에서 나온 기준입니다.
  노벨피아는 무료분이 15화(그 두 배가 30화)이고 정액제라 1화 이탈 자체가 신호입니다.
  커뮤니티식으로 갈아타면 회차 수 편향의 **방향만 뒤집힙니다**(실측 +0.70 → −0.64).
  최신화에 3화 오프셋을 주는 것도 금지 — 연참하면 3화 전이 3시간 전일 수 있습니다.
- **잔류율은 "같은 사람이 계속 읽는 비율"이 아닙니다.** 표시 조회수 기반이고 그 값은
  계속 자랍니다(6일간 328건 전부 증가). 노벨피아 공식 지표 '독자지수'는 감상인원(사람 수)
  기반이라 다른 것이며, 회차별 감상인원은 외부에 노출되지 않아 재현할 수 없습니다.
- **유효 회차 30개 미만이면 초반 잔류를 계산하지 않습니다**(`None` → 화면 `-`).
  `최신화/1화` 같은 대체 계산으로 채우지 마세요 — 표시 없이 정의가 바뀌어 정렬이 오염됩니다.
- **원본 HTML은 스크립트째로 남깁니다.** `<script>`를 빼면 용량이 반이 되지만(91→42KB)
  "여기엔 값어치가 없다"를 미리 굳히는 것이라 ELT의 취지에 어긋납니다. 대신 비밀값만
  치환합니다. 압축은 **반드시 묶어서 zstd** — gzip은 윈도 32KB라 묶어도 이득이 0입니다.
- **연재 상태는 `p.in-badge` 안에서 `b_*` class가 없고 텍스트가 있는 span**입니다.
  `b_`로 시작하는 class만 걷으면 연재중단·연재지연이 통째로 사라집니다(그 배지는 class가
  `s_inv` 하나뿐). 아는 값으로 좁히지 마세요 — 모르는 상태가 조용히 사라집니다.
- **SQS purge 는 상태 머신 첫 단계에서 하고 뒤에 Wait 65초를 둡니다.** purge 는 최대 60초 동안
  그 사이 보낸 메시지도 지울 수 있습니다(2026-09-11 공모전 작업 599건 유실). purge 를 Lambda 로
  되돌리거나 대기를 줄이지 마세요.
- 새로운 "왜"를 알게 되거나 결정을 내리면 DECISIONS.md에 항목을 추가하세요.

## 리포 구조

```
crawler/                  데일리 랭킹 크롤러 (Docker/Lambda)
contests/2025/            공모전 파이프라인 (id_collector, detail_parser)
data-pipeline/            S3→DynamoDB 적재 + Algolia 동기화 Lambda
utils/                    lambda_warmer, discord_notify(알림 입구) 등
webapp/backend/api/       FastAPI 백엔드 (Mangum으로 Lambda 실행)
webapp/frontend/          React + TypeScript + Vite SPA
scripts/                  수동 실행 백필·재파싱 스크립트 (로컬에서 AWS 자격증명으로 실행)
docs/                     ARCHITECTURE, DECISIONS, OPERATIONS
```

## 로컬 실행 / 빌드 / 린트

```bash
# 백엔드 (webapp/backend/.env 필요 — .env.example 복사)
cd webapp/backend && python api/main.py        # http://localhost:8000

# 프론트엔드 (webapp/frontend/.env* 필요 — .env.example 참고)
cd webapp/frontend && npm install && npm run dev
cd webapp/frontend && npm run build            # tsc -b && vite build
cd webapp/frontend && npm run lint             # eslint

# 과거 데이터 소급 (예시 — 전체 옵션은 각 스크립트 docstring)
python scripts/reparse_raw.py --date 2026-09-05 --novel-id 610 --dry-run --show 3
python scripts/backfill_ranking_snapshots.py --dry-run
```

**자동화된 테스트는 없습니다.** 변경 검증은 프론트 `npm run build`(타입 체크 포함)와 `npm run lint`,
백엔드는 로컬 서버를 띄워 해당 엔드포인트를 직접 호출하는 방식입니다. 로컬 백엔드도 실제 DynamoDB를 읽습니다(AWS 자격증명 필요, 리전 `ap-northeast-2`).

배포 절차는 [docs/OPERATIONS.md](docs/OPERATIONS.md).

## 컨벤션 / 함정

- **벤더드 의존성 디렉토리는 커밋하지 않습니다**: `venv/`, `node_modules/`, Lambda zip용 `package/`.
  `package/`는 전역 패턴이 아니라 디렉토리별로 `.gitignore`에 등록돼 있습니다(`data-pipeline/`, `webapp/backend/`,
  `contests/2025/contest_id_collector/`). 다른 곳에 `package/`를 만들면 `.gitignore`에도 추가하세요.
- **시크릿 금지**: `webapp/**/.env`, 백엔드 award ID 등은 커밋 금지. 예시는 `.env.example`로.
- `WORKLOG.md`, `todo.md`, `bugfix.md`는 gitignore된 **개인 스크래치**입니다. 공유할 결정은 스크래치가 아니라 [docs/DECISIONS.md](docs/DECISIONS.md)에 남기세요.
- 백엔드 `main.py` 변경 시 Lambda 재배포가 필요합니다(자동 배포 없음). 배포는 보통 사용자가 직접 합니다 — 코드만 정리하고 별도 안내하세요.
- 백엔드 배포 패키지에는 `api/` 아래 모듈이 **전부** 들어가야 합니다(`main.py`가 `analysis_report`를 import). `Dockerfile.arm64`는 `api/*.py`만 복사하므로, `api/` 아래에 하위 폴더를 만들면 COPY도 바꾸세요.
- `raw_store.py`는 `crawler/`·`contests/2025/contest_detail_parser/`·`contests/2026/contest_detail_parser/`에 **같은 파일이 복사**돼 있습니다(이미지가 따로 빌드됨). 2026 파서의 `extract.py`도 크롤러 추출 규칙(배지·연재 상태·인생픽·잔류율)의 복사본입니다. 한쪽을 고치면 다른 쪽도 맞추세요.
- 2026 공모전 스택은 `bash contests/2026/deploy.sh [infra|code|orchestration|dmap|schedule]`로 배포합니다(2025 스택은 건드리지 않음). 자정 스케줄 대상은 기본 DMap 판이고 `PIPELINE=sqs`로 되돌립니다.
- crawler 이미지는 Lambda **두 개**(`np-trend-crawler-get-ranking`, `...-get-novel-data`)가 공유합니다. AWS 리소스 이름은 옛 프로젝트명 `np-trend`/`NP-Trend`를 유지 중이니 코드에서 임의로 `NovelFlow`로 바꾸지 마세요. 단 **새로 만드는 리소스는 NovelFlow 이름**을 씁니다(2026 공모전 스택 `novelflow-contest-2026-*`부터).
- DECISIONS.md는 **append-only**입니다. 항목을 지우지 말고, 바뀐 결정은 새 항목을 쓰고 이전 항목 `상태`를 `대체됨 (→ 날짜)`로 바꿉니다. 템플릿은 파일 상단 「작성 규칙」.
- DynamoDB Decimal은 `_convert_decimals()`로 변환합니다(`json.loads(json.dumps())` 이중 변환 대신).
- 태그 통계 pruning(등장 < 2회)의 근거는 **용량이 아니라 노이즈 제거**입니다 — STATS 항목 실측 12.9KB로 400KB 상한의 3%뿐입니다.
- iOS Safari: sticky `top:0` 헤더에 `backdrop-filter` 금지(상태바 색상 lock-in 버그). theme-color는 이중 meta의 `media` 속성 swap으로 갱신.

## Git — trunk 기반 (1인, PR 없음)

- **`main` = 운영에 배포된 상태.** main 에 직접 커밋하지 않습니다. 배포하지 않을 변경은 main 에 올리지 않습니다.
- 작업은 main 에서 짧게 사는 브랜치로: `<type>/<요약>`, type 은 `feat` · `fix` · `refactor` · `docs` · `chore`
  (예: `fix/sqs-purge-race`). 오래 걸리는 작업(웹 개편 등)은 main 을 자주 rebase 해 갈라짐을 줄입니다.
- 합치기는 로컬에서, 이력은 일직선:
  `git rebase main` → `git switch main && git merge --ff-only <branch>` → `git push origin main` → `git branch -d <branch>`.
- **이미지 배포에는 태그**(`crawler-v1.5.0` 처럼 컴포넌트-버전)를 겁니다. ECR 은 최신 이미지만 남기므로 롤백은 태그에서
  다시 빌드하는 것입니다.
- 커밋 메시지는 한국어 한 줄 요약 + 본문에 "왜". 커밋/푸시는 사용자가 요청할 때만.
