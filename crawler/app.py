import boto3
import logging
import json
import os
import requests
import time
from datetime import datetime
from pytz import timezone
from playwright.sync_api import sync_playwright, TimeoutError as PlaywrightTimeoutError
from bs4 import BeautifulSoup

# --- Basic Setup ---
logger = logging.getLogger()
logger.setLevel(logging.INFO)

# --- Centralized Configuration ---
class Config:
    """Houses all configuration variables for the crawler."""
    # AWS & SQS
    SQS_QUEUE_URL = os.environ.get('SQS_QUEUE_URL')
    CREDENTIAL_PARAM_NAMES = ["/NP-Trend/NOVELPIA_ID", "/NP-Trend/NOVELPIA_PASS"]
    AWS_REGION = "ap-northeast-2"

    # Playwright & Browser
    BROWSER_ARGS = ['--disable-gpu', '--no-sandbox', '--single-process', '--disable-dev-shm-usage']
    USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Safari/537.36"
    VIEWPORT_SIZE = {"width": 1920, "height": 1080}
    DEFAULT_NAVIGATION_TIMEOUT = 30000  # 30 seconds
    DEFAULT_ACTION_TIMEOUT = 30000      # 30 seconds

    # Novelpia URLs & Settings
    BASE_URL = "https://novelpia.com/top100"
    RANKING_URL_TEMPLATE = "https://novelpia.com/top100/all/weekly/view/all/all/#more{}"
    NOVEL_URL_TEMPLATE = "https://novelpia.com/novel/{}"
    RANKING_LOAD_TIMEOUT = 30000  # 30 seconds
    MAX_INTERNAL_RETRIES = 10
    SEOUL_TIMEZONE = timezone('Asia/Seoul')

    # CSS Selectors
    class Selectors:
        BANNER_CLOSE = "div.detail-modal-background.show .layer-close-x3"
        TOGGLE_MENU = "#toggle-menu"
        ADULT_SWITCH = "#pc-sidemenu img.switch-adult"
        LOGIN_EMAIL = "#login_box input[name='email']"
        LOGIN_PASSWORD = "#login_box input[name='wd']"
        LOGIN_SUBMIT = "#login_box button[type='submit']"
        RANKING_CONTAINER = "#top100_page"
        NOVEL_BOX = ".novelbox"
        ALERT_MODAL = "#alert_modal"
        TITLE = "div.epnew-novel-title"
        AUTHOR_LINK = "a.writer-name"
        COUNTER_SPANS = "div.counter-line-a span:not(.category-title)"
        INFO_SPANS = "div.info-count2 span.gray-txt"
        TAGS = "div.mobile_hidden p.writer-tag span.tag"
        SYNOPSIS = "div.synopsis-story"

if not Config.SQS_QUEUE_URL:
    raise ValueError("Environment variable SQS_QUEUE_URL must be set.")

# --- Logging Helper ---
def _log(level, execution_id, message, **kwargs):
    """Creates a structured log message."""
    log_data = {"execution_id": execution_id, "message": message, **kwargs}
    logger.log(level, json.dumps(log_data, ensure_ascii=False))

# --- AWS Parameter Store Helper ---
def get_credentials(execution_id):
    """Retrieves credentials from AWS Parameter Store."""
    _log(logging.INFO, execution_id, "Retrieving credentials...")
    session = boto3.session.Session()
    client = session.client(service_name='ssm', region_name=Config.AWS_REGION)
    try:
        response = client.get_parameters(Names=Config.CREDENTIAL_PARAM_NAMES, WithDecryption=True)
        params = {p['Name']: p['Value'] for p in response['Parameters']}
        username = params.get(Config.CREDENTIAL_PARAM_NAMES[0])
        password = params.get(Config.CREDENTIAL_PARAM_NAMES[1])
        if not username or not password:
            raise ValueError("Credentials not found in Parameter Store.")
        return username, password
    except Exception as e:
        _log(logging.ERROR, execution_id, f"Failed to get credentials: {e}")
        raise

# --- Playwright Helpers for get_ranking_list ---
def _perform_login(page, username, password, execution_id):
    """Handles the login process on Novelpia."""
    _log(logging.INFO, execution_id, "Performing login...")
    page.goto(Config.BASE_URL, wait_until="commit")
    page.locator(Config.Selectors.TOGGLE_MENU).click()
    page.locator(Config.Selectors.ADULT_SWITCH).click()
    page.locator(Config.Selectors.LOGIN_EMAIL).fill(username)
    page.locator(Config.Selectors.LOGIN_PASSWORD).fill(password)
    page.on("dialog", lambda dialog: dialog.accept())
    page.locator(Config.Selectors.LOGIN_SUBMIT).click()
    _log(logging.INFO, execution_id, "Login successful.")

def _ensure_adult_mode(page, execution_id):
    """Checks and enables adult mode if it's off."""
    alt_text = page.locator(Config.Selectors.ADULT_SWITCH).get_attribute('alt')
    if alt_text == '일반':
        page.locator(Config.Selectors.TOGGLE_MENU).click()
        switch_locator = page.locator(Config.Selectors.ADULT_SWITCH)
        switch_locator.wait_for(state='visible')
        switch_locator.click()
        page.wait_for_load_state("domcontentloaded")
        _log(logging.INFO, execution_id, "Adult mode enabled.")
    else:
        _log(logging.INFO, execution_id, "Adult mode is already ON.")

def _parse_score(score_text):
    """Converts score text to an integer."""
    if "M" in score_text:
        return int(float(score_text.replace("M", "")) * 1000000)
    if "K" in score_text:
        return int(float(score_text.replace("K", "")) * 1000)
    return int(score_text.replace(",", ""))

def _fetch_and_parse_ranking_page(page, ranking_url, target_novel_count, today, execution_id):
    """Navigates to the ranking page and parses the novel list."""
    expected_api_calls = (target_novel_count - 1) // 100
    _log(logging.INFO, execution_id, f"Expecting {expected_api_calls} 'rank_more' API calls.")
    
    api_responses = []
    def response_handler(response):
        if "proc/rank_more" in response.url and response.request.method == "POST" and response.ok:
            _log(logging.INFO, execution_id, f"Captured SUCCESSFUL 'rank_more' API response #{len(api_responses) + 1}.")
            api_responses.append(response)
    
    page.on("response", response_handler)
    page.goto(ranking_url, wait_until="domcontentloaded")
    
    try:
        timeout_seconds = Config.RANKING_LOAD_TIMEOUT / 1000
        start_time = time.time()
        while len(api_responses) < expected_api_calls:
            if time.time() - start_time > timeout_seconds:
                raise PlaywrightTimeoutError(f"Timeout: Only captured {len(api_responses)}/{expected_api_calls} API responses.")
            time.sleep(0.1)
        _log(logging.INFO, execution_id, "All expected API responses have been captured.")
    finally:
        page.remove_listener("response", response_handler)
        
    _log(logging.INFO, execution_id, "Fetching the entire page content...")
    page_html = page.content()
    soup = BeautifulSoup(page_html, 'html.parser')
    boxes = soup.select(f"{Config.Selectors.NOVEL_BOX}")
    
    novels = []
    seen_novel_ids = set()
    for idx, box in enumerate(boxes[:target_novel_count]):
        onclick_div = box.select_one("div[onclick]")
        raw_onclick = onclick_div['onclick']
        novel_id = str(raw_onclick.split('/')[-1].strip("';"))
        
        if novel_id in seen_novel_ids:
            raise ValueError(f"Duplicate novel ID found: {novel_id}.")
        seen_novel_ids.add(novel_id)
        
        score_element = box.select_one("font.thumb_s4")
        score = _parse_score(score_element.get_text(strip=True))
        
        novels.append({"date": today, "ranking": idx + 1, "id": novel_id, "score": score})

    if len(novels) != target_novel_count:
        raise ValueError(f"Expected {target_novel_count} novels, but found {len(novels)}.")
        
    return novels

# =====================================================================================
# LAMBDA HANDLER 1: Get Ranking List
# =====================================================================================
def get_ranking_list(event, context):
    execution_id = event.get('execution_id', 'N/A')
    input_payload = event.get('input', {})
    test_mode = input_payload.get('test_mode', False)
    _log(logging.INFO, execution_id, "Starting get ranking process...")

    try:
        _log(logging.INFO, execution_id, f"Attempting to purge SQS queue: {Config.SQS_QUEUE_URL}")
        boto3.client('sqs').purge_queue(QueueUrl=Config.SQS_QUEUE_URL)
        _log(logging.INFO, execution_id, "SQS queue purge request sent.")
    except Exception as e:
        _log(logging.ERROR, execution_id, f"Failed to purge SQS queue: {e}", exc_info=True)
        raise ValueError(f"Critical step failed: Could not purge SQS queue. Error: {e}")

    username, password = get_credentials(execution_id)
    today = datetime.now(Config.SEOUL_TIMEZONE).strftime("%Y-%m-%d")
    target_novel_count = input_payload.get('target_novel_count', 500)
    if not (1 <= target_novel_count <= 1000):
        raise ValueError("Invalid target number of novels. Must be between 1 and 1000.")
    
    url_request_count = ((target_novel_count - 1) // 100 + 1) * 100
    ranking_url = Config.RANKING_URL_TEMPLATE.format(url_request_count)

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, args=Config.BROWSER_ARGS)
        pw_context = None
        try:
            # Create context once to maintain login session across retries
            pw_context = browser.new_context(user_agent=Config.USER_AGENT, viewport=Config.VIEWPORT_SIZE)
            pw_context.set_default_navigation_timeout(Config.DEFAULT_NAVIGATION_TIMEOUT)
            pw_context.set_default_timeout(Config.DEFAULT_ACTION_TIMEOUT)

            # --- Perform login and setup only once ---
            setup_page = pw_context.new_page()
            try:
                def block_unnecessary_resources(route):
                    blocked_domains = [
                        "rubiconproject.com",
                        "google-analytics.com",
                        "googletagmanager.com",
                        "googleadservices.com",
                        "doubleclick.net",
                        "facebook.net",
                        "facebook.com",
                        "moloco.com",
                        "creativecdn.com",
                        "pangle-ads.com",
                        "tiktok.com",
                    ]
                    request = route.request
                    if (request.resource_type in ["image", "font", "media"] or 
                            any(domain in request.url for domain in blocked_domains)):
                        route.abort()
                    else:
                        route.continue_()
                setup_page.route("**/*", block_unnecessary_resources)
                _perform_login(setup_page, username, password, execution_id)
                _ensure_adult_mode(setup_page, execution_id)
            finally:
                setup_page.close() # Close the setup page immediately after use

            # --- Retry loop for fetching data, using a new page for each attempt ---
            for attempt in range(Config.MAX_INTERNAL_RETRIES):
                page = None  # Ensure page is defined in the loop's scope
                try:
                    page = pw_context.new_page()
                    page.route("**/*", block_unnecessary_resources)
                    
                    novels = _fetch_and_parse_ranking_page(page, ranking_url, target_novel_count, today, execution_id)
                    
                    _log(logging.INFO, execution_id, f"Successfully fetched {len(novels)} novels.", novel_count=len(novels), date=today)
                    
                    if test_mode:
                        _log(logging.INFO, execution_id, "Test mode enabled. Returning summary without novel data.")
                        return {
                            "status": "TEST_SUCCESS",
                            "fetched_count": len(novels),
                            "fetched_novels": novels
                        }
                    return {"novels": novels, "target_novel_count": target_novel_count, "date": today}

                except (ValueError, PlaywrightTimeoutError) as e:
                    if attempt < Config.MAX_INTERNAL_RETRIES - 1:
                        _log(logging.WARNING, execution_id, f"Attempt {attempt + 1}/{Config.MAX_INTERNAL_RETRIES} failed: {e}. Retrying...")
                    else:
                        _log(logging.ERROR, execution_id, f"Attempt {attempt + 1}/{Config.MAX_INTERNAL_RETRIES} failed. All internal retry attempts failed.")
                        raise
                finally:
                    if page:
                        page.close()

        except Exception as e:
            _log(logging.ERROR, execution_id, f"A non-recoverable error occurred in get_ranking_list: {e}", exc_info=True)
            raise
        finally:
            if pw_context:
                pw_context.close()
            browser.close()

# =====================================================================================
# LAMBDA HANDLER 2: Parse Novel Details
# =====================================================================================
def _create_placeholder_item(novel_info, reason="N/A"):
    """Creates a placeholder dictionary for a failed novel parse."""
    return {
        "Date": novel_info['date'], "Ranking": novel_info['ranking'], "ID": novel_info['id'],
        "Score": novel_info['score'], "Title": f"N/A ({reason})", "AuthorName": "N/A",
        "AuthorID": "0", "View": 0, "Like": 0, "Fav": 0, "Alr": 0, "Eps": 0,
        "Tags": [], "Synopsis": ""
    }

def _validate_item(item, novel_id):
    """Validates the structure and types of the parsed item."""
    non_empty_fields = {"Date", "Ranking", "ID", "Score", "AuthorID", "View", "Like", "Fav", "Alr", "Eps"}
    expected_types = {
        "Date": str, "Ranking": int, "ID": str, "Score": int, "Title": str, "AuthorName": str,
        "AuthorID": str, "View": int, "Like": int, "Fav": int, "Alr": int, "Eps": int,
        "Tags": list, "Synopsis": str,
    }
    for field, expected_type in expected_types.items():
        value = item.get(field)
        if value is None:
            raise ValueError(f"Validation failed for Novel ID {novel_id}: Field '{field}' is missing.")
        if not isinstance(value, expected_type):
            raise ValueError(f"Validation failed for Novel ID {novel_id}: Field '{field}' has type {type(value).__name__}, expected {expected_type.__name__}.")
        if expected_type == str and not value.strip() and field in non_empty_fields:
            raise ValueError(f"Validation failed for Novel ID {novel_id}: Field '{field}' is an empty string.")
        if expected_type == list and not all(isinstance(tag, str) for tag in value):
            raise ValueError(f"Validation failed for Novel ID {novel_id}: Field '{field}' (Tags) contains non-string elements.")
    return True

def _parse_int_from_raw_text(text, suffix_to_remove=""):
    """Helper to parse an integer from cleaned text."""
    return int(text.rstrip(suffix_to_remove).replace(",", ""))

def parse_novel_details(event, context):
    execution_id = event.get('execution_id', 'N/A')
    novel_info = event['novel']
    today = novel_info['date']
    novel_id = novel_info['id']
    item_to_send = None
    status = "UNKNOWN"

    if not novel_id:
        raise ValueError("Novel ID is missing from the event.")

    try:
        if event.get('is_placeholder', False):
            _log(logging.WARNING, execution_id, "Final retry failed. Creating placeholder.", novel_id=novel_id)
            item_to_send = _create_placeholder_item(novel_info, reason="RetryFailed")
            status = "PLACEHOLDER_CREATED"
        else:
            novel_url = Config.NOVEL_URL_TEMPLATE.format(novel_id)
            response = requests.get(novel_url, headers={"User-Agent": Config.USER_AGENT}, timeout=10)
            response.raise_for_status()
            soup = BeautifulSoup(response.text, 'html.parser')

            if soup.select_one(Config.Selectors.ALERT_MODAL):
                _log(logging.WARNING, execution_id, "Novel is inaccessible. Creating placeholder.", novel_id=novel_id)
                item_to_send = _create_placeholder_item(novel_info, reason="Inaccessible")
                status = "PLACEHOLDER_CREATED"
            else:
                counter_line_a = soup.select(Config.Selectors.COUNTER_SPANS)
                info_count2 = soup.select(Config.Selectors.INFO_SPANS)
                tags_raw = [tag.get_text(strip=True) for tag in soup.select(Config.Selectors.TAGS)]

                item = {
                    "Date": today, "Ranking": novel_info['ranking'], "ID": novel_id, "Score": novel_info['score'],
                    "Title": soup.select_one(Config.Selectors.TITLE).get_text(strip=True),
                    "AuthorName": soup.select_one(Config.Selectors.AUTHOR_LINK).get_text(strip=True),
                    "AuthorID": str(soup.select_one(Config.Selectors.AUTHOR_LINK)['href'].split("/")[-1]),
                    "View": _parse_int_from_raw_text(counter_line_a[0].get_text(strip=True)),
                    "Like": _parse_int_from_raw_text(counter_line_a[1].get_text(strip=True)),
                    "Fav": _parse_int_from_raw_text(info_count2[0].get_text(strip=True)),
                    "Alr": _parse_int_from_raw_text(info_count2[1].get_text(strip=True)),
                    "Eps": _parse_int_from_raw_text(info_count2[2].get_text(strip=True), "회차"),
                    "Tags": [t.lstrip("#") for t in tags_raw] if tags_raw else [],
                    "Synopsis": ' '.join([p.get_text(strip=True, separator=' ') for p in soup.select(Config.Selectors.SYNOPSIS)])
                }
                _validate_item(item, novel_id)
                item_to_send = item
                status = "SUCCESS"

    except requests.exceptions.RequestException as e:
        _log(logging.ERROR, execution_id, f"A retriable network error occurred: {e}. Retrying.", novel_id=novel_id, exc_info=True)
        raise e
    except Exception as e:
        _log(logging.ERROR, execution_id, f"A non-retriable error occurred: {e}. Creating placeholder.", novel_id=novel_id, exc_info=True)
        item_to_send = _create_placeholder_item(novel_info, reason=f"ParsingFailed: {e}")
        status = "PLACEHOLDER_CREATED"

    if item_to_send:
        try:
            sqs_client = boto3.client('sqs')
            sqs_client.send_message(
                QueueUrl=Config.SQS_QUEUE_URL,
                MessageBody=json.dumps(item_to_send, ensure_ascii=False)
            )
            _log(logging.INFO, execution_id, f"Successfully sent message to SQS.", novel_id=novel_id, status=status)
            return {"status": status, "novel_id": novel_id}
        except Exception as sqs_e:
            _log(logging.ERROR, execution_id, f"Failed to send message to SQS: {sqs_e}. Retrying.", novel_id=novel_id, exc_info=True)
            raise sqs_e
    else:
        final_error_message = "Function finished without an item to send and without raising an exception."
        _log(logging.CRITICAL, execution_id, final_error_message, novel_id=novel_id)
        raise RuntimeError(final_error_message)