import boto3
import logging
import json
import os
import requests
import time
from datetime import datetime
from pytz import timezone
from playwright.sync_api import sync_playwright, TimeoutError as PlaywrightTimeoutError, expect
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
    BASE_URL = "https://novelpia.com/mybook"
    RANK_MORE_URL = "https://novelpia.com/proc/rank_more"
    NOVEL_URL_TEMPLATE = "https://novelpia.com/novel/{}"
    MAX_INTERNAL_RETRIES = 10
    SEOUL_TIMEZONE = timezone('Asia/Seoul')

    # CSS Selectors
    class Selectors:
        BANNER_CLOSE_SELECTORS = [
            "div.event-plus-close"
        ]
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
    page.locator(Config.Selectors.LOGIN_EMAIL).fill(username)
    page.locator(Config.Selectors.LOGIN_PASSWORD).fill(password)
    page.on("dialog", lambda dialog: dialog.accept())
    page.locator(Config.Selectors.LOGIN_SUBMIT).click()
    _log(logging.INFO, execution_id, "Login successful.")

def _ensure_adult_mode(page, execution_id):
    """Checks and enables adult mode if it's off."""
    # Locate the switch once to check its initial state.
    adult_switch_locator = page.locator(Config.Selectors.ADULT_SWITCH)
    
    # --- Defensive Banner Closing ---
    # Try to close any known banners that might be overlaying the UI.
    for i, selector in enumerate(Config.Selectors.BANNER_CLOSE_SELECTORS):
        try:
            banner_close_button = page.locator(selector)
            if banner_close_button.is_visible(timeout=2000):
                _log(logging.INFO, execution_id, f"Overlay banner #{i+1} detected. Attempting to close.")
                banner_close_button.click(timeout=5000)
        except PlaywrightTimeoutError:
            pass # Banner not found, which is fine.

    if adult_switch_locator.get_attribute('alt') == '일반':
        _log(logging.INFO, execution_id, "Adult mode is OFF. Enabling via UI click...")
        page.locator(Config.Selectors.TOGGLE_MENU).click()
        adult_switch_locator.click()
        _log(logging.INFO, execution_id, "Switch clicked. Waiting for UI to update...")
        expect(page.locator(Config.Selectors.ADULT_SWITCH)).to_have_attribute('alt', '성인', timeout=20000)
        _log(logging.INFO, execution_id, "Verification successful. Adult mode is now ON.")
    else:
        _log(logging.INFO, execution_id, "Adult mode is already ON.")

def _parse_score(score_text):
    """Converts score text to an integer."""
    if "M" in score_text:
        return int(float(score_text.replace("M", "")) * 1000000)
    if "K" in score_text:
        return int(float(score_text.replace("K", "")) * 1000)
    return int(score_text.replace(",", ""))

def _fetch_rankings_with_requests(session, target_novel_count, today, execution_id):
    """Fetches initial and additional rankings using a requests session."""
    _log(logging.INFO, execution_id, f"Fetching {target_novel_count} rankings via single API call...")

    payload = {
        "load": "top100", "cate": "all", "proc": "weekly", "info": "view",
        "req1": "all", "req2": "all", "req3": "",
        "idx": 0,
        "page_cut": target_novel_count,
        "main_genre": ""
    }
    
    response = session.post(Config.RANK_MORE_URL, data=payload, timeout=30)
    response.raise_for_status()
    
    response_json = response.json()
    if response_json.get("status") != "200" or not response_json.get("result"):
        _log(logging.ERROR, execution_id, "API call for rankings returned non-200 status or empty result.", response_data=response_json)
        raise ValueError("Failed to fetch novel list from API.")

    full_html = response_json["result"]

    _log(logging.INFO, execution_id, "Parsing API response HTML for novel data...")
    soup = BeautifulSoup(full_html, 'html.parser')
    boxes = soup.select(Config.Selectors.NOVEL_BOX)

    novels = []
    seen_novel_ids = set()

    if len(boxes) < target_novel_count:
         _log(logging.WARNING, execution_id, f"Expected at least {target_novel_count} novel boxes, but found {len(boxes)}. Proceeding with found items.")

    for idx, box in enumerate(boxes[:target_novel_count]):
        try:
            onclick_div = box.select_one("div[onclick]")
            if not onclick_div:
                _log(logging.WARNING, execution_id, f"Skipping box at index {idx} due to missing 'onclick' div.")
                continue

            raw_onclick = onclick_div['onclick']
            novel_id = str(raw_onclick.split('/')[-1].strip("';"))

            if novel_id in seen_novel_ids:
                _log(logging.WARNING, execution_id, f"Duplicate novel ID found and skipped: {novel_id}.")
                continue
            seen_novel_ids.add(novel_id)

            score_element = box.select_one("font.thumb_s4")
            score = _parse_score(score_element.get_text(strip=True))

            novels.append({"date": today, "ranking": len(novels) + 1, "id": novel_id, "score": score})
        except (AttributeError, IndexError, ValueError) as e:
            _log(logging.WARNING, execution_id, f"Could not parse a novel box at index {idx}: {e}")

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
            
            # --- Extract cookies from Playwright and set up requests session ---
            _log(logging.INFO, execution_id, "Extracting cookies from Playwright context...")
            cookies = pw_context.cookies()
            requests_session = requests.Session()
            requests_session.headers.update({"User-Agent": Config.USER_AGENT})
            for cookie in cookies:
                requests_session.cookies.set(cookie['name'], cookie['value'], domain=cookie['domain'])
            _log(logging.INFO, execution_id, "Requests session created with login cookies.")

            # --- Retry loop for fetching data with requests ---
            for attempt in range(Config.MAX_INTERNAL_RETRIES):
                try:
                    novels = _fetch_rankings_with_requests(requests_session, target_novel_count, today, execution_id)
                    
                    _log(logging.INFO, execution_id, f"Successfully fetched {len(novels)} novels.", novel_count=len(novels), date=today)
                    
                    if test_mode:
                        _log(logging.INFO, execution_id, "Test mode enabled. Returning fetched novels directly.")
                        return {
                            "status": "TEST_SUCCESS_REQUESTS",
                            "fetched_count": len(novels),
                            "fetched_novels": novels
                        }
                    return {"novels": novels, "target_novel_count": target_novel_count, "date": today}

                except (ValueError, requests.exceptions.RequestException) as e:
                    if attempt < Config.MAX_INTERNAL_RETRIES - 1:
                        _log(logging.WARNING, execution_id, f"Attempt {attempt + 1}/{Config.MAX_INTERNAL_RETRIES} failed: {e}. Retrying...")
                    else:
                        _log(logging.ERROR, execution_id, f"Attempt {attempt + 1}/{Config.MAX_INTERNAL_RETRIES} failed. All internal retry attempts failed.")
                        raise

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
                    "Synopsis": soup.select_one(Config.Selectors.SYNOPSIS).get_text(separator='\n', strip=True)
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