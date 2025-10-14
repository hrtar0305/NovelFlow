import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'package'))

import boto3
import decimal
import json
from fastapi import FastAPI, HTTPException, Query, Response
from fastapi.middleware.cors import CORSMiddleware
from mangum import Mangum
from pydantic import BaseModel, Field
from boto3.dynamodb.conditions import Key, Attr
from botocore.exceptions import ClientError
from datetime import datetime, timedelta
from typing import Optional, List, Dict, Any

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

class TagRankData(BaseModel):
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
    RetentionRate: Optional[float] = None # 연독률
    Rank: Optional[int] = None  # Calculated rank based on view_change
    view_change: int = Field(0, description="조회수 변동. 프론트엔드에서 계산됨.")
    is_new: bool = Field(False, description="신규 진입 여부. 프론트엔드에서 계산됨.")


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
            response.headers["Cache-Control"] = "public, max-age=300" # 5분 캐싱
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
            response.headers["Cache-Control"] = "public, max-age=300" # 5분 캐싱 (latest-date와 동기화)
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
        # 1. 현재 날짜의 소설 랭킹 데이터 조회
        current_day_db_response = table.query(
            IndexName='DateRankIndex',
            KeyConditionExpression=Key('Date').eq(date)
        )
        current_day_items = json.loads(json.dumps(current_day_db_response.get('Items', []), cls=DecimalEncoder))

        if not current_day_items:
            raise HTTPException(status_code=404, detail="No data found for the given date.")

        # 2. 직전 날짜 계산
        current_date_dt = datetime.strptime(date, '%Y-%m-%d')
        previous_date_dt = current_date_dt - timedelta(days=1)
        previous_date = previous_date_dt.strftime('%Y-%m-%d')

        # 3. 직전 날짜의 소설 랭킹 데이터 조회
        previous_day_db_response = table.query(
            IndexName='DateRankIndex',
            KeyConditionExpression=Key('Date').eq(previous_date)
        )
        previous_day_items = json.loads(json.dumps(previous_day_db_response.get('Items', []), cls=DecimalEncoder))

        # 4. 직전 날짜 랭킹 맵 생성 (novel_id -> rank)
        previous_ranks_map = {item['ID']: item['Ranking'] for item in previous_day_items}

        # 5. 현재 날짜 데이터에 랭킹 변동 정보 추가
        for item in current_day_items:
            novel_id = item['ID'] # ID is already NOVEL#<novel_id>
            current_rank = item['Ranking']

            if novel_id in previous_ranks_map:
                previous_rank = previous_ranks_map[novel_id]
                rank_change = previous_rank - current_rank
                item['rank_change'] = rank_change
            else:
                item['rank_change'] = 'New' # 신규 진입

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
            response.headers["Cache-Control"] = "public, max-age=300" # 5분 캐싱
            return latest_item
        else:
            raise HTTPException(status_code=404, detail="Novel not found")
    except ClientError as e:
        raise HTTPException(status_code=500, detail=f"DynamoDB query failed: {e.response['Error']['Message']}")

@app.get("/api/trends/novels/{novel_id}", response_model=List[Dict[str, Any]])
def get_novel_trend(novel_id: str, start_date: str, end_date: str, response: Response):
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
        response.headers["Cache-Control"] = "public, max-age=300" # 5분 캐싱
        return AvailableDatesResponse(available_dates=dates)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/ranks/tags/{date}", response_model=List[TagRankData])
def get_tags_by_date(date: str, response: Response):
    """
    특정 날짜의 태그 랭킹 데이터를 조회합니다.
    """
    try:
        db_response = table.get_item(Key={'ID': f"STATS#{date}", 'Date': date})
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
        
        # Sort by linear score to determine rank
        sorted_data = sorted(processed_data, key=lambda x: x.get('score_linear', 0), reverse=True)
        
        # Add rank to each item
        for i, item in enumerate(sorted_data):
            item['Rank'] = i + 1

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
    response.headers["Cache-Control"] = "public, max-age=300" # 5분 캐싱
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
            response.headers["Cache-Control"] = "public, max-age=300" # 5분 캐싱
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
            response.headers["Cache-Control"] = "public, max-age=300" # 5분 캐싱 (latest-date와 동기화)
            return AvailableDatesResponse(available_dates=sorted(list(item['dates']), reverse=True))
        raise HTTPException(status_code=404, detail="No available dates found for contest.")
    except ClientError as e:
        raise HTTPException(status_code=500, detail=f"DynamoDB query failed: {e.response['Error']['Message']}")

@app.get("/api/contests/{year}/{date}", response_model=List[ContestNovelData])
def get_contest_data_by_date(year: int, date: str, response: Response):
    """
    지정된 연도의 특정 날짜 공모전 소설 데이터를 조회합니다.
    """
    # For now, we only have 2025 data.
    if year != 2025:
        raise HTTPException(status_code=404, detail=f"Contest data for year {year} not found.")

    try:
        # 1. Get current day's data with pagination
        all_items = []
        query_args = {
            'IndexName': 'DateViewIndex',
            'KeyConditionExpression': Key('Date').eq(date)
        }

        while True:
            db_response = contest_table.query(**query_args)
            items = db_response.get('Items', [])
            all_items.extend(items)
            
            if 'LastEvaluatedKey' in db_response:
                query_args['ExclusiveStartKey'] = db_response['LastEvaluatedKey']
            else:
                break

        current_day_items = json.loads(json.dumps(all_items, cls=DecimalEncoder))

        if not current_day_items:
            raise HTTPException(status_code=404, detail="No data found for the given date.")

        # The 'rank' is now pre-calculated. We just need to add placeholder fields
        # for the frontend to calculate daily changes.
        for item in current_day_items:
            # Add placeholder fields that frontend will calculate
            item['view_change'] = 0
            item['is_new'] = False

        response.headers["Cache-Control"] = "public, max-age=3600, s-maxage=86400"
        return current_day_items

    except ClientError as e:
        # Handle cases where the GSI might not exist yet
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
            # 프론트엔드에서 필요한 필드 추가
            latest_item['Rank'] = latest_item.get('Rank', 0)
            latest_item['view_change'] = 0
            latest_item['is_new'] = False
            response.headers["Cache-Control"] = "public, max-age=300" # 5분 캐싱
            return latest_item
        else:
            raise HTTPException(status_code=404, detail="Contest novel not found")
    except ClientError as e:
        raise HTTPException(status_code=500, detail=f"DynamoDB query failed: {e.response['Error']['Message']}")

@app.get("/api/trends/contests/{year}/novels/{novel_id}", response_model=List[Dict[str, Any]])
def get_contest_novel_trend(year: int, novel_id: str, start_date: str, end_date: str, response: Response):
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
                    'RetentionRate': None,
                })
            current_date += timedelta(days=1)

        response.headers["Cache-Control"] = "public, max-age=3600, s-maxage=86400"
        return padded_data

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/contests/{year}/ranks/tags/{date}", response_model=List[TagRankData])
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

@app.get("/api/trends/tags/analysis")
def analyze_tag_trends(start_date: str, end_date: str, response: Response):
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
                        'ProjectionExpression': 'ID, #d, TagWeightedScoresInverseLinear, TagCounts',
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
            scores_linear = item.get('TagWeightedScoresInverseLinear', {})
            counts = item.get('TagCounts', {})

            for tag in scores_linear.keys():
                if tag not in tag_analytics:
                    tag_analytics[tag] = {
                        'total_linear_score': 0,
                        'total_count': 0,
                        'daily_avg_scores': [0.0] * len(dates),
                        'daily_total_scores': [0.0] * len(dates)
                    }
                
                score = scores_linear.get(tag, 0)
                count = counts.get(tag, 0)

                tag_analytics[tag]['total_linear_score'] += score
                tag_analytics[tag]['total_count'] += count
                tag_analytics[tag]['daily_total_scores'][idx] = score
                if count > 0:
                    avg_score = score / count
                    tag_analytics[tag]['daily_avg_scores'][idx] = avg_score

        # 3. 각 태그에 대한 최종 분석 지표 계산
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

            analyzed_tags.append({
                'tag': tag,
                'slope': slope,
                'avg_daily_avg_score': float(avg_daily_avg_score),
                'avg_total_score': float(avg_total_score),
                'min_score': float(min_score),
                'max_score': float(max_score),
                'normalized_std_dev': float(normalized_std_dev),
                'total_score': data['total_linear_score'],
                'score_series': data['daily_avg_scores'], # 일일 평균 점수 시계열
                'total_score_series': data['daily_total_scores'] # 일일 총합 점수 시계열
            })

        if not analyzed_tags:
            raise HTTPException(status_code=404, detail="No tags with enough data to analyze.")

        # 4. 카테고리별 태그 분류
        # 상승 태그 / 하락 태그
        analyzed_tags.sort(key=lambda x: x['slope'], reverse=True)
        rising_tags = [t for t in analyzed_tags if t['slope'] > 0][:20]
        falling_tags = [t for t in reversed(analyzed_tags) if t['slope'] < 0][:20]

        # 상위 10% 인기 태그 풀 생성
        analyzed_tags.sort(key=lambda x: x['total_score'], reverse=True)
        total_score_threshold_index = int(len(analyzed_tags) * 0.1)
        popular_tags_pool = analyzed_tags[:total_score_threshold_index + 1]

        # 꾸준한 인기 태그
        stable_pool = list(popular_tags_pool)
        stable_pool.sort(key=lambda x: x['normalized_std_dev'])
        stable_popular_tags = stable_pool[:20]

        # 격동의 태그
        volatile_pool = list(popular_tags_pool)
        volatile_pool.sort(key=lambda x: x['normalized_std_dev'], reverse=True)
        volatile_tags = volatile_pool[:20]

        # 주목할 만한 태그
        all_categorized_tags = set(t['tag'] for t in rising_tags + falling_tags + stable_popular_tags + volatile_tags)
        noteworthy_tags = [t for t in analyzed_tags if t['tag'] not in all_categorized_tags and t['max_score'] >= 450]
        noteworthy_tags.sort(key=lambda x: x['max_score'], reverse=True)
        noteworthy_tags = noteworthy_tags[:20]
        
        # Remove temporary total_score before returning
        final_response = {
            "rising_trend": rising_tags,
            "falling_trend": falling_tags,
            "stable_popular": stable_popular_tags,
            "volatile_tags": volatile_tags,
            "noteworthy": noteworthy_tags
        }

        for category_list in final_response.values():
            for tag_data in category_list:
                # Remove temporary or redundant fields before returning
                tag_data.pop('total_score', None)
                if category_list is not final_response['stable_popular'] and category_list is not final_response['volatile_tags']:
                    tag_data.pop('total_score_series', None)

        response.headers["Cache-Control"] = "public, max-age=3600, s-maxage=86400"
        return final_response

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    
if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)