import json
import os
import logging
import sys

sys.path.append(os.path.join(os.path.dirname(__file__), 'package'))
from algoliasearch.search.client import SearchClientSync

logger = logging.getLogger()
logger.setLevel(logging.INFO)

# Global variable to hold the Algolia client for reuse across invocations
algolia_client = None

# 크롤러 placeholder 행(접근 불가·재시도 실패·파싱 실패)의 제목 접두사.
# crawler/consolidate_data.py 의 PLACEHOLDER_TITLE_PREFIX 와 같은 값이어야 한다.
# 이 제목으로 색인을 덮으면 그 작품은 실제 제목으로 검색되지 않는다(작가 쪽 AuthorID '0' 제외와 같은 방어).
PLACEHOLDER_TITLE_PREFIX = "N/A ("

def lambda_handler(event, context):
    global algolia_client

    # This variable will be defined inside the handler
    index_name = os.environ.get('ALGOLIA_INDEX_NAME', 'novels_and_authors')

    # Initialize client on first invocation or if it failed previously.
    if not algolia_client:
        logger.info("Algolia client is not initialized. Attempting to initialize.")
        
        app_id = os.environ.get('ALGOLIA_APP_ID')
        api_key = os.environ.get('ALGOLIA_ADMIN_API_KEY')

        if not app_id or not api_key:
            logger.error("Algolia credentials not set in environment variables (ALGOLIA_APP_ID, ALGOLIA_ADMIN_API_KEY).")
            # 예외를 올려야 스트림 이벤트 소스 매핑이 배치를 재시도한다.
            # dict 를 반환하면 성공으로 보고 체크포인트를 넘겨 그 배치가 버려진다.
            raise RuntimeError('Algolia credentials not configured')

        try:
            algolia_client = SearchClientSync(app_id, api_key)
            logger.info("Successfully initialized Algolia client.")
        except Exception as e:
            logger.error(f"Failed to initialize Algolia client: {e}")
            algolia_client = None
            raise

    # objectID → (Date, 레코드). 한 배치에 같은 작품이 여러 날짜로 오면 가장 늦은 날짜의 이름을 쓴다.
    latest = {}

    def _keep_latest(object_id, date, rec):
        if object_id not in latest or date >= latest[object_id][0]:
            latest[object_id] = (date, rec)

    for record in event['Records']:
        try:
            event_name = record.get('eventName')
            if event_name in ('INSERT', 'MODIFY'):
                new_image = record['dynamodb']['NewImage']
                # 스트림 뷰 타입이 NEW_AND_OLD_IMAGES 라 MODIFY 에는 OldImage 가 있다
                old_image = record['dynamodb'].get('OldImage', {})

                novel_id = new_image.get('ID', {}).get('S')
                date = new_image.get('Date', {}).get('S', '')
                title = new_image.get('Title', {}).get('S')
                author_id = new_image.get('AuthorID', {}).get('S')
                author_name = new_image.get('AuthorName', {}).get('S')

                # 새 날짜 스냅샷은 늘 INSERT 로 들어온다. MODIFY 는 과거 행을 고치는 작업
                # (reparse_raw.py 의 필드 추가, 같은 날짜 재적재)이고 NewImage 의 이름은 **그날 당시**
                # 이름이라, 그대로 쓰면 그 뒤에 바뀐 이름이 옛 이름으로 되돌아간다.
                # 그래서 MODIFY 는 그 행의 이름 자체가 바뀐 경우에만 반영한다.
                is_insert = event_name == 'INSERT'
                title_changed = is_insert or old_image.get('Title', {}).get('S') != title
                author_changed = is_insert or old_image.get('AuthorName', {}).get('S') != author_name

                if (novel_id and title and title_changed
                        and not title.startswith(PLACEHOLDER_TITLE_PREFIX)):
                    _keep_latest(f'novel_{novel_id}', date, {
                        'objectID': f'novel_{novel_id}',
                        'type': 'novel',
                        'name': title,
                        'id': novel_id
                    })

                if author_id and author_id != '0' and author_name and author_changed:
                    _keep_latest(f'author_{author_id}', date, {
                        'objectID': f'author_{author_id}',
                        'type': 'author',
                        'name': author_name,
                        'id': author_id
                    })
        except KeyError as e:
            logger.error(f"Malformed DynamoDB record: missing key {e}. Record: {record}")
        except Exception as e:
            logger.error(f"An unexpected error occurred while processing a record: {e}. Record: {record}")

    records_to_update = [rec for _, rec in latest.values()]

    # Batch update operation
    if not records_to_update:
        logger.info("No records to update.")
        return {'statusCode': 200, 'body': json.dumps('No records to update.')}

    try:
        algolia_client.save_objects(index_name, records_to_update)
        logger.info(f"Successfully requested update of {len(records_to_update)} records in Algolia.")

    except Exception as e:
        logger.error(f"Error during Algolia batch operation: {e}")
        # 일시 장애면 매핑의 재시도로 복구된다. 레코드 단위 오류(위 KeyError 등)는 배치를 영구히
        # 막지 않도록 지금처럼 로그만 남기고 건너뛴다.
        raise

    return {'statusCode': 200, 'body': json.dumps('Successfully processed DynamoDB stream records.')}