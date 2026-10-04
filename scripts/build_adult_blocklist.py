"""성인 등급(19금) 소설 목록을 만들어 DynamoDB에 저장한다.

무엇을 위한 스크립트인가
    포트폴리오 공개 기간 동안 성인작을 화면에서 아예 제외하기 위한 **차단 목록**을
    만든다. 표지만 가려도 제목이 남기 때문에 목록 단위 필터가 필요했다.

    이것은 `IsAdult`(스냅샷별 관측값, 크롤러가 매일 기록)와 **다른 것**이다.
    `IsAdult`는 "그날 관측한 등급"이고, 이 목록은 "특정 시점에 19금으로 관측된
    소설 집합"이다. 과거 스냅샷에 소급 기록하지 않는 이유는 하지 않은 관측을
    주장하지 않기 위함이다(docs/DECISIONS.md 참고). 목록은 관측 시점을 함께
    저장하므로 그 문제가 없다.

왜 태그가 아니라 배지인가
    태그 기반 규칙은 실측에서 재현율 78%였다. 오늘 랭킹 500건의 실제 등급을
    확보해 평가한 결과, 성인 비율 100%인 태그 21개를 모두 써도 성인작 132건 중
    29건을 놓쳤다. 놓친 작품들의 태그는 `['판타지','현대','하렘']`처럼 일반작과
    구별이 불가능했고 상위권에도 있었다. 등급 배지는 서버가 `novel_age`로
    렌더하는 값이라 오차가 없다.

판정 근거
    상세 페이지의 `p.in-badge span.b_19` 존재 여부. 세션과 무관하므로 익명
    요청으로 충분하다. `span.b_19`로 넓히면 회차 목록 배지까지 잡히므로 반드시
    소설 정보 영역으로 한정한다.

사용법
    python scripts/build_adult_blocklist.py                  # 데일리 + 공모전 전량
    python scripts/build_adult_blocklist.py --scope daily    # 데일리만
    python scripts/build_adult_blocklist.py --limit 100      # 앞 100건만 (시험)
    python scripts/build_adult_blocklist.py --dry-run        # DB 저장 없이 판정만
    python scripts/build_adult_blocklist.py --refresh        # 캐시 무시하고 재판정

    중단해도 안전하다. 판정 결과는 캐시에 한 줄씩 append되므로 다시 실행하면
    남은 것만 이어서 처리한다.
"""
from __future__ import annotations

import argparse
import json
import pathlib
import sys
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor

import boto3
from boto3.dynamodb.conditions import Key
from bs4 import BeautifulSoup

REGION = "ap-northeast-2"
DAILY_TABLE = "NovelRanks"
CONTEST_TABLE = "ContestStats2025"

# 차단 목록을 담는 항목. 기존 AVAILABLE_DATES와 같은 규약을 따른다 —
# Ranking / AuthorID 속성이 없으므로 두 GSI 모두에서 sparse하게 빠진다.
BLOCKLIST_ID = "ADULT_BLOCKLIST"
BLOCKLIST_DATE = "ALL_DATES"

NOVEL_URL = "https://novelpia.com/novel/{}"
ADULT_BADGE = "p.in-badge span.b_19"
CACHE_PATH = pathlib.Path(__file__).with_name(".blocklist_cache.jsonl")

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    ),
    "Accept-Language": "ko-KR,ko;q=0.9",
}
TIMEOUT_SECONDS = 30


# ---------------------------------------------------------------------------
# 대상 수집
# ---------------------------------------------------------------------------
def collect_daily_ids(table) -> set[str]:
    """데일리 랭킹에 한 번이라도 등장한 모든 소설 ID."""
    ids: set[str] = set()
    kwargs = {"ProjectionExpression": "ID"}
    while True:
        response = table.scan(**kwargs)
        for item in response["Items"]:
            novel_id = str(item["ID"])
            # STATS# / AVAILABLE_DATES 등 집계 항목은 소설이 아니다.
            if novel_id.isdigit():
                ids.add(novel_id)
        if "LastEvaluatedKey" not in response:
            break
        kwargs["ExclusiveStartKey"] = response["LastEvaluatedKey"]
    return ids


def collect_contest_ids(table) -> set[str]:
    """공모전 풀 전체. 시즌 종료 후 고정이므로 최신 날짜 하나로 충분하다."""
    latest = _latest_contest_date(table)
    if not latest:
        return set()
    ids: set[str] = set()
    kwargs = {
        "IndexName": "DateViewIndex",
        "KeyConditionExpression": Key("Date").eq(latest),
        "ProjectionExpression": "ID",
    }
    while True:
        response = table.query(**kwargs)
        ids.update(str(item["ID"]) for item in response["Items"] if str(item["ID"]).isdigit())
        if "LastEvaluatedKey" not in response:
            break
        kwargs["ExclusiveStartKey"] = response["LastEvaluatedKey"]
    return ids


def _latest_contest_date(table) -> str | None:
    # 공모전 테이블은 데일리와 키 규약이 다르다 (CONTEST_AVAILABLE_DATES / METADATA).
    response = table.get_item(Key={"ID": "CONTEST_AVAILABLE_DATES", "Date": "METADATA"})
    item = response.get("Item")
    if item and item.get("dates"):
        return sorted(str(d) for d in item["dates"])[-1]
    return None


# ---------------------------------------------------------------------------
# 판정
# ---------------------------------------------------------------------------
def probe_is_adult(novel_id: str) -> bool | None:
    """익명 요청으로 등급 배지를 확인한다. 판정 불가 시 None."""
    request = urllib.request.Request(NOVEL_URL.format(novel_id), headers=HEADERS)
    for attempt in (1, 2):
        try:
            with urllib.request.urlopen(request, timeout=TIMEOUT_SECONDS) as response:
                html = response.read().decode("utf-8", errors="ignore")
            soup = BeautifulSoup(html, "html.parser")
            return soup.select_one(ADULT_BADGE) is not None
        except (urllib.error.URLError, TimeoutError, OSError):
            if attempt == 2:
                return None
            time.sleep(2)
    return None


def load_cache() -> dict[str, bool]:
    """이전 실행에서 판정한 결과. 판정 실패(None)는 캐시하지 않는다."""
    if not CACHE_PATH.exists():
        return {}
    cache: dict[str, bool] = {}
    for line in CACHE_PATH.read_text().splitlines():
        if not line.strip():
            continue
        try:
            row = json.loads(line)
        except json.JSONDecodeError:
            continue
        if isinstance(row.get("adult"), bool):
            cache[str(row["id"])] = row["adult"]
    return cache


# ---------------------------------------------------------------------------
def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--scope", choices=("all", "daily", "contest"), default="all")
    parser.add_argument("--workers", type=int, default=10)
    parser.add_argument("--limit", type=int, help="앞 N건만 처리 (시험용)")
    parser.add_argument("--dry-run", action="store_true", help="DB에 저장하지 않는다")
    parser.add_argument("--refresh", action="store_true", help="캐시를 무시하고 전부 재판정")
    args = parser.parse_args()

    dynamodb = boto3.resource("dynamodb", region_name=REGION)
    daily_table = dynamodb.Table(DAILY_TABLE)

    targets: set[str] = set()
    if args.scope in ("all", "daily"):
        targets |= collect_daily_ids(daily_table)
        print(f"데일리 대상 {len(targets):,}건")
    if args.scope in ("all", "contest"):
        contest_ids = collect_contest_ids(dynamodb.Table(CONTEST_TABLE))
        before = len(targets)
        targets |= contest_ids
        print(f"공모전 대상 {len(contest_ids):,}건 (신규 {len(targets) - before:,}건)")

    # --refresh 라도 이번에 판정하지 못한 작품(실패·--limit 로 잘림)은 마지막으로 성공한 판정을 이어받는다 — 빈 상태에서 시작해
    # 성공분만으로 목록을 통째로 교체하면 그 작품들이 차단 목록에서 조용히 빠졌다(리뷰 #29).
    previous = load_cache()
    cache = {} if args.refresh else dict(previous)
    todo = sorted(targets - set(cache), key=int)
    if args.limit is not None:
        if args.limit <= 0:
            parser.error("--limit는 1 이상이어야 한다 (전량 처리는 옵션을 생략)")
        todo = todo[: args.limit]

    print(
        f"총 {len(targets):,}건 / 캐시 {len(cache):,}건 / 판정할 것 {len(todo):,}건 "
        f"(workers={args.workers})"
    )

    failed = 0
    started = time.time()
    if todo:
        with CACHE_PATH.open("a") as cache_file:
            with ThreadPoolExecutor(max_workers=args.workers) as executor:
                for done, (novel_id, is_adult) in enumerate(
                    zip(todo, executor.map(probe_is_adult, todo)), 1
                ):
                    if is_adult is None:
                        failed += 1
                    else:
                        cache[novel_id] = is_adult
                        cache_file.write(json.dumps({"id": novel_id, "adult": is_adult}) + "\n")
                        cache_file.flush()
                    if done % 200 == 0:
                        rate = done / max(time.time() - started, 1)
                        left = (len(todo) - done) / max(rate, 0.01)
                        print(
                            f"  {done:,}/{len(todo):,}  성인 누적 {sum(cache.values()):,}  "
                            f"실패 {failed}  남은 시간 ~{left / 60:.0f}분",
                            flush=True,
                        )

    inherited = 0
    for nid in targets - set(cache):
        if nid in previous:
            cache[nid] = previous[nid]
            inherited += 1
    if inherited:
        print(f"이번에 판정하지 못한 {inherited:,}건은 이전 판정을 이어받았다.")
    adult_ids = sorted((nid for nid, flag in cache.items() if flag), key=int)
    print(
        f"\n판정 완료 {len(cache):,}건 / 성인작 {len(adult_ids):,}건 "
        f"({len(adult_ids) / max(len(cache), 1) * 100:.1f}%) / 실패 {failed}건 "
        f"/ {time.time() - started:.0f}초"
    )
    if failed:
        print(f"실패 {failed}건은 캐시에 남지 않았다. 다시 실행하면 그것만 재시도한다.")

    if args.dry_run:
        print("dry-run: DB에 저장하지 않았다.")
        return 0
    # 판정이 빠진 상태로는 운영 항목을 덮어쓰지 않는다 — 이전 판정도 없는 작품이 남았으면 실패분을 재시도한 뒤 저장한다.
    unjudged = len(targets - set(cache))
    if unjudged:
        print(f"판정이 없는 작품 {unjudged:,}건이 남아 저장하지 않는다(--limit·실패). 다시 실행해 재시도할 것.")
        return 1
    if not adult_ids:
        print("성인작이 없어 저장을 건너뛴다.")
        return 0

    daily_table.put_item(
        Item={
            "ID": BLOCKLIST_ID,
            "Date": BLOCKLIST_DATE,
            "novel_ids": adult_ids,
            "observed_at": time.strftime("%Y-%m-%d", time.localtime()),
            "checked_count": len(cache),
            "scope": args.scope,
        }
    )
    print(
        f"저장 완료: {DAILY_TABLE} / ID={BLOCKLIST_ID} / {len(adult_ids):,}건 "
        f"(검사 {len(cache):,}건)"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
