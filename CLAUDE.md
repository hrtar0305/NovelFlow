# CLAUDE.md

이 파일은 코딩 에이전트(및 사람)를 위한 리포 안내서입니다. 작업 시작 전에 읽어주세요.

## 이 프로젝트가 하는 일

노벨피아 일별 랭킹을 수집·분석하는 서버리스 데이터 엔지니어링 프로젝트입니다. 전체 그림은 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), 설계 근거는 [docs/DECISIONS.md](docs/DECISIONS.md)를 보세요.

## ⚠️ 변경 전 반드시 확인

**겉보기엔 버그·비효율처럼 보여도 의도된 설계인 경우가 있습니다.** 아래를 "고치기" 전에 [docs/DECISIONS.md](docs/DECISIONS.md)를 먼저 확인하세요. 대표적으로:

- **데일리는 캘린더 -1일, 공모전은 실제 수집일 기준**으로 previous date를 계산합니다. 통일하지 마세요 (공모전 `view_change`가 깨짐).
- **공모전 파서는 인증 쿠키를 쓰지 않습니다.** 익명 세션이 의도입니다.
- **데일리의 로그인·성인 모드는 표지가 아니라 커버리지 때문입니다.** 빼면 랭킹에서 성인작이 통째로 빠지고(실측 26.4%), 수량 검증도 못 잡습니다. 단순화 명목으로 제거 금지.
- **공모전 태그는 구 3-track 스코어링**을 유지합니다(데일리만 2-track 개편됨).
- **성인작 판정은 등급 배지 `p.in-badge span.b_19`**입니다. `span.b_19`로 넓히면 회차 배지까지 잡히고, 정규식으로 HTML을 훑으면 `<script>` 안 템플릿 문자열 때문에 일반작이 전부 오판됩니다. 표지 이미지나 태그로 판정하려는 시도는 실측으로 폐기됐습니다.
- **성인작은 포트폴리오 기간 동안 표시에서 제외**됩니다 — 판정은 `ADULT_BLOCKLIST`(과거 전 기간) **∪** `IsAdult`(매일 갱신)의 합집합이며(`_is_adult_item()`), 둘 중 하나만 쓰면 빈틈이 생깁니다. 목록은 `_apply_content_policy_all()`, 단건은 `_apply_content_policy()`만 지나야 하고 우회 경로를 만들지 마세요. `HIDE_ADULT_CONTENT=false`로 끕니다.
- **표지에는 성인작 전용 '잠금' 단계가 없습니다**(제거됨). 성인작이 애초에 목록·상세에 도달하지 않으므로 불필요합니다. 모든 표지가 동일하게 기본 블러 + 토글입니다.
- **Algolia 검색은 의도적으로 필터하지 않습니다.** 별도 색인이라 백엔드 필터가 닿지 않고 제목 검색에 노출되지만, 목적이 존재 은폐가 아니라 배려이므로 그대로 둡니다.
- **태그 랭킹은 뺄셈으로 필터합니다**(`_tag_stats_without_blocked`). 세 지표가 소설 단위 단순 합이라 성립합니다. 목적은 점수 정확도가 아니라 목록에서 태그 이름을 없애는 것입니다. 차단 목록은 600초 캐시되니 검증 시 주의하세요.
- **표지 마스킹은 포트폴리오 기간 한정 일시 정책**입니다. 이걸 근거로 인증 쿠키 파이프라인을 건드리지 마세요(표지를 가리는 것과 표지 데이터를 확보하는 것은 별개).
- **표지를 그리는 유일한 경로는 `NovelCover`**이고, 백엔드는 `_prepare_cover_fields*` 하나를 지납니다. 표지 URL 정리와 `is_adult` 부여를 다시 분리하지 마세요(누락이 타입 체크를 통과합니다).
- **잔류율(초반/최신)의 30화·1화 기준은 의도된 선택입니다.** 커뮤니티에서 통용되는
  연독률은 `(최신−3)화 / 4화`지만 그건 문피아의 편당 결제 구조에서 나온 기준입니다.
  노벨피아는 무료분이 15화(그 두 배가 30화)이고 정액제라 1화 이탈 자체가 신호입니다.
  커뮤니티식으로 갈아타면 회차 수 편향의 **방향만 뒤집힙니다**(실측 +0.70 → −0.64).
  최신화에 3화 오프셋을 주는 것도 금지 — 연참하면 3화 전이 3시간 전일 수 있습니다.
- **잔류율은 "같은 사람이 계속 읽는 비율"이 아닙니다.** 표시 조회수 기반이고 그 값은
  계속 자랍니다(6일간 328건 전부 증가). 노벨피아 공식 지표 '독자지수'는 감상인원(사람 수)
  기반이라 다른 것이며, 회차별 감상인원은 외부에 노출되지 않아 재현할 수 없습니다.
- **유효 회차 30개 미만이면 초반 잔류를 계산하지 않습니다**(`None` → 화면 `-`).
  예전의 `최신화/1화` 대체 계산은 표시 없이 정의가 바뀌어 정렬을 오염시켜 제거했습니다.
  되살리지 마세요.
- **원본 HTML은 스크립트째로 남깁니다.** `<script>`를 빼면 용량이 반이 되지만(91→42KB)
  "여기엔 값어치가 없다"를 미리 굳히는 것이라 ELT의 취지에 어긋납니다. 대신 비밀값만
  치환합니다. 압축은 **반드시 묶어서 zstd** — gzip은 윈도 32KB라 묶어도 이득이 0입니다.
- **연재 상태는 `p.in-badge` 안에서 `b_*` class가 없고 텍스트가 있는 span**입니다.
  `b_`로 시작하는 class만 걷으면 연재중단·연재지연이 통째로 사라집니다(그 배지는 class가
  `s_inv` 하나뿐). 아는 값으로 좁히지 마세요 — 모르는 상태가 조용히 사라집니다.
- 새로운 "왜"를 알게 되거나 결정을 내리면 DECISIONS.md에 항목을 추가하세요.

## 리포 구조

```
crawler/                  데일리 랭킹 크롤러 (Docker/Lambda)
contests/2025/            공모전 파이프라인 (id_collector, detail_parser)
data-pipeline/            S3→DynamoDB 적재 + Algolia 동기화 Lambda
utils/                    lambda_warmer 등
webapp/backend/api/       FastAPI 백엔드 (Mangum으로 Lambda 실행)
webapp/frontend/          React + TypeScript + Vite SPA
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
```

배포 절차는 [docs/OPERATIONS.md](docs/OPERATIONS.md).

## 컨벤션 / 함정

- **벤더드 의존성 디렉토리는 커밋하지 않습니다**: `venv/`, `*/package/`, `node_modules/` 모두 .gitignore 처리됨. 새로 추가하지 마세요.
- **시크릿 금지**: `webapp/**/.env`, 백엔드 award ID 등은 커밋 금지. 예시는 `.env.example`로.
- `WORKLOG.md`, `todo.md`, `bugfix.md`는 gitignore된 **개인 스크래치**입니다. 공유할 결정은 스크래치가 아니라 [docs/DECISIONS.md](docs/DECISIONS.md)에 남기세요.
- 백엔드 `main.py` 변경 시 Lambda 재배포가 필요합니다(자동 배포 없음). 배포는 보통 사용자가 직접 합니다 — 코드만 정리하고 별도 안내하세요.
- DynamoDB Decimal은 `_convert_decimals()`로 변환합니다(`json.loads(json.dumps())` 이중 변환 대신).
- 태그 통계 pruning(등장 < 2회)의 근거는 **용량이 아니라 노이즈 제거**입니다 — STATS 항목 실측 12.9KB로 400KB 상한의 3%뿐입니다.
- iOS Safari: sticky `top:0` 헤더에 `backdrop-filter` 금지(상태바 색상 lock-in 버그). theme-color는 이중 meta의 `media` 속성 swap으로 갱신.

## Git

- 커밋/푸시는 사용자가 요청할 때만. 기본 브랜치(main)에서는 먼저 브랜치를 만드세요.
