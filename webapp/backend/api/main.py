import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'package'))
# 같은 폴더의 모듈(analysis_report)을 찾게 api/ 자신도 넣는다. Lambda 핸들러는 `api.main.handler`라
# `importlib.import_module('api.main')`으로 불리고, 그때 sys.path 에는 /var/task 만 있다 — 로컬의
# `python api/main.py`는 스크립트 폴더가 자동으로 들어가 이 문제가 안 보인다.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

# 로컬 개발 환경: .env 파일이 있으면 환경 변수로 로드 (이미 설정된 값은 덮어쓰지 않음)
_env_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '.env')
if os.path.exists(_env_path):
    with open(_env_path) as _f:
        for _line in _f:
            _line = _line.strip()
            if _line and not _line.startswith('#') and '=' in _line:
                _k, _v = _line.split('=', 1)
                os.environ.setdefault(_k.strip(), _v.strip())

import logging
import boto3
import decimal
import math
import re
import time
from fastapi import FastAPI, HTTPException, Query, Response
from fastapi.middleware.cors import CORSMiddleware
from mangum import Mangum
from pydantic import BaseModel, Field
from boto3.dynamodb.conditions import Key, Attr
from botocore.config import Config as BotoConfig
from boto3.dynamodb.types import TypeDeserializer
from botocore.exceptions import ClientError
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta
from typing import Optional, List, Dict, Any
import analysis_report as AR
import episode_history

# 로거 설정 (Lambda root logger 사용 — basicConfig는 Lambda에서 무효)
logger = logging.getLogger()
logger.setLevel(logging.INFO)

# FastAPI 애플리케이션 인스턴스 생성
app = FastAPI()

# CORS 미들웨어 설정
# 정적 도메인 (운영 환경)
origins = [
    "https://d2ti06wylez2yq.cloudfront.net", # CloudFront Domain
]

# 개발 환경을 위한 정규식
dev_origin_regex = r"https?://(localhost|127\.0\.0\.1|172\.\d+\.\d+\.\d+):\d+"

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_origin_regex=dev_origin_regex,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Mangum 핸들러 생성: FastAPI 앱을 Lambda에서 실행 가능하도록 변환
handler = Mangum(app)

# DynamoDB 리소스 초기화
dynamodb = boto3.resource('dynamodb', region_name='ap-northeast-2')
table = dynamodb.Table('NovelRanks')

# 스레드에서 쓰는 조회는 이쪽으로. **`resource`·`Table` 은 스레드 안전하지 않고
# botocore `client` 는 안전하다**(AWS 문서). 커넥션 풀 기본값이 10이라 동시 16으로
# 도는 구간에서 그대로 두면 절반이 커넥션을 기다린다.
ddb_client = boto3.client('dynamodb', region_name='ap-northeast-2',
                          config=BotoConfig(max_pool_connections=32))
# 연도 → 공모전 테이블. 2026 부터는 NovelFlow 이름(DECISIONS 2026-10-01). 없는 연도는 404.
CONTEST_TABLES = {
    2025: dynamodb.Table('ContestStats2025'),
    2026: dynamodb.Table(os.environ.get('CONTEST_TABLE_2026', 'NovelFlowContest2026')),
}
# 연재 기록(작품별 실제 회차 목록). 크롤러·2026 파서가 쓰고 여기선 읽기만 한다(DECISIONS 2026-10-05).
history_table = dynamodb.Table(os.environ.get('EPISODE_HISTORY_TABLE', 'NovelFlowEpisodeHistory'))
# 기성 작가 판정의 기준선: 그해 공모전 첫 참가작 번호. 이보다 작은 다른 작품이 있으면 기성이다.
# 신인이 공모전에 두 작품을 함께 내도 기성이 되지 않게 '다른 작품이 있나'가 아니라 '그 전 작품이 있나'로 본다.
CONTEST_FIRST_NOVEL_ID = {2026: 455325}
NOVELPIA_COVER_URL_MARKER = "images.novelpia.com/imagebox/cover/"

def _env_ids(var_name: str) -> list[str]:
    """쉼표로 나눈 ID 목록(순서 유지)."""
    return [s.strip() for s in os.environ.get(var_name, '').split(',') if s.strip()]

# 공모전 수상작 ID. 우선순위 순서대로 상을 정의한다(`_get_contest_award` 가 앞에서부터 본다).
# 환경변수는 `{접두}_IDS_{연도}` — 2026 수상작은 발표 후 같은 이름 규칙(…_IDS_2026)으로 넣는다. 그 전에는 비어 있다.
_AWARD_ENV = {'대상': 'GRAND_PRIZE', '최우수상': 'TOP_EXCELLENCE_AWARD', '탑툰상': 'TOPTOON_AWARD',
              '우수상': 'WINNER_AWARD', '특별상': 'SPECIAL_AWARD', '본선': 'FINALIST'}
CONTEST_AWARDS = {y: {k: set(_env_ids(f'{v}_IDS_{y}')) for k, v in _AWARD_ENV.items()} for y in (2025, 2026)}
CONTEST_SHOWCASE_IDS_2025 = _env_ids('CONTEST_SHOWCASE_IDS_2025')

def get_contest_showcase_ids_2025():
    """지정 쇼케이스 ID 다음에 대상 · 탑툰상 · 최우수상 순으로 채워 4개."""
    awards = (i for e in ('GRAND_PRIZE', 'TOPTOON_AWARD', 'TOP_EXCELLENCE_AWARD') for i in _env_ids(f'{e}_IDS_2025'))
    return list(dict.fromkeys([*CONTEST_SHOWCASE_IDS_2025, *awards]))[:4]

def _convert_decimals(obj):
    """DynamoDB Decimal을 int/float으로 직접 변환 (json 이중 파싱 없이)."""
    if isinstance(obj, list):
        return [_convert_decimals(i) for i in obj]
    elif isinstance(obj, dict):
        return {k: _convert_decimals(v) for k, v in obj.items()}
    elif isinstance(obj, decimal.Decimal):
        return int(obj) if obj % 1 == 0 else float(obj)
    return obj

def _server_error(context_msg: str) -> HTTPException:
    """내부 예외는 서버 로그(traceback 포함)에만 남기고 클라이언트에는 일반 메시지를 반환합니다."""
    logger.exception(context_msg)
    return HTTPException(status_code=500, detail="Internal server error.")

def _parse_date(value: str) -> datetime:
    """경로의 날짜(YYYY-MM-DD). 형식이 틀리면 400 — ValueError 가 그대로 올라가면 CORS 헤더 없는 500이 된다."""
    try:
        return datetime.strptime(value, '%Y-%m-%d')
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid date format. Use YYYY-MM-DD.")

# 기간 엔드포인트의 상한. 공개 API라 `0001-01-01~9999-12-31` 같은 요청 하나로 날짜마다 dict 를 만들어
# Lambda 메모리·시간을 다 쓸 수 있다. 작품 추이는 프론트가 첫 수집일(2025년 초)부터 고를 수 있어 넉넉히 둔다.
NOVEL_TREND_MAX_DAYS = 1100
TAG_RANGE_MAX_DAYS = 180

def _parse_date_range(start: str, end: str, max_days: int) -> tuple[datetime, datetime]:
    start_dt, end_dt = _parse_date(start), _parse_date(end)
    if end_dt < start_dt:
        raise HTTPException(status_code=400, detail="end_date must not precede start_date.")
    if (end_dt - start_dt).days > max_days:
        raise HTTPException(status_code=400, detail=f"Range must be {max_days} days or fewer.")
    return start_dt, end_dt

def _query_all_pages(tbl, **args) -> list[dict]:
    """Query 를 LastEvaluatedKey 끝까지 따라간다. 1MB 한도는 투영 전 크기 기준이라 투영해도 잘린다."""
    items = []
    while True:
        page = tbl.query(**args)
        items.extend(page.get('Items', []))
        if 'LastEvaluatedKey' not in page:
            return items
        args['ExclusiveStartKey'] = page['LastEvaluatedKey']

def _batch_get(keys: list[dict], **proj) -> list[dict]:
    """`table` 에서 키 목록을 batch_get_item 으로 읽는다(한 번에 100개). 스로틀링 등으로 처리 못한 키는
    UnprocessedKeys 로 돌아오므로 비어질 때까지 백오프를 두고 다시 묻는다 — 안 그러면 일부 날짜가 조용히 빠진다."""
    items = []
    for i in range(0, len(keys), 100):
        unprocessed = {table.name: {'Keys': keys[i:i + 100], **proj}}
        backoff = 0.05
        while unprocessed:
            res = dynamodb.batch_get_item(RequestItems=unprocessed)
            items.extend(res.get('Responses', {}).get(table.name, []))
            unprocessed = res.get('UnprocessedKeys') or {}
            if unprocessed:
                time.sleep(backoff)
                backoff = min(backoff * 2, 1.0)
    return items

def _days(start_dt: datetime, end_dt: datetime) -> list[str]:
    """start~end(양끝 포함)의 달력 날짜 문자열."""
    return [(start_dt + timedelta(days=i)).strftime('%Y-%m-%d') for i in range((end_dt - start_dt).days + 1)]

# --- 자리표시(placeholder) 행 ----------------------------------------------------
# 수집에 실패한 작품도 행은 남는다. 데일리는 Title 'N/A (…)'에 수치 0(순위·점수는 정상),
# 2026 공모전은 같은 제목에 수치 -1, 2025 공모전 삭제작은 View -1 이다. 최신 행 하나만 읽으면
# 그날 실패한 작품의 상세가 'N/A (…)'·조회 0(-1)이 되므로, 값은 직전 정상 행에서 가져온다.
_PLACEHOLDER_VALUE_KEYS = ('View', 'Like', 'Fav', 'Alr', 'Eps')

def _is_placeholder_row(item: dict) -> bool:
    return str(item.get('Title') or '').startswith('N/A (') or item.get('View') == -1

def _latest_real_row(rows: list[dict], keep_from_latest: tuple[str, ...]) -> dict | None:
    """날짜 내림차순 행들에서 '최신 상세'를 고른다.

    최신 행이 정상이면 그대로. 자리표시면 제목·수치 등은 직전 정상 행에서 가져오되,
    `keep_from_latest`(그날의 날짜·순위처럼 자리표시에도 맞는 값)는 최신 행 것을 쓴다 —
    날짜를 옛날로 돌리면 화면이 '오늘 순위권 밖'으로 읽는다. 값이 온 날은 `values_date`,
    최신 수집이 자리표시였다는 사실은 `is_unavailable` 로 알린다. 정상 행이 없으면 수치를 None 으로 내린다.
    """
    if not rows:
        return None
    latest = rows[0]
    if not _is_placeholder_row(latest):
        return latest
    real = next((r for r in rows[1:] if not _is_placeholder_row(r)), None)
    if real is None:
        item = dict(latest)
        for k in _PLACEHOLDER_VALUE_KEYS:
            item[k] = None
    else:
        item = dict(real)
        for k in keep_from_latest:
            item[k] = latest.get(k)
        item['values_date'] = real.get('Date')
    item['is_unavailable'] = True
    return item

def _query_latest_rows(tbl, novel_id: str, limit: int, max_rows: int = 400) -> list[dict]:
    """소설 파티션의 최근 행(날짜 내림차순) — 처음 `limit` 행, 그 안에 정상 행이 없으면 정상 행이 나올 때까지 더 읽는다.

    삭제·비공개된 작품은 자리표시가 몇 달 이어진다(2025 공모전 최신일 4,719행 중 2,570행이 자리표시이고, 대부분 정상 행이
    10행보다 과거다 — 최종 검증 2026-10-03). 그래서 `limit` 안에 정상 행이 없으면 `max_rows` 까지 이어 읽는다.
    FilterExpression 은 Limit 뒤에 걸러 쓰지 않는다.
    """
    rows: list[dict] = []
    kwargs = {'KeyConditionExpression': Key('ID').eq(novel_id), 'ScanIndexForward': False, 'Limit': limit}
    while True:
        db_response = tbl.query(**kwargs)
        page = _convert_decimals(db_response.get('Items', []))
        rows.extend(page)
        if any(not _is_placeholder_row(r) for r in page) or 'LastEvaluatedKey' not in db_response or len(rows) >= max_rows:
            return rows
        kwargs['ExclusiveStartKey'] = db_response['LastEvaluatedKey']
        kwargs['Limit'] = 50

def _derive_serial_status(item: dict) -> str | None:
    """그 스냅샷의 연재 상태. 판정은 여기 한 곳에서만 하고 적재 시점에 굳히지 않는다.

    크롤러는 상세 페이지 `p.in-badge` 의 span 을 전부 `Badges` 로 싣고(2026-09-05~),
    `b_*` class 가 없는 상태 배지(연재중단·연재지연 등)의 텍스트만 `SerialStatus` 로 따로 싣는다.
    완결은 `b_comp` class 배지라 `SerialStatus` 에 들어가지 않으므로 여기서 합친다.

        SerialStatus 있음            → 그 값(모르는 상태도 그대로 — 아는 값으로 좁히지 않는다)
        Badges 에 b_comp             → '완결'
        Badges 있음(위 둘 다 없음)   → '연재중'
        Badges 없음                  → None (기록 없음: 2026-09-05 이전 스냅샷 등)
    """
    badges = item.get('Badges')
    if not isinstance(badges, list):
        return None
    status = item.get('SerialStatus')
    if status:
        return str(status)
    if any('b_comp' in (b.get('class') or []) for b in badges if isinstance(b, dict)):
        return '완결'
    return '연재중'

# 배지 class → 표시 이름. 상태(완결)·등급(19/15)은 따로 내보내므로 여기서 뺀다.
# 모르는 class 라도 텍스트가 있으면 그 텍스트를 그대로 쓴다(아는 값으로 좁히지 않는다).
_BADGE_SKIP = {'b_comp', 'b_19', 'b_15'}
_BADGE_LABEL = {'b_plus': 'PLUS', 'b_mono': '독점', 'b_challenge': '챌린지', 'b_free': '자유연재'}


def _badge_labels(item: dict) -> list[str]:
    """상세 머리에 보일 배지 이름들(PLUS · 독점 · 챌린지 …). 이미지뿐인 이벤트 배지(텍스트 없음)는 뺀다."""
    out: list[str] = []
    for b in item.get('Badges') or []:
        if not isinstance(b, dict):
            continue
        classes = b.get('class') or []
        if not classes or _BADGE_SKIP.intersection(classes):
            continue   # class 없는 배지는 연재 상태(SerialStatus)다
        label = next((_BADGE_LABEL[c] for c in classes if c in _BADGE_LABEL), None) or b.get('text')
        if label and label not in out:
            out.append(label)
    return out


def _age_rating(item: dict) -> str | None:
    """이용 등급 표기. 19세는 정책 판정과 같은 신호(`is_adult`)를 쓰고, 15세는 배지로 본다."""
    if item.get('is_adult'):
        return '19세'
    if any('b_15' in (b.get('class') or []) for b in item.get('Badges') or [] if isinstance(b, dict)):
        return '15세'
    return None


def _life_pick_rank(item: dict) -> int | None:
    """인생픽 칸 원문('9위' / '공개전', 크롤러 `LifePick`)에서 순위. 순위가 없으면 None."""
    m = re.fullmatch(r'\s*([\d,]+)\s*위\s*', str(item.get('LifePick') or ''))
    return int(m.group(1).replace(',', '')) if m else None


def _compute_retention_rates(item: dict) -> dict:
    """DB 원본 수치에서 초반/최신 잔류율 계산 (단순 구간 비율).

    - EarlyRetentionRate: 1번째 유효 회차 대비 30번째 유효 회차의 조회수 비율
    - RecentRetentionRate: 최신화 역순 30번째 대비 최신화의 조회수 비율

    30화 기준은 노벨피아 무료분(첫 15화)의 두 배다. 커뮤니티에서 흔히 쓰는
    4화 기준은 문피아의 편당 결제 구조에서 나온 것이라 그대로 옮기면 맞지 않는다.

    유효 회차가 30개에 못 미치면 Early는 **계산하지 않는다**(None). 예전에는
    '최신화 / 1화'로 대체 계산했는데, 그러면 (a) 화면에 아무 표시 없이 다른
    정의의 값이 섞이고 (b) Early와 Recent가 최신화 조회수를 분자로 공유해
    아직 덜 찬 최신화의 왜곡이 두 숫자에 동시에 실린다. 정렬해서 나란히 볼 때
    서로 다른 것을 비교하게 되는 문제가 여기서 나왔다.
    """
    result = {"EarlyRetentionRate": None, "RecentRetentionRate": None}

    first_view = item.get("FirstEpView")
    ep30_view = item.get("Ep30View")
    latest_view = item.get("TargetLatestEpView")
    base_view = item.get("RecentBaseView")

    # Early: 1번째 유효 회차 대비 30번째 유효 회차 비율. 30번째가 없으면 미산출.
    if first_view and first_view > 0 and ep30_view and ep30_view > 0:
        result["EarlyRetentionRate"] = round(ep30_view / first_view, 4)

    # Recent: 최신화 역순 30번째 대비 최신화 비율. 2026 공모전은 못 읽은 값을 -1 로 싣는다(데일리 적재는
    # -1 을 버린다) — -1 은 참으로 평가되므로 `> 0` 으로 막는다(0 은 예전처럼 미산출).
    if base_view and base_view > 0 and latest_view and latest_view > 0:
        result["RecentRetentionRate"] = round(latest_view / base_view, 4)

    return result

# --- 표지 응답 필드 ------------------------------------------------------------
# 표지를 내려보내는 모든 엔드포인트는 반드시 아래 두 함수를 지난다. 표지 URL
# 정리와 성인작 판정을 한 곳에 모아 둔 이유는, 둘을 따로 호출하던 동안 실제로
# 누락이 생겼기 때문이다 — 쇼케이스에만 성인 플래그를 붙이고 목록·상세·작가
# 페이지에는 붙이지 않아, 프론트에서 조용히 `false`로 떨어져 성인작 표지가
# 노출될 수 있었다. 엔드포인트가 늘어도 같은 실수가 반복되지 않도록 합친다.
#
# 성인 여부는 요청 경로에서 판정하지 않고 `IsAdult` 속성을 읽기만 한다. 크롤러가
# 상세 페이지의 등급 배지로 매 수집마다 판정해 raw data에 기록한다(근거는
# docs/DECISIONS.md). 값이 없는 과거 스냅샷은 False가 되지만, 표지는 이미 기본
# 블러 상태이므로 판정 공백이 화면을 깨뜨리지 않는다.
def _is_valid_cover_url(url: str | None) -> bool:
    if not url:
        return False
    return NOVELPIA_COVER_URL_MARKER in url.strip()

def _prepare_cover_fields(item: dict) -> dict:
    if item.get("ThumbnailURL") and not _is_valid_cover_url(item.get("ThumbnailURL")):
        item["ThumbnailURL"] = None
    item['is_adult'] = bool(item.get('IsAdult'))
    return item

# --- 성인작 제외 (기본 꺼짐) ---------------------------------------------------
# 포트폴리오 공개 기간에 성인작을 목록·상세에서 아예 제외했던 장치다. 2026-09-27에
# 제외를 풀어 기본값을 꺼짐으로 바꿨다(DECISIONS.md). 다시 필요하면 Lambda 환경변수
# `HIDE_ADULT_CONTENT=true` 하나로 켠다 — 아래 판정·차감 경로는 전부 이 값을 따른다.
#
# 판정 근거는 `scripts/build_adult_blocklist.py`가 만든 차단 목록이다. 크롤러가
# 기록하는 `IsAdult`(스냅샷별 관측값)와 별개인 이유는, 과거 605일 스냅샷에는
# `IsAdult`가 없고 소급 기록은 하지 않은 관측을 주장하는 셈이기 때문이다.
# 차단 목록은 "특정 시점에 19금으로 관측된 소설 집합"이라 그 문제가 없다.
#
# 태그가 아니라 배지로 판정한 이유: 태그 규칙은 실측 재현율이 78%였다. 성인
# 비율 100%인 태그를 다 써도 132건 중 29건을 놓쳤고, 놓친 것들의 태그는
# `['판타지','현대','하렘']`처럼 일반작과 구별이 불가능했다.
HIDE_ADULT_CONTENT = os.environ.get('HIDE_ADULT_CONTENT', 'false').strip().lower() not in (
    '0', 'false', 'no', 'off', ''
)
_BLOCKLIST_KEY = {'ID': 'ADULT_BLOCKLIST', 'Date': 'ALL_DATES'}
_BLOCKLIST_TTL_SECONDS = 600
_blocklist_cache: tuple[float, frozenset] | None = None

def _normalize_novel_id(novel_id) -> str:
    return str(novel_id or '').replace('NOVEL#', '').strip()


def _adult_blocklist() -> frozenset:
    """차단 목록을 읽는다. 컨테이너 단위로 캐시하며 TTL이 지나면 다시 읽는다."""
    global _blocklist_cache
    if not HIDE_ADULT_CONTENT:
        return frozenset()
    now = time.monotonic()
    if _blocklist_cache and now - _blocklist_cache[0] < _BLOCKLIST_TTL_SECONDS:
        return _blocklist_cache[1]
    try:
        item = table.get_item(Key=_BLOCKLIST_KEY).get('Item') or {}
        ids = frozenset(_normalize_novel_id(i) for i in (item.get('novel_ids') or []))
        _blocklist_cache = (now, ids)
        return ids
    except ClientError:
        # 목록을 못 읽으면 필터가 걸리지 않는다(fail-open). 목록이 아직 없는
        # 상태가 정상 케이스라(차단 목록 생성 전) 여기서 막으면 화면이 빈다.
        logger.warning("성인작 차단 목록을 읽지 못했다 — 이번 응답은 필터되지 않는다")
        return _blocklist_cache[1] if _blocklist_cache else frozenset()


def _is_blocked_novel(novel_id) -> bool:
    return _normalize_novel_id(novel_id) in _adult_blocklist()


def _reject_if_blocked(novel_id) -> None:
    """차단된 소설의 단건·트렌드 조회를 막는다.

    403이 아니라 404를 쓴다. 403은 "여기 뭔가 있는데 가렸다"는 신호가 되므로,
    존재하지 않는 소설과 구별되지 않게 한다. 목록에서 지워도 상세 URL이 열리면
    필터의 의미가 없다.
    """
    if _is_blocked_novel(novel_id):
        raise HTTPException(status_code=404, detail="Novel not found")


def _reject_if_any_adult(novel_id, items: list[dict]) -> None:
    """`_reject_if_blocked` 는 차단 목록만 본다. 조회한 행의 `IsAdult` 까지 합쳐(합집합) 판정한다.

    한 행이라도 걸리면 막는다 — 등급이 바뀐 작품의 과거 스냅샷도 같은 소설이다.
    차단 목록을 만든 뒤 새로 19금이 된 작품은 목록·상세에서는 빠지는데 추이·날짜 API로는
    열리던 빈틈을 막는다. 행에 `IsAdult` 가 투영돼 있어야 한다.
    """
    blocked = _adult_blocklist()
    if any(_is_adult_item({**it, 'ID': novel_id}, blocked) for it in items):
        raise HTTPException(status_code=404, detail="Novel not found")


_deserializer = TypeDeserializer()


def _fetch_rank_tag_rows_by_date(date: str) -> list[dict]:
    """태그 뺄셈에만 쓰는 경량 조회. Synopsis 등을 빼서 응답 크기를 줄인다.

    여러 날짜를 스레드로 동시에 읽으므로(`_prefetch_rank_tag_rows`) 스레드 안전한 저수준
    client 를 쓴다. `IsAdult` 는 차단 목록과의 합집합 판정에 쓴다.
    """
    items = []
    query_args = {
        'TableName': table.name,
        'IndexName': 'DateRankIndex',
        'KeyConditionExpression': '#d = :d',
        'ExpressionAttributeNames': {'#d': 'Date'},
        'ExpressionAttributeValues': {':d': {'S': date}},
        'ProjectionExpression': 'ID, Ranking, Score, Tags, IsAdult',
    }
    while True:
        db_response = ddb_client.query(**query_args)
        items.extend({k: _deserializer.deserialize(v) for k, v in it.items()}
                     for it in db_response.get('Items', []))
        if 'LastEvaluatedKey' not in db_response:
            break
        query_args['ExclusiveStartKey'] = db_response['LastEvaluatedKey']
    return _convert_decimals(items)


def _prefetch_rank_tag_rows(dates: list[str]) -> dict[str, list[dict]] | None:
    """기간 태그 엔드포인트용: 뺄셈에 쓸 날짜별 행을 한꺼번에 병렬로 읽는다.

    날짜마다 순서대로 GSI 를 읽으면 90일에 웜 0.37초 × 90 이라 API Gateway 29초를 넘는다.
    정책이 꺼져 있으면 뺄 것이 없으므로 아무것도 읽지 않는다(None).
    """
    if not HIDE_ADULT_CONTENT or not dates:
        return None
    with ThreadPoolExecutor(max_workers=16) as pool:
        return dict(zip(dates, pool.map(_fetch_rank_tag_rows_by_date, dates)))


def _tag_stats_without_blocked(date: str, scores_log: dict, counts_total: dict,
                               counts_top100: dict,
                               rows: list[dict] | None = None,
                               score_sum: dict | None = None,
                               score_total: int | None = None) -> tuple[dict, dict, dict, dict | None, int | None]:
    """저장된 태그 집계에서 차단 소설의 기여분을 뺀다.

    STATS 항목은 이미 전체 소설로 집계된 값이지만, 세 지표가 **모두 소설 단위
    단순 합**이라 뺄셈이 성립한다(재계산이 필요 없다):

        TagCounts[t]                    = Σ 1
        TagCountsTop100[t]              = Σ 1  (rank <= 100)
        TagWeightedScoresLogarithmic[t] = Σ 1/ln(rank+1)

    적재 코드(`data_ingestion.calculate_and_store_tag_trends`)의 가중치 식이
    바뀌면 여기도 함께 바꿔야 한다. 지금은 `1/ln(rank+1)`로 일치한다.

    등장 2회 미만 태그는 적재 때 pruning되므로 집계에 없을 수 있다. 없는 키는
    건너뛰고, 빼서 0 이하가 된 태그는 제거한다.

    한계: `local_lift`는 분모를 100/400 상수로 쓰기 때문에(적재 시점의 top500
    구조 전제), 뺄셈 후에는 실제 표시 건수와 어긋난다. 값이 다소 작게 나오지만
    지표 자체가 휴리스틱이고, 식을 바꾸면 적재 코드의 정의와 갈라지므로 그대로
    둔다.

    판정은 차단 목록 ∪ 그날 `IsAdult`(`_is_adult_item`)다 — 목록만 보면 목록을 만든 뒤
    새로 19금이 된 작품의 태그가 남는다. 그래서 목록이 비어 있어도 정책이 켜져 있으면 행을
    읽는다. `rows` 를 주면(기간 엔드포인트가 미리 병렬로 읽은 것) 다시 조회하지 않는다.
    """
    if not HIDE_ADULT_CONTENT:
        return scores_log, counts_total, counts_top100, score_sum, score_total
    blocked = _adult_blocklist()

    scores_log = dict(scores_log)
    counts_total = dict(counts_total)
    counts_top100 = dict(counts_top100)
    score_sum = dict(score_sum) if score_sum is not None else None

    for item in (rows if rows is not None else _fetch_rank_tag_rows_by_date(date)):
        if not _is_adult_item(item, blocked):
            continue
        rank = item.get('Ranking')
        if not isinstance(rank, int) or rank <= 0:
            continue
        weight = 1 / math.log(rank + 1)
        score = int(item.get('Score') or 0)
        # 점유율의 분모(그날 전체 랭킹 점수)에서도 뺀다 — 태그 쪽만 빼면 숨긴 작품 몫만큼 점유율이 낮게 나온다.
        if score_total is not None:
            score_total = int(score_total) - score
        for tag in (item.get('Tags') or []):
            if score_sum is not None and tag in score_sum:
                score_sum[tag] = int(score_sum[tag]) - score
            if tag in counts_total:
                counts_total[tag] = int(counts_total[tag]) - 1
            if tag in scores_log:
                scores_log[tag] = float(scores_log[tag]) - weight
            if rank <= 100 and tag in counts_top100:
                counts_top100[tag] = int(counts_top100[tag]) - 1

    for tag, count in list(counts_total.items()):
        if count <= 0:
            counts_total.pop(tag, None)
            scores_log.pop(tag, None)
            counts_top100.pop(tag, None)
            if score_sum is not None:
                score_sum.pop(tag, None)
    return scores_log, counts_total, counts_top100, score_sum, score_total


def _attach_top_novels(rows: list[dict], items: list[dict], rank_key: str) -> None:
    """태그마다 그날 순위가 가장 높은 작품을 `top_novel` 로 단다(태그 랭킹의 '대표 작품', 2026-10-18).
    items 는 `_apply_content_policy_all()` 을 지난 목록이어야 한다 — 성인작 숨김을 켜면 대표로도 나오지 않는다."""
    best: dict[str, dict] = {}
    for it in items:
        rank = it.get(rank_key)
        if rank is None:
            continue
        for tag in it.get('Tags') or []:
            if tag not in best or rank < best[tag]['rank']:
                best[tag] = {'id': str(it['ID']), 'title': it.get('Title'), 'rank': int(rank)}
    for r in rows:
        r['top_novel'] = best.get(r['tag'])


_TOP_NOVEL_NAMES = {'#i': 'ID', '#t': 'Title', '#g': 'Tags', '#a': 'IsAdult'}

# 2026 공모전 태그 랭킹의 모집단 = 그날 일간 500위 안 작품(데일리 태그 랭킹과 같은 크기 · 같은 식, 2026-10-18).
# 참여작 전부(약 4,700편, 누적 조회 중앙값 37)로 세면 '100위 안'이 2% 라 작품 100편 미만 태그의 대부분이 0편이었고(지도 무의미),
# 조회가 거의 없는 작품들이 작품 수 · 평균선을 끌어내렸다. DAILY_TAG_STATS(전체 기준)는 파이프라인이 계속 쌓지만 화면은 읽지 않는다.
CONTEST_TAG_POOL = 500


def _contest_pool_tag_rows(items: list[dict], pool: int = CONTEST_TAG_POOL) -> list[dict]:
    """그날 공모전 작품 중 일간 순위 pool 위 안만으로 태그 행을 만든다 — data-pipeline/tag_stats.daily_tag_stats 와 같은 식
    (작품 수 · 100위 안 · 인기 점수 = 조회 증가 점유율 · 2편 미만 태그 제외) + 대표 작품. items 는 콘텐츠 정책을 지난 목록."""
    ranked = [it for it in items if it.get('DailyRank') is not None and int(it['DailyRank']) <= pool]
    if not ranked:
        return []
    counts: dict[str, int] = {}
    top: dict[str, int] = {}
    ssum: dict[str, int] = {}
    logw: dict[str, float] = {}
    total = 0
    for it in ranked:
        rank, delta = int(it['DailyRank']), int(it.get('ViewDelta') or 0)
        total += delta
        for tag in it.get('Tags') or []:
            counts[tag] = counts.get(tag, 0) + 1
            ssum[tag] = ssum.get(tag, 0) + delta
            logw[tag] = logw.get(tag, 0.0) + 1 / math.log(rank + 1)
            if rank <= 100:
                top[tag] = top.get(tag, 0) + 1
    counts = {t: n for t, n in counts.items() if n >= 2}   # 등장 2회 미만은 노이즈(STATS 와 같은 규칙)
    rows = _one_day_tag_rows(counts, top, ssum, total, len(ranked))
    for r in rows:
        r['power_score'] = float(logw.get(r['tag'], 0.0))
        r['local_lift'] = None
    _attach_top_novels(rows, ranked, 'DailyRank')
    return rows


def _one_day_tag_rows(counts: dict, top100: dict | None, score_sum: dict | None,
                      score_total: int | None, ranked_total: int | None) -> list[dict]:
    """태그 랭킹 하루 판정의 행(DECISIONS 2026-10-06): 작품 수 · 100위 안 작품 수 · 인기 점수(랭킹 점수 점유율).

    순서 = 점유율 내림차순, 동점은 태그 이름 — 동점 순서가 날마다 바뀌어 가짜 변동이 생겼다. 점수 필드가 없는 날(소급 전 ·
    적재 실패)은 점유율을 비우고 작품 수 순으로 낸다(터지지 않게). 구역 판정은 화면(tagZones.ts)이 n · t · N 으로 한다.
    """
    has_score = score_sum is not None and bool(score_total)
    rows = []
    for tag, n in counts.items():
        n = int(n)
        if n <= 0:
            continue
        rows.append({
            # 100위 안 집계가 없는 날(2026-04-13 이전 STATS)은 0 이 아니라 모름 — 0 이면 흔한 태그가 전부 '0편 · 과포화'로 판정됐다.
            'tag': tag, 'count': n, 'top100': int(top100.get(tag, 0)) if top100 else None,
            'score_share': float((score_sum or {}).get(tag, 0)) / float(score_total) if has_score else None,
            'ranked_total': int(ranked_total) if ranked_total else None,
        })
    rows.sort(key=(lambda r: (-r['score_share'], r['tag'])) if has_score else (lambda r: (-r['count'], r['tag'])))
    for i, r in enumerate(rows, 1):
        r['Rank'] = i
    return rows


def _is_adult_item(item: dict, blocked: frozenset) -> bool:
    """차단 목록(과거 전 기간) 또는 그날 관측값(`IsAdult`) 중 하나라도 참이면 성인작.

    두 신호를 합치는 이유는 서로의 빈틈을 메우기 때문이다.
      - 차단 목록: 특정 시점의 스냅샷. 과거 605일을 커버하지만, 그 뒤에 등급이
        바뀌거나 새로 랭킹에 진입한 소설은 모른다.
      - `IsAdult`: 크롤러가 매일 기록하므로 항상 최신이지만, 기록을 시작한
        날 이전 스냅샷에는 값이 없다.
    합치면 목록을 다시 만들지 않아도 새 성인작이 자동으로 걸린다.
    """
    if not HIDE_ADULT_CONTENT:
        return False
    return bool(item.get('IsAdult')) or _normalize_novel_id(item.get('ID')) in blocked


def _apply_content_policy_all(items: list[dict]) -> list[dict]:
    """목록용 단일 초크 포인트. 성인작을 빼고 표지 필드를 정리한다.

    태그 목록은 따로 필터하지 않는다. 프론트가 소설 목록에서 태그를 만들기
    때문에(`rankings.flatMap(novel => novel.Tags)`), 소설이 빠지면 그 소설만
    갖고 있던 태그도 자동으로 사라진다. STATS 기반 태그 랭킹은 별도로
    `_tag_stats_without_blocked()`가 기여분을 차감한다.
    """
    blocked = _adult_blocklist()
    return [
        _prepare_cover_fields(item)
        for item in items
        if not _is_adult_item(item, blocked)
    ]


def _apply_content_policy(item: dict) -> dict:
    """단건용. 성인작이면 404. 목록에서 지워도 상세가 열리면 의미가 없다."""
    if _is_adult_item(item, _adult_blocklist()):
        raise HTTPException(status_code=404, detail="Novel not found")
    return _prepare_cover_fields(item)


def _novel_id_lookup_candidates(novel_id: str | None) -> list[str]:
    if not novel_id:
        return []
    raw_id = str(novel_id).replace('NOVEL#', '')
    return list(dict.fromkeys(c for c in (str(novel_id), raw_id, f'NOVEL#{raw_id}') if c))

def _fetch_latest_novel_thumbnail_url(novel_id: str | None) -> str | None:
    """공모전 adult placeholder 보강용으로 daily ranking 최신 썸네일 URL만 조회합니다."""
    for candidate_id in _novel_id_lookup_candidates(novel_id):
        try:
            db_response = table.query(
                KeyConditionExpression=Key('ID').eq(candidate_id),
                ScanIndexForward=False,
                Limit=1,
                ProjectionExpression='ThumbnailURL'
            )
        except ClientError as e:
            logger.warning("Daily thumbnail fallback query failed for contest item %s: %s", candidate_id, e)
            return None

        items = db_response.get('Items', [])
        if not items:
            continue
        thumbnail_url = items[0].get('ThumbnailURL')
        if _is_valid_cover_url(thumbnail_url):
            return thumbnail_url

    return None

def _apply_daily_thumbnail_fallback_to_contest_item(item: dict) -> dict:
    if _is_valid_cover_url(item.get('ThumbnailURL')):
        return item
    fallback_url = _fetch_latest_novel_thumbnail_url(item.get('ID'))
    if fallback_url:
        item['ThumbnailURL'] = fallback_url
    return item

def _contest_table_for(year: int):
    tbl = CONTEST_TABLES.get(year)
    if tbl is None:
        raise HTTPException(status_code=404, detail=f"Contest data for year {year} not found.")
    return tbl

def _get_contest_award(novel_id: str, year: int = 2025) -> str | None:
    for award_name, ids_set in CONTEST_AWARDS.get(year, {}).items():
        if novel_id in ids_set:
            return award_name
    return None

def _contest_veteran(item: dict, year: int) -> bool | None:
    """기성 작가 여부. 원문은 적재가 붙인 `AuthorOtherNovels`(작가의 다른 작품 번호)·`AuthorOtherMore`.

    공모전 첫 참가작 번호보다 작은 다른 작품이 하나라도 있으면 True. 없고 더 볼 쪽도 없으면 False.
    색인에 아직 없는 작가이거나(속성 없음) 다음 쪽이 남았는데 못 찾았으면 None(모름)이다.
    """
    first = CONTEST_FIRST_NOVEL_ID.get(year)
    novels = item.get('AuthorOtherNovels')
    if first is None or novels is None:
        return None
    if any(int(n) < first for n in novels):
        return True
    return None if item.get('AuthorOtherMore') else False

def _decorate_contest_item(item: dict, year: int, previous_item: dict | None = None, prev_ranked: bool = False) -> dict:
    """2026 부터의 해석값을 붙인다(원문은 그대로 두고). 2025 행에는 원문이 없어 전부 None 이 된다."""
    item['daily_rank'] = item.get('DailyRank')
    prev_rank = (previous_item or {}).get('DailyRank')
    # 'New' = 오늘 처음 순위에 들었다. 직전 수집 뒤 새로 등록된 작품(IsNew — 적재가 판정)과 어제는 기준값이 없어
    # 순위 밖이었던 작품 둘 다다. 직전 수집일에 일간 순위가 아예 없었으면(`prev_ranked` 거짓) 견줄 대상이 없어 None 이지만,
    # 신작(IsNew)은 New — 개막일(2026-10-01)은 참가작 전부가 0 에서 출발한 신작이라 전부 New 다(사용자 2026-10-05).
    # 기준값이 없어 오늘도 순위 밖인 작품은 None.
    if prev_rank is not None and item.get('DailyRank') is not None:
        item['daily_rank_change'] = prev_rank - item['DailyRank']
    elif item.get('DailyRank') is not None and (prev_ranked or item.get('IsNew')):
        item['daily_rank_change'] = 'New'
    else:
        item['daily_rank_change'] = None
    item['serial_status'] = _derive_serial_status(item)
    item['is_veteran'] = _contest_veteran(item, year)
    item['life_pick_rank'] = _life_pick_rank(item)
    item['badges'] = _badge_labels(item)
    item['serial_days'] = item.get('SerialDays') or None
    return item

def _get_latest_contest_date(tbl) -> str | None:
    dates = _get_contest_available_dates_desc(tbl)
    return dates[0] if dates else None

def _get_contest_available_dates_desc(tbl) -> list[str]:
    db_response = tbl.get_item(
        Key={'ID': 'CONTEST_AVAILABLE_DATES', 'Date': 'METADATA'}
    )
    item = db_response.get('Item')
    if item and 'dates' in item:
        return sorted(list(item['dates']), reverse=True)
    return []

def _get_previous_contest_date(target_date: str, tbl) -> str | None:
    dates = _get_contest_available_dates_desc(tbl)
    i = dates.index(target_date) + 1 if target_date in dates else len(dates)
    return dates[i] if i < len(dates) else None

def _contest_item_view_change(item: dict, previous_item: dict | None) -> int:
    current_view = item.get('View', 0) or 0
    if current_view == -1:
        return -1
    if not previous_item:
        return current_view
    previous_view = previous_item.get('View', 0) or 0
    if previous_view == -1:
        previous_view = 0
    return current_view - previous_view

# --- Pydantic Response Models ---
class AvailableDatesResponse(BaseModel):
    available_dates: List[str] = Field(..., description="데이터가 존재하는 모든 날짜 목록 (내림차순 정렬)", example=["2025-08-20", "2025-08-19"])

class _NovelBase(BaseModel):
    """데일리 랭킹 행과 작품 상세가 함께 쓰는 필드."""
    # Required fields
    ID: str
    Date: str
    Ranking: int
    Score: int

    # Optional fields
    Title: Optional[str] = None
    AuthorName: Optional[str] = None
    AuthorID: Optional[str] = None
    View: Optional[int] = None
    Like: Optional[int] = None
    Fav: Optional[int] = None
    Alr: Optional[int] = None
    Eps: Optional[int] = None
    Tags: List[str] = Field(default_factory=list)
    Synopsis: Optional[str] = None
    ThumbnailURL: Optional[str] = None
    is_adult: bool = Field(False, description="성인 등급 여부. 크롤러가 상세 페이지 등급 배지로 판정한 값이며, 표지 표시 정책에 쓰인다")
    EarlyRetentionRate: Optional[float] = None
    RecentRetentionRate: Optional[float] = None
    FirstEpView: Optional[int] = None
    FirstEpNum: Optional[int] = None
    Ep30View: Optional[int] = None
    Ep30Num: Optional[int] = None
    RecentBaseView: Optional[int] = None
    RecentBaseNum: Optional[int] = None
    TargetLatestEpView: Optional[int] = None
    TargetLatestEpNum: Optional[int] = None
    serial_status: Optional[str] = Field(None, description="그 날 스냅샷의 연재 상태(연재중·완결·연재지연·연재중단 등). 기록이 없는 날(2026-09-05 이전)은 null")

class NovelRankData(_NovelBase):
    like_to_view_ratio: Optional[float] = None
    rank_change: Optional[Any] = Field(None, description="랭킹 변동. 숫자 또는 'New'", example=5)

class NovelDetails(_NovelBase):
    # 상세 머리용 해석값(2026-09-30). 원문은 Badges · SerialStatus · SerialDays · LifePick 이고 판정은 여기서만 한다.
    serial_days: Optional[str] = None
    life_pick_rank: Optional[int] = None
    badges: List[str] = Field(default_factory=list)
    age_rating: Optional[str] = None
    is_unavailable: bool = Field(False, description="최신 수집이 자리표시(수집 실패)였다. 제목·수치는 직전 정상 행(values_date) 것")
    values_date: Optional[str] = Field(None, description="제목·수치가 온 수집일. 최신 행이 정상이면 null(= Date)")

class TagRankData(BaseModel):
    tag: str
    power_score: float  # 구 인기 점수 Σ1/ln(rank+1) — 기간 페이지 호환으로 남긴다(화면은 score_share)
    local_lift: Optional[float] = None  # top100 vs bottom400 상대적 표현도 (구 데이터는 null)
    count: int
    Rank: int  # 인기 점수(score_share) 순, 동점은 태그 이름
    rank_change: Optional[Any] = None  # 전일 대비 순위 변화 (양수=상승, 음수=하락, 'New'=신규)
    top100: Optional[int] = None  # 100위 안 작품 수
    score_share: Optional[float] = None  # 인기 점수 = 그날 전체 랭킹 점수(공모전은 조회 증가) 중 이 태그 작품들의 몫. 필드 없는 날은 null
    ranked_total: Optional[int] = None  # 그날 순위 작품 수 N(구역 판정의 기준)
    top_novel: Optional[Dict[str, Any]] = None  # 대표 작품 {id, title, rank}: 이 태그에서 그날 순위가 가장 높은 작품

class ContestTagRankData(BaseModel):
    tag: str
    score_linear: float
    score_inverse: float
    score_log: float
    count: int
    Rank: int

class ContestNovelData(BaseModel):
    ID: str
    Date: str
    Title: Optional[str] = None
    AuthorName: Optional[str] = None
    AuthorID: Optional[str] = None
    View: Optional[int] = None
    Like: Optional[int] = None
    Fav: Optional[int] = None
    Alr: Optional[int] = None
    Eps: Optional[int] = None
    Synopsis: Optional[str] = None
    ThumbnailURL: Optional[str] = None
    Tags: List[str] = Field(default_factory=list)
    EarlyRetentionRate: Optional[float] = None
    RecentRetentionRate: Optional[float] = None
    FirstEpView: Optional[int] = None
    FirstEpNum: Optional[int] = None
    Ep30View: Optional[int] = None
    Ep30Num: Optional[int] = None
    RecentBaseView: Optional[int] = None
    RecentBaseNum: Optional[int] = None
    TargetLatestEpView: Optional[int] = None
    TargetLatestEpNum: Optional[int] = None
    Rank: Optional[int] = None  # Calculated rank based on view_change
    view_change: int = Field(0, description="일일 조회수 변동")
    like_to_view_ratio: Optional[float] = None
    rank_change: Optional[Any] = Field(None, description="랭킹 변동. 숫자 또는 'New'")
    award: Optional[str] = Field(None, description="수상 내역 (예: 대상, 최우수상, 본선 진출)")
    is_new: bool = Field(False, description="신규 진입 여부")
    is_adult: bool = Field(False, description="성인 등급 여부. 크롤러가 상세 페이지 등급 배지로 판정한 값이며, 표지 표시 정책에 쓰인다")
    # --- 2026 부터(2025 는 None) ---
    daily_rank: Optional[int] = Field(None, description="일간 순위: 직전 수집일 대비 누적 조회 증가 순위(적재 시 확정)")
    daily_rank_change: Optional[Any] = Field(None, description="일간 순위 변동. 숫자 또는 'New'")
    serial_status: Optional[str] = None
    serial_days: Optional[str] = None
    life_pick_rank: Optional[int] = None
    badges: List[str] = Field(default_factory=list)
    is_veteran: Optional[bool] = Field(None, description="기성 작가(공모전 시작 전 작품이 있음). 모르면 None")
    age_rating: Optional[str] = None
    # 상세 전용(목록은 늘 False/None): 최신 행이 자리표시면 값은 직전 정상 행에서 온다
    is_unavailable: bool = False
    values_date: Optional[str] = None

class ContestShowcaseResponse(BaseModel):
    latest_date: str
    items: List[ContestNovelData] = Field(default_factory=list)

@app.get("/")
def read_root(response: Response):
    """
    루트 엔드포인트. API 서버가 동작하는지 확인하는 용도.
    """
    response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
    return {"message": "Welcome to NovelFlow API"}

@app.get("/api/dates", response_model=AvailableDatesResponse)
def get_available_dates(response: Response):
    """
    데이터가 존재하는 모든 날짜 목록을 조회합니다.
    AVAILABLE_DATES 아이템에서 날짜 목록을 가져옵니다.
    """
    try:
        db_response = table.get_item(
            Key={
                'ID': 'AVAILABLE_DATES',
                'Date': 'ALL_DATES'
            }
        )
        item = db_response.get('Item')
        if item and 'dates' in item:
            response.headers["Cache-Control"] = "public, max-age=300, s-maxage=300"
            return AvailableDatesResponse(available_dates=sorted(list(item['dates']), reverse=True))
        raise HTTPException(status_code=404, detail="No available dates found.")
    except ClientError as e:
        raise _server_error("DynamoDB query failed")

@app.get("/api/ranks/novels/{date}", response_model=List[NovelRankData])
def get_novels_by_date(date: str, response: Response):
    """
    특정 날짜의 모든 소설 랭킹 데이터를 조회하고, 직전 날짜와의 랭킹 변동을 포함합니다.
    DateRankIndex GSI를 사용하여 해당 날짜의 데이터를 가져옵니다.
    """
    current_date_dt = _parse_date(date)
    try:
        # 1~3. 당일·직전일을 동시에 조회한다.
        #
        # 직전일은 rank_change 계산에 ID와 Ranking만 쓰는데도 전체 속성(Synopsis·Tags 등)을
        # 가져오고 있었다. 500건 × 전 속성이면 응답이 300KB를 넘고 그만큼 읽기도 늘어난다.
        # ProjectionExpression으로 두 필드만 받고, 두 조회를 병렬로 돌린다
        # (공모전 쪽에서 이미 쓰던 패턴을 데일리로 이식 — 백로그 #35).
        previous_date = (current_date_dt - timedelta(days=1)).strftime('%Y-%m-%d')

        def _query_all(target_date: str, **proj) -> list[dict]:
            return _query_all_pages(table, IndexName='DateRankIndex', KeyConditionExpression=Key('Date').eq(target_date), **proj)

        with ThreadPoolExecutor(max_workers=2) as executor:
            current_future = executor.submit(_query_all, date)
            previous_future = executor.submit(_query_all, previous_date, ProjectionExpression='ID, Ranking')
            all_current_items = current_future.result()
            all_previous_items = previous_future.result()

        current_day_items = _convert_decimals(all_current_items)

        if not current_day_items:
            raise HTTPException(status_code=404, detail="No data found for the given date.")

        # 4. 직전 날짜 랭킹 맵 생성 (novel_id -> rank)
        previous_ranks_map = {
            item['ID']: int(item['Ranking'])
            for item in all_previous_items
            if 'Ranking' in item
        }

        # 5. 현재 날짜 데이터에 랭킹 변동 정보 + 연독률 추가
        for item in current_day_items:
            novel_id = item['ID'] # ID is already NOVEL#<novel_id>
            current_rank = item['Ranking']

            if novel_id in previous_ranks_map:
                previous_rank = previous_ranks_map[novel_id]
                rank_change = previous_rank - current_rank
                item['rank_change'] = rank_change
            else:
                item['rank_change'] = 'New' # 신규 진입

            item.update(_compute_retention_rates(item))
            item['serial_status'] = _derive_serial_status(item)

        # 데이터는 하루에 한 번 바뀌므로 길게 캐싱 가능
        response.headers["Cache-Control"] = "public, max-age=3600, s-maxage=86400"
        return _apply_content_policy_all(current_day_items)

    except HTTPException:
        raise
    except ClientError as e:
        raise _server_error("DynamoDB query failed")
    except Exception:
        raise _server_error(f"Error building novel ranking for {date}")

@app.get("/api/novels/{novel_id}/latest", response_model=NovelDetails)
def get_latest_novel_details(novel_id: str, response: Response):
    """
    특정 소설의 가장 최근 전체 데이터를 조회합니다.
    """
    _reject_if_blocked(novel_id)
    try:
        # 최신 행이 자리표시면 직전 정상 행의 값을 쓴다. 순위·점수는 자리표시에도 맞는 값이라 그날 것을 둔다.
        latest_item = _latest_real_row(_query_latest_rows(table, novel_id, 10), ('Date', 'Ranking', 'Score'))
        if latest_item:
            latest_item.update(_compute_retention_rates(latest_item))
            response.headers["Cache-Control"] = "public, max-age=300, s-maxage=300"
            latest_item = _apply_content_policy(latest_item)
            latest_item.update({
                'serial_status': _derive_serial_status(latest_item),
                'serial_days': latest_item.get('SerialDays') or None,
                'life_pick_rank': _life_pick_rank(latest_item),
                'badges': _badge_labels(latest_item),
                'age_rating': _age_rating(latest_item),
            })
            return latest_item
        else:
            raise HTTPException(status_code=404, detail="Novel not found")
    except ClientError as e:
        raise _server_error("DynamoDB query failed")

@app.get("/api/trends/novels/{novel_id}/{start_date}/{end_date}", response_model=List[Dict[str, Any]])
def get_novel_trend(novel_id: str, start_date: str, end_date: str, response: Response, _: Optional[str] = Query(None)):
    """
    특정 소설의 기간별 데이터 트렌드를 조회합니다.
    데이터가 없는 날짜는 `Ranking: null`로 채워서 반환합니다.
    프론트엔드에서 반드시 start_date와 end_date를 제공해야 합니다.
    """
    _reject_if_blocked(novel_id)
    try:
        start_date_dt, end_date_dt = _parse_date_range(start_date, end_date, NOVEL_TREND_MAX_DAYS)

        # DynamoDB에서 해당 기간의 실제 데이터 조회
        items = _convert_decimals(_query_all_pages(
            table,
            KeyConditionExpression=Key('ID').eq(novel_id) & Key('Date').between(start_date_dt.strftime('%Y-%m-%d'), end_date_dt.strftime('%Y-%m-%d'))
        ))
        _reject_if_any_adult(novel_id, items)

        # Get title from the first available item (if any)
        novel_title = items[0].get('Title', 'Unknown Title') if items else 'Unknown Title'

        # 연독률 계산 적용
        for item in items:
            item.update(_compute_retention_rates(item))

        # 조회를 빠르게 하기 위해 날짜를 키로 하는 맵 생성
        data_map = {item['Date']: item for item in items}

        # 모든 날짜를 채운다(Padding). 데이터가 없는 날은 순위권 밖 — Ranking null, 제목은 일관되게.
        padded_data = [data_map.get(d) or {'Date': d, 'Ranking': None, 'Title': novel_title, 'ID': novel_id}
                       for d in _days(start_date_dt, end_date_dt)]

        response.headers["Cache-Control"] = "public, max-age=3600, s-maxage=86400"
        return padded_data

    except HTTPException:
        raise
    except Exception:
        raise _server_error("Unhandled error while handling request")

@app.get("/api/trends/novels/{novel_id}/available-dates", response_model=AvailableDatesResponse)
def get_novel_available_dates(novel_id: str, response: Response):
    """
    특정 소설의 데이터가 존재하는 모든 날짜 목록을 조회합니다.
    비용 최소화를 위해 Date 속성만 프로젝션합니다.
    """
    _reject_if_blocked(novel_id)
    try:
        # 오름차순이라 1MB 에서 잘리면 최신 날짜가 빠진다 — 끝까지 따라간다.
        items = _query_all_pages(
            table,
            KeyConditionExpression=Key('ID').eq(novel_id),
            ProjectionExpression='#d, IsAdult',
            ExpressionAttributeNames={'#d': 'Date'}
        )
        _reject_if_any_adult(novel_id, items)
        # DynamoDB는 날짜(SK)를 기준으로 자동 정렬하여 반환합니다.
        dates = [item['Date'] for item in items]
        response.headers["Cache-Control"] = "public, max-age=300, s-maxage=300"
        return AvailableDatesResponse(available_dates=dates)
    except HTTPException:
        raise
    except Exception:
        raise _server_error("Unhandled error while handling request")

# 행 펼침의 '그날 값' 마감 = 그날 수집이 받을 수 있는 끝. 늦은 재실행 거절선(데일리 D 22:00, 공모전 D+1 01:00)은 **시도를 시작할 수
# 있는** 끝이라, 그 뒤에도 받는 중일 수 있다(재실행이 30~45분 걸린다). 그 다음 확인(공모전 00:00 / 데일리 21:00) 전까지로 둔다.
_UPLOAD_CUTOFF = {
    'daily': lambda d: f'{d}T23:59:59+09:00',
    'contest': lambda d: f'{(datetime.fromisoformat(d) + timedelta(days=1)).date().isoformat()}T03:00:00+09:00',
}

@app.get("/api/uploads/{novel_id}")
def get_uploads(novel_id: str, start: str, end: str, response: Response, asof: Optional[str] = None, source: Optional[str] = None):
    """연재 기록에서 날짜별 올린 화 수(null = 셀 수 없음). `asof`+`source`(daily|contest) 를 주면 그 날짜 수집 마감까지 본 회차만
    센다(행 펼침 고정값). 회차 수 차이로 추정하지 않는다 — 삭제·재업로드·BONUS 도 실제 목록 그대로."""
    _reject_if_blocked(novel_id)
    s, e = _parse_date_range(start, end, NOVEL_TREND_MAX_DAYS)
    if HIDE_ADULT_CONTENT:
        # 차단 목록 ∪ 행의 IsAdult(합집합) — 다른 단건 API 와 같은 판정. 연재 기록 항목엔 IsAdult 가 없어 수집 테이블에서 읽는다
        # (데일리 · 2026 공모전 — 연재 기록이 있는 두 곳). 꺼져 있으면 읽지 않는다.
        rows = [it for tbl in (table, CONTEST_TABLES[2026]) for it in _query_all_pages(
            tbl, KeyConditionExpression=Key('ID').eq(novel_id), ProjectionExpression='IsAdult', FilterExpression=Attr('IsAdult').eq(True))]
        _reject_if_any_adult(novel_id, rows)
    cutoff = _UPLOAD_CUTOFF[source](_parse_date(asof).strftime('%Y-%m-%d')) if asof and source in _UPLOAD_CUTOFF else None
    try:
        item = _convert_decimals(history_table.get_item(Key={'NovelId': novel_id}).get('Item'))
    except Exception:
        raise _server_error("Unhandled error while handling request")
    out = episode_history.day_counts(item, s.strftime('%Y-%m-%d'), e.strftime('%Y-%m-%d'), cutoff) if item else \
        {'days': {}, 'known_from': None, 'known_until': None}
    # 첫 회차 날짜 — 그 앞은 '쉰 날'이 아니라 아직 없던 작품이다(다 받은 기록만 안다).
    eps = (item or {}).get('Episodes') or {}
    first = None
    if item and item.get('Complete'):
        # 다 받았는데 회차가 없으면(첫 회차 전 — 공모전 미시작작 등) 기간 전체가 첫 회차 앞이다.
        first = min((v[0] for v in eps.values()), default=(e + timedelta(days=1)).strftime('%Y-%m-%d'))
    response.headers["Cache-Control"] = "public, max-age=600, s-maxage=600"
    return {**out, 'first_date': first, 'tracked': bool(item)}

def _compute_local_lift(count_top100: int, count_total: int, min_count: int = 5, rest_total: int = 400, min_top: int = 0) -> Optional[float]:
    """
    Local Lift = top100_rate / rest_rate
    상위 100개와 나머지(데일리는 늘 400개)를 상호 배타적으로 비교하여 순위 관통력을 측정합니다.
    min_count 미만 태그는 노이즈로 간주하여 None 반환. 공모전 일간 순위는 순위가 매겨진 작품 수가 날마다 달라
    `rest_total = RankedTotal − 100` 을 넘긴다(100 이하면 나머지가 없어 None).
    `min_top`: 상위 100 안 작품이 이 수 미만(1편 이상)인데 집중도가 1.0 이상이면 None — 공모전은 모수(약 2,700편)가 커서
    상위 100 안 1편만으로 5편짜리 태그가 6.5배가 된다. '몰렸다'는 주장은 우연과 구별되지 않는다(2026-10-05 리뷰: '숨은 강자'
    54개 중 31개가 1편). 1.0 미만(큰 태그가 1편뿐 — 예 SF 175편 중 1편, 기대 6.5편)은 '덜 몰렸다'는 분명한 신호라 그대로 둔다.
    """
    if count_total < min_count or rest_total <= 0:
        return None
    count_bottom = count_total - count_top100
    top100_rate = count_top100 / 100.0
    rest_rate = max(count_bottom, 1) / float(rest_total)  # 최소 1로 스무딩
    lift = top100_rate / rest_rate
    if 0 < count_top100 < min_top and lift >= 1.0:
        return None
    return lift


def _set_tag_rank_change(rows: list[dict], prev_rank: dict) -> None:
    """직전 날 대비 순위 변동(양수 = 상승). 직전 날 순위가 아예 없으면 None, 그날 없던 태그는 'New'."""
    for r in rows:
        r['rank_change'] = None if not prev_rank else (prev_rank[r['tag']] - r['Rank'] if r['tag'] in prev_rank else 'New')


@app.get("/api/ranks/tags/{date}", response_model=List[TagRankData])
def get_tags_by_date(date: str, response: Response):
    """
    특정 날짜의 태그 랭킹 데이터를 조회합니다.
    - 순서 = score_share(인기 점수: 그날 전체 랭킹 점수 중 이 태그 작품들의 몫), 동점은 태그 이름(DECISIONS 2026-10-06)
    - power_score: 구 인기 점수 Σ 1/ln(rank+1) — 호환으로만 남는다
    - local_lift: top100_rate / bottom400_rate — 순위 관통력/신흥 트렌드 (TagCountsTop100 없는 구 데이터는 null)
    """
    try:
        db_response = table.get_item(Key={'ID': f"STATS#{date}", 'Date': date})
        item = db_response.get('Item')
        if not item:
            raise HTTPException(status_code=404, detail="No tag statistics found for the given date.")

        scores_log = item.get('TagWeightedScoresLogarithmic', {})
        counts_total = item.get('TagCounts', {})
        counts_top100 = item.get('TagCountsTop100', {})  # 구 데이터에는 없을 수 있음
        has_top100_data = bool(counts_top100)

        # 차단 소설의 기여분을 뺀다. 지표가 모두 소설 단위 단순 합이라 성립한다(점유율의 분모 ScoreTotal 포함).
        scores_log, counts_total, counts_top100, score_sum, score_total = _tag_stats_without_blocked(
            date, scores_log, counts_total, counts_top100, None, item.get('TagScoreSum'), item.get('ScoreTotal')
        )

        # 하루 판정(2026-10-06): 순서 = 인기 점수(랭킹 점수 점유율), 동점은 태그 이름.
        sorted_data = _one_day_tag_rows(counts_total, counts_top100, score_sum, score_total, item.get('RankedTotal'))
        for tag_item in sorted_data:
            tag_item['power_score'] = float(scores_log.get(tag_item['tag'], 0))
            tag_item['local_lift'] = _compute_local_lift(tag_item['top100'], tag_item['count']) if has_top100_data else None

        # 전날 데이터 조회하여 rank_change 계산 (같은 기준 — 인기 점수 순위)
        prev_rank_map = {}
        try:
            prev_date = (datetime.strptime(date, '%Y-%m-%d') - timedelta(days=1)).strftime('%Y-%m-%d')
            prev_db_response = table.get_item(
                Key={'ID': f'STATS#{prev_date}', 'Date': prev_date},
                ProjectionExpression='TagCounts, TagCountsTop100, TagScoreSum, ScoreTotal, RankedTotal'
            )
            prev_item = prev_db_response.get('Item')
            if prev_item:
                # 전날도 같은 기준으로 빼지 않으면 rank_change가 틀린다.
                _, p_counts, p_top, p_sum, p_total = _tag_stats_without_blocked(
                    prev_date, {}, prev_item.get('TagCounts', {}), prev_item.get('TagCountsTop100', {}),
                    None, prev_item.get('TagScoreSum'), prev_item.get('ScoreTotal'),
                )
                prev_rank_map = {r['tag']: r['Rank'] for r in
                                 _one_day_tag_rows(p_counts, p_top, p_sum, p_total, prev_item.get('RankedTotal'))}
        except Exception as e:
            logger.warning(f"Failed to fetch previous day tag ranks for rank_change: {e}")

        _set_tag_rank_change(sorted_data, prev_rank_map)

        try:
            novels = _query_all_pages(table, IndexName='DateRankIndex', KeyConditionExpression=Key('Date').eq(date),
                                      ProjectionExpression='#i, #t, #g, #a, #r', ExpressionAttributeNames={**_TOP_NOVEL_NAMES, '#r': 'Ranking'})
            _attach_top_novels(sorted_data, _apply_content_policy_all(_convert_decimals(novels)), 'Ranking')
        except Exception as e:   # 대표 작품은 곁들이 — 없어도 표는 낸다
            logger.warning(f"Failed to attach top novels: {e}")

        response.headers["Cache-Control"] = "public, max-age=3600, s-maxage=86400"
        return sorted_data

    except ClientError as e:
        raise _server_error("DynamoDB query failed")

@app.get("/api/authors/{author_id}", response_model=List[NovelDetails])
async def get_author_novels(author_id: str, response: Response):
    if author_id == "0":
        raise HTTPException(status_code=404, detail="Author not found")
    try:
        # 작품 × 수집일마다 항목이 있어 오래 랭킹에 든 작가는 1MB 를 넘는다 — 끝까지 따라간다.
        gsi_items = _query_all_pages(
            table,
            IndexName='AuthorIDIndex',
            KeyConditionExpression=Key('AuthorID').eq(author_id),
            ProjectionExpression='ID',
        )
    except ClientError as e:
        raise _server_error("Author GSI query failed")
    novel_ids = {item['ID'] for item in gsi_items}
    if not novel_ids:
        raise HTTPException(status_code=404, detail="Author not found")
    latest_novels = []
    for novel_id in novel_ids:
        try:
            # 최신 행이 자리표시면 직전 정상 행의 값을 쓴다(상세와 같은 규칙).
            item = _latest_real_row(_query_latest_rows(table, novel_id, 5), ('Date', 'Ranking', 'Score'))
            if item:
                latest_novels.append(item)
        except ClientError as e:
            raise _server_error("Author novel query failed")
    response.headers["Cache-Control"] = "public, max-age=300, s-maxage=300"
    return _apply_content_policy_all(latest_novels)

@app.get("/api/contests/{year}/available-dates", response_model=AvailableDatesResponse)
def get_contest_available_dates(year: int, response: Response):
    """
    공모전 데이터가 존재하는 모든 날짜 목록을 조회합니다.
    """
    tbl = _contest_table_for(year)
    try:
        dates = _get_contest_available_dates_desc(tbl)
        if dates:
            response.headers["Cache-Control"] = "public, max-age=300, s-maxage=300"
            return AvailableDatesResponse(available_dates=dates)
        raise HTTPException(status_code=404, detail="No available dates found for contest.")
    except ClientError as e:
        raise _server_error("DynamoDB query failed")

# 공모전 랭킹 리스트 뷰에서 실제 사용하는 필드만 조회 (Synopsis, 에피소드 조회수 등 제외)
# 'Date', 'View', 'Like', 'Rank'는 DynamoDB 예약어이므로 ExpressionAttributeNames 사용
_CONTEST_LIST_PROJ = ('ID, #dt, Title, AuthorName, AuthorID, #vw, #lk, Fav, Alr, Eps, Tags, ThumbnailURL, #rk, '
                      # 2026 부터 적재가 싣는 값(2025 행에는 없어 투영에서 그냥 빠진다)
                      'ViewDelta, DailyRank, IsNew, IsAdult, Badges, SerialStatus, SerialDays, AuthorOtherNovels, AuthorOtherMore, '
                      # 잔류율 원재료(회차 30 이상만 있다 — 표의 초반/최신 잔류 열)
                      'FirstEpView, Ep30View, RecentBaseView, TargetLatestEpView')
_CONTEST_LIST_NAMES = {'#dt': 'Date', '#vw': 'View', '#lk': 'Like', '#rk': 'Rank'}

def _fetch_all_contest_items(target_date: str, projection: str, expr_names: dict, tbl) -> list:
    """지정 날짜의 전체 공모전 항목을 페이지네이션으로 조회합니다."""
    return _convert_decimals(_query_all_pages(
        tbl, IndexName='DateViewIndex', KeyConditionExpression=Key('Date').eq(target_date),
        ProjectionExpression=projection, ExpressionAttributeNames=expr_names))

@app.get("/api/contests/{year}/showcase", response_model=ContestShowcaseResponse)
def get_contest_showcase(year: int, response: Response):
    """
    최신 공모전 snapshot에서 운영자가 지정한 showcase 작품만 반환합니다.
    날짜별 테이블 탐색과 분리된 영역이므로 항상 최신 데이터만 사용합니다.
    """
    tbl = _contest_table_for(year)

    try:
        latest_date = _get_latest_contest_date(tbl)
        if not latest_date:
            raise HTTPException(status_code=404, detail="No latest date found for contest.")

        if year != 2025:
            # 2026~ 쇼케이스는 프론트가 고른 날짜의 목록(`/api/contests/{year}/{date}`)에서 바로 고른다(일간 순위·변동이 다 있다 —
            # DECISIONS 2026-10-03). 수상작이 발표되면 그날 목록의 award 로 시상대를 그린다. 이 API 는 2025 수상작 전용이다.
            response.headers["Cache-Control"] = "public, max-age=300, s-maxage=300"
            return {"latest_date": latest_date, "items": []}

        configured_showcase_ids = get_contest_showcase_ids_2025()

        if not configured_showcase_ids:
            response.headers["Cache-Control"] = "public, max-age=300, s-maxage=300"
            return {"latest_date": latest_date, "items": []}

        previous_date = _get_previous_contest_date(latest_date, tbl)
        with ThreadPoolExecutor(max_workers=2) as executor:
            future_latest = executor.submit(_fetch_all_contest_items, latest_date, _CONTEST_LIST_PROJ, _CONTEST_LIST_NAMES, tbl)
            future_previous = executor.submit(_fetch_all_contest_items, previous_date, _CONTEST_LIST_PROJ, _CONTEST_LIST_NAMES, tbl) if previous_date else None
            latest_items = future_latest.result()
            previous_items = future_previous.result() if future_previous else []

        previous_item_by_id = {item['ID']: item for item in previous_items}
        item_by_id = {item['ID']: item for item in latest_items}
        item_by_raw_id = {item['ID'].replace('NOVEL#', ''): item for item in latest_items}

        showcase_items = []
        seen_ids = set()
        def append_showcase_item(item: dict) -> None:
            previous_item = previous_item_by_id.get(item['ID'])
            item['award'] = _get_contest_award(item['ID'], year)
            item['view_change'] = (item.get('View', 0) or 0) - (previous_item.get('View', 0) or 0) if previous_item else (item.get('View', 0) or 0)
            item['rank_change'] = None
            item['is_new'] = False
            item['like_to_view_ratio'] = (item.get('Like', 0) or 0) / item['View'] if item.get('View') else 0
            showcase_items.append(item)
            seen_ids.add(item['ID'])

        for configured_id in configured_showcase_ids:
            item = item_by_id.get(configured_id) or item_by_raw_id.get(configured_id.replace('NOVEL#', ''))
            if not item or item['ID'] in seen_ids:
                continue
            append_showcase_item(item)

        winner_candidates = [
            item for item in latest_items
            if item['ID'] not in seen_ids and _get_contest_award(item['ID'], year) == '우수상'
        ]
        winner_candidates.sort(key=lambda item: item.get('View', 0) or 0, reverse=True)
        for item in winner_candidates:
            if len(showcase_items) >= 11:
                break
            append_showcase_item(item)

        response.headers["Cache-Control"] = "public, max-age=300, s-maxage=300"
        return {
            "latest_date": latest_date,
            "items": _apply_content_policy_all([_apply_daily_thumbnail_fallback_to_contest_item(i) for i in showcase_items]),
        }

    except ClientError as e:
        raise _server_error("DynamoDB query failed")


@app.get("/api/contests/{year}/{date}", response_model=List[ContestNovelData])
def get_contest_data_by_date(year: int, date: str, response: Response):
    """
    지정된 연도의 특정 날짜 공모전 소설 데이터를 조회합니다.
    """
    tbl = _contest_table_for(year)

    # 전날 = 실제 직전 수집일(공모전 규칙 — 달력 −1 아님). 날짜 목록을 못 읽으면 변동 없이 낸다.
    try:
        previous_date = _get_previous_contest_date(date, tbl)
    except ClientError as e:
        logger.warning(f"Could not fetch available dates for contest: {e}")
        previous_date = None

    try:
        # 현재 날짜 + 전날 DynamoDB 쿼리 병렬 실행 (리스트 뷰에 필요한 필드만 투영)
        with ThreadPoolExecutor(max_workers=2) as executor:
            future_current = executor.submit(_fetch_all_contest_items, date, _CONTEST_LIST_PROJ, _CONTEST_LIST_NAMES, tbl)
            # 직전일은 변동 계산에 쓰는 세 값만 읽는다(누적 순위·조회수 — 2025, 일간 순위 — 2026). 전 속성을 읽으면 2천여 편 × 이틀이 된다.
            future_prev = executor.submit(_fetch_all_contest_items, previous_date, 'ID, #vw, #rk, DailyRank', {'#vw': 'View', '#rk': 'Rank'}, tbl) if previous_date else None
            current_day_items = future_current.result()
            previous_day_items = future_prev.result() if future_prev else []

        if not current_day_items:
            raise HTTPException(status_code=404, detail="No data found for the given date.")

        previous_day_map = {item['ID']: item for item in previous_day_items}
        prev_ranked = any(i.get('DailyRank') is not None for i in previous_day_items)

        for item in current_day_items:
            previous_item = previous_day_map.get(item['ID'])
            item['award'] = _get_contest_award(item['ID'], year)
            # 2026 은 적재가 저장한 조회 증가(직전 유효 측정값이 없으면 속성 없음 → 0. 직전 수집 뒤 신작은 ViewDelta = View 로 순위가 있다)
            item['view_change'] = item['ViewDelta'] if 'ViewDelta' in item else (0 if year != 2025 else _contest_item_view_change(item, previous_item))
            _decorate_contest_item(item, year, previous_item, prev_ranked)
            if year != 2025:
                item.update(_compute_retention_rates(item))   # 원재료가 없으면(회차 30 미만) 둘 다 None → 화면 '–'
            item['is_new'] = False
            if previous_item and previous_item.get('Rank') is not None:
                previous_rank = previous_item['Rank']
                current_rank = item.get('Rank')
                item['rank_change'] = previous_rank - current_rank if current_rank is not None else 'New'
                if item['rank_change'] == 'New':
                    item['is_new'] = True
            else:
                item['rank_change'] = 'New'
                item['is_new'] = True

        response.headers["Cache-Control"] = "public, max-age=3600, s-maxage=86400"
        return _apply_content_policy_all(current_day_items)

    except ClientError as e:
        if e.response['Error']['Code'] == 'ResourceNotFoundException':
            raise _server_error("Contest DateViewIndex missing")
        raise _server_error("DynamoDB query failed")

@app.get("/api/contests/{year}/novels/{novel_id}/latest", response_model=ContestNovelData)
def get_latest_contest_novel_details(year: int, novel_id: str, response: Response):
    """
    특정 공모전 소설의 가장 최근 전체 데이터를 조회합니다.
    """
    _reject_if_blocked(novel_id)
    tbl = _contest_table_for(year)

    try:
        # 최신 행이 자리표시(FetchFailed·Inaccessible, 2025 삭제작 — View -1)면 제목·수치는 직전 정상 행에서.
        # 날짜와 그날의 순위 값은 최신 행 것을 둔다(자리표시라 순위가 없으면 None — 지난 순위를 오늘 것처럼 보이지 않는다).
        latest_item = _latest_real_row(_query_latest_rows(tbl, novel_id, 10), ('Date', 'Rank', 'DailyRank', 'ViewDelta'))
        if latest_item:
            # 수상 내역 추가
            latest_item['award'] = _get_contest_award(latest_item['ID'], year)
            _decorate_contest_item(latest_item, year)
            latest_item.update(_compute_retention_rates(latest_item))   # 2026: 회차 30 이상만 원재료가 있다
            # 프론트엔드에서 필요한 필드 추가
            latest_item['Rank'] = latest_item.get('Rank', 0)
            latest_item['view_change'] = 0
            latest_item['is_new'] = False
            response.headers["Cache-Control"] = "public, max-age=300, s-maxage=300"
            latest_item = _apply_content_policy(_apply_daily_thumbnail_fallback_to_contest_item(latest_item))
            latest_item['age_rating'] = _age_rating(latest_item)   # is_adult 는 정책 함수가 붙인다
            return latest_item
        else:
            raise HTTPException(status_code=404, detail="Contest novel not found")
    except ClientError as e:
        raise _server_error("DynamoDB query failed")

@app.get("/api/trends/contests/{year}/novels/{novel_id}/available-dates", response_model=AvailableDatesResponse)
def get_contest_novel_available_dates(year: int, novel_id: str, response: Response):
    """
    특정 공모전 소설의 데이터가 존재하는 모든 날짜 목록을 조회합니다.
    """
    _reject_if_blocked(novel_id)
    tbl = _contest_table_for(year)
    try:
        items = _query_all_pages(
            tbl,
            KeyConditionExpression=Key('ID').eq(novel_id),
            ProjectionExpression='#d, IsAdult',
            ExpressionAttributeNames={'#d': 'Date'}
        )
        _reject_if_any_adult(novel_id, items)
        dates = [item['Date'] for item in items]
        response.headers["Cache-Control"] = "public, max-age=300, s-maxage=300"
        return AvailableDatesResponse(available_dates=dates)
    except HTTPException:
        raise
    except Exception:
        raise _server_error("Unhandled error while handling request")

@app.get("/api/trends/contests/{year}/novels/{novel_id}/{start_date}/{end_date}", response_model=List[Dict[str, Any]])
def get_contest_novel_trend(year: int, novel_id: str, start_date: str, end_date: str, response: Response, _: Optional[str] = Query(None)):
    """
    특정 공모전 소설의 기간별 데이터 트렌드를 조회합니다.
    데이터가 없는 날짜는 null 값으로 채워서 반환합니다.
    """
    _reject_if_blocked(novel_id)
    tbl = _contest_table_for(year)

    try:
        start_date_dt, end_date_dt = _parse_date_range(start_date, end_date, NOVEL_TREND_MAX_DAYS)

        # DynamoDB에서 해당 기간의 실제 데이터 조회
        items = _convert_decimals(_query_all_pages(
            tbl,
            KeyConditionExpression=Key('ID').eq(novel_id) & Key('Date').between(start_date_dt.strftime('%Y-%m-%d'), end_date_dt.strftime('%Y-%m-%d'))
        ))
        _reject_if_any_adult(novel_id, items)

        real_items = [item for item in items if not _is_placeholder_row(item)]
        novel_title = real_items[0].get('Title', 'Unknown Title') if real_items else 'Unknown Title'

        # 조회를 빠르게 하기 위해 날짜를 키로 하는 맵 생성. 자리표시 행(View -1 · 'N/A (…)')은
        # 값이 없는 날과 같은 꼴로 내린다 — -1 을 실제 측정값으로 그리면 증가량이 -5만·+5만으로 튄다.
        data_map = {item['Date']: item for item in real_items}

        # 모든 날짜를 채운다(Padding). 데이터가 없는 날(자리표시 포함)은 값을 비운다.
        padded_data = [data_map.get(d) or {'Date': d, 'ID': novel_id, 'Title': novel_title, 'View': None, 'Like': None,
                                           'Fav': None, 'Eps': None, 'Synopsis': None, 'Rank': None}
                       for d in _days(start_date_dt, end_date_dt)]

        response.headers["Cache-Control"] = "public, max-age=3600, s-maxage=86400"
        return padded_data

    except HTTPException:
        raise
    except Exception:
        raise _server_error("Unhandled error while handling request")

@app.get("/api/contests/{year}/ranks/tags/{date}", response_model=List[ContestTagRankData])
def get_contest_tags_by_date(year: int, date: str, response: Response):
    """
    특정 날짜의 공모전 태그 랭킹 데이터를 조회합니다.
    """
    tbl = _contest_table_for(year)

    try:
        db_response = tbl.get_item(Key={'ID': f"TAG_STATS#{date}", 'Date': date})
        item = db_response.get('Item')
        if not item:
            raise HTTPException(status_code=404, detail="No tag statistics found for the given date.")

        scores_linear = item.get('TagWeightedScoresInverseLinear', {})
        scores_inverse = item.get('TagWeightedScoresInverseRank', {})
        scores_log = item.get('TagWeightedScoresLogarithmic', {})
        counts = item.get('TagCounts', {})

        tag_data = []
        for tag in scores_linear.keys():
            tag_data.append({
                'tag': tag,
                'score_linear': scores_linear.get(tag, 0),
                'score_inverse': scores_inverse.get(tag, 0),
                'score_log': scores_log.get(tag, 0),
                'count': counts.get(tag, 0)
            })
        
        sorted_data = sorted(_convert_decimals(tag_data), key=lambda x: x.get('score_linear', 0), reverse=True)
        
        for i, item in enumerate(sorted_data):
            item['Rank'] = i + 1
        response.headers["Cache-Control"] = "public, max-age=3600, s-maxage=86400"
        return sorted_data
    except ClientError as e:
        raise _server_error("DynamoDB query failed")

@app.get("/api/contests/{year}/ranks/daily-tags/{date}", response_model=List[TagRankData])
def get_contest_daily_tags_by_date(year: int, date: str, response: Response):
    """공모전 태그 랭킹 — **일간 500위 안 작품만**으로 데일리 태그 랭킹과 같은 하루 판정(2026-10-18, `_contest_pool_tag_rows`).

    인기 점수 = 그 500편의 그날 조회 증가 중 이 태그 작품들의 몫. 일간 순위가 없는 날(수집 첫날)은 404.
    전날 대비 변동은 내지 않는다 — 화면에서 뺐다(2026-10-18).
    """
    tbl = _contest_table_for(year)
    try:
        items = _fetch_all_contest_items(date, '#i, #t, #g, #a, #r, #v', {**_TOP_NOVEL_NAMES, '#r': 'DailyRank', '#v': 'ViewDelta'}, tbl)
        rows = _contest_pool_tag_rows(_apply_content_policy_all(items))
        if not rows:
            raise HTTPException(status_code=404, detail="No daily tag statistics found for the given date.")
        response.headers["Cache-Control"] = "public, max-age=3600, s-maxage=86400"
        return rows
    except HTTPException:
        raise
    except ClientError:
        raise _server_error("DynamoDB query failed")


@app.get("/api/trends/tags/series/{start_date}/{end_date}")
def get_tag_series(start_date: str, end_date: str, response: Response):
    """기간 안의 모든 수집일에 대해 태그별 시계열을 한 번에 반환한다.

    프론트가 날짜를 하나씩 호출하면(`/api/ranks/tags/{date}`) 날짜당 약 0.4초가
    들어 30일이면 12초가 넘는다. STATS 항목은 `batch_get_item`으로 한 번에 최대
    100일을 읽을 수 있으므로 여기서 묶어 준다.

    반환 형태는 날짜 배열 + 태그별 병렬 배열이다. 태그마다 날짜를 반복해 담으면
    응답이 몇 배로 커진다. 특정 날짜에 그 태그가 없으면 해당 자리는 null이다.

    순위는 `/api/ranks/tags/{date}`와 같게 인기 점수(score_share) 순으로 매기고(score = score_share, top = 100위 안 작품 수),
    차단 소설 기여분도 같은 방식으로 뺀다 — 두 화면의 숫자가 어긋나면 안 된다.
    """
    try:
        start_dt, end_dt = _parse_date_range(start_date, end_date, TAG_RANGE_MAX_DAYS)

        dates = _days(start_dt, end_dt)
        items_by_date = {it['Date']: it for it in _batch_get(
            [{'ID': f"STATS#{d}", 'Date': d} for d in dates],
            ProjectionExpression='ID, #d, TagWeightedScoresLogarithmic, TagCounts, TagCountsTop100, TagScoreSum, ScoreTotal, RankedTotal',
            ExpressionAttributeNames={'#d': 'Date'},
        )}

        # 인기 점수 재료(ScoreTotal)가 없는 날은 비운다 — 다른 기준의 순위를 섞어 잇지 않는다(소급 전 · 적재 실패).
        present = [d for d in dates if d in items_by_date and items_by_date[d].get('ScoreTotal') is not None]
        if not present:
            raise HTTPException(status_code=404, detail="No tag statistics found in the given range.")

        # 정책이 켜져 있으면 뺄셈에 쓸 행을 날짜별로 한꺼번에 병렬로 읽어 둔다(순차면 90일에 29초를 넘는다).
        rows_by_date = _prefetch_rank_tag_rows(present) or {}

        series: dict = {}
        for idx, d in enumerate(present):
            item = items_by_date[d]
            _, counts, counts_top, ssum, stot = _tag_stats_without_blocked(
                d,
                item.get('TagWeightedScoresLogarithmic', {}) or {},
                item.get('TagCounts', {}) or {},
                item.get('TagCountsTop100', {}) or {},
                rows_by_date.get(d),
                item.get('TagScoreSum'), item.get('ScoreTotal'),
            )
            for r in _one_day_tag_rows(counts, counts_top, ssum, stot, item.get('RankedTotal')):
                tag = r['tag']
                slot = series.get(tag)
                if slot is None:
                    n = len(present)
                    slot = {'rank': [None] * n, 'count': [None] * n, 'score': [None] * n, 'top': [None] * n}
                    series[tag] = slot
                slot['rank'][idx] = r['Rank']
                slot['count'][idx] = r['count']
                slot['score'][idx] = r['score_share']   # 인기 점수(점유율) — 하루 판정과 같은 값
                slot['top'][idx] = r['top100']

        response.headers["Cache-Control"] = "public, max-age=300"
        # ranked_total = 날짜별 순위 작품 수 N — 화면이 구역(태그 랭킹과 같은 판정)을 매기는 기준(태그 트렌드 '구역 바뀜').
        ranked_total = [int(items_by_date[d].get('RankedTotal') or 0) or None for d in present]
        return {'dates': present, 'tags': series, 'ranked_total': ranked_total}   # _one_day_tag_rows 가 int·float 로 낸 값뿐이다

    except HTTPException:
        raise
    except Exception:
        raise _server_error(f"Error building tag series for {start_date}~{end_date}")


def _returning_ids(candidates: set, before: str) -> set:
    """`before` **이전에 한 번이라도 랭킹에 든 적이 있는** ID 를 골라낸다.

    '들어온 작품'이 정말 처음 진입한 것인지 확인하는 경로다. 기간 첫날 목록과만
    비교하면 전부터 있다가 첫날 하루만 빠졌던 작품이 '신규'로 잡힌다.

    **왜 앞쪽 스냅샷을 되짚지 않고 작품별로 묻는가.** 스냅샷을 전부 읽는 방법도 되지만
    전 기간 530일이 **853 RCU**(실측)다. 정작 판정이 필요한 것은 *후보 작품* 몇십~몇백
    편뿐인데, 작품마다 자기 파티션에서 `Date < before` 를 `Limit 1` 로 물으면 건당
    0.5 RCU 라 후보 185편에 **93 RCU** 다 — 9배 싸고, 무엇보다 **판정 범위가 스냅샷
    보유 기간에 묶이지 않는다**(전 이력을 본다).

    행이 하나라도 있으면 그날 랭킹에 있었다는 뜻이다 — 적재는 랭킹에 든 작품만 쓴다.
    """
    if not candidates:
        return set()

    def charted(nid: str) -> Optional[str]:
        try:
            # **저수준 client 를 쓴다.** `boto3.resource`(와 그 `Table`)는 AWS 문서상
            # 스레드 안전하지 않고, botocore client 는 안전하다. 리소스를 공유한 채
            # 스레드를 늘리면 조용히 직렬화되거나 더 나쁜 일이 난다.
            res = ddb_client.query(
                TableName=table.name,
                KeyConditionExpression='ID = :i AND #dt < :d',
                ExpressionAttributeNames={'#dt': 'Date'},
                ExpressionAttributeValues={':i': {'S': str(nid)}, ':d': {'S': before}},
                ProjectionExpression='#dt',
                Limit=1,
            )
            return nid if res.get('Items') else None
        except Exception:                    # noqa: BLE001
            # 판정 실패는 '처음 진입'이 아니라 **'모른다'** 로 처리한다. 조회 오류를
            # 신규 진입으로 읽으면 예전부터 있던 작품이 목록에 조용히 섞인다.
            return nid

    with ThreadPoolExecutor(max_workers=16) as pool:
        return {r for r in pool.map(charted, candidates) if r}

# 기간 AI 요약을 담아 두는 아이템. 요청마다 모델을 부르지 않는다 — 창이 7/30/90
# 세 개뿐이라 하루 세 번 만들어 두면 되고, 그래야 응답 시간과 비용이 예측 가능하다.
# 아직 생성 경로가 없어 아이템이 없으면 `None` 을 돌려주고 화면이 빈 영역을 그린다.
AI_SUMMARY_ID = 'AISUMMARY'


def _ai_period_summary(days: int, end_date: str) -> Optional[dict]:
    """저장된 기간 요약. 없거나 다른 날짜 것이면 `None`.

    **끝 날짜를 대조한다.** 요약은 특정 기간에 대한 문장이므로, 파이프라인이
    아직 오늘 것을 만들지 않았다면 어제 요약을 오늘 것처럼 보여 주면 안 된다.
    """
    try:
        item = table.get_item(Key={'ID': f'{AI_SUMMARY_ID}#{days}', 'Date': end_date}).get('Item')
    except Exception:
        return None                     # 요약이 없다고 리포트 전체를 실패시키지 않는다
    if not item or not item.get('text'):
        return None
    return {
        'text': item['text'],
        'model': item.get('model'),
        'generated_at': item.get('generated_at'),
    }


@app.get("/api/analysis/report/{days}")
def get_analysis_report(days: int, response: Response):
    """데이터 분석 리포트. 기간 전체(모든 수집일)를 실제로 다 쓴다.

    **왜 사전 계산인가.** 날짜당 랭킹은 364행 340KB이고 `DateRankIndex` 조회가
    웜 0.37초·콜드 30초다. 90일을 요청 시점에 모으면 API Gateway 29초를 넘고
    브라우저 페이로드도 30MB가 된다. 그래서 적재 파이프라인이 날짜마다 16KB짜리
    압축 스냅샷(`RSNAP#<date>`)을 남기고, 여기서 `batch_get_item` 으로 한 번에 읽는다.
    표본을 뽑지 않으므로 최고 순위·평균 순위·기간 추천비가 실제 값이 된다.

    **성인작 판정은 여기서만 한다.** 스냅샷에는 `adult` 플래그가 그대로 담겨 있고,
    차단 목록(과거 전 기간, 매일 갱신)과의 합집합을 이 함수가 적용한다.
    `analysis_report` 모듈은 판정을 모르며 이미 걸러진 데이터만 받는다 —
    판정 로직이 두 군데로 갈라지면 나중에 추가된 차단 작품이 리포트에 남는다.

    스냅샷이 없는 날짜는 건너뛰고 `dates_missing` 으로 알린다(파이프라인 배포 이전
    날짜는 `scripts/backfill_ranking_snapshots.py` 로 소급 생성한다).
    """
    if days not in (7, 30, 90):
        raise HTTPException(status_code=400, detail="days must be one of 7, 30, 90.")
    try:
        meta = table.get_item(Key={'ID': 'AVAILABLE_DATES', 'Date': 'ALL_DATES'}).get('Item') or {}
        all_dates = sorted(meta.get('dates') or [], reverse=True)
        if not all_dates:
            raise HTTPException(status_code=404, detail="No collection dates found.")
        # N일 = 수집일 N+1개(간격 N일). N개로 읽으면 '7일'이 6일 사이의 변화라 '+28화'와 '주당 32.7화'가 어긋났다.
        window = sorted(all_dates[:days + 1])      # 오름차순: [0] 시작, [-1] 끝

        # 1. 압축 스냅샷을 배치로. 날짜별 get_item 이면 90번이라 못 쓴다.
        got = {it['Date']: it for it in _batch_get([{'ID': f'RSNAP#{d}', 'Date': d} for d in window])}

        present = [d for d in window if d in got]
        if len(present) < 2:
            raise HTTPException(
                status_code=404,
                detail="Not enough ranking snapshots in range. Run scripts/backfill_ranking_snapshots.py.",
            )

        # 2. 성인작 제거. 스냅샷은 병렬 배열이므로 살릴 인덱스를 골라 다시 만든다.
        blocked = _adult_blocklist()
        snaps = []
        for d in present:
            it = got[d]
            ids = [str(x) for x in (it.get('ids') or [])]
            adult = list(it.get('adult') or [])
            keep = [
                i for i, nid in enumerate(ids)
                if not _is_adult_item({'ID': nid, 'IsAdult': adult[i] if i < len(adult) else False}, blocked)
            ]
            pick = lambda name: [int(it.get(name, [])[i]) for i in keep]  # noqa: E731
            snaps.append({
                'date': d, 'ids': [ids[i] for i in keep],
                'rank': pick('rank'), 'eps': pick('eps'),
                'view': pick('view'), 'like': pick('like'),
            })

        # 3. 양 끝 날짜의 전체 행. 제목·작가·태그·잔류율은 압축 스냅샷에 없다.
        #
        # **시작일도 읽어야 한다.** 빠진 작품은 마지막 날 목록에 없으므로 끝 날짜만
        # 읽으면 제목을 붙일 수 없어 화면에 `작품 436900` 처럼 ID 만 남는다 —
        # 실제로 그 상태였고, 태그 통계도 들어온 쪽만 낼 수 있었다.
        end_date, start_date_actual = present[-1], present[0]

        def _rows_for(date: str) -> list[dict]:
            items = _query_all_pages(
                table,
                IndexName='DateRankIndex',
                KeyConditionExpression=Key('Date').eq(date),
                ProjectionExpression='ID, Ranking, Title, AuthorName, AuthorID, Eps, #s, Tags, '
                                     'FirstEpView, Ep30View, RecentBaseView, TargetLatestEpView, IsAdult',
                ExpressionAttributeNames={'#s': 'Score'},
            )
            rows = _apply_content_policy_all(_convert_decimals(items))
            for r in rows:
                # 잔류율. 랭킹 응답과 같은 규칙 — 30번째 유효 회차가 없으면 미산출(-1 센티널도 거기서 막는다).
                r.update(_compute_retention_rates(r))
            return rows

        # 두 날짜를 병렬로. 순차로 하면 콜드에서 30초씩 두 번이다.
        with ThreadPoolExecutor(max_workers=2) as pool:
            fe = pool.submit(_rows_for, end_date)
            fs = pool.submit(_rows_for, start_date_actual)
            end_rows, start_rows = fe.result(), fs.result()
        end_by_id = {str(r['ID']): r for r in end_rows}
        start_by_id = {str(r['ID']): r for r in start_rows}

        # 4. 계산
        works = AR.per_work(snaps)
        end_ids = set(end_by_id)

        # '들어온 작품' 후보 = 지금 목록에 있고 기간 첫날에는 없던 작품. 이 가운데
        # 기간 **전에** 랭킹에 든 적이 있는 것을 걸러내면 남는 것이 진짜 첫 진입이다.
        # 전수를 묻지 않고 후보만 묻는다 — 계속 목록에 있던 작품은 물어볼 필요가 없다.
        candidates = end_ids - set(snaps[0]['ids'])
        seen_before = _returning_ids(candidates, present[0])
        entrants_basis = {
            'checked': len(candidates),
            'returning': len(seen_before),
            'first_collected': all_dates[-1],       # all_dates 는 내림차순
        }
        bands_def = [('상위 50위', 1, 50), ('51~150위', 51, 150),
                     ('151~300위', 151, 300), ('301위 밖', 301, math.inf)]
        report = {
            'days_requested': days,
            'dates': present,
            'dates_missing': len(window) - len(present),
            'start': present[0], 'end': end_date,
            'ai_summary': _ai_period_summary(days, end_date),
            'entrants_basis': entrants_basis,
            'churn': AR.churn(snaps, AR.band_retention(snaps, bands_def)),
            'pace': AR.pace_distribution(works, end_ids),
        }
        report.update(_report_lists(snaps, works, end_by_id, end_rows,
                                    start_by_id, start_rows, seen_before))
        # 연재 분포와 그 상위 목록은 화면에서 한 섹션이므로 응답에서도 한 덩어리로.
        report['pace']['top'] = report.pop('pace_top')

        response.headers["Cache-Control"] = "public, max-age=1800"
        return _convert_decimals(report)

    except HTTPException:
        raise
    except Exception:
        raise _server_error(f"Error building analysis report for {days} days")


def _report_lists(snaps: list, works: dict, end_by_id: dict, end_rows: list,
                  start_by_id: dict, start_rows: list, seen_before: set) -> dict:
    """화면에 글자로 나가는 목록들. 여기서만 제목·작가·태그를 붙인다."""
    start_ids = set(snaps[0]['ids'])
    end_ids = set(end_by_id)

    def label(nid: str) -> dict:
        """제목·작가·태그. 마지막 날 행이 자리표시('N/A (…)', 태그 없음)면 시작일 행에서 가져온다."""
        base = end_by_id.get(nid) or {}
        if _is_placeholder_row(base):
            alt = start_by_id.get(nid)
            if alt and not _is_placeholder_row(alt):
                return alt
        return base

    def row(nid: str, w: dict, extra: dict) -> dict:
        base = end_by_id.get(nid) or {}
        lb = label(nid)
        out = {
            'id': nid,
            'title': lb.get('Title'), 'author': lb.get('AuthorName'),
            'author_id': lb.get('AuthorID'),
            'tags': (lb.get('Tags') or [])[:3],
            'eps': w.get('last_eps'), 'added_eps': w.get('added_eps'),
            'recent_added_eps': w.get('recent_added_eps'),
            'rank': w.get('ranks', [None])[-1], 'best_rank': w.get('best_rank'),
            'avg_rank': w.get('avg_rank'),
            'early': base.get('EarlyRetentionRate'),
            'recent': base.get('RecentRetentionRate'),
            'period_ratio': w.get('period_ratio'),
            'per_week': round(w['per_week'], 1) if w.get('per_week') is not None else None,
            'observations': w.get('observations'),
        }
        out.update(extra)
        return out

    # 들어온 작품 = 지금 목록에 있고 첫날에는 없던 작품 — 빠진 작품(첫날에 있고 지금 없는 작품)과 **같은 기준**이다.
    # 들어온 쪽만 '예전에 든 적 없는 작품'으로 좁히면 139편이 들고 139편이 나간 달이 '들어온 76 · 빠진 139'로
    # 읽혀 목록이 줄어드는 것처럼 보였다(2026-10-07 리뷰). 처음 진입은 그 가운데 `first` 로 따로 센다.
    # 목록은 화면 앞 숫자(지금 순위) 순이다 — 최고 순위로 줄 세우면 보이는 숫자가 1, 12, 28, 24, 111…로 뒤죽박죽이었다.
    entrant_ids = sorted((n for n in end_ids if n not in start_ids and n in works),
                         key=lambda n: works[n]['ranks'][-1])
    entrants = [row(n, works[n], {'first': n not in seen_before}) for n in entrant_ids[:15]]

    # 빠진 작품의 제목·태그는 **시작일 행**에서 가져온다(마지막 날 목록에 없으므로).
    leaver_ids = [n for n in start_ids if n not in end_ids]
    leavers = []
    for n in sorted(leaver_ids, key=lambda n: works[n]['ranks'][0] if n in works else 9999)[:15]:
        w = works.get(n)
        if not w:
            continue
        base = start_by_id.get(n) or {}
        leavers.append({
            'id': n,
            'title': base.get('Title'), 'author': base.get('AuthorName'),
            'author_id': base.get('AuthorID'),
            'tags': (base.get('Tags') or [])[:3],
            # 마지막으로 순위에 든 날(자리표시 날 포함). `last_date` 는 값을 읽은 마지막 날이라 다르다.
            'rank_at_start': w['ranks'][0], 'best_rank': w['best_rank'],
            'last_seen': w['dates'][-1], 'observations': w['observations'],
            'eps': w['last_eps'], 'added_eps': w['added_eps'],
            'early': base.get('EarlyRetentionRate'), 'recent': base.get('RecentRetentionRate'),
        })

    ratios = sorted(
        (w for n, w in works.items() if n in end_ids and w.get('period_ratio') is not None),
        key=lambda w: -w['period_ratio'],
    )
    rid = {id(w): n for n, w in works.items()}
    ratio_row = lambda w: row(rid[id(w)], w, {})  # noqa: E731

    # 이 기간에 회차가 가장 많이 늘어난 작품. 분포 그래프만으로는 "그래서 어떤
    # 작품이"에 답하지 못해 표를 함께 둔다.
    #
    # **주당 페이스가 아니라 늘어난 회차 절대량으로 줄 세운다.** 주당 값으로 줄
    # 세우면 사흘만 관측된 작품이 맨 위로 오고(짧은 분모), 화면이 그 값을 순위처럼
    # 보여 준다. 절대량은 그 기간에 실제로 올라온 분량이라 그런 왜곡이 없다.
    paced = sorted(
        # 값을 한 번도 못 읽은 작품(added_eps None — 자리표시뿐)은 뺀다.
        (w for n, w in works.items() if n in end_ids and (w['added_eps'] or 0) > 0),
        key=lambda w: (-w['added_eps'], w['avg_rank']),
    )
    pace_top = [ratio_row(w) for w in paced[:15]]

    # 잔류율은 **지금 연재 중인 작품만**(마지막 7일에 회차가 늘어난 작품) 본다. 최신 잔류는 연재가 멈추면 최신화
    # 조회수가 계속 차서 올라가므로, 완결·휴재작이 섞이면 목록이 그것들로만 찬다. '기간 동안 늘었나'로 거르면
    # 90일 창 초반에 몇 화 올리고 멈춘 작품이 최신 잔류 136% 로 1위가 됐다(2026-10-05 리뷰).
    active = [
        w for n, w in works.items()
        if n in end_ids and (w['recent_added_eps'] or 0) > 0
        and end_by_id[n].get('EarlyRetentionRate') is not None
        and end_by_id[n].get('RecentRetentionRate') is not None
    ]
    # **두 비율을 그냥 더하지 않는다.** 초반 잔류(30화/1화)와 최신 잔류(최신화/그
    # 30화 전)는 분모가 달라 분포 폭도 다르다 — 합으로 줄 세우면 폭이 넓은 쪽이
    # 순서를 혼자 결정하고, 화면에는 "둘 다 높은 작품"이라고 적히면서 실제로는
    # 한 지표만 반영된 목록이 나온다. 그래서 각 지표를 **후보군 안에서의 백분위**로
    # 바꾼 뒤 평균한다. 척도가 사라지므로 두 지표가 같은 무게를 갖는다.
    _early = sorted(end_by_id[rid[id(w)]]['EarlyRetentionRate'] for w in active)
    _recent = sorted(end_by_id[rid[id(w)]]['RecentRetentionRate'] for w in active)

    def _retention_key(w: dict) -> float:
        from bisect import bisect_left
        base = end_by_id[rid[id(w)]]
        n = max(len(active), 1)
        pe = bisect_left(_early, base['EarlyRetentionRate']) / n
        pr = bisect_left(_recent, base['RecentRetentionRate']) / n
        return -(pe + pr) / 2

    active.sort(key=_retention_key)

    avg_ranks = [w['avg_rank'] for n, w in works.items() if n in end_ids]
    quartiles = AR.rank_quartiles(avg_ranks)
    diagnose_works = []
    for n, w in works.items():
        if n not in end_ids:
            continue
        base = end_by_id[n]
        lb = label(n)
        diagnose_works.append({
            'id': n, 'title': lb.get('Title'), 'author': lb.get('AuthorName'),
            'avg_rank': round(w['avg_rank'], 1), 'best_rank': w['best_rank'],
            'band': AR.band_of(w['avg_rank'], quartiles),
            'score': base.get('Score'), 'eps': w['last_eps'],
            'delta_view': w['delta_view'], 'period_ratio': w['period_ratio'],
            'per_week': round(w['per_week'], 2) if w['per_week'] is not None else None,
            'early': base.get('EarlyRetentionRate'),
            'recent': base.get('RecentRetentionRate'),
        })

    return {
        'totals': {
            'end_works': len(end_rows),
            'entrants': len(entrant_ids),
            'first_entrants': sum(1 for n in entrant_ids if n not in seen_before),
            'leavers': len(leaver_ids),
        },
        'entrants': entrants,
        'leavers': leavers,
        # 들어온·빠진 작품의 '많이 달린 태그'(작품 수 배수)는 뺐다 — 인기 점수로 재는 태그 트렌드와 반대로 말했다
        # (헌터 ×2.0 인데 트렌드는 식은 태그 −1.55%p, 같은 태그가 양쪽에 동시에). 태그 흐름은 태그 트렌드가 맡는다.
        # 두 목록을 **순위로 가른다.** 전체 상위와 '100위 밖'을 나란히 두면 추천비
        # 상위가 전부 100위 밖일 때 같은 카드가 두 번 나온다(실측 12건 전부 겹쳤다).
        'period_ratio': {
            'floor_delta_view': AR.DELTA_VIEW_FLOOR,
            'counted': len(ratios),
            'top': [ratio_row(w) for w in ratios if w['ranks'][-1] <= 100][:12],
            'hidden': [ratio_row(w) for w in ratios if w['ranks'][-1] > 100][:12],
        },
        'pace_top': pace_top,
        'retention': {'counted': len(active), 'rows': [ratio_row(w) for w in active[:12]]},
        'diagnose': {'quartiles': quartiles, 'works': diagnose_works},
        'tags': {
            # 두 태그 10편 이상 상위 15, 세 태그 6편 이상 상위 12(2026-09-30).
            # '많이 쓰인 태그의 짝'과 '신규작에서만 보이는 조합'은 화면에서 뺐다.
            'pairs': AR.tag_combinations(end_rows, 2, 10, 15),
            'triples': AR.tag_combinations(end_rows, 3, 6, 12),
        },
    }


@app.get("/api/trends/tags/analysis/{start_date}/{end_date}")
def analyze_tag_trends(start_date: str, end_date: str, response: Response, _: Optional[str] = Query(None)):
    """
    지정된 기간 동안의 태그 트렌드를 분석하여 카테고리별로 반환합니다.

    개편 프론트는 `/api/trends/tags/series` 를 쓰고 이 엔드포인트를 부르지 않는다. 운영 중인 main 프론트의
    TagTrendsPage 가 아직 부르고 백엔드 Lambda 는 두 프론트가 함께 쓰므로, 개편 프론트가 main 에 오른 뒤
    numpy(requirements)와 함께 지운다.
    """
    import numpy as np

    try:
        # 1. 데이터 조회 및 집계. 기간 상한은 태그 시계열과 같다(공개 API — 범위 전체로 회귀를 돌린다).
        start_date_dt, end_date_dt = _parse_date_range(start_date, end_date, TAG_RANGE_MAX_DAYS)
        dates = _days(start_date_dt, end_date_dt)
        all_items_raw = _batch_get(
            [{'ID': f"STATS#{d}", 'Date': d} for d in dates],
            ProjectionExpression='ID, #d, TagWeightedScoresLogarithmic, TagCountsTop100, TagCounts',
            ExpressionAttributeNames={'#d': 'Date'},
        )
        items = _convert_decimals(all_items_raw)
        
        if not items:
            raise HTTPException(status_code=404, detail="No statistics data found for the given date range.")

        # 2. 태그별 데이터 집계 및 시계열 생성
        # 시계열은 **STATS 가 있는 날(수집일)만**으로 만든다. 달력의 모든 날로 만들면 수집이 없던 날·
        # 아직 적재 전인 오늘이 모든 태그에서 0점 칸이 되고, 가중치가 큰 끝쪽 0 때문에 기울기가 거의 다 음수가 된다.
        wanted = set(dates)
        present = sorted({item['Date'] for item in items if item.get('Date') in wanted})
        date_map = {date: i for i, date in enumerate(present)}
        tag_analytics = {}
        # 다른 태그 엔드포인트와 같게 성인작 기여분을 뺀다(정책이 켜져 있을 때만 행을 읽는다).
        rows_by_date = _prefetch_rank_tag_rows(present) or {}

        for item in items:
            item_date = item['Date']
            if item_date not in date_map:
                continue
            
            idx = date_map[item_date]
            scores_log, counts, counts_top100, _, _ = _tag_stats_without_blocked(
                item_date,
                item.get('TagWeightedScoresLogarithmic', {}) or {},
                item.get('TagCounts', {}) or {},
                item.get('TagCountsTop100', {}) or {},  # 없으면 {} (구 날짜 호환)
                rows_by_date.get(item_date),
            )

            for tag in set(scores_log.keys()) | set(counts.keys()):
                if tag not in tag_analytics:
                    tag_analytics[tag] = {
                        'total_log_score': 0,
                        'total_count': 0,
                        'total_count_top100': 0,
                        'daily_avg_scores': [0.0] * len(present),
                        'daily_total_scores': [0.0] * len(present)
                    }

                score = scores_log.get(tag, 0)
                count = counts.get(tag, 0)
                count_top100 = counts_top100.get(tag, 0)

                tag_analytics[tag]['total_log_score'] += score
                tag_analytics[tag]['total_count'] += count
                tag_analytics[tag]['total_count_top100'] += count_top100
                tag_analytics[tag]['daily_total_scores'][idx] = score
                if count > 0:
                    tag_analytics[tag]['daily_avg_scores'][idx] = score / count

        # 3. 각 태그에 대한 최종 분석 지표 계산
        # min_count: 기간 길이에 비례 (최소 5) — Local Lift 유효성 판단에 사용
        min_count = max(5, len(present) * 2)

        analyzed_tags = []
        for tag, data in tag_analytics.items():
            if data['total_count'] == 0:
                continue

            y_values_slope = data['daily_avg_scores']
            if len(y_values_slope) < 2:
                slope = 0.0
            else:
                x_values = np.arange(len(y_values_slope))
                # 가중치 생성: 최근 데이터에 더 높은 가중치를 부여 (지수적 증가)
                weights = np.exp(np.linspace(0, 1, len(y_values_slope)))
                # 가중 선형 회귀를 사용하여 기울기 계산
                m, _ = np.polyfit(x_values, y_values_slope, deg=1, w=weights)
                slope = m

            daily_total_scores = data['daily_total_scores']
            std_dev = np.std(daily_total_scores)
            avg_total_score = np.mean(daily_total_scores) if daily_total_scores else 0
            normalized_std_dev = std_dev / avg_total_score if avg_total_score > 0 else 0

            max_score = max(data['daily_avg_scores'])
            min_score = min(data['daily_avg_scores'])
            avg_daily_avg_score = np.mean(data['daily_avg_scores'])

            # Period Local Lift: Simpson's Paradox 방지 — 기간 전체 집계 후 한 번만 계산
            total_count = data['total_count']
            total_count_top100 = data['total_count_top100']
            if total_count >= min_count:
                count_bottom400 = total_count - total_count_top100
                top100_rate = total_count_top100 / 100.0
                bottom400_rate = max(count_bottom400, 1) / 400.0
                period_local_lift = top100_rate / bottom400_rate
            else:
                period_local_lift = None

            analyzed_tags.append({
                'tag': tag,
                'slope': slope,
                'period_local_lift': period_local_lift,
                'avg_daily_avg_score': float(avg_daily_avg_score),
                'avg_total_score': float(avg_total_score),
                'min_score': float(min_score),
                'max_score': float(max_score),
                'normalized_std_dev': float(normalized_std_dev),
                'total_log_score': data['total_log_score'],
                'score_series': data['daily_avg_scores'],
            })

        if not analyzed_tags:
            raise HTTPException(status_code=404, detail="No tags with enough data to analyze.")

        # 4. 2×2 매트릭스 카테고리 분류 (Slope × Local Lift)
        # 분위 기준: Local Lift 있는 태그만으로 계산
        lifts = [t['period_local_lift'] for t in analyzed_tags if t['period_local_lift'] is not None]
        lift_median = float(np.percentile(lifts, 50)) if lifts else 1.0
        lift_p75 = float(np.percentile(lifts, 75)) if lifts else 1.5

        trend_leader = []    # 상승 + Lift 상위 50% → 지금 뜨는 트렌드
        broad_popular = []   # 상승 + Lift 하위 50% → 대중적이지만 경쟁 치열
        efficient_niche = [] # 비상승 + Lift 상위 25% → 틈새지만 상위권 집중
        declining = []       # 기울기 음수 → 수요 감소

        for t in analyzed_tags:
            lift = t['period_local_lift']
            slope = t['slope']
            if slope > 0:
                if lift is not None and lift >= lift_median:
                    trend_leader.append(t)
                else:
                    broad_popular.append(t)
            else:
                if slope < 0:
                    declining.append(t)
                if lift is not None and lift >= lift_p75:
                    efficient_niche.append(t)

        trend_leader.sort(key=lambda x: x['slope'], reverse=True)
        broad_popular.sort(key=lambda x: x['slope'], reverse=True)
        efficient_niche.sort(key=lambda x: (x['period_local_lift'] or 0), reverse=True)
        declining.sort(key=lambda x: x['slope'])

        final_response = {
            "trend_leader": trend_leader[:20],
            "broad_popular": broad_popular[:20],
            "efficient_niche": efficient_niche[:20],
            "declining": declining[:20],
        }

        # 내부 임시 필드 제거
        for category_list in final_response.values():
            for tag_data in category_list:
                tag_data.pop('total_log_score', None)

        response.headers["Cache-Control"] = "public, max-age=3600, s-maxage=86400"
        return final_response

    except HTTPException:
        raise
    except Exception:
        raise _server_error("Unhandled error while handling request")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
