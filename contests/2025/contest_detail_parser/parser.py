import boto3
import logging
import json
import re
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

    # Novelpia URLs & Settings
    NOVEL_URL_TEMPLATE = "https://novelpia.com/novel/{}"
    EPISODE_LIST_URL = "https://novelpia.com/proc/episode_list"

    # CSS Selectors
    class Selectors:
        TITLE = "div.epnew-novel-title"
        AUTHOR_LINK = "a.writer-name"
        COUNTER_SPANS = "div.counter-line-a span:not(.category-title)"
        INFO_SPANS = "div.info-count2 span.gray-txt"
        TAGS = "div.mobile_hidden p.writer-tag span.tag"
        SYNOPSIS = "div.synopsis-story"
        ALERT_MODAL = "#alert_modal"

        # For episode list
        EPISODE_UPLOAD_DATE = "div.ep_style2 b"
        EPISODE_NUMBER = "div.ep_style2 span:first-child"

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
        "Eps": -1, "Tags": [], "Synopsis": "", "FirstEpView": -1, "FirstEpNum": -1,
        "TargetLatestEpView": -1, "TargetLatestEpNum": -1
    }

def _get_episode_list_html(session, novel_id, sort_order):
    """Fetches the episode list HTML for a given sort order."""
    payload = {"novel_no": novel_id, "sort": sort_order, "page": 0}
    headers = {"Referer": Config.NOVEL_URL_TEMPLATE.format(novel_id), "X-Requested-With": "XMLHttpRequest"}
    response = session.post(Config.EPISODE_LIST_URL, data=payload, headers=headers, timeout=10)
    response.raise_for_status()
    return response.text

def _get_episode_view_counts(session, novel_id, episode_ids):
    """Fetches view counts for a list of episode IDs using the /proc/novel API."""
    if not episode_ids:
        return {}

    # The payload requires the full class name of the view count span
    episode_arr_values = [f"episode_count_view novel_count_view_{eid}" for eid in episode_ids]

    payload = [
        ("novel_no", novel_id),
        ("cmd", "get_episode_count_view")
    ]
    for val in episode_arr_values:
        payload.append(("episode_arr[]", val))

    headers = {"Referer": Config.NOVEL_URL_TEMPLATE.format(novel_id), "X-Requested-With": "XMLHttpRequest"}
    response = session.post("https://novelpia.com/proc/novel", data=payload, headers=headers, timeout=10)
    response.raise_for_status()

    # API가 비어있는 응답을 보낼 경우를 대비하여 JSON 파싱 전 확인
    if not response.text.strip():
        return {}
    try:
        data = response.json()
        # Create a mapping from episode_no (int) to count_view (int)
        return {item['episode_no']: _parse_int_from_raw_text(item['count_view']) for item in data.get('list', [])}
    except json.JSONDecodeError as e:
        _log(logging.WARNING, "get_episode_view_counts", f"Failed to parse JSON from /proc/novel API: {e}", novel_id=novel_id, response_text=response.text)
        return {}

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
                    "FirstEpView": -1, "FirstEpNum": -1, "TargetLatestEpView": -1, "TargetLatestEpNum": -1
                }

                # 3. Fetch and parse episode data for retention rate
                if parsed_item["Eps"] > 0:
                    # 3.1 Get first episode data
                    html_first_ep = _get_episode_list_html(session, novel_id, 'DOWN')
                    soup_first = BeautifulSoup(html_first_ep, 'html.parser')
                    first_ep_row = soup_first.select_one("tr.ep_style5")

                    first_ep_id = first_ep_row.get('data-episode-no') if first_ep_row else None
                    if first_ep_id:
                        first_ep_upload_date_str = first_ep_row.select_one(Config.Selectors.EPISODE_UPLOAD_DATE).get_text(strip=True)
                        is_too_new = not re.match(r"^\d{2}\.\d{2}\.\d{2}$", first_ep_upload_date_str)

                        if is_too_new:
                            _log(logging.WARNING, execution_id, "Novel is too new. Skipping retention data collection.", novel_id=novel_id)
                        else:
                            # 3.2 Get latest episode list
                            html_latest_ep = _get_episode_list_html(session, novel_id, 'UP')
                            soup_latest = BeautifulSoup(html_latest_ep, 'html.parser')
                            
                            # Find the first valid latest episode (not scheduled)
                            target_latest_ep_row = None
                            for row in soup_latest.select("tr.ep_style5"):
                                if "공개예정" not in row.get_text() and row.get('data-episode-no'):
                                    target_latest_ep_row = row
                                    break

                            if target_latest_ep_row:
                                latest_ep_id = target_latest_ep_row['data-episode-no']

                                # 3.3 Fetch view counts only if first and latest episodes are different
                                if first_ep_id != latest_ep_id:
                                    _log(logging.INFO, execution_id, f"Fetching view counts for episodes: First={first_ep_id}, Latest={latest_ep_id}", novel_id=novel_id)
                                    view_counts = _get_episode_view_counts(session, novel_id, [first_ep_id, latest_ep_id])

                                    first_ep_id_int = int(first_ep_id)
                                    latest_ep_id_int = int(latest_ep_id)

                                    if first_ep_id_int in view_counts and latest_ep_id_int in view_counts:
                                        parsed_item["FirstEpView"] = view_counts[first_ep_id_int]
                                        parsed_item["FirstEpNum"] = _parse_int_from_raw_text(first_ep_row.select_one(Config.Selectors.EPISODE_NUMBER).get_text(strip=True), "EP.")
                                        
                                        parsed_item["TargetLatestEpView"] = view_counts[latest_ep_id_int]
                                        parsed_item["TargetLatestEpNum"] = _parse_int_from_raw_text(target_latest_ep_row.select_one(Config.Selectors.EPISODE_NUMBER).get_text(strip=True), "EP.")
                                        
                                        _log(logging.INFO, execution_id, f"First episode: {parsed_item['FirstEpNum']}, Views: {parsed_item['FirstEpView']}", novel_id=novel_id)
                                        _log(logging.INFO, execution_id, f"Target latest episode: {parsed_item['TargetLatestEpNum']}, Views: {parsed_item['TargetLatestEpView']}", novel_id=novel_id)
                                    else:
                                        _log(logging.WARNING, execution_id, "Could not retrieve view counts for both episodes from API.", novel_id=novel_id, retrieved_counts=view_counts)
                                else:
                                    _log(logging.INFO, execution_id, "Novel has only one valid episode. Skipping retention calculation.", novel_id=novel_id)
                            else:
                                _log(logging.WARNING, execution_id, "No valid published latest episode found.", novel_id=novel_id)
                    else:
                        _log(logging.WARNING, execution_id, "Could not find the first episode row.", novel_id=novel_id)
                else:
                    _log(logging.WARNING, execution_id, "Novel has 0 episodes. Skipping retention data collection.", novel_id=novel_id)

                item_to_send = parsed_item
                success_count += 1

        except requests.exceptions.RequestException as e:
            # Network errors are retried by SQS by re-raising the exception
            _log(logging.ERROR, execution_id, f"A retriable network error occurred for {novel_id}: {e}. The batch will be retried by SQS.", novel_id=novel_id)
            raise e
        except Exception as e:
            # Parsing errors are not retried; a placeholder is created
            _log(logging.ERROR, execution_id, f"A non-retriable error occurred for {novel_id}: {e}. Creating placeholder.", novel_id=novel_id, exc_info=True)
            item_to_send = _create_placeholder_item(novel_id, crawl_date, reason=f"ParsingFailed: {type(e).__name__}")
            placeholder_count += 1

        if item_to_send:
            try:
                sqs_client.send_message(
                    QueueUrl=Config.SQS_RESULT_QUEUE_URL,
                    MessageBody=json.dumps(item_to_send, ensure_ascii=False)
                )
            except BotoClientError as sqs_e:
                _log(logging.ERROR, execution_id, f"Failed to send message to SQS for {novel_id}: {sqs_e}. The batch will be retried by SQS.", novel_id=novel_id)
                raise sqs_e

    _log(logging.INFO, execution_id, f"Batch processing complete. Success: {success_count}, Placeholders: {placeholder_count}, Total: {len(batch_items)}.")
    return {"status": "SUCCESS", "processed_count": success_count + placeholder_count}