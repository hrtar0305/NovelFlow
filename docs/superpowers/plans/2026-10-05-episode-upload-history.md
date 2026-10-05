# 연재 기록 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 행 펼침의 30일 연재와 작품 상세의 기간 연재를, 회차 수 차이 추정 대신 **작품별 연재 기록(실제 회차 목록)** 하나에서 계산한다.

**Architecture:** 순수 함수 모듈 `episode_history.py`(목록 해석·병합·창 계산)를 크롤러·2026 파서·백엔드가 같은 사본으로 쓴다. 기록은
새 DynamoDB 테이블 `NovelFlowEpisodeHistory`(키 `NovelId`)에 작품 한 항목으로 쌓고, 데일리 get-novel-data·2026 파서가 수집 때마다
'마지막 확인 이후'만 받아 병합한다. 백엔드 `/api/uploads/{novel_id}` 가 날짜별 화 수를 주고, 프론트의 연재 줄 두 곳이 이것을 그린다.

**Tech Stack:** Python 3.13(Lambda zip/이미지, boto3, requests, bs4), DynamoDB, FastAPI(Mangum), React+TS(vitest).

**Spec:** `docs/superpowers/specs/2026-10-05-episode-upload-history-design.md`

## Global Constraints

- 새 AWS 리소스는 NovelFlow 이름(`NovelFlowEpisodeHistory`). 기존 np-trend 리소스 이름은 바꾸지 않는다.
- `main` = 배포 상태. 파이프라인 변경(crawler·contests·scripts·utils)은 main 에서 딴 짧은 브랜치로 합친다. 웹(`webapp/`)은 `feat/webapp-redesign`.
  **웹 브랜치에 파이프라인 코드를 넣지 않는다.**
- 같은 파일 사본은 같아야 한다: `episode_history.py` 는 `crawler/`(원본)·`contests/2026/contest_detail_parser/`·`webapp/backend/api/` — `scripts/check_copies.sh` 로 확인.
- AWS 를 건드리는 스크립트는 `--dry-run` 이 기본 경로다(먼저 돌린다).
- 2025 공모전은 넣지 않는다(화면에서도 연재를 숨긴다).
- 배포 태그: 데일리 `crawler-v1.7.0`, 2026 `contest2026-v1.1.0`(태그를 먼저 걸고 `deploy.sh code`).
- 하루의 값 원칙: 행 펼침 마감 = 데일리 D 22:00 KST, 공모전 D+1 01:00 KST.
- 커밋 메시지 한국어 한 줄 + 본문 '왜', 끝에 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- DECISIONS.md 는 append-only.

## Review Focus

1. **삭제가 있던 작품의 쪽**: 20칸 미만인 쪽이 중간에 온다 — 끝 판정이 칸 수로 멈추면 안 된다(Task 1 테스트 `test_short_page_is_not_last`).
2. **자정 걸친 상대 시각**: 00:30 에 받은 '2시간전'은 전날이다(Task 1 `test_relative_time_crosses_midnight`).
3. **사라졌다 다시 보인 회차**(비공개→공개): 기록을 지우지 않고 `gone` 을 풀어야 한다(Task 1 `test_reappear_clears_gone`).
4. **처음 보는 긴 작품**(수천 화)을 데일리 Lambda(300초) 안에서 다 받지 못함: 한 번에 120쪽까지, `Complete=false` 와 `OldestDate` 로 남기고 다음에 이어 받기(Task 1 `test_partial_history_marks_unknown_before_oldest`, Task 4 단계).
5. **마감 뒤에 본 회차**: 행 펼침 D 에는 들어가지 않아야 값이 고정된다 — 처음 본 시각 null(백필)은 날짜만 본다(Task 1 `test_window_cutoff`).

---

## 파일 구조

| 파일 | 할 일 |
|---|---|
| `crawler/episode_history.py` (새, 원본) | 순수 함수: 쪽 해석, 날짜 환산, 끝 판정, 병합, 창 계산 |
| `crawler/test_episode_history.py` (새) | unittest(표준 라이브러리) |
| `contests/2026/contest_detail_parser/episode_history.py`, `webapp/backend/api/episode_history.py` (사본) | 같은 파일 |
| `scripts/check_copies.sh` (새) | 사본 3쌍(raw_store·episode_history) 같은지 |
| `scripts/backfill_episode_history.py` (수정) | 해석을 모듈로 바꾸고 예약 줄(`tr.ep_style5`) 읽기 반영 |
| `scripts/setup_episode_history.sh` (새) | 테이블 + IAM(크롤러 역할 읽기·쓰기, 웹 API 역할 읽기) |
| `scripts/load_episode_history.py` (새) | 로컬 백필 → 테이블 적재, 원본 → S3 |
| `contests/2026/contest_detail_parser/parser.py` (수정) | `_attach_history` — 최신순 1쪽부터 마지막 확인일까지 |
| `crawler/app.py` (수정) | `_update_history` — 잔류율이 받은 최신순 쪽 재사용, 모자라면 더, 원본은 S3 따로 |
| `webapp/backend/api/main.py` (수정, 웹 브랜치) | `GET /api/uploads/{novel_id}` |
| `webapp/frontend/src/utils/uploads.ts` (새) + `.test.ts` | API 응답 → 칸·요약 |
| `webapp/frontend/src/components/novel/UploadCells.tsx`, `MetricsPanel.tsx`, `ranking/NovelRowExpand.tsx`, `services/api.ts` | 연재 줄 교체 |
| `webapp/frontend/src/utils/contestNovels.ts`, `metricSeries.ts` | `withDebutBaseline`·`uploadStats` 제거 |
| `scripts/report_episode_events.py` (새) | 감시 집계 |

---

### Task 1: 순수 모듈 `episode_history.py`

**Files:**
- Create: `crawler/episode_history.py`, `crawler/test_episode_history.py`, `scripts/check_copies.sh`
- Copy: `contests/2026/contest_detail_parser/episode_history.py`, (웹 브랜치에서) `webapp/backend/api/episode_history.py`
- Modify: `scripts/backfill_episode_history.py` (모듈 import)

**Interfaces:**
- Produces:
  - `parse_page(html: str, fetched_at: datetime) -> tuple[list[list], list[list], int]` — (회차 `[id, label, date|None, raw]`, 예약 `[id, title, text, fetched_iso]`, 칸 수)
  - `to_date(text: str, fetched_at: datetime) -> str|None`
  - `is_last_page(new_count: int, labels: list[str], slots: int) -> bool`
  - `merge(history: dict|None, seen: list[list], fetched_at_iso: str, covered_from: str|None, complete: bool, scheduled: list) -> dict` — 반환은 새 기록 dict(아래 모양)
  - `day_counts(history: dict, start: str, end: str, cutoff_iso: str|None) -> dict` — `{"days": {date: int|None}, "known_from": str|None, "known_until": str|None}`
  - 기록 dict 모양: `{"NovelId", "Episodes": {id: [date, first_seen|None, gone_at|None]}, "CheckedAt", "CheckedCount", "Complete": bool, "OldestDate": str|None, "Scheduled": [...], "Version": int}`

- [ ] **Step 1: 실패하는 테스트**

```python
# crawler/test_episode_history.py
import unittest
from datetime import datetime, timedelta, timezone
import episode_history as eh

KST = timezone(timedelta(hours=9))
def row(eid, label, date_txt):
    return (f'<div class="ep_style2"><span>{label}</span><span class="episode_count_view novel_count_view_{eid}">1</span>'
            f'<b>{date_txt}</b></div>')

class T(unittest.TestCase):
    def test_parse_and_relative_dates(self):
        at = datetime(2026, 10, 5, 12, 0, tzinfo=KST)
        html = row(3, 'EP.3', '9시간전') + row(2, 'EP.2', '26.10.04') + \
            '<table><tr class="ep_style5"><td><a onclick="location=\'/viewer/9\'"></a></td><td class="font12">제목</td><td class="ep_style3">공개예정 5시간후</td></tr></table>'
        eps, sch, slots = eh.parse_page(html, at)
        self.assertEqual([e[:3] for e in eps], [['3', 'EP.3', '2026-10-05'], ['2', 'EP.2', '2026-10-04']])
        self.assertEqual(slots, 2)
        self.assertEqual(sch[0][0], '9')

    def test_relative_time_crosses_midnight(self):
        self.assertEqual(eh.to_date('2시간전', datetime(2026, 10, 5, 0, 30, tzinfo=KST)), '2026-10-04')
        self.assertEqual(eh.to_date('41초전', datetime(2026, 10, 5, 0, 0, 20, tzinfo=KST)), '2026-10-04')

    def test_short_page_is_not_last(self):
        self.assertFalse(eh.is_last_page(19, ['EP.60', 'EP.42'], 19))     # 삭제가 있던 첫 쪽
        self.assertTrue(eh.is_last_page(0, ['EP.60'], 20))                # 새 회차 없음(마지막 쪽 반복)
        self.assertTrue(eh.is_last_page(3, ['EP.2', 'EP.1', 'EP.0'], 3))
        self.assertFalse(eh.is_last_page(20, ['EP.20', 'EP.1'], 20))      # EP.1 이 꽉 찬 쪽 끝 → EP.0 이 다음 쪽일 수 있다

    def test_merge_adds_marks_gone_and_reappear_clears_gone(self):
        h = eh.merge(None, [['1', 'EP.1', '2026-10-01', '26.10.01'], ['2', 'EP.2', '2026-10-02', '26.10.02']],
                     '2026-10-02T21:00:00+09:00', covered_from='2026-10-01', complete=True, scheduled=[])
        self.assertEqual(h['Episodes']['2'], ['2026-10-02', '2026-10-02T21:00:00+09:00', None])
        h2 = eh.merge(h, [['1', 'EP.1', '2026-10-01', '26.10.01']], '2026-10-03T21:00:00+09:00', '2026-10-01', True, [])
        self.assertEqual(h2['Episodes']['2'][2], '2026-10-03T21:00:00+09:00')   # 사라짐 표시, 지우지 않음
        h3 = eh.merge(h2, [['1', 'EP.1', '2026-10-01', '26.10.01'], ['2', 'EP.1', '2026-10-02', '26.10.02']],
                      '2026-10-04T21:00:00+09:00', '2026-10-01', True, [])
        self.assertIsNone(h3['Episodes']['2'][2])
        self.assertEqual(h3['Episodes']['2'][1], '2026-10-02T21:00:00+09:00')   # 처음 본 시각은 그대로

    def test_window_cutoff(self):
        h = {'Episodes': {'a': ['2026-10-04', None, None], 'b': ['2026-10-04', '2026-10-05T21:00:00+09:00', None],
                          'c': ['2026-10-03', '2026-10-03T21:00:00+09:00', '2026-10-04T21:00:00+09:00']},
             'CheckedAt': '2026-10-05T21:00:00+09:00', 'Complete': True, 'OldestDate': '2026-10-01'}
        r = eh.day_counts(h, '2026-10-03', '2026-10-04', cutoff_iso='2026-10-04T22:00:00+09:00')
        self.assertEqual(r['days'], {'2026-10-03': 1, '2026-10-04': 1})   # b 는 마감 뒤에 봤다, c 는 지워졌어도 센다

    def test_partial_history_marks_unknown_before_oldest(self):
        h = {'Episodes': {'a': ['2026-10-04', None, None]}, 'CheckedAt': '2026-10-05T12:00:00+09:00',
             'Complete': False, 'OldestDate': '2026-10-03'}
        r = eh.day_counts(h, '2026-10-01', '2026-10-06', cutoff_iso=None)
        self.assertEqual(r['days']['2026-10-02'], None)        # 받지 못한 앞부분
        self.assertEqual(r['days']['2026-10-03'], 0)
        self.assertEqual(r['days']['2026-10-06'], None)        # 마지막 확인 뒤
        self.assertEqual(r['known_until'], '2026-10-05')

if __name__ == '__main__':
    unittest.main()
```

- [ ] **Step 2: 실패 확인**

Run: `cd crawler && ../venv/bin/python -m unittest test_episode_history -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'episode_history'`

- [ ] **Step 3: 구현**

```python
# crawler/episode_history.py
"""작품별 연재 기록 — 노벨피아 회차 목록 해석·병합·날짜별 화 수(설계 docs/superpowers/specs/2026-10-05-episode-upload-history-design.md).
순수 함수만 둔다(I/O 없음). crawler/ 가 원본이고 contests/2026/contest_detail_parser/·webapp/backend/api/ 에 같은 파일을 둔다
(이미지·배포가 따로라 — scripts/check_copies.sh 로 확인).
"""
import re
from datetime import date, datetime, timedelta

_REL = re.compile(r'(\d+)\s*(초|분|시간)\s*전')
_DATE = re.compile(r'^(\d{2})\.(\d{2})\.(\d{2})$')


def to_date(text, fetched_at):
    """목록 날짜 원문 → 'YYYY-MM-DD'. 'YY.MM.DD' 또는 그날 올린 회차의 'N초전·N분전·N시간전'(받은 시각 KST 에서 뺀다)."""
    t = (text or '').strip()
    m = _DATE.match(t)
    if m:
        return f'20{m[1]}-{m[2]}-{m[3]}'
    m = _REL.search(t)
    if m:
        n, unit = int(m[1]), m[2]
        return (fetched_at - {'초': timedelta(seconds=n), '분': timedelta(minutes=n), '시간': timedelta(hours=n)}[unit]).date().isoformat()
    return None


def parse_page(html, fetched_at):
    """회차 목록 한 쪽 → (회차들 [고유번호, 'EP.N'·'BONUS', 날짜, 원문], 예약 [고유번호, 제목, 원문, 받은 시각], 칸 수).
    회차 키는 고유 번호(`novel_count_view_N`) — 'EP.N' 은 순서라 삭제 때 당겨진다. 예약은 따로 된 줄(`tr.ep_style5`)."""
    from bs4 import BeautifulSoup
    soup = BeautifulSoup(html or '', 'html.parser')
    eps, scheduled = [], []
    for tr in soup.select('tr.ep_style5'):
        text = re.sub(r'\s+', ' ', tr.get_text(' ', strip=True))
        if '공개예정' not in text:
            continue
        m = re.search(r'/viewer/(\d+)', str(tr))
        title, when = tr.select_one('td.font12'), tr.select_one('td.ep_style3')
        scheduled.append([m.group(1) if m else None, re.sub(r'\s+', ' ', title.get_text(' ', strip=True))[:80] if title else None,
                          re.sub(r'\s+', ' ', when.get_text(' ', strip=True)) if when else text[:80], fetched_at.isoformat()])
    divs = soup.select('div.ep_style2')
    for d in divs:
        sp = d.select_one('span.episode_count_view')
        m = re.search(r'novel_count_view_(\d+)', ' '.join(sp.get('class', []))) if sp else None
        if not m:
            continue
        num, b = d.select_one('span:first-child'), d.select_one('b')
        raw = b.get_text(strip=True) if b else ''
        eps.append([m.group(1), num.get_text(strip=True) if num else None, to_date(raw, fetched_at), raw])
    return eps, scheduled, len(divs)


def is_last_page(new_count, labels, slots):
    """최신순으로 넘길 때 이 쪽이 끝인가. 새 고유 번호가 없으면(마지막 쪽을 넘기면 같은 쪽이 다시 온다) 끝.
    가장 오래된 공개 회차는 늘 EP.0 이나 EP.1 이다 — 다만 EP.1 이 꽉 찬 쪽(20칸) 맨 끝이면 EP.0 이 다음 쪽에 있을 수 있다.
    칸 수로는 판정하지 않는다(삭제가 있던 작품은 첫 쪽이 20칸보다 적다 — 378108)."""
    if new_count == 0 or 'EP.0' in labels:
        return True
    return 'EP.1' in labels and not (labels[-1] == 'EP.1' and slots >= 20)


def merge(history, seen, fetched_at_iso, covered_from, complete, scheduled):
    """기록에 이번에 본 회차를 더한다. 새 고유 번호는 [날짜, 이번 시각, None]. 이번에 받은 범위(`covered_from` 이후 날짜) 안에
    있어야 하는데 없는 기존 회차는 사라진 시각만 적는다(지우지 않는다 — 지워진 회차의 업로드 날도 연재로 센다). 다시 보이면 푼다."""
    h = dict(history or {})
    eps = {k: list(v) for k, v in (h.get('Episodes') or {}).items()}
    seen_ids = set()
    for eid, _label, d, _raw in seen:
        seen_ids.add(eid)
        if d is None:
            continue
        if eid in eps:
            eps[eid][2] = None
        else:
            eps[eid] = [d, fetched_at_iso, None]
    for eid, v in eps.items():
        if eid not in seen_ids and v[2] is None and covered_from and v[0] >= covered_from:
            v[2] = fetched_at_iso
    dates = [v[0] for v in eps.values()]
    h.update({'Episodes': eps, 'CheckedAt': fetched_at_iso, 'CheckedCount': len(seen_ids),
              'Complete': bool(complete or h.get('Complete')),
              'OldestDate': min(dates) if dates else h.get('OldestDate'),
              'Scheduled': (h.get('Scheduled') or [])[-50:] + list(scheduled),
              'Version': int(h.get('Version') or 0) + 1})
    return h


def day_counts(history, start, end, cutoff_iso=None):
    """[start, end] 날짜별 올린 화 수. `cutoff_iso` 를 주면 처음 본 시각이 그 뒤인 회차는 뺀다(행 펼침 고정값 — 백필(None)은 날짜만 본다).
    값 None = 모름: 마지막 확인일 뒤, 또는 다 받지 못한 기록(`Complete=false`)의 가장 오래된 날짜 앞."""
    eps = (history or {}).get('Episodes') or {}
    checked = (history or {}).get('CheckedAt')
    known_until = checked[:10] if checked else None
    known_from = None if (history or {}).get('Complete') else (history or {}).get('OldestDate')
    counts = {}
    for d, first_seen, _gone in eps.values():
        if cutoff_iso and first_seen and first_seen > cutoff_iso:
            continue
        counts[d] = counts.get(d, 0) + 1
    out, cur, last = {}, date.fromisoformat(start), date.fromisoformat(end)
    while cur <= last:
        k = cur.isoformat()
        unknown = (known_until is None or k > known_until) or (known_from is not None and k < known_from)
        out[k] = None if unknown else counts.get(k, 0)
        cur += timedelta(days=1)
    return {'days': out, 'known_from': known_from, 'known_until': known_until}
```

```bash
# scripts/check_copies.sh
#!/usr/bin/env bash
# 이미지·배포가 따로라 같은 파일을 복사해 둔 것들이 서로 같은지 본다(CLAUDE.md 「컨벤션」).
set -euo pipefail
cd "$(dirname "$0")/.."
bad=0
for pair in "crawler/raw_store.py contests/2025/contest_detail_parser/raw_store.py" \
            "crawler/raw_store.py contests/2026/contest_detail_parser/raw_store.py" \
            "crawler/episode_history.py contests/2026/contest_detail_parser/episode_history.py" \
            "crawler/episode_history.py webapp/backend/api/episode_history.py"; do
  set -- $pair
  [ -f "$2" ] || { echo "없음: $2"; continue; }
  cmp -s "$1" "$2" || { echo "다름: $1 ↔ $2"; bad=1; }
done
exit $bad
```

- [ ] **Step 4: 통과 확인** — Run: `cd crawler && ../venv/bin/python -m unittest test_episode_history -v` → 6 tests OK
- [ ] **Step 5:** 사본 `cp crawler/episode_history.py contests/2026/contest_detail_parser/`. 백필 스크립트의 `to_date`/`parse`/끝 판정을 `sys.path.insert(0, 'crawler'); import episode_history as eh` 로 바꾼다(동작 같음 — `--dry-run --limit 3 --only contest` 로 확인). `bash scripts/check_copies.sh`(웹 사본은 Task 5 에서).
- [ ] **Step 6: 커밋** (브랜치 `feat/episode-history-core`, main 으로) — `연재 기록 순수 모듈: 회차 목록 해석·병합·날짜별 화 수(사본 확인 스크립트)`

### Task 2: 저장소와 백필 적재

**Files:** Create `scripts/setup_episode_history.sh`, `scripts/load_episode_history.py`

**Interfaces:** Consumes `episode_history.merge`(백필 결과를 처음 본 시각 None 으로 적재 — `merge` 가 아니라 직접 dict 생성: `{"NovelId", "Episodes": {id: [date, None, None]}, "CheckedAt": checked_at, "CheckedCount", "Complete": True, "OldestDate", "Scheduled", "Version": 1}`).

- [ ] **Step 1:** `setup_episode_history.sh` — 테이블(PAY_PER_REQUEST, 키 `NovelId` S, PITR, 삭제 방지), 크롤러 역할 `NpTrendCrawlerLambdaExecutionRole` 인라인 정책 `NovelFlowEpisodeHistoryRW`(GetItem·PutItem), 웹 API 역할 `service-role/NpTrendWebappAPIRole` 정책 `NovelFlowEpisodeHistoryRead`(GetItem). 계정 ID 는 `aws sts get-caller-identity` 로.
```bash
#!/usr/bin/env bash
set -euo pipefail
R=ap-northeast-2; ACC=$(aws sts get-caller-identity --query Account --output text); T=NovelFlowEpisodeHistory
ARN=arn:aws:dynamodb:$R:$ACC:table/$T
if ! aws dynamodb describe-table --region $R --table-name $T >/dev/null 2>&1; then
  aws dynamodb create-table --region $R --table-name $T --billing-mode PAY_PER_REQUEST \
    --attribute-definitions AttributeName=NovelId,AttributeType=S --key-schema AttributeName=NovelId,KeyType=HASH \
    --deletion-protection-enabled >/dev/null
  aws dynamodb wait table-exists --region $R --table-name $T
fi
aws dynamodb update-continuous-backups --region $R --table-name $T --point-in-time-recovery-specification PointInTimeRecoveryEnabled=true >/dev/null
aws iam put-role-policy --role-name NpTrendCrawlerLambdaExecutionRole --policy-name NovelFlowEpisodeHistoryRW --policy-document \
  "{\"Version\":\"2012-10-17\",\"Statement\":[{\"Effect\":\"Allow\",\"Action\":[\"dynamodb:GetItem\",\"dynamodb:PutItem\"],\"Resource\":\"$ARN\"}]}"
aws iam put-role-policy --role-name NpTrendWebappAPIRole --policy-name NovelFlowEpisodeHistoryRead --policy-document \
  "{\"Version\":\"2012-10-17\",\"Statement\":[{\"Effect\":\"Allow\",\"Action\":[\"dynamodb:GetItem\"],\"Resource\":\"$ARN\"}]}"
echo "done: $T"
```
- [ ] **Step 2:** `load_episode_history.py --src review/episode-history/2026-10-05 [--dry-run]` — `history.jsonl` 한 줄 → 위 dict, `batch_writer` 로 PutItem. `status == 'empty'` 도 빈 기록(`Episodes {}`, `Complete True`)으로 넣는다. `raw-*.jsonl.zst` 는 원본 버킷 `episode-history/backfill-2026-10-05/` 로 올린다. 항목 400KB 넘으면 실패로 보고(예상 최대 ~130KB). dry-run 은 작품 수·최대 항목 크기·예상 쓰기 단위만 출력.
- [ ] **Step 3:** 실행: setup → `load --dry-run` → `load`. 검증: `aws dynamodb get-item --key '{"NovelId":{"S":"378108"}}'` 의 `Episodes` 개수 60, `scan --select COUNT` = 6,401.
- [ ] **Step 4: 커밋** (`chore/episode-history-store`) — `연재 기록 저장소(NovelFlowEpisodeHistory)와 백필 적재 스크립트`. OPERATIONS 에 테이블·스크립트 한 줄.

### Task 3: 2026 공모전 파서 증분

**Files:** Modify `contests/2026/contest_detail_parser/parser.py`(`_parse_one` 뒤 `_attach_history`), `contests/2026/deploy.sh`(환경 변수 `EPISODE_HISTORY_TABLE`)

**Interfaces:** Consumes `eh.parse_page`, `eh.is_last_page`, `eh.merge`. 기록 읽기·쓰기 boto3 `Table.get_item` / `put_item(ConditionExpression=attr('Version').eq(v) | attr not exists)`.

- [ ] **Step 1:** `_attach_history(session, novel_id, pages, crawled_at, execution_id, write)`:
  - 기록 GetItem. 최신순 0쪽부터: 잔류율이 이미 받은 `UP` 쪽(pages 안 kind=episode_list, params.sort=='UP')은 다시 받지 않고 재사용, 없으면 `extract._episode_list_html(session, novel_id, 'UP', page, pages)` 로 받는다(원본 묶음에 그대로 들어간다).
  - 멈춤: `eh.is_last_page(...)` 또는 (기록 있음 and 그 쪽 가장 오래된 날짜 ≤ `CheckedAt` 날짜) 또는 120쪽.
  - `covered_from` = 받은 쪽들의 가장 오래된 날짜(끝까지 받았으면 None → 사라짐 판정은 받은 범위 전체), `complete` = 끝까지 받았거나 기존 기록이 complete.
  - `write` 가 True(실수집, dry_run 아님, reprocess 아님)일 때만 PutItem(Version 조건, 실패하면 다시 읽어 1회 병합). 실패해도 작품 처리는 계속(로그 WARNING, 다음 확인이 `CheckedAt` 부터 채운다).
  - 처음 본 시각 = `crawled_at`(상세를 받은 시각, 재시도에도 같은 값).
- [ ] **Step 2:** dry_run 이면 쓰지 않고 `{"history": {"new": n, "gone": g, "pages": p}}` 를 결과에 싣는다 → consolidate dry-run 보고에 합계(`history_new`, `history_gone`)를 더한다.
- [ ] **Step 3:** 로컬 검증: `ReplaySession` 대신 실제 `requests.Session` 으로 455628·378108 에 `_attach_history(write=False)` 호출 — 새 회차·예약 줄이 나오는지.
- [ ] **Step 4:** 그림자 실행 `{"skip_discovery": true, "raw": false, "dry_run": true, "target_date": "<어제>"}` — `history_new` 가 그날 새 회차 수와 비슷한지, 실행 시간 증가(예상 +50%).
- [ ] **Step 5:** 태그 `contest2026-v1.1.0` → `bash contests/2026/deploy.sh code`. 다음 자정 뒤 `NovelFlowEpisodeHistory` 의 공모전 작품 `CheckedAt` 이 자정 시각으로 바뀌었는지.
- [ ] **Step 6: 커밋/머지** — `2026 공모전 파서: 매일 최신순 1쪽으로 연재 기록을 갱신(회차 수가 같아도 — 삭제 후 재업로드)`

### Task 4: 데일리 크롤러 증분

**Files:** Modify `crawler/app.py`(잔류율 블록 뒤 `_update_history`), `crawler/Dockerfile`(episode_history.py 포함 확인), `crawler/requirements.txt`(변경 없음 — 추가 쪽은 gzip 단일 객체)

- [ ] **Step 1:** `_update_history(session, novel_id, raw_pages, execution_id)`: Task 3 과 같은 규칙. 잔류율이 받은 `UP` 쪽을 재사용하고 모자란 쪽만 `_get_episode_list_html(..., pages=extra_pages)` 로 더 받는다. **추가 쪽은 SQS 원본에 얹지 않는다**(256KB 한도) — `extra_pages` 가 있으면 원본 버킷 `episode-history/{date}/{novel_id}.json.gz` 로 따로 PUT(`raw_store.build_payload` 재사용). 처음 보는 작품은 전체 목록(최대 120쪽 ≈ 85초 — Lambda 300초). 처음 본 시각 = 상세를 받은 시각.
- [ ] **Step 2:** 기록 실패는 작품 전송을 막지 않는다(로그). `test_mode` 경로는 get-novel-data 를 부르지 않으므로 영향 없음.
- [ ] **Step 3:** 이미지 `crawler:1.7.0` 빌드·두 Lambda 갱신(OPERATIONS 「크롤러」). 연기 시험: 이전처럼 get-novel-data 직접 호출 2편(하나는 기록 있는 작품, 하나는 기록 지운 작품 — 시험용 작품 번호의 항목만 지우고 다시 만든다) → 큐 메시지 지우기 → 기록 `CheckedAt`·새 회차 확인.
- [ ] **Step 4:** 태그 `crawler-v1.7.0`, 머지. 다음 21:00 뒤: 500편 `CheckedAt` 갱신, 재진입 작품의 추가 쪽 수(로그), get-novel-data 평균 시간(현재 4.35초) 비교.

### Task 5: 백엔드 API (웹 브랜치)

**Files:** Copy `webapp/backend/api/episode_history.py`; Modify `webapp/backend/api/main.py`

- [ ] **Step 1:** 엔드포인트:
```python
history_table = dynamodb.Table(os.environ.get('EPISODE_HISTORY_TABLE', 'NovelFlowEpisodeHistory'))
_CUTOFF = {'daily': lambda d: f'{d}T22:00:00+09:00',
           'contest2026': lambda d: f'{(datetime.fromisoformat(d) + timedelta(days=1)).date().isoformat()}T01:00:00+09:00'}

@app.get("/api/uploads/{novel_id}")
def get_uploads(novel_id: str, start: str, end: str, response: Response, asof: Optional[str] = None, source: Optional[str] = None):
    """연재 기록에서 날짜별 올린 화 수. `asof`+`source`(daily|contest2026) 를 주면 그 날짜 수집 마감까지 본 회차만(행 펼침 고정값)."""
    _reject_if_blocked(novel_id)
    s, e = _parse_date_range(start, end, NOVEL_TREND_MAX_DAYS)
    item = _convert_decimals(history_table.get_item(Key={'NovelId': novel_id}).get('Item'))
    cutoff = _CUTOFF[source](asof) if asof and source in _CUTOFF else None
    out = episode_history.day_counts(item, s.strftime('%Y-%m-%d'), e.strftime('%Y-%m-%d'), cutoff) if item else \
        {'days': {}, 'known_from': None, 'known_until': None}
    response.headers["Cache-Control"] = "public, max-age=600, s-maxage=600"
    return {**out, 'tracked': bool(item)}
```
  (`main.py` 상단 `import episode_history`, `Dockerfile.arm64` 는 `api/*.py` 를 복사하므로 그대로 들어간다.)
- [ ] **Step 2:** 로컬 서버로 `curl 'localhost:8000/api/uploads/378108?start=2026-09-25&end=2026-10-05'` → 10/03·10/04 가 1(회차 수 차이로는 '쉰 날'이던 날). `&asof=2026-10-04&source=daily` 로 10/05 회차가 빠지는지.
- [ ] **Step 3: 커밋**(웹 브랜치) — `백엔드: 연재 기록 API(/api/uploads) — 행 펼침은 그날 수집 마감까지 본 회차만`. 배포 안내(사용자) + 웹 API 역할 정책은 Task 2 에서 붙였음.

### Task 6: 프론트 — 연재 줄 두 곳 교체 (웹 브랜치)

**Files:** Create `webapp/frontend/src/utils/uploads.ts`, `uploads.test.ts`; Modify `services/api.ts`, `components/novel/UploadCells.tsx`, `components/novel/MetricsPanel.tsx`, `components/ranking/NovelRowExpand.tsx`, `utils/metricSeries.ts`(uploadStats 제거), `utils/contestNovels.ts`(withDebutBaseline·CONTEST_OPEN_DATE 제거 + 테스트 제거), `hooks/useContestNovelData.ts`

**Interfaces:**
- `getUploads(novelId: string, start: string, end: string, asof?: { date: string; source: 'daily' | 'contest2026' }): Promise<UploadsResponse>`
- `type UploadsResponse = { days: Record<string, number | null>; known_from: string | null; known_until: string | null; tracked: boolean }`
- `uploadSummary(days: Record<string, number|null>): { known: number; uploaded: number; streak: number; resting: number }` — 끝에서부터 연속(올린 날 연속, 쉰 날 연속), 모름(null)에서 끊는다.
- `UploadCells` props: `{ dates: string[]; days: Record<string, number|null>; X: (i:number)=>number; cw; h; y?; hover?; showCount? }` — 칸 = 그 날짜의 화 수(0 쉰 날, ≥1 올린 날, 2 이상이고 칸이 넓으면 수, null 모름).

- [ ] **Step 1: 실패하는 테스트**
```ts
// webapp/frontend/src/utils/uploads.test.ts
import { describe, expect, it } from 'vitest';
import { uploadSummary } from './uploads';
describe('uploadSummary', () => {
  it('끝에서 센 연속 연재, 모름에서 끊는다', () => {
    expect(uploadSummary({ '2026-10-01': 1, '2026-10-02': 2, '2026-10-03': 1 })).toEqual({ known: 3, uploaded: 3, streak: 3, resting: 0 });
    expect(uploadSummary({ '2026-10-01': 1, '2026-10-02': null, '2026-10-03': 1 })).toEqual({ known: 2, uploaded: 2, streak: 1, resting: 0 });
    expect(uploadSummary({ '2026-10-01': 1, '2026-10-02': 0, '2026-10-03': 0 })).toEqual({ known: 3, uploaded: 1, streak: 0, resting: 2 });
  });
  it('끝이 모름이면 연속을 세지 않는다', () => {
    expect(uploadSummary({ '2026-10-01': 1, '2026-10-02': null })).toEqual({ known: 1, uploaded: 1, streak: 0, resting: 0 });
  });
});
```
- [ ] **Step 2:** `npm test -- uploads` → FAIL(모듈 없음)
- [ ] **Step 3: 구현**
```ts
// webapp/frontend/src/utils/uploads.ts
/** 연재 기록 API(`/api/uploads`)의 날짜별 화 수 → 요약. null = 모름(마지막 확인 뒤·다 받지 못한 앞부분). */
export type UploadDays = Record<string, number | null>;
export function uploadSummary(days: UploadDays) {
  const dates = Object.keys(days).sort();
  const known = dates.filter(d => days[d] != null);
  const uploaded = known.filter(d => (days[d] ?? 0) > 0).length;
  let streak = 0; let resting = 0;
  for (let i = dates.length - 1; i >= 0; i--) {
    const v = days[dates[i]];
    if (v == null) break;
    if (v > 0) { if (resting) break; streak++; } else { if (streak) break; resting++; }
  }
  return { known: known.length, uploaded, streak, resting };
}
```
- [ ] **Step 4:** `UploadCells` 를 `dates/days` 입력으로 바꾸고(점선 '여러 날치' 칸은 없어진다 — 실제 날짜별이라), `NovelRowExpand` 는 `getUploads(id, D-29, D, { date: D, source })`(공모전 2026 은 `contest2026`, 2025 는 연재 줄 숨김)로, `MetricsPanel` 은 상세 페이지가 넘기는 `uploads`(기간 시작~끝, asof 없음)로 그린다. 요약 문구는 `uploadSummary`. `withDebutBaseline` 과 그 테스트, `metricSeries.uploadStats` 와 테스트를 지운다(`d.eps` 기반 '회차 +N' 표기는 남긴다).
- [ ] **Step 5:** `npm test`, `npx tsc -b`, `npm run lint` 통과. 스크린샷(데일리·공모전 펼침, 상세 30일): 378108 의 10/03·10/04 가 올린 날로, 공모전 첫날(10/1)이 올린 날로 나오는지.
- [ ] **Step 6: 커밋**(웹 브랜치) — `연재 줄을 연재 기록 API 로: 회차 수 차이 추정·'전날 = 0' 땜질을 걷어낸다`

### Task 7: 감시와 문서

**Files:** Create `scripts/report_episode_events.py`; Modify `docs/DECISIONS.md`, `docs/OPERATIONS.md`, `CLAUDE.md`, 설계 문서 상태

- [ ] **Step 1:** `report_episode_events.py [--days 7]` — 테이블 스캔: 최근 N일 사라진 회차 수(`gone_at`), 늦은 등장(처음 본 날 − 날짜 ≥ 2일, 처음 본 시각 있는 것만), 예약 관찰 수, `Complete=false` 작품 수. 출력만(쓰기 없음).
- [ ] **Step 2:** 예약 감시(`review/episode-history/scheduled_watch.jsonl`) 결론을 DECISIONS 에(목록 날짜 = 공개일 여부, 330742 결과 포함).
- [ ] **Step 3:** CLAUDE.md 「변경 전 확인」: '연재는 연재 기록에서만 — 회차 수 차이로 되돌리지 말 것', 사본 목록에 `episode_history.py`, 특수 테이블 한 줄. OPERATIONS: 테이블·백필·감시 스크립트.
- [ ] **Step 4: 커밋**(main) — `연재 기록 감시 스크립트와 문서`
