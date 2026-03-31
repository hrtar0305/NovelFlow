import boto3
import logging
import json
import os
import requests
from bs4 import BeautifulSoup
from botocore.exceptions import ClientError as BotoClientError

# --- Basic Setup ---
logger = logging.getLogger()
logger.setLevel(logging.INFO)

class Config:
    """Houses all configuration variables for the contest novel parser."""
    # AWS Configuration
    AWS_REGION = "ap-northeast-2"
    SQS_RESULT_QUEUE_URL = os.environ.get('SQS_RESULT_QUEUE_URL')

    # Request & Parsing Configuration
    USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Safari/537.36"
    MAX_INTERNAL_RETRIES = 3 # Max retries for individual novel parsing
    
    # Novelpia URLs & Settings
    NOVEL_URL_TEMPLATE = "https://novelpia.com/novel/{}"

    # CSS Selectors
    class Selectors:
        TITLE = "div.epnew-novel-title"
        AUTHOR_LINK = "a.writer-name"
        COUNTER_SPANS = "div.counter-line-a span:not(.category-title)"
        INFO_SPANS = "div.info-count2 span.gray-txt"
        TAGS = "div.mobile_hidden p.writer-tag span.tag"
        SYNOPSIS = "div.synopsis-story"
        ALERT_MODAL = "#alert_modal"

if not Config.SQS_RESULT_QUEUE_URL:
    raise ValueError("Environment variable SQS_RESULT_QUEUE_URL must be set.")

def _log(level, execution_id, message, **kwargs):
    """Creates a structured log message."""
    log_data = {"execution_id": execution_id, "message": message, **kwargs}
    logger.log(level, json.dumps(log_data, ensure_ascii=False))

def _parse_int_from_raw_text(text, suffix_to_remove=""):
    """Helper to parse an integer from cleaned text, removing suffixes, prefixes, and commas."""
    cleaned_text = text.strip().replace(suffix_to_remove, "").replace(",", "")
    return int(cleaned_text)

def _create_placeholder_item(novel_id, crawl_date, reason="N/A"):
    """Creates a placeholder dictionary for a failed novel parse."""
    return {
        "Date": crawl_date, "ID": novel_id, "Title": f"N/A ({reason})",
        "AuthorName": "N/A", "AuthorID": "0", "View": -1, "Like": -1, "Fav": -1, "Alr": -1,
        "Eps": -1, "Tags": [], "Synopsis": ""
    }

# =====================================================================================
# LAMBDA HANDLER: Parse Contest Novel Details
# =====================================================================================
def parse_contest_novel_details_batch(event, context):
    """
    Parses detailed information for a BATCH of contest novels using a single
    requests.Session to improve performance.
    """
    records = event.get('Records', [])
    if not records:
        logger.info("Received empty event, no records to process.")
        return {"status": "EMPTY_EVENT"}

    first_message = json.loads(records[0]['body'])
    execution_id = first_message.get('execution_id', 'N/A')
    crawl_date = first_message.get('date')

    batch_items = [json.loads(record['body'])['novel_id'] for record in records]

    _log(logging.INFO, execution_id, f"Starting SQS batch processing for {len(batch_items)} novels.")

    session = requests.Session()
    session.headers.update({"User-Agent": Config.USER_AGENT})
    sqs_client = boto3.client('sqs', region_name=Config.AWS_REGION)

    success_count = 0
    placeholder_count = 0

    for novel_id in batch_items:
        novel_id = str(novel_id).strip()
        item_to_send = None

        # Internal retry loop for each novel_id in case of retriable network errors
        for attempt in range(Config.MAX_INTERNAL_RETRIES):
            try:
                # 1. Fetch main novel page for static data
                novel_url = Config.NOVEL_URL_TEMPLATE.format(novel_id)
                response = session.get(novel_url, timeout=15)
                response.raise_for_status()
                soup = BeautifulSoup(response.text, 'html.parser')

                if soup.select_one(Config.Selectors.ALERT_MODAL):
                    _log(logging.WARNING, execution_id, "Novel is inaccessible. Creating placeholder.", novel_id=novel_id)
                    item_to_send = _create_placeholder_item(novel_id, crawl_date, reason="Inaccessible")
                    placeholder_count += 1
                else:
                    # 2. Parse static data
                    counter_line_a = soup.select(Config.Selectors.COUNTER_SPANS)
                    info_count2 = soup.select(Config.Selectors.INFO_SPANS)
                    tags_raw = [tag.get_text(strip=True) for tag in soup.select(Config.Selectors.TAGS)]

                    parsed_item = {
                        "Date": crawl_date, "ID": novel_id,
                        "Title": soup.select_one(Config.Selectors.TITLE).get_text(strip=True),
                        "AuthorName": soup.select_one(Config.Selectors.AUTHOR_LINK).get_text(strip=True),
                        "AuthorID": str(soup.select_one(Config.Selectors.AUTHOR_LINK)['href'].split("/")[-1]),
                        "View": _parse_int_from_raw_text(counter_line_a[0].get_text(strip=True)),
                        "Like": _parse_int_from_raw_text(counter_line_a[1].get_text(strip=True)),
                        "Fav": _parse_int_from_raw_text(info_count2[0].get_text(strip=True)),
                        "Alr": _parse_int_from_raw_text(info_count2[1].get_text(strip=True)),
                        "Eps": _parse_int_from_raw_text(info_count2[2].get_text(strip=True), "회차"),
                        "Tags": [t.lstrip("#") for t in tags_raw] if tags_raw else [],
                        "Synopsis": soup.select_one(Config.Selectors.SYNOPSIS).get_text(separator='\n', strip=True),
                    }

                    item_to_send = parsed_item
                    success_count += 1
                
                # If successful, break out of the internal retry loop
                break 

            except requests.exceptions.RequestException as e:
                if attempt < Config.MAX_INTERNAL_RETRIES - 1:
                    _log(logging.WARNING, execution_id, f"Retriable network error for {novel_id} (attempt {attempt + 1}/{Config.MAX_INTERNAL_RETRIES}): {e}. Retrying...", novel_id=novel_id)
                else:
                    # After all internal retries fail, re-raise the exception to let SQS handle the batch retry.
                    _log(logging.ERROR, execution_id, f"Retriable network error for {novel_id} failed after {Config.MAX_INTERNAL_RETRIES} attempts: {e}. The batch will be retried by SQS.", novel_id=novel_id)
                    raise e
            except Exception as e:
                # Parsing errors or other unexpected errors are not retried; create a placeholder and break the loop.
                _log(logging.ERROR, execution_id, f"A non-retriable error occurred for {novel_id}: {e}. Creating placeholder.", novel_id=novel_id, exc_info=True)
                item_to_send = _create_placeholder_item(novel_id, crawl_date, reason=f"ParsingFailed: {type(e).__name__}")
                placeholder_count += 1
                break

        if item_to_send:
            try:
                sqs_client.send_message(
                    QueueUrl=Config.SQS_RESULT_QUEUE_URL,
                    MessageBody=json.dumps(item_to_send, ensure_ascii=False)
                )
            except BotoClientError as sqs_e:
                _log(logging.ERROR, execution_id, f"Failed to send message to SQS for {novel_id}: {sqs_e}. The batch will be retried by SQS.", novel_id=novel_id, exc_info=True)
                raise sqs_e

    _log(logging.INFO, execution_id, f"Batch processing complete. Success: {success_count}, Placeholders: {placeholder_count}, Total: {len(batch_items)}.")
    return {"status": "SUCCESS", "processed_count": success_count + placeholder_count}