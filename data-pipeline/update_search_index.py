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
            return {'statusCode': 500, 'body': json.dumps('Algolia credentials not configured')}

        try:
            algolia_client = SearchClientSync(app_id, api_key)
            logger.info("Successfully initialized Algolia client.")
        except Exception as e:
            logger.error(f"Failed to initialize Algolia client: {e}")
            algolia_client = None
            return {'statusCode': 500, 'body': json.dumps(f'Failed to initialize Algolia client: {e}')}

    records_to_update = []

    for record in event['Records']:
        try:
            event_name = record.get('eventName')
            if event_name in ('INSERT', 'MODIFY'):
                new_image = record['dynamodb']['NewImage']

                novel_id = new_image.get('ID', {}).get('S')
                title = new_image.get('Title', {}).get('S')
                author_id = new_image.get('AuthorID', {}).get('S')
                author_name = new_image.get('AuthorName', {}).get('S')

                if novel_id and title:
                    records_to_update.append({
                        'objectID': f'novel_{novel_id}',
                        'type': 'novel',
                        'name': title,
                        'id': novel_id
                    })
                
                if author_id and author_id != '0' and author_name:
                    records_to_update.append({
                        'objectID': f'author_{author_id}',
                        'type': 'author',
                        'name': author_name,
                        'id': author_id
                    })
        except KeyError as e:
            logger.error(f"Malformed DynamoDB record: missing key {e}. Record: {record}")
        except Exception as e:
            logger.error(f"An unexpected error occurred while processing a record: {e}. Record: {record}")

    # Batch update operation
    if not records_to_update:
        logger.info("No records to update.")
        return {'statusCode': 200, 'body': json.dumps('No records to update.')}

    try:
        algolia_client.save_objects(index_name, records_to_update)
        logger.info(f"Successfully requested update of {len(records_to_update)} records in Algolia.")

    except Exception as e:
        logger.error(f"Error during Algolia batch operation: {e}")
        return {'statusCode': 500, 'body': json.dumps(f'Error during Algolia batch operation: {e}')}

    return {'statusCode': 200, 'body': json.dumps('Successfully processed DynamoDB stream records.')}