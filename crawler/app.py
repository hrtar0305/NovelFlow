import boto3
import logging
import json
import os
import re
import requests
import time
from datetime import datetime
from pytz import timezone
from urllib.parse import urljoin
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
    NOVELPIA_BASE_URL = "https://novelpia.com"
    BASE_URL = "https://novelpia.com/mybook"
    RANK_MORE_URL = "https://novelpia.com/proc/rank_more"
    NOVEL_URL_TEMPLATE = "https://novelpia.com/novel/{}"
    EPISODE_LIST_URL = "https://novelpia.com/proc/episode_list"
    NOVEL_PROC_URL = "https://novelpia.com/proc/novel"
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
        COVER_IMAGE = "img.cover_img"
        OG_IMAGE = 'meta[property="og:image"]'

        # For episode list
        EPISODE_INFO_DIV = "div.ep_style2"
        EPISODE_UPLOAD_DATE = "b"
        EPISODE_NUMBER = "span:first-child"
        EPISODE_VIEW_COUNT_SPAN = "span.episode_count_view"

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
def _get_episode_list_html(session, novel_id, sort_order, page=0):
    """Fetches the episode list HTML for a given sort order ('DOWN'=oldest first, 'UP'=newest first)."""
    payload = {"novel_no": novel_id, "sort": sort_order, "page": page}
    headers = {"Referer": Config.NOVEL_URL_TEMPLATE.format(novel_id), "X-Requested-With": "XMLHttpRequest"}
    response = session.post(Config.EPISODE_LIST_URL, data=payload, headers=headers, timeout=10)
    response.raise_for_status()
    return response.text

def _parse_valid_episodes(soup):
    """Returns list of (ep_id_str, ep_num_int) for all valid episodes in page soup.
    Valid = EP.\\d+ format number + YY.MM.DD format date + novel_count_view class span present."""
    result = []
    for ep_div in soup.select(Config.Selectors.EPISODE_INFO_DIV):
        ep_num_el = ep_div.select_one(Config.Selectors.EPISODE_NUMBER)
        ep_date_el = ep_div.select_one(Config.Selectors.EPISODE_UPLOAD_DATE)
        if (ep_num_el and ep_date_el and
                re.match(r"^EP\.\s*\d+$", ep_num_el.get_text(strip=True)) and
                re.match(r"^\d{2}\.\d{2}\.\d{2}$", ep_date_el.get_text(strip=True))):
            view_span = ep_div.select_one(Config.Selectors.EPISODE_VIEW_COUNT_SPAN)
            if view_span:
                m = re.search(r'novel_count_view_(\d+)', ' '.join(view_span.get('class', [])))
                if m:
                    ep_num = int(re.search(r'\d+', ep_num_el.get_text(strip=True)).group())
                    result.append((m.group(1), ep_num))
    return result

def _get_episode_view_counts(session, novel_id, episode_ids, execution_id):
    """Fetches view counts for a list of episode IDs via /proc/novel."""
    if not episode_ids:
        return {}
    episode_arr_values = [f"episode_count_view novel_count_view_{eid}" for eid in episode_ids]
    payload = [("novel_no", novel_id), ("cmd", "get_episode_count_view")]
    for val in episode_arr_values:
        payload.append(("episode_arr[]", val))
    headers = {"Referer": Config.NOVEL_URL_TEMPLATE.format(novel_id), "X-Requested-With": "XMLHttpRequest"}
    response = session.post(Config.NOVEL_PROC_URL, data=payload, headers=headers, timeout=10)
    response.raise_for_status()
    if not response.text.strip():
        return {}
    try:
        data = response.json()
        return {item['episode_no']: int(item['count_view'].replace(',', '')) for item in data.get('list', [])}
    except (json.JSONDecodeError, ValueError, KeyError) as e:
        _log(logging.WARNING, execution_id, f"Failed to parse /proc/novel response: {e}", novel_id=novel_id)
        return {}

def _normalize_thumbnail_url(url):
    if not url:
        return ""
    cleaned_url = url.strip()
    if not cleaned_url:
        return ""
    if cleaned_url.startswith("//"):
        return f"https:{cleaned_url}"
    return urljoin(Config.NOVELPIA_BASE_URL, cleaned_url)

def _extract_thumbnail_url(soup):
    cover_image = soup.select_one(Config.Selectors.COVER_IMAGE)
    if cover_image and cover_image.get("src"):
        return _normalize_thumbnail_url(cover_image.get("src"))

    og_image = soup.select_one(Config.Selectors.OG_IMAGE)
    if og_image and og_image.get("content"):
        return _normalize_thumbnail_url(og_image.get("content"))

    return ""

def _create_placeholder_item(novel_info, reason="N/A"):
    """Creates a placeholder dictionary for a failed novel parse."""
    return {
        "Date": novel_info['date'], "Ranking": novel_info['ranking'], "ID": novel_info['id'],
        "Score": novel_info['score'], "Title": f"N/A ({reason})", "AuthorName": "N/A",
        "AuthorID": "0", "View": 0, "Like": 0, "Fav": 0, "Alr": 0, "Eps": 0,
        "Tags": [], "Synopsis": "", "ThumbnailURL": "",
        "FirstEpView": -1, "FirstEpNum": -1, "TargetLatestEpView": -1, "TargetLatestEpNum": -1,
    }

def _validate_item(item, novel_id):
    """Validates the structure and types of the parsed item."""
    non_empty_fields = {"Date", "Ranking", "ID", "Score", "AuthorID", "View", "Like", "Fav", "Alr", "Eps"}
    expected_types = {
        "Date": str, "Ranking": int, "ID": str, "Score": int, "Title": str, "AuthorName": str,
        "AuthorID": str, "View": int, "Like": int, "Fav": int, "Alr": int, "Eps": int,
        "Tags": list, "Synopsis": str,
        "FirstEpView": int, "FirstEpNum": int, "TargetLatestEpView": int, "TargetLatestEpNum": int,
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
            session = requests.Session()
            session.headers.update({"User-Agent": Config.USER_AGENT})

            novel_url = Config.NOVEL_URL_TEMPLATE.format(novel_id)
            response = session.get(novel_url, timeout=10)
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
                    "Synopsis": soup.select_one(Config.Selectors.SYNOPSIS).get_text(separator='\n', strip=True),
                    "ThumbnailURL": _extract_thumbnail_url(soup),
                    "FirstEpView": -1, "FirstEpNum": -1,
                    "Ep30View": -1, "Ep30Num": -1,
                    "RecentBaseView": -1, "RecentBaseNum": -1,
                    "TargetLatestEpView": -1, "TargetLatestEpNum": -1,
                }

                # Fetch episode data for retention rate calculation
                if item["Eps"] > 0:
                    early_valid_eps = []   # (ep_id_str, ep_num_int), sort=DOWN order (oldest first)
                    recent_valid_eps = []  # (ep_id_str, ep_num_int), sort=UP order (newest first)

                    # --- Early window: sort=DOWN, 최대 2페이지 ---
                    # 페이지당 2개 기준, 유효 30개 확보.
                    # 중복 ep_id 감지로 API 마지막 페이지 반복 반환 방어.
                    early_seen_ids: set = set()
                    try:
                        for page_num in range(2):
                            html = _get_episode_list_html(session, novel_id, 'DOWN', page=page_num)
                            soup_ep = BeautifulSoup(html, 'html.parser')
                            if not soup_ep.select(Config.Selectors.EPISODE_INFO_DIV):
                                break  # 진짜 빈 페이지
                            parsed = _parse_valid_episodes(soup_ep)
                            page_ids = {ep[0] for ep in parsed}
                            if page_ids and page_ids.issubset(early_seen_ids):
                                break  # 중복 페이지 — 마지막 페이지 반복 반환
                            for ep in parsed:
                                if ep[0] not in early_seen_ids:
                                    early_valid_eps.append(ep)
                                    early_seen_ids.add(ep[0])
                            if len(early_valid_eps) >= 30:
                                break
                    except requests.exceptions.RequestException as ep_e:
                        _log(logging.WARNING, execution_id, f"Failed to fetch early episode list: {ep_e}", novel_id=novel_id)

                    # --- Recent window: sort=UP, 최대 5페이지 ---
                    # Early의 2.5배 탐색: 최신화 앞에 BONUS + 역순 30개 확보.
                    recent_seen_ids: set = set()
                    try:
                        for page_num in range(5):
                            html = _get_episode_list_html(session, novel_id, 'UP', page=page_num)
                            soup_ep = BeautifulSoup(html, 'html.parser')
                            if not soup_ep.select(Config.Selectors.EPISODE_INFO_DIV):
                                break  # 진짜 빈 페이지
                            parsed = _parse_valid_episodes(soup_ep)
                            page_ids = {ep[0] for ep in parsed}
                            if page_ids and page_ids.issubset(recent_seen_ids):
                                break  # 중복 페이지
                            for ep in parsed:
                                if ep[0] not in recent_seen_ids:
                                    recent_valid_eps.append(ep)
                                    recent_seen_ids.add(ep[0])
                            if len(recent_valid_eps) >= 30:
                                break
                    except requests.exceptions.RequestException as ep_e:
                        _log(logging.WARNING, execution_id, f"Failed to fetch recent episode list: {ep_e}", novel_id=novel_id)

                    # --- 수집된 에피소드로 요청할 ID 목록 결정 ---
                    first_ep_id = early_valid_eps[0][0] if early_valid_eps else None
                    ep30_id = early_valid_eps[29][0] if len(early_valid_eps) >= 30 else None
                    latest_ep_id = recent_valid_eps[0][0] if recent_valid_eps else None
                    recent_base_id = recent_valid_eps[29][0] if len(recent_valid_eps) >= 30 else None

                    # first가 있으면 배치 요청 실행. latest가 없거나 same-ep이어도 first는 저장.
                    if first_ep_id:
                        ep_ids_to_fetch = list(dict.fromkeys(
                            eid for eid in [first_ep_id, ep30_id, recent_base_id, latest_ep_id] if eid
                        ))
                        view_counts = _get_episode_view_counts(session, novel_id, ep_ids_to_fetch, execution_id)

                        first_ep_id_int = int(first_ep_id)
                        if first_ep_id_int in view_counts:
                            item["FirstEpView"] = view_counts[first_ep_id_int]
                            item["FirstEpNum"] = early_valid_eps[0][1]
                        else:
                            _log(logging.WARNING, execution_id, "Could not retrieve view count for first episode.", novel_id=novel_id)

                        if latest_ep_id and latest_ep_id != first_ep_id:
                            latest_ep_id_int = int(latest_ep_id)
                            if latest_ep_id_int in view_counts:
                                item["TargetLatestEpView"] = view_counts[latest_ep_id_int]
                                item["TargetLatestEpNum"] = recent_valid_eps[0][1]
                        elif latest_ep_id and latest_ep_id == first_ep_id:
                            _log(logging.INFO, execution_id, "Novel has only one valid episode.", novel_id=novel_id)

                        if ep30_id:
                            ep30_id_int = int(ep30_id)
                            if ep30_id_int in view_counts:
                                item["Ep30View"] = view_counts[ep30_id_int]
                                item["Ep30Num"] = early_valid_eps[29][1]

                        if recent_base_id:
                            recent_base_id_int = int(recent_base_id)
                            if recent_base_id_int in view_counts:
                                item["RecentBaseView"] = view_counts[recent_base_id_int]
                                item["RecentBaseNum"] = recent_valid_eps[29][1]
                else:
                    _log(logging.INFO, execution_id, "Novel has 0 episodes. Skipping retention data.", novel_id=novel_id)

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
