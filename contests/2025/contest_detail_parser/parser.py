import boto3
import logging
import json
import re
import os
import time
from playwright.sync_api import sync_playwright, TimeoutError as PlaywrightTimeoutError
from botocore.exceptions import ClientError

# --- Basic Setup ---
logger = logging.getLogger()
logger.setLevel(logging.INFO)

class Config:
    """Houses all configuration variables for the contest novel parser."""
    # AWS Configuration
    AWS_REGION = "ap-northeast-2"
    SQS_RESULT_QUEUE_URL = os.environ.get('SQS_RESULT_QUEUE_URL')
    MAX_INTERNAL_RETRIES = 3

    # Playwright & Browser Configuration
    BROWSER_ARGS = ['--disable-gpu', '--no-sandbox', '--single-process', '--disable-dev-shm-usage']
    USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Safari/537.36"
    VIEWPORT_SIZE = {"width": 1920, "height": 1080}
    DEFAULT_NAVIGATION_TIMEOUT = 10000
    DEFAULT_ACTION_TIMEOUT = 5000

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
        
        # For dynamic data
        SORT_BUTTON = "div.mobile_hidden div.toggle_sort"
        EPISODE_ROWS = "#episode_list tr.ep_style5"
        EPISODE_UPLOAD_DATE = "div.ep_style2 b"
        EPISODE_NUMBER = "div.ep_style2 span:first-child"
        EPISODE_VIEW_COUNT = "span.episode_count_view"

if not Config.SQS_RESULT_QUEUE_URL:
    raise ValueError("Environment variable SQS_RESULT_QUEUE_URL must be set.")

def _log(level, execution_id, message, **kwargs):
    """Creates a structured log message."""
    log_data = {"execution_id": execution_id, "message": message, **kwargs}
    logger.log(level, json.dumps(log_data, ensure_ascii=False))

def _block_unnecessary_resources(route):
    """Blocks unnecessary resources like images, fonts, and trackers to speed up page loads."""
    blocked_domains = [
        "rubiconproject.com", "google-analytics.com", "googletagmanager.com",
        "googleadservices.com", "doubleclick.net", "facebook.net", "facebook.com",
        "moloco.com", "creativecdn.com", "pangle-ads.com", "tiktok.com",
    ]
    request = route.request
    if (request.resource_type in ["image", "font", "media"] or
            any(domain in request.url for domain in blocked_domains)):
        route.abort()
    else:
        route.continue_()

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

# =====================================================================================
# LAMBDA HANDLER: Parse Contest Novel Details
# =====================================================================================
def parse_contest_novel_details_batch(event, context):
    """
    Parses detailed information for a BATCH of contest novels using a single
    Playwright instance to improve performance.
    """
    # SQS event is a list of records.
    records = event.get('Records', [])
    if not records:
        logger.info("Received empty event, no records to process.")
        return {"status": "EMPTY_EVENT"}

    # Extract novel IDs and context from the first message.
    # All messages in a batch share the same execution_id and date.
    first_message = json.loads(records[0]['body'])
    execution_id = first_message.get('execution_id', 'N/A')
    crawl_date = first_message.get('date')

    # Create a list of novel IDs from the batch of SQS messages.
    batch_items = [json.loads(record['body'])['novel_id'] for record in records]

    _log(logging.INFO, execution_id, f"Starting SQS batch processing for {len(batch_items)} novels.")

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, args=Config.BROWSER_ARGS)
        pw_context = browser.new_context(user_agent=Config.USER_AGENT, viewport=Config.VIEWPORT_SIZE)
        pw_context.set_default_navigation_timeout(Config.DEFAULT_NAVIGATION_TIMEOUT)
        pw_context.set_default_timeout(Config.DEFAULT_ACTION_TIMEOUT)

        try:
            success_count = 0
            placeholder_count = 0
            for novel_id in batch_items:
                novel_id = str(novel_id).strip()
                page = None
                parsed_item = None
                is_permanent_error = False

                for attempt in range(Config.MAX_INTERNAL_RETRIES):
                    try:
                        page = pw_context.new_page()
                        page.route("**/*", _block_unnecessary_resources)
                        
                        novel_url = Config.NOVEL_URL_TEMPLATE.format(novel_id)
                        page.goto(novel_url, wait_until="domcontentloaded")

                        if page.locator(Config.Selectors.ALERT_MODAL).count() > 0:
                            _log(logging.WARNING, execution_id, "Novel is inaccessible (alert modal found).", novel_id=novel_id)
                            is_permanent_error = True
                            break # Exit retry loop for permanent errors

                        # ... (The entire parsing logic from #1 to #4)
                        counter_line_a = page.locator(Config.Selectors.COUNTER_SPANS).all_inner_texts()
                        info_count2 = page.locator(Config.Selectors.INFO_SPANS).all_inner_texts()
                        tags_raw = page.locator(Config.Selectors.TAGS).all_inner_texts()
                        parsed_item = {
                            "Date": crawl_date, "ID": novel_id, "Title": page.locator(Config.Selectors.TITLE).inner_text(),
                            "AuthorName": page.locator(Config.Selectors.AUTHOR_LINK).inner_text(),
                            "AuthorID": str(page.locator(Config.Selectors.AUTHOR_LINK).get_attribute('href').split("/")[-1]),
                            "View": _parse_int_from_raw_text(counter_line_a[0]), "Like": _parse_int_from_raw_text(counter_line_a[1]),
                            "Fav": _parse_int_from_raw_text(info_count2[0]), "Alr": _parse_int_from_raw_text(info_count2[1]),
                            "Eps": _parse_int_from_raw_text(info_count2[2], "회차"),
                            "Tags": [t.lstrip("#") for t in tags_raw] if tags_raw else [],
                            "Synopsis": ' '.join(page.locator(Config.Selectors.SYNOPSIS).all_inner_texts())
                        }
                        if parsed_item["Eps"] == 0:
                            _log(logging.WARNING, execution_id, "Novel has 0 episodes. Skipping retention data collection.", novel_id=novel_id)
                            parsed_item.update({"FirstEpView": -1, "FirstEpNum": -1, "TargetLatestEpView": -1, "TargetLatestEpNum": -1})
                        else:
                            sort_button = page.locator(Config.Selectors.SORT_BUTTON)
                            if "최신화부터" in sort_button.inner_text():
                                _log(logging.INFO, execution_id, "Sorting to '첫화부터'.", novel_id=novel_id)
                                api_responses = []
                                def response_handler(response):
                                    if response.ok and ("/proc/episode_list" in response.url or "/proc/novel" in response.url):
                                        api_responses.append(response.url)
                                page.on("response", response_handler)
                                try:
                                    sort_button.click()
                                    start_time = time.time()
                                    while len(api_responses) < 2:
                                        if time.time() - start_time > (Config.DEFAULT_ACTION_TIMEOUT / 1000):
                                            raise PlaywrightTimeoutError(f"Timeout waiting for sort APIs. Captured {len(api_responses)}/2.")
                                        page.wait_for_timeout(100)
                                finally:
                                    page.remove_listener("response", response_handler)
                            first_ep_row_selector = f"{Config.Selectors.EPISODE_ROWS}:has-text('EP.')"
                            page.wait_for_selector(first_ep_row_selector)
                            first_ep_row = page.locator(first_ep_row_selector).first

                            first_ep_upload_date_str = first_ep_row.locator(Config.Selectors.EPISODE_UPLOAD_DATE).last.inner_text().strip()
                            is_too_new = not re.match(r"^\d{2}\.\d{2}\.\d{2}$", first_ep_upload_date_str)
                            if is_too_new:
                                _log(logging.WARNING, execution_id, "Novel is too new. Skipping retention data collection.", novel_id=novel_id)
                                parsed_item.update({"FirstEpView": -1, "FirstEpNum": -1, "TargetLatestEpView": -1, "TargetLatestEpNum": -1})
                            else:
                                parsed_item["FirstEpView"] = _parse_int_from_raw_text(first_ep_row.locator(Config.Selectors.EPISODE_VIEW_COUNT).inner_text())
                                parsed_item["FirstEpNum"] = _parse_int_from_raw_text(first_ep_row.locator(Config.Selectors.EPISODE_NUMBER).inner_text(), "EP.")
                                _log(logging.INFO, execution_id, f"First episode: {parsed_item['FirstEpNum']}, Views: {parsed_item['FirstEpView']}", novel_id=novel_id)
                                _log(logging.INFO, execution_id, "Sorting to '최신화부터'.", novel_id=novel_id)
                                api_responses_latest = []
                                def response_handler_latest(response):
                                    if response.ok and ("/proc/episode_list" in response.url or "/proc/novel" in response.url):
                                        api_responses_latest.append(response.url)
                                page.on("response", response_handler_latest)
                                try:
                                    sort_button.click()
                                    start_time = time.time()
                                    while len(api_responses_latest) < 2:
                                        if time.time() - start_time > (Config.DEFAULT_ACTION_TIMEOUT / 1000):
                                            raise PlaywrightTimeoutError(f"Timeout waiting for sort APIs (latest). Captured {len(api_responses_latest)}/2.")
                                        page.wait_for_timeout(100)
                                finally:
                                    page.remove_listener("response", response_handler_latest)
                                xpath_selector = f"//tr[contains(@class, 'ep_style5') and .//div[contains(@class, 'ep_style2')]/descendant::b[contains(., '.') and string-length(normalize-space(.)) = 8]]"
                                target_latest_ep_row = page.locator(xpath_selector).first
                                if not target_latest_ep_row.count():
                                    _log(logging.WARNING, execution_id, "No episode with YY.MM.DD date format. Using fallback.", novel_id=novel_id)
                                    valid_rows = page.locator(f"{Config.Selectors.EPISODE_ROWS}:has-text('EP.')")
                                    target_latest_ep_row = valid_rows.last if valid_rows.count() > 0 else None
                                if target_latest_ep_row:
                                    parsed_item["TargetLatestEpView"] = _parse_int_from_raw_text(target_latest_ep_row.locator(Config.Selectors.EPISODE_VIEW_COUNT).inner_text())
                                    parsed_item["TargetLatestEpNum"] = _parse_int_from_raw_text(target_latest_ep_row.locator(Config.Selectors.EPISODE_NUMBER).inner_text(), "EP.")
                                else:
                                    _log(logging.ERROR, execution_id, "No valid published episodes found.", novel_id=novel_id)
                                    parsed_item.update({"TargetLatestEpView": -1, "TargetLatestEpNum": -1})
                                try:
                                    first_ep_num_int = int(parsed_item.get("FirstEpNum", -1))
                                    latest_ep_num_int = int(parsed_item.get("TargetLatestEpNum", -1))
                                    if latest_ep_num_int <= first_ep_num_int:
                                        _log(logging.WARNING, execution_id, "Target latest episode is not newer than the first.", novel_id=novel_id)
                                        parsed_item.update({"TargetLatestEpView": -1, "TargetLatestEpNum": -1})
                                    else:
                                        _log(logging.INFO, execution_id, f"Target latest episode: {parsed_item['TargetLatestEpNum']}, Views: {parsed_item['TargetLatestEpView']}", novel_id=novel_id)
                                except (ValueError, TypeError):
                                    _log(logging.ERROR, execution_id, "Could not parse episode numbers.", novel_id=novel_id)
                                    parsed_item.update({"TargetLatestEpView": -1, "TargetLatestEpNum": -1})
                        
                        # If parsing is successful, break the retry loop
                        break
                    except (PlaywrightTimeoutError, ClientError) as e:
                        if attempt >= Config.MAX_INTERNAL_RETRIES - 1:
                            _log(logging.ERROR, execution_id, f"All {Config.MAX_INTERNAL_RETRIES} retry attempts failed for {novel_id}. Failing this batch.", novel_id=novel_id)
                            raise # Re-raise the final exception to fail the Lambda
                        _log(logging.WARNING, execution_id, f"Attempt {attempt + 1}/{Config.MAX_INTERNAL_RETRIES} failed for {novel_id}: {e}. Retrying immediately...")
                    finally:
                        if page:
                            page.close()
                
                # After the loop (successful or permanent error)
                item_to_send = None
                if is_permanent_error:
                    item_to_send = _create_placeholder_item(novel_id, crawl_date, reason="Inaccessible")
                    placeholder_count += 1
                elif parsed_item:
                    item_to_send = parsed_item
                    success_count += 1
                
                if item_to_send:
                    sqs_client = boto3.client('sqs', region_name=Config.AWS_REGION)
                    sqs_client.send_message(
                        QueueUrl=Config.SQS_RESULT_QUEUE_URL,
                        MessageBody=json.dumps(item_to_send, ensure_ascii=False)
                    )
                    _log(logging.INFO, execution_id, f"Sent item for {novel_id} to SQS.", novel_id=novel_id, status="SUCCESS" if not is_permanent_error else "PLACEHOLDER")
                                
            _log(logging.INFO, execution_id, f"Batch processing complete. Success: {success_count}, Placeholders: {placeholder_count}, Total: {len(batch_items)}.")
            return {"status": "SUCCESS", "processed_count": success_count + placeholder_count}
        finally:
            if pw_context:
                pw_context.close()
            if browser:
                browser.close()