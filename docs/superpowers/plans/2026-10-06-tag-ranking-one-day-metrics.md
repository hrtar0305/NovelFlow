# 태그 랭킹 하루 판정 수치 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 태그 랭킹(데일리·2026 공모전)을 작품 수 · 100위 안(t편·비율) · 인기 점수(랭킹 점수 점유율) · 구역 3개(+경계)로 바꾸고 지형 지도를 표 위로 올린다.

**Architecture:** 적재가 태그별 랭킹 점수 합(`TagScoreSum`)·전체 합(`ScoreTotal`)·작품 수(`RankedTotal`)를 STATS/DAILY_TAG_STATS 에 더 싣고(과거 날짜는 소급),
백엔드가 그날 값으로 `score_share`·`top100`·`ranked_total` 을 내며, 프론트가 구역(대세·과포화·숨은 강자 + 경계)을 판정해 칩 → 지도 → 표로 그린다.

**Tech Stack:** Python 3.13(Lambda zip·컨테이너, boto3), DynamoDB, FastAPI(Mangum), React+TS(Recharts, vitest).

**Spec:** `docs/superpowers/specs/2026-10-06-tag-ranking-one-day-metrics-design.md`

## Global Constraints

- 랭킹 페이지는 그날 하루의 데이터로만 판단한다. 흐름(시들어 감)은 태그 트렌드(기간) 페이지 몫.
- N = 그날 순위가 매겨진 작품 수(데일리 500). p0 = 100/N. cut = ceil(0.06·N)(데일리 30). 숨은 강자 = 5 ≤ n < cut, t ≥ 4, t/n ≥ 1.5·p0. 경계 = n ≥ cut 이고 |t/n − p0| ≤ 0.02.
- 인기 점수 = Σ(태그 작품의 랭킹 점수) ÷ Σ(그날 전체 랭킹 점수). 공모전은 랭킹 점수 대신 그날 조회 증가(`ViewDelta`, 일간 순위가 있는 작품).
- 표 순서 = 인기 점수 내림차순, 동점은 태그 이름 오름차순. 변동 = 데일리는 달력 −1일, 공모전은 실제 직전 수집일.
- 2025 공모전(구 3-track), 기간 집중도(`period_local_lift`), 태그 트렌드 재설계는 범위 밖.
- 파이프라인 변경(data-pipeline·contests·scripts)은 main 에서 딴 짧은 브랜치로, 웹(webapp)은 `feat/webapp-redesign` 에서. **웹 브랜치에 파이프라인 코드를 넣지 않는다.**
- 소급이 웹 배포보다 먼저다(웹 배포는 사용자). DECISIONS.md 는 append-only. 커밋 끝에 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- 색은 tokens.css 토큰만. 글자색을 바꾸면 `node webapp/frontend/scripts/contrast.mjs`.

## Review Focus

1. **새 필드가 없는 날짜**(소급 전·적재 실패): 단일 날짜 API 는 터지지 않고 `score_share` 를 비우고 작품 수 순으로 낸다. 기간 시계열은 그날을 비운다(Task 5 `test_missing_score_fields`).
2. **성인작 숨김이 켜졌을 때**: 태그별 점수 합뿐 아니라 `ScoreTotal` 에서도 숨긴 작품 점수를 빼야 점유율이 맞다(Task 5 `test_blocked_subtraction_includes_total`).
3. **TagCounts 에는 있는데 TagScoreSum 에 없는 태그**(가지치기 어긋남): 0 으로 보고 넘어간다(Task 5 같은 테스트 파일 `test_missing_tag_in_score_sum`).
4. **N ≤ 100 인 날**(공모전 초반 등): p0 ≥ 1 이 되어 구역 판정이 무의미 — 구역을 붙이지 않는다(Task 6 `N 이 100 이하면 구역 없음`).
5. **인기 점수 동점**: 이름 순으로 고정해 날마다 순서·변동이 바뀌지 않는다(Task 5 `test_ties_sorted_by_name`).

---

## 파일 구조

| 파일 | 할 일 |
|---|---|
| `data-pipeline/tag_stats.py` (새) | 순수 함수 `daily_tag_stats(items)` — STATS 필드 전부 계산(기존 3 + 새 3). 적재·소급이 같이 쓴다 |
| `data-pipeline/test_tag_stats.py` (새) | unittest |
| `data-pipeline/data_ingestion.py` | `calculate_and_store_tag_trends` 가 `tag_stats.daily_tag_stats` 사용 |
| `contests/2026/contest_detail_parser/consolidate_contest_data.py` | `daily_tag_stats` 에 `TagScoreSum`·`ScoreTotal`(Σ ViewDelta) |
| `contests/2026/contest_detail_parser/test_opening_day.py` | 공모전 태그 점수 테스트 추가 |
| `scripts/backfill_tag_score_sum.py` (새) | 과거 STATS·DAILY_TAG_STATS 에 새 필드 소급(`--dry-run`, `--source daily|contest2026`) |
| `scripts/measure_tag_zones.py` (새) | 구역 규칙을 날짜 범위에 계산해 하루 바뀜·구역별 개수·예를 내는 측정(공모전 기준값 확인용, 쓰기 없음) |
| `webapp/backend/api/main.py` | 태그 API·시계열·뺄셈·공모전 일간 태그가 새 값 사용 |
| `webapp/backend/tests/test_tag_rows.py` (새) | 백엔드 순수 함수 테스트 |
| `webapp/frontend/src/utils/tagZones.ts` · `.test.ts` | 구역 3개 + 경계 + 정렬 |
| `webapp/frontend/src/components/tag/TagTerrainMap.tsx` | 축(작품 수 × 100위 안 비율)·영역·점 크기 교체 |
| `webapp/frontend/src/components/tag/DailyTagBoard.tsx` | 칩 → 지도 → 표, 열, 폰 지도 접기 |
| `webapp/frontend/src/components/tag/TagRowExpand.tsx` | 펼침 수치를 '100위 안' 으로 |
| `webapp/frontend/src/pages/TagRankingsPage.tsx`, `ContestTagRankingsPage.tsx` | 문구·props |

---

### Task 1: 적재 — 태그 점수 합 필드(데일리)

**Files:** Create `data-pipeline/tag_stats.py`, `data-pipeline/test_tag_stats.py`; Modify `data-pipeline/data_ingestion.py:202-255`

**Interfaces:**
- Produces: `tag_stats.daily_tag_stats(items: list[dict]) -> dict` → `{'TagCounts': {tag:int}, 'TagCountsTop100': {tag:int}, 'TagWeightedScoresLogarithmic': {tag:float}, 'TagScoreSum': {tag:int}, 'ScoreTotal': int, 'RankedTotal': int}`. 입력 행: `Ranking`(int>0), `Score`(int|None), `Tags`(list). 등장 2회 미만 태그는 네 맵에서 모두 뺀다. `ScoreTotal`·`RankedTotal` 은 가지치기와 무관하게 순위가 있는 전체 행.

- [ ] **Step 1: 실패하는 테스트**

```python
# data-pipeline/test_tag_stats.py
import os, sys, unittest
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import tag_stats as T


class DailyTagStats(unittest.TestCase):
    def test_score_sum_total_and_pruning(self):
        items = [
            {'Ranking': 1, 'Score': 1000, 'Tags': ['a', 'b']},
            {'Ranking': 101, 'Score': 100, 'Tags': ['a', 'c']},
            {'Ranking': 300, 'Score': 50, 'Tags': ['a', 'b']},
            {'Ranking': 0, 'Score': 999, 'Tags': ['a']},          # 순위 없는 행은 무시
        ]
        s = T.daily_tag_stats(items)
        self.assertEqual(s['TagCounts'], {'a': 3, 'b': 2})       # c 는 1회라 가지치기
        self.assertEqual(s['TagCountsTop100'], {'a': 1, 'b': 1})
        self.assertEqual(s['TagScoreSum'], {'a': 1150, 'b': 1050})
        self.assertEqual((s['ScoreTotal'], s['RankedTotal']), (1150, 3))   # 가지치기와 무관
        self.assertAlmostEqual(s['TagWeightedScoresLogarithmic']['b'], 1 / 0.6931471805599453 + 1 / 5.707110264748875)

    def test_missing_score_counts_as_zero(self):
        s = T.daily_tag_stats([{'Ranking': 1, 'Score': None, 'Tags': ['a']}, {'Ranking': 2, 'Tags': ['a']}])
        self.assertEqual((s['TagScoreSum'], s['ScoreTotal']), ({'a': 0}, 0))


if __name__ == '__main__':
    unittest.main()
```

- [ ] **Step 2:** `cd data-pipeline && ../venv/bin/python -m unittest test_tag_stats` → FAIL(ModuleNotFoundError tag_stats)
- [ ] **Step 3: 구현**

```python
# data-pipeline/tag_stats.py
"""데일리 태그 통계(STATS#{date}) 계산 — 적재(data_ingestion)와 소급(scripts/backfill_tag_score_sum.py)이 같이 쓴다.

태그 랭킹은 그날 하루로 판단한다(DECISIONS 2026-10-06): 작품 수 · 100위 안 작품 수 · 인기 점수(랭킹 점수 점유율).
`TagScoreSum`/`ScoreTotal` 이 인기 점수의 재료다 — 노벨피아가 매긴 랭킹 점수를 그대로 더해, 순위에 따른 인기 차이가 임의 가중치
없이 들어간다. `TagWeightedScoresLogarithmic`(Σ1/ln(rank+1))은 기간 페이지가 아직 쓰므로 남긴다.
등장 2회 미만 태그는 노이즈라 뺀다(용량이 아니라 노이즈 — DECISIONS 2026-04-13 정정). 전체 합(`ScoreTotal`)과 작품 수(`RankedTotal`)는
가지치기와 무관하게 순위가 있는 모든 행이다.
"""
import math


def daily_tag_stats(items):
    counts, top100, logw, score_sum = {}, {}, {}, {}
    total, ranked = 0, 0
    for item in items:
        rank = item.get('Ranking')
        if not isinstance(rank, int) or rank <= 0:
            continue
        score = int(item.get('Score') or 0)
        ranked += 1
        total += score
        w = 1 / math.log(rank + 1)
        for tag in item.get('Tags') or []:
            counts[tag] = counts.get(tag, 0) + 1
            logw[tag] = logw.get(tag, 0) + w
            score_sum[tag] = score_sum.get(tag, 0) + score
            if rank <= 100:
                top100[tag] = top100.get(tag, 0) + 1
    for tag in [t for t, c in counts.items() if c < 2]:
        for m in (counts, top100, logw, score_sum):
            m.pop(tag, None)
    return {'TagCounts': counts, 'TagCountsTop100': top100, 'TagWeightedScoresLogarithmic': logw,
            'TagScoreSum': score_sum, 'ScoreTotal': total, 'RankedTotal': ranked}
```

- [ ] **Step 4:** `calculate_and_store_tag_trends` 본문을 `stats = tag_stats.daily_tag_stats(items)` 로 바꾸고 `stats_item` 에 `'TagScoreSum': stats['TagScoreSum'], 'ScoreTotal': stats['ScoreTotal'], 'RankedTotal': stats['RankedTotal']` 를 더한다(`TagWeightedScoresLogarithmic` 은 지금처럼 Decimal 변환). 파일 상단 `import tag_stats`.
- [ ] **Step 5:** `../venv/bin/python -m unittest test_tag_stats` → PASS. `python -c "import ast;ast.parse(open('data_ingestion.py').read())"` → 오류 없음.
- [ ] **Step 6: 배포**(이 Lambda 는 boto3·표준 라이브러리만 쓴다 — 지금 배포된 zip 에 두 파일만 바꿔 넣는다):

```bash
cd data-pipeline
URL=$(aws lambda get-function --function-name np-trend-data-ingestion --query Code.Location --output text)
curl -s "$URL" -o /tmp/ingest_current.zip && cp /tmp/ingest_current.zip /tmp/ingest_new.zip
zip -j /tmp/ingest_new.zip data_ingestion.py tag_stats.py
aws lambda update-function-code --function-name np-trend-data-ingestion --zip-file fileb:///tmp/ingest_new.zip
aws lambda wait function-updated-v2 --function-name np-trend-data-ingestion
```
Expected: `LastUpdateStatus Successful`. 21:00 데일리 전에 끝낸다(진행 중이면 기다린다).
- [ ] **Step 7: 커밋** — `태그 통계: 랭킹 점수 합(TagScoreSum·ScoreTotal·RankedTotal)을 STATS 에 싣는다`

### Task 2: 공모전 적재 — 조회 증가 합 필드

**Files:** Modify `contests/2026/contest_detail_parser/consolidate_contest_data.py:249-290`, `test_opening_day.py`

**Interfaces:**
- Produces: `daily_tag_stats(items)` 반환에 `'TagScoreSum': {tag: int}`(일간 순위가 있는 작품의 `ViewDelta` 합), `'ScoreTotal': int` 추가. `_store_daily_tag_stats` 가 두 필드를 싣는다.

- [ ] **Step 1: 실패하는 테스트**(test_opening_day.py 에 추가)

```python
class DailyTagScore(unittest.TestCase):
    def test_view_delta_sum_and_total(self):
        items = [{'ID': '1', 'DailyRank': 1, 'ViewDelta': 900, 'Tags': ['a', 'b']},
                 {'ID': '2', 'DailyRank': 2, 'ViewDelta': 100, 'Tags': ['a', 'b']},
                 {'ID': '3', 'View': 5, 'Tags': ['a']}]                       # 일간 순위 없음 → 빠짐
        s = C.daily_tag_stats(items)
        self.assertEqual(s['TagScoreSum'], {'a': 1000, 'b': 1000})
        self.assertEqual((s['ScoreTotal'], s['RankedTotal']), (1000, 2))
```
- [ ] **Step 2:** `cd contests/2026/contest_detail_parser && ../../../venv/bin/python -m unittest test_opening_day` → FAIL(KeyError 'TagScoreSum')
- [ ] **Step 3: 구현** — `daily_tag_stats` 루프에서 `score[tag] += int(it.get('ViewDelta') or 0)`, `total = sum(int(i.get('ViewDelta') or 0) for i in ranked)`, 가지치기에 `score` 포함, 반환에 두 키. `_store_daily_tag_stats` 의 put_item 에 `'TagScoreSum': stats['TagScoreSum'], 'ScoreTotal': stats['ScoreTotal']`.
- [ ] **Step 4:** 테스트 PASS(test_opening_day · test_history_attach 전부).
- [ ] **Step 5:** 태그 `contest2026-v1.3.0` 를 걸고 `bash contests/2026/deploy.sh code`(main 에 합친 뒤). Expected: `done: code (contest2026-v1.3.0)`.
- [ ] **Step 6: 커밋** — `2026 공모전 태그 통계: 조회 증가 합(TagScoreSum·ScoreTotal)`

### Task 3: 소급 스크립트와 실행

**Files:** Create `scripts/backfill_tag_score_sum.py`

**Interfaces:**
- Consumes: `data-pipeline/tag_stats.daily_tag_stats`, `consolidate_contest_data.daily_tag_stats`.
- Produces: 모든 데일리 날짜 `STATS#{d}` 와 2026 공모전 날짜 `DAILY_TAG_STATS#{d}` 에 `TagScoreSum`·`ScoreTotal`·`RankedTotal`.

- [ ] **Step 1:** 스크립트(데일리: `AVAILABLE_DATES` 의 날짜마다 `DateRankIndex` 로 `ID, Ranking, Score, Tags` 를 읽어 `tag_stats.daily_tag_stats` → `update_item(SET TagScoreSum, ScoreTotal, RankedTotal, ConditionExpression attribute_exists(ID))`. 공모전: `CONTEST_AVAILABLE_DATES` 날짜마다 `DateViewIndex` 로 ID 를 받고 `batch_get_item` 으로 `ID, DailyRank, ViewDelta, Tags` → `consolidate_contest_data.daily_tag_stats` → `DAILY_TAG_STATS#{d}` 가 있을 때만 갱신). 옵션 `--source daily|contest2026`, `--since YYYY-MM-DD`, `--dry-run`(날짜별 `RankedTotal`·`ScoreTotal`·태그 수와, 기존 `TagCounts` 와 새 계산의 불일치 태그 수를 출력). 기존 STATS 에 그날 항목이 없으면 건너뛴다.
- [ ] **Step 2:** `python scripts/backfill_tag_score_sum.py --source daily --dry-run` → 날짜마다 `RankedTotal 500`(구 날짜 300 가능), 기존 `TagCounts` 와의 불일치 0. 불일치가 있으면 원인을 적고 멈춘다(정의가 어긋남).
- [ ] **Step 3:** 실제 소급(daily → contest2026). Expected: 모든 날짜 `updated`, 실패 0.
- [ ] **Step 4:** 확인 — `aws dynamodb get-item --table-name NovelRanks --key '{"ID":{"S":"STATS#2026-10-05"},"Date":{"S":"2026-10-05"}}' --projection-expression ScoreTotal,RankedTotal`.
- [ ] **Step 5: 커밋** — `태그 점수 합 소급 스크립트` + OPERATIONS 에 한 줄.

### Task 4: 공모전 기준값 측정

**Files:** Create `scripts/measure_tag_zones.py`

**Interfaces:**
- Produces: 측정 결과(원장 Ruling) — 공모전에 데일리 상수(6% · 1.5·p0 · t≥4 · ±2%p)를 그대로 쓸지, 공모전용 상수를 둘지. 상수가 다르면 Task 6 의 `ZoneRules` 에 공모전 값.

- [ ] **Step 1:** 스크립트: `--source daily|contest2026`, `--days 14`. 날짜마다 소급된 필드로 n·t·N 을 얻어 Task 6 과 같은 규칙으로 구역을 매기고, 하루 구역 바뀜 개수·다음 날 유지율·구역별 개수·대표 5개를 출력(쓰기 없음).
- [ ] **Step 2:** 데일리 실행 → 설계 수치와 맞는지(하루 바뀜 약 1.9개, 10/05 대세 15 · 숨은 강자 10 · 과포화 11). 맞지 않으면 규칙 구현을 바로잡는다.
- [ ] **Step 3:** 공모전 실행(10/01~). 판단 기준: 구역마다 최소 3개 이상, 하루 바뀜이 구역 붙은 태그의 10% 이하, 대표가 상식적. 어긋나면 cut 비율·숨은 강자 배수를 바꿔 다시 재고, 고른 값과 근거를 원장 Ruling 으로 남긴다.
- [ ] **Step 4: 커밋** — `태그 구역 측정 스크립트`

### Task 5: 백엔드 — 하루 태그 값(웹 브랜치)

**Files:** Modify `webapp/backend/api/main.py`(`TagRankData` 819행, `_fetch_rank_tag_rows_by_date` 444행, `_tag_stats_without_blocked` 481행, `get_tags_by_date`, `get_tag_series`, `_contest_daily_tag_ranking`); Create `webapp/backend/tests/test_tag_rows.py`

**Interfaces:**
- Produces: `_one_day_tag_rows(counts, top100, score_sum, score_total, ranked_total) -> list[dict]` — 행 `{'tag','count','top100','score_share'(float|None),'ranked_total','Rank'}`, 정렬 `(-score_share, tag)`; score 필드가 없으면 `score_share=None` 이고 `(-count, tag)`.
- `_tag_stats_without_blocked(date, scores_log, counts_total, counts_top100, rows=None, score_sum=None, score_total=None)` → 반환에 `score_sum`·`score_total` 추가(튜플 5개).
- API 행: `TagRankData` 에 `top100: Optional[int]`, `score_share: Optional[float]`, `ranked_total: Optional[int]` 추가(`power_score`·`local_lift` 는 기간 페이지 호환으로 남기되 화면은 안 씀).
- 시계열 `slot` 에 `'top': [...]`, `'score'` = score_share(새 필드 없는 날은 그 날짜 전체를 비움).

- [ ] **Step 1: 실패하는 테스트**

```python
# webapp/backend/tests/test_tag_rows.py
import os, sys, unittest
os.environ.setdefault('AWS_DEFAULT_REGION', 'ap-northeast-2')
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'api'))
import main as M


class OneDayRows(unittest.TestCase):
    def test_share_and_order(self):
        rows = M._one_day_tag_rows({'a': 10, 'b': 5}, {'a': 2, 'b': 3}, {'a': 300, 'b': 700}, 1000, 500)
        self.assertEqual([(r['tag'], r['Rank'], r['score_share'], r['top100']) for r in rows], [('b', 1, 0.7, 3), ('a', 2, 0.3, 2)])

    def test_ties_sorted_by_name(self):
        rows = M._one_day_tag_rows({'나': 3, '가': 3}, {}, {'나': 100, '가': 100}, 1000, 500)
        self.assertEqual([r['tag'] for r in rows], ['가', '나'])

    def test_missing_score_fields(self):
        rows = M._one_day_tag_rows({'a': 3, 'b': 9}, {'a': 1}, None, None, None)
        self.assertEqual([(r['tag'], r['score_share']) for r in rows], [('b', None), ('a', None)])

    def test_missing_tag_in_score_sum(self):
        rows = M._one_day_tag_rows({'a': 3}, {}, {}, 1000, 500)
        self.assertEqual(rows[0]['score_share'], 0.0)


class BlockedSubtraction(unittest.TestCase):
    def test_blocked_subtraction_includes_total(self):
        M.HIDE_ADULT_CONTENT, old = True, M.HIDE_ADULT_CONTENT
        M._adult_blocklist, old_bl = (lambda: frozenset()), M._adult_blocklist
        try:
            rows = [{'ID': '1', 'Ranking': 5, 'Score': 400, 'Tags': ['a'], 'IsAdult': True}]
            _, counts, top, ssum, stot = M._tag_stats_without_blocked('2026-10-05', {'a': 2.0}, {'a': 3}, {'a': 1}, rows,
                                                                       {'a': 900}, 2000)
            self.assertEqual((counts['a'], top['a'], ssum['a'], stot), (2, 0, 500, 1600))
        finally:
            M.HIDE_ADULT_CONTENT, M._adult_blocklist = old, old_bl


if __name__ == '__main__':
    unittest.main()
```
- [ ] **Step 2:** `cd webapp/backend && ../../venv/bin/python -m unittest discover tests` → FAIL(no attribute `_one_day_tag_rows`)
- [ ] **Step 3: 구현**
  - `_one_day_tag_rows`: 위 Interfaces 그대로(`score_share = score_sum.get(tag, 0)/score_total` if score_total else None).
  - `_fetch_rank_tag_rows_by_date` 투영에 `Score` 추가.
  - `_tag_stats_without_blocked`: 성인작 행마다 `score = int(item.get('Score') or 0)` 를 `score_total` 에서 빼고 태그마다 `score_sum` 에서 뺀다(키가 있을 때). 정책이 꺼져 있으면 입력 그대로 5개 반환. 호출부 3곳(단일 날짜·전날·시계열)을 새 반환에 맞춘다.
  - `get_tags_by_date`: STATS 에서 `TagScoreSum`·`ScoreTotal`·`RankedTotal` 을 읽어 `_one_day_tag_rows` 로 행을 만들고, 기존 `power_score`·`local_lift` 도 행에 붙인다. 전날 순위도 같은 함수로 계산(전날 투영에 세 필드 추가). 변동 규칙은 지금 그대로.
  - `get_tag_series`: 투영에 세 필드, 날짜마다 `_one_day_tag_rows` 로 순위·`score`(=score_share)·`top`. **`ScoreTotal` 이 없는 날은 그 날짜를 `present` 에서 뺀다.** `lift` 는 지금 그대로 둔다(태그 트렌드 호환).
  - `_contest_daily_tag_ranking`: `TagScoreSum`·`ScoreTotal`·`RankedTotal` 로 `_one_day_tag_rows`, `local_lift` 는 지금 계산 유지(min_top=2).
- [ ] **Step 4:** 테스트 PASS(기존 test_analysis_report·test_tag_lift 포함). 로컬 서버에서 `curl localhost:8000/api/ranks/tags/2026-10-05 | head -c 400` → 첫 행 판타지, `score_share` ≈ 0.09, `top100` 69, `ranked_total` 500.
- [ ] **Step 5: 커밋**(웹 브랜치) — `백엔드 태그 랭킹: 랭킹 점수 점유율 · 100위 안 · 이름 순 동점`

### Task 6: 프론트 — 구역 규칙

**Files:** Modify `webapp/frontend/src/utils/tagZones.ts`, `tagZones.test.ts`

**Interfaces:**
- Produces: `type ZoneKey = 'mainstream' | 'gem' | 'saturated'`; `interface ZoneRules { cutShare: number; gemMult: number; gemMinTop: number; edge: number }`; `DAILY_RULES = { cutShare: 0.06, gemMult: 1.5, gemMinTop: 4, edge: 0.02 }`;
  `zoneOf(t: { count: number; top100?: number | null; ranked_total?: number | null }, rules = DAILY_RULES): { zone: ZoneKey | null; edge: boolean }`;
  `withZones(tags, rules?)` → 행에 `zone`·`edge`; `DailyTag` 에 `top100?`, `score_share?`, `ranked_total?`; `TagSortKey` 에 `score_share`·`top_share`.

- [ ] **Step 1: 실패하는 테스트**(tagZones.test.ts 의 구역 describe 를 바꾼다)

```ts
describe('zoneOf (하루 판정, 데일리 N=500)', () => {
  const t = (count: number, top100: number) => ({ count, top100, ranked_total: 500 });
  it('흔한 태그(30편 이상)는 100위 안 비율 20% 를 기준으로 대세·과포화', () => {
    expect(zoneOf(t(30, 6)).zone).toBe('mainstream');
    expect(zoneOf(t(100, 19)).zone).toBe('saturated');
  });
  it('20% ± 2%p 는 경계', () => {
    expect(zoneOf(t(100, 22))).toEqual({ zone: 'mainstream', edge: true });
    expect(zoneOf(t(100, 23)).edge).toBe(false);
  });
  it('숨은 강자 = 5~29편 · 100위 안 4편 이상 · 30% 이상', () => {
    expect(zoneOf(t(13, 4)).zone).toBe('gem');
    expect(zoneOf(t(16, 3)).zone).toBeNull();     // 3편 — 판단 보류
    expect(zoneOf(t(20, 5)).zone).toBeNull();     // 25%
    expect(zoneOf(t(4, 4)).zone).toBeNull();      // 5편 미만
  });
  it('N 이 100 이하면 구역 없음', () => {
    expect(zoneOf({ count: 50, top100: 40, ranked_total: 90 }).zone).toBeNull();
  });
  it('100위 안 정보가 없으면 구역 없음', () => {
    expect(zoneOf({ count: 50, top100: null, ranked_total: 500 }).zone).toBeNull();
  });
});
```
- [ ] **Step 2:** `npx vitest run src/utils/tagZones.test.ts` → FAIL
- [ ] **Step 3: 구현**

```ts
export const DAILY_RULES: ZoneRules = { cutShare: 0.06, gemMult: 1.5, gemMinTop: 4, edge: 0.02 };
export function zoneOf(t: { count: number; top100?: number | null; ranked_total?: number | null }, rules: ZoneRules = DAILY_RULES): { zone: ZoneKey | null; edge: boolean } {
  const N = t.ranked_total ?? 0;
  if (N <= 100 || t.top100 == null || t.count < 5) return { zone: null, edge: false };
  const p0 = 100 / N;
  const cut = Math.ceil(rules.cutShare * N);
  const share = t.top100 / t.count;
  if (t.count >= cut) return { zone: share >= p0 ? 'mainstream' : 'saturated', edge: Math.abs(share - p0) <= rules.edge + 1e-9 };
  if (t.top100 >= rules.gemMinTop && share >= rules.gemMult * p0) return { zone: 'gem', edge: false };
  return { zone: null, edge: false };
}
```
  `ZONE_LABEL` 은 `{ mainstream: '대세', gem: '숨은 강자', saturated: '과포화' }`, `ZONE_ORDER` 3개. `mainstreamCut`·`cold` 제거(사용처 함께). 정렬 키 `score_share`(인기 점수)·`top_share`(t/n)를 `sortValue` 에 추가, `DEFAULT_TAG_SORT` 는 `Rank` 그대로.
- [ ] **Step 4:** `npm test` 전부 PASS(지운 함수의 기존 테스트는 새 규칙 테스트로 대체).
- [ ] **Step 5: 커밋** — `태그 구역: 하루 판정 3구역 + 경계`

### Task 7: 프론트 — 칩 · 지도(표 위) · 표 · 펼침

**Files:** Modify `TagTerrainMap.tsx`, `DailyTagBoard.tsx`, `TagRowExpand.tsx`, `TagRankingsPage.tsx`, `ContestTagRankingsPage.tsx`, `styles/redesign.css`, `styles/tokens.css`(cold 토큰 정리)

**Interfaces:**
- Consumes: Task 6 `zoneOf`/`withZones`/`ZoneRules`, Task 5 API 필드.
- `DailyTagBoard` props 에 `rules?: ZoneRules`(공모전은 Task 4 결과), `scoreLabel`(데일리 '랭킹 점수', 공모전 '조회 증가').
- `TagTerrainMap` props: `rows: (ZonedTag & { top100: number })[]`, `ranked_total: number`, `rules`, `active`, `matches`, `onPick`, `onHover`.

- [ ] **Step 1:** `TagTerrainMap`: x = 작품 수(로그, 2~최대), y = 100위 안 비율 0~0.6 고정(넘으면 0.6 에 ▲). 세로선 cut, 가로선 p0('평균'), 숨은 강자 영역(x < cut, y ≥ gemMult·p0) `ReferenceArea` 옅은 칠. 점 반지름 고정 5, 색 = 구역(없으면 `var(--np-chart-bar)` 회색). `ZAxis` 제거. 이름표: 구역 있는 점만 기존 충돌 회피, 회색은 hover 때만. 툴팁 "작품 N편 · 100위 안 t편(x%) · 인기 점수 y%" 와 판단 보류 문구(x < cut, y ≥ 1.5·p0, t < 4).
- [ ] **Step 2:** `DailyTagBoard`: 순서 제목 → 구역 칩(태그 수 + 대표 3개, 누르면 기존 zone 필터) → 지도(폰 <768px 는 '지도 보기' 버튼으로 펼침) → 툴바·표 → 각주. 열 `순위 · 변동 · 태그(구역 점, '경계') · 인기 점수(x.x%) · 작품 수 · 100위 안("7편 · 32%")`. 지도 아래 한 줄 "작품 5편 미만 태그는 그리지 않습니다 · 시들어 가는 태그는 태그 트렌드에서". 지도 제목 아래 해설 문장 삭제. 각주 3개를 세 값의 한 문장 정의로.
- [ ] **Step 3:** `TagRowExpand`: '집중도 1.1×' 대신 '100위 안 t편 · x%'(시계열 `top`·`count`).
- [ ] **Step 4:** 페이지: 메타 문구에서 개수 반복을 빼고 출처만. 공모전은 `rules`·`scoreLabel` 전달.
- [ ] **Step 5:** `npm test` · `npx tsc -b` · `npm run lint` 통과. `scripts/shots.sh /tmp/shots-tag /tags/rankings /contests/2026/tags/rankings` 360/768/1200 라이트·다크 확인: 지도가 표 위, 회색 점·경계·칩, 폰 지도 접힘.
- [ ] **Step 6: 커밋** — `태그 랭킹 화면: 구역 칩 → 지도(표 위) → 표, 100위 안 · 랭킹 점수 점유율`

### Task 8: 문서

**Files:** Modify `docs/DECISIONS.md`(main · 웹 브랜치 각각 해당 부분), `docs/OPERATIONS.md`, 설계 문서 상태

- [ ] **Step 1:** DECISIONS(main): 「2026-10-06 — 태그 랭킹은 하루로 판단한다: 랭킹 점수 점유율 · 100위 안 · 구역 3개」(설계 1~4절 요약과 14일 실측, Task 4 공모전 결과), 2026-04-13 · 2026-08-25 항목 상태를 '일부 대체됨 (→ 2026-10-06)'.
- [ ] **Step 2:** OPERATIONS: 소급·측정 스크립트 사용법 한 줄씩. 설계 문서 상태 '구현됨'.
- [ ] **Step 3: 커밋**(main) — `태그 랭킹 하루 판정: 결정 기록과 운영 안내`
