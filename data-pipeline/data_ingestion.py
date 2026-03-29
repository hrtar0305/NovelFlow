import boto3
import csv
import io
import os
import json
import logging
import math
from decimal import Decimal
from ast import literal_eval

# Configure logging
logger = logging.getLogger()
logger.setLevel(logging.INFO)

# Initialize Boto3 clients
s3_client = boto3.client('s3')
dynamodb = boto3.resource('dynamodb')

# Get table name from environment variable
TABLE_NAME = os.environ.get('DYNAMODB_TABLE_NAME', 'NovelRanks')
table = dynamodb.Table(TABLE_NAME)

def lambda_handler(event, context):
    """
    Main handler function triggered by S3 CSV file uploads to store data in DynamoDB.
    """
    logger.info(f"Received event: {json.dumps(event)}")

    # Extract bucket name and file key (path) from S3 event
    bucket_name = event['Records'][0]['s3']['bucket']['name']
    file_key = event['Records'][0]['s3']['object']['key']

    if not file_key.endswith('.csv'):
        logger.info(f"Non-CSV file ({file_key}) triggered the event. Skipping.")
        return {'statusCode': 200, 'body': 'Not a CSV file.'}

    try:
        # Read CSV file from S3
        response = s3_client.get_object(Bucket=bucket_name, Key=file_key)
        content = response['Body'].read().decode('utf-8')
        csv_reader = csv.DictReader(io.StringIO(content))
        
        items = list(csv_reader)
        if not items:
            logger.warning("CSV file is empty.")
            return {'statusCode': 400, 'body': 'CSV file is empty.'}

        processed_items = []
        with table.batch_writer() as batch:
            for item_dict in items:
                processed_item = process_csv_row(item_dict)
                final_item = {k: v for k, v in processed_item.items() if v != ""}
                batch.put_item(Item=final_item)
                processed_items.append(processed_item)
        
        logger.info(f"Successfully processed and stored {len(items)} items from {file_key}.")

        # Analyze and store tag trends using the successfully processed items
        calculate_and_store_tag_trends(processed_items)

        # Extract date from file_key (e.g., '2025-08-19.csv' -> '2025-08-19')
        date_from_file = file_key.split('/')[-1].replace('.csv', '')

        # Update AVAILABLE_DATES item in DynamoDB
        update_available_dates(date_from_file)

        return {
            'statusCode': 200,
            'body': json.dumps(f'Successfully processed {file_key} and stored {len(items)} items.')
        }

    except Exception as e:
        logger.error(f"Error processing file {file_key} from bucket {bucket_name}: {e}")
        raise e

def process_csv_row(item):
    """
    Transforms a CSV row into a Python dictionary with correct data types.
    Raises an exception if any conversion fails.
    """
    # Convert numeric fields
    for key in ['Ranking', 'Score', 'View', 'Like', 'Fav', 'Alr', 'Eps']:
        if item.get(key):
            try:
                item[key] = int(item[key])
            except (ValueError, TypeError) as e:
                logger.error(f"Could not convert {key} to int for value {item[key]}.")
                raise e
    
    # Keep ID and AuthorID as strings
    item['ID'] = str(item['ID'])
    if item.get('AuthorID'):
        item['AuthorID'] = str(item['AuthorID'])

    # Parse Tags field (string list -> actual list)
    if item.get('Tags'):
        try:
            tags_list = literal_eval(item['Tags'])
            
            if not isinstance(tags_list, list):
                raise ValueError(f"Tags field is not a list: {item['Tags']}")
            
            seen_tags = set()
            ordered_unique_tags = []
            for tag in tags_list:
                stripped_tag = tag.strip()
                if stripped_tag and stripped_tag not in seen_tags:
                    ordered_unique_tags.append(stripped_tag)
                    seen_tags.add(stripped_tag)
            item['Tags'] = ordered_unique_tags
            
        except (ValueError, SyntaxError) as e:
            logger.error(f"Could not process Tags field: {item.get('Tags')}. Error: {e}")
            raise e
    
    return item

def calculate_and_store_tag_trends(items):
    """
    Calculates tag trends based on all items and stores them in DynamoDB.
    """
    if not items:
        return

    tag_counts = {}
    tag_weighted_scores_inverse_rank = {}
    tag_weighted_scores_inverse_linear = {}
    tag_weighted_scores_logarithmic = {}

    total_ranks = len(items) # Use total number of items as dynamic MAX_RANK
    
    for item in items:
        rank = item.get('Ranking')
        if not isinstance(rank, int) or rank <= 0:
            continue

        # 1. Inverse Rank Weighting: 1/rank
        weight_inverse_rank = 1 / rank 

        # 2. Inverse Linear Weighting: (total_ranks - rank + 1)
        weight_inverse_linear = total_ranks - rank + 1

        # 3. Logarithmic Weighting: 1 / ln(rank + 1)
        weight_logarithmic = 1 / math.log(rank + 1)

        tags = item.get('Tags', [])
        if isinstance(tags, list):
            for tag in tags:
                # Simple count
                tag_counts[tag] = tag_counts.get(tag, 0) + 1
                
                # Sum weights (for each method)
                tag_weighted_scores_inverse_rank[tag] = tag_weighted_scores_inverse_rank.get(tag, 0) + weight_inverse_rank
                tag_weighted_scores_inverse_linear[tag] = tag_weighted_scores_inverse_linear.get(tag, 0) + weight_inverse_linear
                tag_weighted_scores_logarithmic[tag] = tag_weighted_scores_logarithmic.get(tag, 0) + weight_logarithmic

    # Get date from the first item
    date = items[0]['Date']

    # Create stats data item to store
    stats_item = {
        'ID': f'STATS#{date}',
        'Date': date,
        'DataType': 'TAG_TRENDS',
        'TagCounts': tag_counts,
        'TagWeightedScoresInverseRank': {k: Decimal(str(v)) for k, v in tag_weighted_scores_inverse_rank.items()}, # Convert to Decimal
        'TagWeightedScoresInverseLinear': {k: Decimal(str(v)) for k, v in tag_weighted_scores_inverse_linear.items()}, # Convert to Decimal
        'TagWeightedScoresLogarithmic': {k: Decimal(str(v)) for k, v in tag_weighted_scores_logarithmic.items()} # Convert to Decimal
    }

    try:
        table.put_item(Item=stats_item)
        logger.info(f"Successfully calculated and stored tag trends for {date}.")
    except Exception as e:
        logger.error(f"Failed to store tag trends for {date}. Error: {e}")

def update_available_dates(date_from_file):
    """
    Updates the AVAILABLE_DATES item in DynamoDB with the new date.
    """
    try:
        # Get the current list of dates to avoid duplicates
        response = table.get_item(
            Key={'ID': 'AVAILABLE_DATES', 'Date': 'ALL_DATES'},
            ProjectionExpression="dates"
        )
        
        # Safely get the list of dates, default to an empty list if not found
        current_dates_set = set(response.get('Item', {}).get('dates', []))

        # Add the new date. A set automatically handles duplicates.
        current_dates_set.add(date_from_file)

        # Convert back to a list and sort it for consistent ordering
        sorted_dates = sorted(list(current_dates_set), reverse=True)

        # Update the entire item with the new list of dates
        table.put_item(
            Item={
                'ID': 'AVAILABLE_DATES',
                'Date': 'ALL_DATES',
                'dates': sorted_dates
            }
        )
        logger.info(f"Successfully updated AVAILABLE_DATES with {date_from_file}.")

    except Exception as e:
        logger.error(f"Failed to update AVAILABLE_DATES with {date_from_file}. Error: {e}")
