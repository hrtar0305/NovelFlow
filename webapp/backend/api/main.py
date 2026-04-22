import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'package'))

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
import json
from fastapi import FastAPI, HTTPException, Query, Response
from fastapi.middleware.cors import CORSMiddleware
from mangum import Mangum
from pydantic import BaseModel, Field
from boto3.dynamodb.conditions import Key, Attr
from botocore.exceptions import ClientError
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta
from typing import Optional, List, Dict, Any

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
dev_origin_regex = r"https?://(localhost|127\.0\.0\.1|172\..*):\d+"

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
contest_table = dynamodb.Table('ContestStats2025')

# 2025 공모전 수상작 ID 로드
def load_ids_from_env(var_name):
    ids_str = os.environ.get(var_name)
    if ids_str:
        return set(ids_str.split(','))
    return set()

# 우선순위 순서대로 상을 정의합니다.
AWARD_WINNERS_2025 = {
    "대상": load_ids_from_env('GRAND_PRIZE_IDS_2025'),
    "최우수상": load_ids_from_env('TOP_EXCELLENCE_AWARD_IDS_2025'),
    "탑툰상": load_ids_from_env('TOPTOON_AWARD_IDS_2025'),
    "우수상": load_ids_from_env('WINNER_AWARD_IDS_2025'),
    "특별상": load_ids_from_env('SPECIAL_AWARD_IDS_2025'),
    "본선": load_ids_from_env('FINALIST_IDS_2025')
}

# DynamoDB의 Decimal 타입을 JSON으로 직렬화하기 위한 헬퍼 클래스
class DecimalEncoder(json.JSONEncoder):
    def default(self, o):
        if isinstance(o, decimal.Decimal):
            # 정수이면 int로, 실수이면 float으로 변환
            if o % 1 == 0:
                return int(o)
            else:
                return float(o)
        return super(DecimalEncoder, self).default(o)

def _convert_decimals(obj):
    """DynamoDB Decimal을 int/float으로 직접 변환 (json 이중 파싱 없이)."""
    if isinstance(obj, list):
        return [_convert_decimals(i) for i in obj]
    elif isinstance(obj, dict):
        return {k: _convert_decimals(v) for k, v in obj.items()}
    elif isinstance(obj, decimal.Decimal):
        return int(obj) if obj % 1 == 0 else float(obj)
    return obj

def _compute_retention_rates(item: dict) -> dict:
    """DB 원본 수치에서 초반/최신 연독률 계산 (단순 구간 비율).
    - EarlyRetentionRate: 1화 대비 30화 조회수 비율 (1화 독자 중 30화까지 읽은 비율)
    - RecentRetentionRate: 최신화 역순 30번째 대비 최신화 조회수 비율
    - 유효 에피소드 < 30개면 Early는 1화 대비 최신화 비율로 fallback
    """
    result = {"EarlyRetentionRate": None, "RecentRetentionRate": None}

    first_view = item.get("FirstEpView")
    ep30_view = item.get("Ep30View")
    latest_view = item.get("TargetLatestEpView")
    base_view = item.get("RecentBaseView")

    # Early: 1번째 유효 ep 대비 30번째 유효 ep 비율
    if first_view and first_view > 0:
        if ep30_view:
            result["EarlyRetentionRate"] = round(ep30_view / first_view, 4)
        elif latest_view:
            # fallback: 유효 에피소드 < 30개
            result["EarlyRetentionRate"] = round(latest_view / first_view, 4)

    # Recent: 최신화 역순 30번째 대비 최신화 비율
    if base_view and base_view > 0 and latest_view:
        result["RecentRetentionRate"] = round(latest_view / base_view, 4)

    return result

# --- Pydantic Response Models ---
class AvailableDatesResponse(BaseModel):
    available_dates: List[str] = Field(..., description="데이터가 존재하는 모든 날짜 목록 (내림차순 정렬)", example=["2025-08-20", "2025-08-19"])

class LatestDateResponse(BaseModel):
    latest_date: str = Field(..., description="데이터가 존재하는 가장 최근 날짜", example="2025-08-20")

class NovelRankData(BaseModel):
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
    rank_change: Optional[Any] = Field(None, description="랭킹 변동. 숫자 또는 'New'", example=5)
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

class NovelDetails(BaseModel):
    # Required fields
    ID: str
    Date: str
    Ranking: int
    Score: int

    # Optional fields that are usually present for detailed views
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

class TagRankData(BaseModel):
    tag: str
    power_score: float
    local_lift: Optional[float] = None  # top100 vs bottom400 상대적 표현도 (구 데이터는 null)
    count: int
    Rank: int
    rank_change: Optional[Any] = None  # 전일 대비 순위 변화 (양수=상승, 음수=하락, 'New'=신규)

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
    IsPlus: Optional[bool] = None
    IsFree: Optional[bool] = None
    FirstUpdate: Optional[str] = None
    LastUpdate: Optional[str] = None
    Synopsis: Optional[str] = None
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
    rank_change: Optional[Any] = Field(None, description="랭킹 변동. 숫자 또는 'New'")
    award: Optional[str] = Field(None, description="수상 내역 (예: 대상, 최우수상, 본선 진출)")
    is_new: bool = Field(False, description="신규 진입 여부")

@app.get("/")
def read_root(response: Response):
    """
    루트 엔드포인트. API 서버가 동작하는지 확인하는 용도.
    """
    response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
    return {"message": "Welcome to NP-Trend API"}

@app.get("/api/ranks/latest-date", response_model=LatestDateResponse)
def get_latest_date(response: Response):
    """
    데이터가 존재하는 가장 최근 날짜를 조회합니다.
    STATS#<date> 항목을 조회하여 가장 최근 날짜를 가져옵니다.
    """
    try:
        db_response = table.query(
            KeyConditionExpression=Key('ID').begins_with('STATS#'),
            ScanIndexForward=False, # Descending order by Date (Sort Key)
            Limit=1
        )
        items = db_response.get('Items', [])
        if items:
            response.headers["Cache-Control"] = "public, max-age=300, s-maxage=300"
            return LatestDateResponse(latest_date=items[0]['Date'])
        raise HTTPException(status_code=404, detail="No data found.")
    except ClientError as e:
        raise HTTPException(status_code=500, detail=f"DynamoDB query failed: {e.response['Error']['Message']}")

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
        raise HTTPException(status_code=500, detail=f"DynamoDB query failed: {e.response['Error']['Message']}")

@app.get("/api/ranks/novels/{date}", response_model=List[NovelRankData])
def get_novels_by_date(date: str, response: Response):
    """
    특정 날짜의 모든 소설 랭킹 데이터를 조회하고, 직전 날짜와의 랭킹 변동을 포함합니다.
    DateRankIndex GSI를 사용하여 해당 날짜의 데이터를 가져옵니다.
    """
    try:
        # 1. 현재 날짜의 소설 랭킹 데이터 조회 (페이지네이션 처리)
        all_current_items = []
        query_args = {
            'IndexName': 'DateRankIndex',
            'KeyConditionExpression': Key('Date').eq(date)
        }
        while True:
            current_day_db_response = table.query(**query_args)
            all_current_items.extend(current_day_db_response.get('Items', []))
            if 'LastEvaluatedKey' in current_day_db_response:
                query_args['ExclusiveStartKey'] = current_day_db_response['LastEvaluatedKey']
            else:
                break
        current_day_items = json.loads(json.dumps(all_current_items, cls=DecimalEncoder))

        if not current_day_items:
            raise HTTPException(status_code=404, detail="No data found for the given date.")

        # 2. 직전 날짜 계산
        current_date_dt = datetime.strptime(date, '%Y-%m-%d')
        previous_date_dt = current_date_dt - timedelta(days=1)
        previous_date = previous_date_dt.strftime('%Y-%m-%d')

        # 3. 직전 날짜의 소설 랭킹 데이터 조회 (페이지네이션 처리)
        all_previous_items = []
        prev_query_args = {
            'IndexName': 'DateRankIndex',
            'KeyConditionExpression': Key('Date').eq(previous_date)
        }
        while True:
            previous_day_db_response = table.query(**prev_query_args)
            all_previous_items.extend(previous_day_db_response.get('Items', []))
            if 'LastEvaluatedKey' in previous_day_db_response:
                prev_query_args['ExclusiveStartKey'] = previous_day_db_response['LastEvaluatedKey']
            else:
                break
        previous_day_items = json.loads(json.dumps(all_previous_items, cls=DecimalEncoder))

        # 4. 직전 날짜 랭킹 맵 생성 (novel_id -> rank)
        previous_ranks_map = {item['ID']: item['Ranking'] for item in previous_day_items}

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

        # 데이터는 하루에 한 번 바뀌므로 길게 캐싱 가능
        response.headers["Cache-Control"] = "public, max-age=3600, s-maxage=86400"
        return current_day_items

    except ClientError as e:
        raise HTTPException(status_code=500, detail=f"DynamoDB query failed: {e.response['Error']['Message']}")

@app.get("/api/novels/{novel_id}/latest", response_model=NovelDetails)
def get_latest_novel_details(novel_id: str, response: Response):
    """
    특정 소설의 가장 최근 전체 데이터를 조회합니다.
    """
    try:
        db_response = table.query(
            KeyConditionExpression=Key('ID').eq(novel_id),
            ScanIndexForward=False,
            Limit=1
        )
        items = db_response.get('Items', [])
        if items:
            latest_item = json.loads(json.dumps(items[0], cls=DecimalEncoder))
            latest_item.update(_compute_retention_rates(latest_item))
            response.headers["Cache-Control"] = "public, max-age=300, s-maxage=300"
            return latest_item
        else:
            raise HTTPException(status_code=404, detail="Novel not found")
    except ClientError as e:
        raise HTTPException(status_code=500, detail=f"DynamoDB query failed: {e.response['Error']['Message']}")

@app.get("/api/trends/novels/{novel_id}/{start_date}/{end_date}", response_model=List[Dict[str, Any]])
def get_novel_trend(novel_id: str, start_date: str, end_date: str, response: Response, _: Optional[str] = Query(None)):
    """
    특정 소설의 기간별 데이터 트렌드를 조회합니다.
    데이터가 없는 날짜는 `Ranking: null`로 채워서 반환합니다.
    프론트엔드에서 반드시 start_date와 end_date를 제공해야 합니다.
    """
    try:
        start_date_dt = datetime.strptime(start_date, '%Y-%m-%d')
        end_date_dt = datetime.strptime(end_date, '%Y-%m-%d')

        # DynamoDB에서 해당 기간의 실제 데이터 조회
        db_response = table.query(
            KeyConditionExpression=Key('ID').eq(novel_id) & Key('Date').between(start_date_dt.strftime('%Y-%m-%d'), end_date_dt.strftime('%Y-%m-%d'))
        )
        items = json.loads(json.dumps(db_response.get('Items', []), cls=DecimalEncoder))

        # Get title from the first available item (if any)
        novel_title = items[0].get('Title', 'Unknown Title') if items else 'Unknown Title'

        # 연독률 계산 적용
        for item in items:
            item.update(_compute_retention_rates(item))

        # 조회를 빠르게 하기 위해 날짜를 키로 하는 맵 생성
        data_map = {item['Date']: item for item in items}

        # 모든 날짜를 순회하며 데이터 채우기 (Padding)
        padded_data = []
        current_date = start_date_dt
        while current_date <= end_date_dt:
            date_str = current_date.strftime('%Y-%m-%d')
            if date_str in data_map:
                padded_data.append(data_map[date_str])
            else:
                # 데이터가 없는 날 (순위권 밖)
                padded_data.append({
                    'Date': date_str,
                    'Ranking': None, # null 값으로 순위권 밖을 표현
                    'Title': novel_title, # 일관된 제목 사용
                    'ID': novel_id,
                })
            current_date += timedelta(days=1)

        response.headers["Cache-Control"] = "public, max-age=3600, s-maxage=86400"
        return padded_data

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/trends/novels/{novel_id}/available-dates", response_model=AvailableDatesResponse)
def get_novel_available_dates(novel_id: str, response: Response):
    """
    특정 소설의 데이터가 존재하는 모든 날짜 목록을 조회합니다.
    비용 최소화를 위해 Date 속성만 프로젝션합니다.
    """
    try:
        db_response = table.query(
            KeyConditionExpression=Key('ID').eq(novel_id),
            ProjectionExpression='#d',
            ExpressionAttributeNames={'#d': 'Date'}
        )
        # DynamoDB는 날짜(SK)를 기준으로 자동 정렬하여 반환합니다.
        items = db_response.get('Items', [])
        dates = [item['Date'] for item in items]
        response.headers["Cache-Control"] = "public, max-age=300, s-maxage=300"
        return AvailableDatesResponse(available_dates=dates)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

def _compute_local_lift(count_top100: int, count_total: int, min_count: int = 5) -> Optional[float]:
    """
    Local Lift = top100_rate / bottom400_rate
    상위 100개와 하위 400개를 상호 배타적으로 비교하여 순위 관통력을 측정합니다.
    min_count 미만 태그는 노이즈로 간주하여 None 반환.
    """
    if count_total < min_count:
        return None
    count_bottom400 = count_total - count_top100
    top100_rate = count_top100 / 100.0
    bottom400_rate = max(count_bottom400, 1) / 400.0  # 최소 1로 스무딩 (상한: count_top100 * 4)
    return top100_rate / bottom400_rate


@app.get("/api/ranks/tags/{date}", response_model=List[TagRankData])
def get_tags_by_date(date: str, response: Response):
    """
    특정 날짜의 태그 랭킹 데이터를 조회합니다.
    - power_score: Σ 1/ln(rank+1) — 시장 지배력 (빈도 × 순위 품질)
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

        tag_data = []
        for tag in scores_log.keys():
            count_total = int(counts_total.get(tag, 0))
            count_top100 = int(counts_top100.get(tag, 0))
            tag_data.append({
                'tag': tag,
                'power_score': scores_log.get(tag, 0),
                'local_lift': _compute_local_lift(count_top100, count_total) if has_top100_data else None,
                'count': count_total,
            })

        processed_data = json.loads(json.dumps(tag_data, cls=DecimalEncoder))

        # power_score 기준 정렬 후 순위 부여
        sorted_data = sorted(processed_data, key=lambda x: x.get('power_score', 0), reverse=True)
        for i, tag_item in enumerate(sorted_data):
            tag_item['Rank'] = i + 1

        # 전날 데이터 조회하여 rank_change 계산 (power_score 기준)
        prev_rank_map = {}
        try:
            prev_date = (datetime.strptime(date, '%Y-%m-%d') - timedelta(days=1)).strftime('%Y-%m-%d')
            prev_db_response = table.get_item(
                Key={'ID': f'STATS#{prev_date}', 'Date': prev_date},
                ProjectionExpression='TagWeightedScoresLogarithmic'
            )
            prev_item = prev_db_response.get('Item')
            if prev_item:
                prev_scores = json.loads(json.dumps(dict(prev_item.get('TagWeightedScoresLogarithmic', {})), cls=DecimalEncoder))
                sorted_prev = sorted(prev_scores.items(), key=lambda x: x[1], reverse=True)
                prev_rank_map = {tag: i + 1 for i, (tag, _) in enumerate(sorted_prev)}
        except Exception as e:
            logger.warning(f"Failed to fetch previous day tag ranks for rank_change: {e}")

        for tag_item in sorted_data:
            prev_rank = prev_rank_map.get(tag_item['tag'])
            if not prev_rank_map:
                tag_item['rank_change'] = None
            elif prev_rank is None:
                tag_item['rank_change'] = 'New'
            else:
                tag_item['rank_change'] = prev_rank - tag_item['Rank']

        response.headers["Cache-Control"] = "public, max-age=3600, s-maxage=86400"
        return sorted_data

    except ClientError as e:
        raise HTTPException(status_code=500, detail=f"DynamoDB query failed: {e.response['Error']['Message']}")

@app.get("/api/authors/{author_id}", response_model=List[NovelDetails])
async def get_author_novels(author_id: str, response: Response):
    if author_id == "0":
        raise HTTPException(status_code=404, detail="Author not found")
    try:
        gsi_response = table.query(
            IndexName='AuthorIDIndex',
            KeyConditionExpression=Key('AuthorID').eq(author_id)
        )
    except ClientError as e:
        raise HTTPException(status_code=500, detail=f"DynamoDB GSI query failed: {e}")
    novel_ids = {item['ID'] for item in gsi_response.get('Items', [])}
    if not novel_ids:
        raise HTTPException(status_code=404, detail="Author not found")
    latest_novels = []
    for novel_id in novel_ids:
        try:
            db_response = table.query(
                KeyConditionExpression=Key('ID').eq(novel_id),
                ScanIndexForward=False,
                Limit=1
            )
            if db_response.get('Items'):
                item = json.loads(json.dumps(db_response['Items'][0], cls=DecimalEncoder))
                latest_novels.append(item)
        except ClientError as e:
            raise HTTPException(status_code=500, detail=f"DynamoDB query failed for novel {novel_id}: {e}")
    response.headers["Cache-Control"] = "public, max-age=300, s-maxage=300"
    return latest_novels

@app.get("/api/contests/{year}/latest-date", response_model=LatestDateResponse)
def get_contest_latest_date(year: int, response: Response):
    """
    공모전 데이터가 존재하는 가장 최근 날짜를 조회합니다.
    """
    if year != 2025:
        raise HTTPException(status_code=404, detail=f"Contest data for year {year} not found.")
    try:
        db_response = contest_table.get_item(
            Key={'ID': 'CONTEST_AVAILABLE_DATES', 'Date': 'METADATA'}
        )
        item = db_response.get('Item')
        if item and 'dates' in item and item['dates']:
            latest_date = sorted(list(item['dates']), reverse=True)[0]
            response.headers["Cache-Control"] = "public, max-age=300, s-maxage=300"
            return LatestDateResponse(latest_date=latest_date)
        raise HTTPException(status_code=404, detail="No latest date found for contest.")
    except ClientError as e:
        raise HTTPException(status_code=500, detail=f"DynamoDB query failed: {e.response['Error']['Message']}")

@app.get("/api/contests/{year}/available-dates", response_model=AvailableDatesResponse)
def get_contest_available_dates(year: int, response: Response):
    """
    공모전 데이터가 존재하는 모든 날짜 목록을 조회합니다.
    """
    if year != 2025:
        raise HTTPException(status_code=404, detail=f"Contest data for year {year} not found.")
    try:
        db_response = contest_table.get_item(
            Key={'ID': 'CONTEST_AVAILABLE_DATES', 'Date': 'METADATA'}
        )
        item = db_response.get('Item')
        if item and 'dates' in item:
            response.headers["Cache-Control"] = "public, max-age=300, s-maxage=300"
            return AvailableDatesResponse(available_dates=sorted(list(item['dates']), reverse=True))
        raise HTTPException(status_code=404, detail="No available dates found for contest.")
    except ClientError as e:
        raise HTTPException(status_code=500, detail=f"DynamoDB query failed: {e.response['Error']['Message']}")

# 공모전 랭킹 리스트 뷰에서 실제 사용하는 필드만 조회 (Synopsis, 에피소드 조회수 등 제외)
# 'Date', 'View', 'Like', 'Rank'는 DynamoDB 예약어이므로 ExpressionAttributeNames 사용
_CONTEST_LIST_PROJ = 'ID, #dt, Title, AuthorName, AuthorID, #vw, #lk, Fav, Alr, Eps, Tags, #rk'
_CONTEST_LIST_NAMES = {'#dt': 'Date', '#vw': 'View', '#lk': 'Like', '#rk': 'Rank'}

def _fetch_all_contest_items(target_date: str, projection: str | None = None, expr_names: dict | None = None) -> list:
    """지정 날짜의 전체 공모전 항목을 페이지네이션으로 조회합니다."""
    items = []
    query_args = {
        'IndexName': 'DateViewIndex',
        'KeyConditionExpression': Key('Date').eq(target_date),
    }
    if projection:
        query_args['ProjectionExpression'] = projection
    if expr_names:
        query_args['ExpressionAttributeNames'] = expr_names
    while True:
        resp = contest_table.query(**query_args)
        items.extend(resp.get('Items', []))
        if 'LastEvaluatedKey' not in resp:
            break
        query_args['ExclusiveStartKey'] = resp['LastEvaluatedKey']
    return _convert_decimals(items)


@app.get("/api/contests/{year}/{date}", response_model=List[ContestNovelData])
def get_contest_data_by_date(year: int, date: str, response: Response):
    """
    지정된 연도의 특정 날짜 공모전 소설 데이터를 조회합니다.
    """
    if year != 2025:
        raise HTTPException(status_code=404, detail=f"Contest data for year {year} not found.")

    # 전날 날짜 산출 (available_dates_list 조회)
    available_dates_list = []
    try:
        dates_response = contest_table.get_item(Key={'ID': 'CONTEST_AVAILABLE_DATES', 'Date': 'METADATA'})
        dates_item = dates_response.get('Item')
        if dates_item and 'dates' in dates_item:
            available_dates_list = sorted(list(dates_item['dates']), reverse=True)
    except ClientError as e:
        logger.warning(f"Could not fetch available dates for contest: {e}")

    previous_date = None
    try:
        idx = available_dates_list.index(date)
        if idx + 1 < len(available_dates_list):
            previous_date = available_dates_list[idx + 1]
    except (ValueError, IndexError):
        pass

    try:
        # 현재 날짜 + 전날 DynamoDB 쿼리 병렬 실행 (리스트 뷰에 필요한 필드만 투영)
        with ThreadPoolExecutor(max_workers=2) as executor:
            future_current = executor.submit(_fetch_all_contest_items, date, _CONTEST_LIST_PROJ, _CONTEST_LIST_NAMES)
            future_prev = executor.submit(_fetch_all_contest_items, previous_date, _CONTEST_LIST_PROJ, _CONTEST_LIST_NAMES) if previous_date else None
            current_day_items = future_current.result()
            previous_day_items = future_prev.result() if future_prev else []

        if not current_day_items:
            raise HTTPException(status_code=404, detail="No data found for the given date.")

        previous_day_map = {item['ID']: item for item in previous_day_items}

        for item in current_day_items:
            previous_item = previous_day_map.get(item['ID'])
            item['award'] = None
            for award_name, ids_set in AWARD_WINNERS_2025.items():
                if item['ID'] in ids_set:
                    item['award'] = award_name
                    break
            item['view_change'] = (item.get('View', 0) or 0) - (previous_item.get('View', 0) or 0) if previous_item else (item.get('View', 0) or 0)
            item['is_new'] = False
            if previous_item and previous_item.get('Rank') is not None:
                previous_rank = previous_item['Rank']
                current_rank = item.get('Rank')
                item['rank_change'] = previous_rank - current_rank if current_rank is not None else 'New'
                if item['rank_change'] == 'New': item['is_new'] = True
            else:
                item['rank_change'] = 'New'

        response.headers["Cache-Control"] = "public, max-age=3600, s-maxage=86400"
        return current_day_items

    except ClientError as e:
        if e.response['Error']['Code'] == 'ResourceNotFoundException':
            raise HTTPException(status_code=500, detail="Required index 'DateViewIndex' not found on contest table.")
        raise HTTPException(status_code=500, detail=f"DynamoDB query failed: {e.response['Error']['Message']}")

@app.get("/api/contests/{year}/novels/{novel_id}/latest", response_model=ContestNovelData)
def get_latest_contest_novel_details(year: int, novel_id: str, response: Response):
    """
    특정 공모전 소설의 가장 최근 전체 데이터를 조회합니다.
    """
    if year != 2025:
        raise HTTPException(status_code=404, detail=f"Contest data for year {year} not found.")

    try:
        db_response = contest_table.query(
            KeyConditionExpression=Key('ID').eq(novel_id),
            ScanIndexForward=False,
            Limit=1
        )
        items = db_response.get('Items', [])
        if items:
            latest_item = json.loads(json.dumps(items[0], cls=DecimalEncoder))
            # 수상 내역 추가
            latest_item['award'] = None
            for award_name, ids_set in AWARD_WINNERS_2025.items():
                if latest_item['ID'] in ids_set:
                    latest_item['award'] = award_name
                    break
            # 프론트엔드에서 필요한 필드 추가
            latest_item['Rank'] = latest_item.get('Rank', 0)
            latest_item['view_change'] = 0
            latest_item['is_new'] = False
            response.headers["Cache-Control"] = "public, max-age=300, s-maxage=300"
            return latest_item
        else:
            raise HTTPException(status_code=404, detail="Contest novel not found")
    except ClientError as e:
        raise HTTPException(status_code=500, detail=f"DynamoDB query failed: {e.response['Error']['Message']}")

@app.get("/api/trends/contests/{year}/novels/{novel_id}/available-dates", response_model=AvailableDatesResponse)
def get_contest_novel_available_dates(year: int, novel_id: str, response: Response):
    """
    특정 공모전 소설의 데이터가 존재하는 모든 날짜 목록을 조회합니다.
    """
    if year != 2025:
        raise HTTPException(status_code=404, detail=f"Contest data for year {year} not found.")
    try:
        db_response = contest_table.query(
            KeyConditionExpression=Key('ID').eq(novel_id),
            ProjectionExpression='#d',
            ExpressionAttributeNames={'#d': 'Date'}
        )
        items = db_response.get('Items', [])
        dates = [item['Date'] for item in items]
        response.headers["Cache-Control"] = "public, max-age=300, s-maxage=300"
        return AvailableDatesResponse(available_dates=dates)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/trends/contests/{year}/novels/{novel_id}/{start_date}/{end_date}", response_model=List[Dict[str, Any]])
def get_contest_novel_trend(year: int, novel_id: str, start_date: str, end_date: str, response: Response, _: Optional[str] = Query(None)):
    """
    특정 공모전 소설의 기간별 데이터 트렌드를 조회합니다.
    데이터가 없는 날짜는 null 값으로 채워서 반환합니다.
    """
    if year != 2025:
        raise HTTPException(status_code=404, detail=f"Contest data for year {year} not found.")

    try:
        start_date_dt = datetime.strptime(start_date, '%Y-%m-%d')
        end_date_dt = datetime.strptime(end_date, '%Y-%m-%d')

        # DynamoDB에서 해당 기간의 실제 데이터 조회
        db_response = contest_table.query(
            KeyConditionExpression=Key('ID').eq(novel_id) & Key('Date').between(start_date_dt.strftime('%Y-%m-%d'), end_date_dt.strftime('%Y-%m-%d'))
        )
        items = json.loads(json.dumps(db_response.get('Items', []), cls=DecimalEncoder))

        novel_title = items[0].get('Title', 'Unknown Title') if items else 'Unknown Title'

        # 조회를 빠르게 하기 위해 날짜를 키로 하는 맵 생성
        data_map = {item['Date']: item for item in items}

        # 모든 날짜를 순회하며 데이터 채우기 (Padding)
        padded_data = []
        current_date = start_date_dt
        while current_date <= end_date_dt:
            date_str = current_date.strftime('%Y-%m-%d')
            if date_str in data_map:
                padded_data.append(data_map[date_str])
            else:
                # 데이터가 없는 날
                padded_data.append({
                    'Date': date_str,
                    'ID': novel_id,
                    'Title': novel_title,
                    'View': None,
                    'Like': None,
                    'Fav': None,
                    'Eps': None,
                    'Synopsis': None,
                    'Rank': None,
                })
            current_date += timedelta(days=1)

        response.headers["Cache-Control"] = "public, max-age=3600, s-maxage=86400"
        return padded_data

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/contests/{year}/ranks/tags/{date}", response_model=List[ContestTagRankData])
def get_contest_tags_by_date(year: int, date: str, response: Response):
    """
    특정 날짜의 공모전 태그 랭킹 데이터를 조회합니다.
    """
    if year != 2025:
        raise HTTPException(status_code=404, detail=f"Contest data for year {year} not found.")

    try:
        db_response = contest_table.get_item(Key={'ID': f"TAG_STATS#{date}", 'Date': date})
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
        
        processed_data = json.loads(json.dumps(tag_data, cls=DecimalEncoder))
        sorted_data = sorted(processed_data, key=lambda x: x.get('score_linear', 0), reverse=True)
        
        for i, item in enumerate(sorted_data):
            item['Rank'] = i + 1
        response.headers["Cache-Control"] = "public, max-age=3600, s-maxage=86400"
        return sorted_data
    except ClientError as e:
        raise HTTPException(status_code=500, detail=f"DynamoDB query failed: {e.response['Error']['Message']}")

@app.get("/api/trends/tags/analysis/{start_date}/{end_date}")
def analyze_tag_trends(start_date: str, end_date: str, response: Response, _: Optional[str] = Query(None)):
    """
    지정된 기간 동안의 태그 트렌드를 분석하여 카테고리별로 반환합니다.
    """
    import numpy as np
    import math

    try:
        # 1. 데이터 조회 및 집계
        start_date_dt = datetime.strptime(start_date, '%Y-%m-%d')
        end_date_dt = datetime.strptime(end_date, '%Y-%m-%d')
        delta = end_date_dt - start_date_dt
        dates = [(start_date_dt + timedelta(days=i)).strftime('%Y-%m-%d') for i in range(delta.days + 1)]
        
        all_items_raw = []
        keys_to_get = [{'ID': f"STATS#{date}", 'Date': date} for date in dates]

        # DynamoDB batch_get_item은 한 번에 최대 100개의 아이템만 요청할 수 있으므로, 100개씩 나누어 처리합니다.
        for i in range(0, len(keys_to_get), 100):
            chunk = keys_to_get[i:i + 100]
            db_response = dynamodb.batch_get_item(
                RequestItems={
                    table.name: {
                        'Keys': chunk,
                        'ProjectionExpression': 'ID, #d, TagWeightedScoresLogarithmic, TagCountsTop100, TagCounts',
                        'ExpressionAttributeNames': {'#d': 'Date'}
                    }
                }
            )
            all_items_raw.extend(db_response.get('Responses', {}).get(table.name, []))

        items = json.loads(json.dumps(all_items_raw, cls=DecimalEncoder))
        
        if not items:
            raise HTTPException(status_code=404, detail="No statistics data found for the given date range.")

        # 2. 태그별 데이터 집계 및 시계열 생성
        tag_analytics = {}
        date_map = {date: i for i, date in enumerate(dates)}

        for item in items:
            item_date = item['Date']
            if item_date not in date_map:
                continue
            
            idx = date_map[item_date]
            scores_log = item.get('TagWeightedScoresLogarithmic', {})
            counts_top100 = item.get('TagCountsTop100', {})  # 없으면 {} (구 날짜 호환)
            counts = item.get('TagCounts', {})

            for tag in set(scores_log.keys()) | set(counts.keys()):
                if tag not in tag_analytics:
                    tag_analytics[tag] = {
                        'total_log_score': 0,
                        'total_count': 0,
                        'total_count_top100': 0,
                        'daily_avg_scores': [0.0] * len(dates),
                        'daily_total_scores': [0.0] * len(dates)
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
        min_count = max(5, len(dates) * 2)

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

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    
if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
