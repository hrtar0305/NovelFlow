import boto3
import decimal
import json
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from mangum import Mangum
from boto3.dynamodb.conditions import Key
from botocore.exceptions import ClientError
from datetime import datetime, timedelta
from typing import Optional

# FastAPI 애플리케이션 인스턴스 생성
app = FastAPI()

# CORS 미들웨어 설정
origins = [
    "http://localhost:5173", # frontend development server
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Mangum 핸들러 생성: FastAPI 앱을 Lambda에서 실행 가능하도록 변환
handler = Mangum(app)

# DynamoDB 리소스 초기화
dynamodb = boto3.resource('dynamodb', region_name='ap-northeast-2')
table = dynamodb.Table('NovelRanks')

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

@app.get("/")
def read_root():
    """
    루트 엔드포인트. API 서버가 동작하는지 확인하는 용도.
    """
    return {"message": "Welcome to NP-Trend API"}

@app.get("/ranks/latest-date")
def get_latest_date():
    """
    데이터가 존재하는 가장 최근 날짜를 조회합니다.
    STATS#<date> 항목을 조회하여 가장 최근 날짜를 가져옵니다.
    """
    try:
        response = table.query(
            KeyConditionExpression=Key('ID').begins_with('STATS#'),
            ScanIndexForward=False, # Descending order by Date (Sort Key)
            Limit=1
        )
        items = response.get('Items', [])
        if items:
            return {"latest_date": items[0]['Date']}
        else:
            return {"message": "No data found."}
    except Exception as e:
        return {"error": str(e)}

@app.get("/api/dates")
def get_available_dates():
    """
    데이터가 존재하는 모든 날짜 목록을 조회합니다.
    AVAILABLE_DATES 아이템에서 날짜 목록을 가져옵니다.
    """
    try:
        response = table.get_item(
            Key={
                'ID': 'AVAILABLE_DATES',
                'Date': 'ALL_DATES'
            }
        )
        item = response.get('Item')
        if item and 'dates' in item:
            return {"available_dates": item['dates']}
        else:
            return {"message": "No available dates found."}
    except Exception as e:
        return {"error": str(e)}


@app.get("/ranks/novels/{date}")
def get_novels_by_date(date: str):
    """
    특정 날짜의 모든 소설 랭킹 데이터를 조회하고, 직전 날짜와의 랭킹 변동을 포함합니다.
    DateRankIndex GSI를 사용하여 해당 날짜의 데이터를 가져옵니다.
    """
    try:
        # 1. 현재 날짜의 소설 랭킹 데이터 조회
        current_day_response = table.query(
            IndexName='DateRankIndex',
            KeyConditionExpression=Key('Date').eq(date)
        )
        current_day_items = json.loads(json.dumps(current_day_response.get('Items', []), cls=DecimalEncoder))

        if not current_day_items:
            return {"message": "No data found for the given date."}

        # 2. 직전 날짜 계산
        current_date_dt = datetime.strptime(date, '%Y-%m-%d')
        previous_date_dt = current_date_dt - timedelta(days=1)
        previous_date = previous_date_dt.strftime('%Y-%m-%d')

        # 3. 직전 날짜의 소설 랭킹 데이터 조회
        previous_day_response = table.query(
            IndexName='DateRankIndex',
            KeyConditionExpression=Key('Date').eq(previous_date)
        )
        previous_day_items = json.loads(json.dumps(previous_day_response.get('Items', []), cls=DecimalEncoder))

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

        return current_day_items

    except Exception as e:
        return {"error": str(e)}


@app.get("/novels/{novel_id}/latest")
def get_latest_novel_details(novel_id: str):
    """
    특정 소설의 가장 최근 전체 데이터를 조회합니다.
    """
    try:
        response = table.query(
            KeyConditionExpression=Key('ID').eq(novel_id),
            ScanIndexForward=False,
            Limit=1
        )
        items = response.get('Items', [])
        if items:
            latest_item = json.loads(json.dumps(items[0], cls=DecimalEncoder))
            return latest_item
        else:
            raise HTTPException(status_code=404, detail="Novel not found")
    except ClientError as e:
        raise HTTPException(status_code=500, detail=f"DynamoDB query failed: {e.response['Error']['Message']}")


@app.get("/trends/novels/{novel_id}")
def get_novel_trend(novel_id: str, start_date: Optional[str] = None, end_date: Optional[str] = None):
    """
    특정 소설의 기간별 데이터 트렌드를 조회합니다.
    데이터가 없는 날짜는 `Ranking: null`로 채워서 반환합니다.
    """
    try:
        # 날짜 파라미터가 없으면 기본값 설정 (최근 30일)
        if not end_date:
            end_date_dt = datetime.now()
        else:
            end_date_dt = datetime.strptime(end_date, '%Y-%m-%d')

        if not start_date:
            start_date_dt = end_date_dt - timedelta(days=29)
        else:
            start_date_dt = datetime.strptime(start_date, '%Y-%m-%d')

        # DynamoDB에서 해당 기간의 실제 데이터 조회
        response = table.query(
            KeyConditionExpression=Key('ID').eq(novel_id) & Key('Date').between(start_date_dt.strftime('%Y-%m-%d'), end_date_dt.strftime('%Y-%m-%d'))
        )
        items = json.loads(json.dumps(response.get('Items', []), cls=DecimalEncoder))

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

        return padded_data

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/trends/novels/{novel_id}/available-dates")
def get_novel_available_dates(novel_id: str):
    """
    특정 소설의 데이터가 존재하는 모든 날짜 목록을 조회합니다.
    비용 최소화를 위해 Date 속성만 프로젝션합니다.
    """
    try:
        response = table.query(
            KeyConditionExpression=Key('ID').eq(novel_id),
            ProjectionExpression='#d',
            ExpressionAttributeNames={'#d': 'Date'}
        )
        # DynamoDB는 날짜(SK)를 기준으로 자동 정렬하여 반환합니다.
        items = response.get('Items', [])
        dates = [item['Date'] for item in items]
        return {"available_dates": dates}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/ranks/tags/{date}")
def get_tags_by_date(date: str):
    """
    특정 날짜의 태그 랭킹 데이터를 조회하고, 직전 날짜와의 랭킹 변동을 포함합니다.
    """
    try:
        # Helper function to process tag stats for a given date
        def get_processed_tag_stats(target_date: str):
            response = table.get_item(Key={'ID': f"STATS#{target_date}", 'Date': target_date})
            item = response.get('Item')
            if not item:
                return None

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
            return sorted(processed_data, key=lambda x: x.get('score_linear', 0), reverse=True)

        # 1. Get current day's ranked tags
        current_day_ranks = get_processed_tag_stats(date)
        if not current_day_ranks:
            return {"message": "No tag statistics found for the given date."}

        # 2. Get previous day's ranked tags
        current_date_dt = datetime.strptime(date, '%Y-%m-%d')
        previous_date = (current_date_dt - timedelta(days=1)).strftime('%Y-%m-%d')
        previous_day_ranks = get_processed_tag_stats(previous_date)

        # 3. Create a map of previous day's ranks
        previous_ranks_map = {}
        if previous_day_ranks:
            previous_ranks_map = {tag_info['tag']: i + 1 for i, tag_info in enumerate(previous_day_ranks)}

        # 4. Add rank and rank_change to current day's data
        for i, tag_info in enumerate(current_day_ranks):
            current_rank = i + 1
            tag_info['rank'] = current_rank
            
            previous_rank = previous_ranks_map.get(tag_info['tag'])
            if previous_rank is not None:
                tag_info['rank_change'] = previous_rank - current_rank
            else:
                tag_info['rank_change'] = 'New'

        return current_day_ranks

    except Exception as e:
        return {"error": str(e)}

@app.get("/trends/tags")
def get_tag_trends(start_date: Optional[str] = None, end_date: Optional[str] = None):
    """
    기간별 태그 스코어 트렌드를 조회합니다.
    """
    try:
        # 날짜 파라미터가 없으면 기본값 설정 (최근 30일)
        if not end_date:
            end_date_dt = datetime.now()
            end_date = end_date_dt.strftime('%Y-%m-%d')
        else:
            end_date_dt = datetime.strptime(end_date, '%Y-%m-%d')

        if not start_date:
            start_date_dt = end_date_dt - timedelta(days=29)
            start_date = start_date_dt.strftime('%Y-%m-%d')
        else:
            start_date_dt = datetime.strptime(start_date, '%Y-%m-%d')

        delta = end_date_dt - start_date_dt
        dates = [(start_date_dt + timedelta(days=i)).strftime('%Y-%m-%d') for i in range(delta.days + 1)]
        keys_to_get = [{'ID': f"STATS#{date}", 'Date': date} for date in dates]

        response = dynamodb.batch_get_item(
            RequestItems={
                table.name: {
                    'Keys': keys_to_get,
                    'ProjectionExpression': 'ID, #d, TagWeightedScoresInverseLinear, TagWeightedScoresInverseRank, TagWeightedScoresLogarithmic, TagCounts',
                    'ExpressionAttributeNames': {'#d': 'Date'}
                }
            }
        )
        items = response.get('Responses', {}).get(table.name, [])
        tag_trends = {}
        for item in items:
            date = item['Date']
            scores_linear = json.loads(json.dumps(item.get('TagWeightedScoresInverseLinear', {}), cls=DecimalEncoder))
            scores_inverse = json.loads(json.dumps(item.get('TagWeightedScoresInverseRank', {}), cls=DecimalEncoder))
            scores_log = json.loads(json.dumps(item.get('TagWeightedScoresLogarithmic', {}), cls=DecimalEncoder))
            counts = json.loads(json.dumps(item.get('TagCounts', {}), cls=DecimalEncoder))
            all_tags = set(scores_linear.keys()) | set(scores_inverse.keys()) | set(scores_log.keys()) | set(counts.keys())
            for tag in all_tags:
                if tag not in tag_trends:
                    tag_trends[tag] = []
                trend_point = {
                    'date': date,
                    'score_linear': scores_linear.get(tag),
                    'score_inverse': scores_inverse.get(tag),
                    'score_log': scores_log.get(tag),
                    'count': counts.get(tag)
                }
                tag_trends[tag].append(trend_point)

        if not tag_trends:
            return {"message": "No data found for the given date range."}
        return tag_trends
    except Exception as e:
        return {"error": str(e)}





@app.get("/authors/{author_id}")
async def get_author_novels(author_id: str):
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
            response = table.query(
                KeyConditionExpression=Key('ID').eq(novel_id),
                ScanIndexForward=False,
                Limit=1
            )
            if response.get('Items'):
                item = json.loads(json.dumps(response['Items'][0], cls=DecimalEncoder))
                latest_novels.append(item)
        except ClientError as e:
            raise HTTPException(status_code=500, detail=f"DynamoDB query failed for novel {novel_id}: {e}")
    return latest_novels