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

import raw_store

# --- Basic Setup ---
logger = logging.getLogger()
logger.setLevel(logging.INFO)

# --- Centralized Configuration ---
class Config:
    """Houses all configuration variables for the crawler."""
    # AWS & SQS
    SQS_QUEUE_URL = os.environ.get('SQS_QUEUE_URL')
    # 원본 HTML 적재 버킷(ELT). 비워 두면 적재를 건너뛰므로 기존 동작이 그대로다.
    RAW_BUCKET = os.environ.get('RAW_HTML_BUCKET')
    RAW_PREFIX = os.environ.get('RAW_HTML_PREFIX', 'raw')
    CREDENTIAL_PARAM_NAMES = ["/NP-Trend/NOVELPIA_ID", "/NP-Trend/NOVELPIA_PASS"]
    # 로그인 쿠키를 상세 파서에 넘기는 곳. 상태 머신 입출력에 싣지 않는다 — Standard 실행 이력은
    # 90일 남고 읽기 권한만 있어도 보여서, 거기 실린 세션 쿠키는 크롤링 계정 로그인과 같다.
    # 상태 머신에는 이 파라미터의 버전 번호만 흐른다.
    AUTH_COOKIE_PARAM_NAME = "/NP-Trend/AUTH_COOKIES"
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
    # 회차 목록 요청의 자체 재시도. 바깥(Step Functions) 재시도는 상세 전체를 다시 받으므로
    # 회차 목록 한 장의 일시 오류는 여기서 짧게 다시 받는다.
    EPISODE_LIST_ATTEMPTS = 3
    EPISODE_LIST_RETRY_DELAY_SECONDS = 1.5
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
        # 소설 단위 성인 배지. 회차 목록에도 같은 class가 쓰이므로 소설 정보
        # 영역(p.in-badge)으로 한정한다. 서버가 novel_age로 렌더하므로 로그인
        # 여부와 무관하게 나타난다.
        ADULT_BADGE = "p.in-badge span.b_19"
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
    """Handles the login process on Novelpia.

    여기서는 제출까지만 한다. **로그인 성공 판정은 `_ensure_adult_mode` 가 한다** — 성인 스위치는
    서버가 그리는 값이라 로그인한 성인 인증 세션에서만 '성인'이 되고, 비로그인 세션에서 켜려고 하면
    로그인 창이 뜰 뿐 '성인'이 되지 않는다(`adt_mode` → `/proc/member_adt_mode` 가 'login').
    """
    _log(logging.INFO, execution_id, "Performing login...")
    page.goto(Config.BASE_URL, wait_until="commit")
    page.locator(Config.Selectors.LOGIN_EMAIL).fill(username)
    page.locator(Config.Selectors.LOGIN_PASSWORD).fill(password)

    # 경고창은 닫되 문구는 남긴다. 로그인 실패 경고가 조용히 닫히면 원인을 알 수 없다.
    def _on_dialog(dialog):
        _log(logging.WARNING, execution_id, "Dialog during setup.", dialog_type=dialog.type,
             dialog_message=(dialog.message or "")[:200])
        dialog.accept()
    page.on("dialog", _on_dialog)
    page.locator(Config.Selectors.LOGIN_SUBMIT).click()
    _log(logging.INFO, execution_id, "Login submitted. Verified by the adult mode check.")

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

    # '성인'임을 **확인했을 때만** 통과한다. 예전에는 '일반'이 아니면 모두 켜진 것으로 봤는데,
    # 라벨이 바뀌거나 값을 못 읽으면 성인 모드가 꺼진 채 진행돼 랭킹에서 성인작이 통째로 빠졌다
    # (docs/DECISIONS.md 「인증 쿠키 도입 목적」 — 로그인 실패는 즉시 실패해야 한다).
    alt = adult_switch_locator.get_attribute('alt')
    if alt == '성인':
        _log(logging.INFO, execution_id, "Adult mode is already ON.")
    elif alt == '일반':
        _log(logging.INFO, execution_id, "Adult mode is OFF. Enabling via UI click...")
        page.locator(Config.Selectors.TOGGLE_MENU).click()
        adult_switch_locator.click()
        _log(logging.INFO, execution_id, "Switch clicked. Waiting for UI to update...")
        expect(page.locator(Config.Selectors.ADULT_SWITCH)).to_have_attribute('alt', '성인', timeout=20000)
        _log(logging.INFO, execution_id, "Verification successful. Adult mode is now ON.")
    else:
        raise RuntimeError(f"Unexpected adult switch alt={alt!r}; cannot confirm adult mode.")

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

def _serialize_auth_cookies(cookies):
    """Keep only the cookie fields needed to recreate an authenticated requests session.

    노벨피아 도메인 쿠키만 남긴다. 광고·분석 도메인 쿠키는 상세 파싱에 쓰이지 않는다.
    """
    serialized = []
    for cookie in cookies:
        name = cookie.get('name')
        value = cookie.get('value')
        if not name or value is None:
            continue
        domain = (cookie.get('domain') or '.novelpia.com').lstrip('.')
        if domain != 'novelpia.com' and not domain.endswith('.novelpia.com'):
            continue
        serialized.append({
            'name': name,
            'value': value,
            'domain': cookie.get('domain') or '.novelpia.com',
            'path': cookie.get('path') or '/',
        })
    return serialized

def _apply_auth_cookies(session, cookies, execution_id):
    """Best-effort cookie injection. Malformed cookie entries must not break parsing."""
    applied_count = 0
    for cookie in cookies or []:
        if not isinstance(cookie, dict):
            continue
        name = cookie.get('name')
        value = cookie.get('value')
        if not name or value is None:
            continue
        try:
            session.cookies.set(
                name,
                value,
                domain=cookie.get('domain') or '.novelpia.com',
                path=cookie.get('path') or '/',
            )
            applied_count += 1
        except Exception as e:
            _log(logging.WARNING, execution_id, f"Skipped malformed auth cookie: {type(e).__name__}")
    if applied_count:
        _log(logging.INFO, execution_id, "Applied auth cookies to detail parser session.", cookie_count=applied_count)

def _store_auth_cookies(cookies, execution_id):
    """쿠키를 Parameter Store(SecureString)에 덮어쓰고 그 버전 번호를 돌려준다.

    상세 파서는 이 번호로 **이번 실행이 쓴 값**을 정확히 읽는다(다음 날 실행이 덮어써도 섞이지 않는다).
    크기 한도(Standard 4KB)를 넘으면 Intelligent-Tiering 이 Advanced 로 올린다.
    """
    client = boto3.client('ssm', region_name=Config.AWS_REGION)
    response = client.put_parameter(
        Name=Config.AUTH_COOKIE_PARAM_NAME,
        Value=json.dumps(cookies, ensure_ascii=False, separators=(',', ':')),
        Type='SecureString', Overwrite=True, Tier='Intelligent-Tiering',
    )
    version = response['Version']
    _log(logging.INFO, execution_id, "Stored auth cookies in Parameter Store.",
         cookie_count=len(cookies), version=version)
    return version


# 컨테이너가 살아 있는 동안 버전별로 한 번만 읽는다. 동시 20개 Map 이 500번 부르지만
# 대부분은 웜 컨테이너라 Parameter Store 호출은 콜드 스타트 수 정도다.
_AUTH_COOKIE_CACHE: dict = {}


def _load_auth_cookies(version, execution_id):
    """`_store_auth_cookies` 가 쓴 쿠키를 읽는다. 실패하면 예외를 그대로 던진다.

    여기서 삼키면 비로그인 세션으로 파싱하게 된다 — 상세 파싱은 성공하지만 성인작 표지 등
    로그인에 기대는 값이 조용히 바뀐다. 던지면 Step Functions 가 이 작품을 재시도한다.
    """
    if version is not None and str(version) in _AUTH_COOKIE_CACHE:
        return _AUTH_COOKIE_CACHE[str(version)]
    name = Config.AUTH_COOKIE_PARAM_NAME
    if version is None:
        # 버전 없는 호출(수동 시험 등)은 최신 값을 읽고 캐시하지 않는다 — 웜 컨테이너가 지난 쿠키를 붙들지 않게.
        _log(logging.WARNING, execution_id, "auth_cookies_version is missing; reading the latest cookies.")
    else:
        name = f"{name}:{version}"
    client = boto3.client('ssm', region_name=Config.AWS_REGION)
    cookies = json.loads(client.get_parameter(Name=name, WithDecryption=True)['Parameter']['Value'])
    if version is not None:
        _AUTH_COOKIE_CACHE[str(version)] = cookies
    return cookies

# =====================================================================================
# LAMBDA HANDLER 1: Get Ranking List
# =====================================================================================
def get_ranking_list(event, context):
    execution_id = event.get('execution_id', 'N/A')
    input_payload = event.get('input', {})
    test_mode = input_payload.get('test_mode', False)
    _log(logging.INFO, execution_id, "Starting get ranking process...")

    # 큐 purge 는 여기서 하지 않는다. 상태 머신이 purge → 65초 대기 → 이 함수 순서로 부른다.
    # purge 는 최대 60초가 걸리고 그 사이 들어온 메시지를 지울 수 있는데, 여기서 purge 하면
    # 약 20초 뒤부터 상세 파서 결과가 큐에 들어와 그 창 안에 놓인다.

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
            auth_cookies = _serialize_auth_cookies(cookies)
            requests_session = requests.Session()
            requests_session.headers.update({"User-Agent": Config.USER_AGENT})
            _apply_auth_cookies(requests_session, auth_cookies, execution_id)
            _log(logging.INFO, execution_id, "Requests session created with login cookies.", cookie_count=len(auth_cookies))

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
                    return {
                        "novels": novels,
                        "target_novel_count": target_novel_count,
                        "date": today,
                        # 쿠키 자체가 아니라 Parameter Store 버전만 넘긴다(Config.AUTH_COOKIE_PARAM_NAME).
                        "auth_cookies_version": _store_auth_cookies(auth_cookies, execution_id),
                    }

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
def _get_episode_list_html(session, novel_id, sort_order, page=0, pages=None):
    """Fetches the episode list HTML for a given sort order ('DOWN'=oldest first, 'UP'=newest first).

    `pages` 를 주면 받은 응답을 그대로 담는다 — 원본 적재(ELT)용이다. 파싱 결과가
    아니라 받은 것을 남겨야 나중에 다른 규칙으로 다시 뽑을 수 있다.
    """
    payload = {"novel_no": novel_id, "sort": sort_order, "page": page}
    headers = {"Referer": Config.NOVEL_URL_TEMPLATE.format(novel_id), "X-Requested-With": "XMLHttpRequest"}
    # 일시 오류(연결·타임아웃·5xx·429)는 짧게 다시 받는다. 호출부는 이 예외를 삼키고 부분 값으로
    # 진행하므로(잔류율 원재료가 -1 로 굳는다), 여기서 다시 받지 않으면 재시도 기회가 없다.
    for attempt in range(1, Config.EPISODE_LIST_ATTEMPTS + 1):
        try:
            response = session.post(Config.EPISODE_LIST_URL, data=payload, headers=headers, timeout=10)
            response.raise_for_status()
            break
        except requests.exceptions.RequestException as e:
            status = getattr(getattr(e, 'response', None), 'status_code', None)
            retriable = status is None or status >= 500 or status == 429
            if not retriable or attempt == Config.EPISODE_LIST_ATTEMPTS:
                raise
            time.sleep(Config.EPISODE_LIST_RETRY_DELAY_SECONDS)
    if pages is not None:
        pages.append({
            "kind": "episode_list", "url": Config.EPISODE_LIST_URL, "method": "POST",
            "params": payload, "status": response.status_code, "html": response.text,
        })
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
    # TypeError·AttributeError: `list` 가 null·응답이 배열·`count_view` 가 숫자처럼 모양이 다른 응답(2026 extract.py 와 같은 규칙)
    except (json.JSONDecodeError, ValueError, KeyError, TypeError, AttributeError) as e:
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

def _extract_badge_spans(soup):
    """`p.in-badge` 안의 span 을 하나도 빼지 않고 기록한다. 해석은 하지 않는다.

    **`b_*` class 만 모으면 안 된다.** 연재중단·연재지연 배지에는 class 가 `s_inv`
    하나뿐이고 구분은 텍스트와 인라인 배경색으로만 되어 있다 — 실측(2026-09-05):

        212573  <span class="s_inv" style="…background-color:#ea4a4a…">연재중단</span>
        427211  <span class="s_inv" style="…background-color:#BAA576…">연재지연</span>
        610     (해당 span 없음)

    `p.in-badge` 안으로 한정하는 것은 반드시 지킨다 — 회차 목록에도 같은 class 가
    쓰여서 문서 전체를 훑으면 회차 배지까지 잡힌다(docs/DECISIONS.md).
    """
    holder = soup.select_one("p.in-badge")
    if holder is None:
        return None
    out = []
    for sp in holder.find_all("span"):
        classes = [c for c in (sp.get("class") or []) if c != "s_inv"]
        m = re.search(r"background-color:\s*([^;]+)", sp.get("style") or "", re.I)
        out.append({
            "class": classes or None,
            "text": sp.get_text(strip=True) or None,
            "color": m.group(1).strip() if m else None,
        })
    return out


def _serial_status_from_badges(spans):
    """연재 상태. `b_*` class 가 없고 텍스트가 있는 배지의 텍스트다.

    **아는 값으로 좁히지 않는다.** 모르는 상태(예: 완결)가 나오면 그 문자열이 그대로
    남아야 한다 — 화이트리스트로 좁히면 새 상태가 조용히 사라진다.

    상태 배지가 없으면(정상 연재) `None` 을 돌려주고 **항목에 필드를 싣지 않는다.**
    한때 빈 문자열을 썼는데, 적재 Lambda 가 `if v != ""` 로 빈 값을 버리기 때문에
    '정상 연재'와 '판정 불가'가 DynamoDB 에서 구별되지 않았다.

    판정 가능성은 `Badges` 로 가린다:
        SerialStatus 있음                → 그 상태
        SerialStatus 없음 + Badges 리스트 → 상태 배지 없음(정상 연재)
        둘 다 없음                        → 판정 불가(상세 페이지 또는 p.in-badge 없음)
    """
    if spans is None:
        return None
    for sp in spans:
        if not sp["class"] and sp["text"]:
            return sp["text"]
    return None


def _info_value(soup, label):
    """작품 정보 영역(`div.epnew-novel-info`)에서 `span.category-title` 이 `label` 인 칸의 값 원문.

    '인생픽'(`9위` / `공개전`)과 '연재'(`월/화/수` / `비정기`)를 이것으로 싣는다. 해석은 하지 않는다 —
    숫자 추출·표기는 백엔드가 한다(ELT). '연재' 칸은 작가가 요일을 정했을 때만 있어서(2026-09-30 실측
    500편 중 251편) 없으면 `None` 이고 항목에 싣지 않는다. 영역 밖(회차 목록·후원 순위의 'N위')은 보지 않는다.
    """
    root = soup.select_one("div.epnew-novel-info")
    if root is None:
        return None
    for t in root.select("span.category-title"):
        if t.get_text(strip=True) == label:
            v = t.find_next_sibling("span")
            return (v.get_text(strip=True) or None) if v else None
    return None


def _get_html_title(soup):
    """Returns the document title for diagnostics without logging response bodies."""
    if not soup.title:
        return ""
    return soup.title.get_text(strip=True)[:120]

def _get_required_detail_elements(soup, response, execution_id, novel_id):
    """Validates detail-page selectors before dereferencing BeautifulSoup nodes."""
    title_el = soup.select_one(Config.Selectors.TITLE)
    author_el = soup.select_one(Config.Selectors.AUTHOR_LINK)
    synopsis_el = soup.select_one(Config.Selectors.SYNOPSIS)
    counter_line_a = soup.select(Config.Selectors.COUNTER_SPANS)
    info_count2 = soup.select(Config.Selectors.INFO_SPANS)

    missing = []
    if title_el is None:
        missing.append("TITLE")
    if author_el is None:
        missing.append("AUTHOR_LINK")
    elif not author_el.get("href"):
        missing.append("AUTHOR_LINK.href")
    if synopsis_el is None:
        missing.append("SYNOPSIS")
    if len(counter_line_a) < 2:
        missing.append(f"COUNTER_SPANS[{len(counter_line_a)}/2]")
    if len(info_count2) < 3:
        missing.append(f"INFO_SPANS[{len(info_count2)}/3]")

    if missing:
        _log(
            logging.WARNING,
            execution_id,
            "Novel detail HTML is missing required selectors.",
            novel_id=novel_id,
            missing_selectors=missing,
            status_code=response.status_code,
            response_length=len(response.text or ""),
            html_title=_get_html_title(soup),
            has_alert_modal=bool(soup.select_one(Config.Selectors.ALERT_MODAL)),
        )
        raise ValueError(f"Missing required detail selectors: {', '.join(missing)}")

    return title_el, author_el, synopsis_el, counter_line_a, info_count2

def _create_placeholder_item(novel_info, reason="N/A"):
    """Creates a placeholder dictionary for a failed novel parse."""
    return {
        "Date": novel_info['date'], "Ranking": novel_info['ranking'], "ID": novel_info['id'],
        "Score": novel_info['score'], "Title": f"N/A ({reason})", "AuthorName": "N/A",
        "AuthorID": "0", "View": 0, "Like": 0, "Fav": 0, "Alr": 0, "Eps": 0,
        "Tags": [], "Synopsis": "", "ThumbnailURL": "", "IsAdult": False,
        "FirstEpView": -1, "FirstEpNum": -1, "TargetLatestEpView": -1, "TargetLatestEpNum": -1,
    }

def _validate_item(item, novel_id):
    """Validates the structure and types of the parsed item."""
    non_empty_fields = {"Date", "Ranking", "ID", "Score", "AuthorID", "View", "Like", "Fav", "Alr", "Eps"}
    expected_types = {
        "Date": str, "Ranking": int, "ID": str, "Score": int, "Title": str, "AuthorName": str,
        "AuthorID": str, "View": int, "Like": int, "Fav": int, "Alr": int, "Eps": int,
        "Tags": list, "Synopsis": str, "IsAdult": bool,
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
    # 받은 페이지를 그대로 모은다. 파싱이 실패해도 적재는 한다 —
    # 예전에는 파싱 실패 시 placeholder 만 남고 HTML 은 영구히 사라졌다.
    raw_pages: list = []

    if not novel_id:
        raise ValueError("Novel ID is missing from the event.")

    # 쿠키는 아래 try 밖에서 읽는다. 안에서 실패하면 '파싱 실패' placeholder 가 되는데,
    # 이건 작품 문제가 아니라 다시 하면 되는 일이라 예외를 Step Functions 재시도로 넘긴다.
    auth_cookies = None
    if not event.get('is_placeholder', False):
        auth_cookies = _load_auth_cookies(event.get('auth_cookies_version'), execution_id)

    try:
        if event.get('is_placeholder', False):
            _log(logging.WARNING, execution_id, "Final retry failed. Creating placeholder.", novel_id=novel_id)
            item_to_send = _create_placeholder_item(novel_info, reason="RetryFailed")
            status = "PLACEHOLDER_CREATED"
        else:
            session = requests.Session()
            session.headers.update({"User-Agent": Config.USER_AGENT})
            _apply_auth_cookies(session, auth_cookies, execution_id)

            novel_url = Config.NOVEL_URL_TEMPLATE.format(novel_id)
            response = session.get(novel_url, timeout=10)
            response.raise_for_status()
            raw_pages.append({
                "kind": "detail", "url": novel_url, "method": "GET",
                "status": response.status_code, "html": response.text,
            })
            soup = BeautifulSoup(response.text, 'html.parser')

            if soup.select_one(Config.Selectors.ALERT_MODAL):
                _log(logging.WARNING, execution_id, "Novel is inaccessible. Creating placeholder.", novel_id=novel_id)
                item_to_send = _create_placeholder_item(novel_info, reason="Inaccessible")
                status = "PLACEHOLDER_CREATED"
            else:
                title_el, author_el, synopsis_el, counter_line_a, info_count2 = _get_required_detail_elements(
                    soup, response, execution_id, novel_id
                )
                tags_raw = [tag.get_text(strip=True) for tag in soup.select(Config.Selectors.TAGS)]
                badge_spans = _extract_badge_spans(soup)
                serial_status = _serial_status_from_badges(badge_spans)

                item = {
                    "Date": today, "Ranking": novel_info['ranking'], "ID": novel_id, "Score": novel_info['score'],
                    "Title": title_el.get_text(strip=True),
                    "AuthorName": author_el.get_text(strip=True),
                    "AuthorID": str(author_el['href'].split("/")[-1]),
                    "View": _parse_int_from_raw_text(counter_line_a[0].get_text(strip=True)),
                    "Like": _parse_int_from_raw_text(counter_line_a[1].get_text(strip=True)),
                    "Fav": _parse_int_from_raw_text(info_count2[0].get_text(strip=True)),
                    "Alr": _parse_int_from_raw_text(info_count2[1].get_text(strip=True)),
                    "Eps": _parse_int_from_raw_text(info_count2[2].get_text(strip=True), "회차"),
                    "Tags": [t.lstrip("#") for t in tags_raw] if tags_raw else [],
                    "Synopsis": synopsis_el.get_text(separator='\n', strip=True),
                    "ThumbnailURL": _extract_thumbnail_url(soup),
                    "IsAdult": soup.select_one(Config.Selectors.ADULT_BADGE) is not None,
                    # 배지 원문. 예전 CSV 스키마에서는 이 필드를 넣어도 CSV_HEADERS 에
                    # 없어 사라졌을 것이다 — NDJSON 이라 그대로 실린다.
                    # `SerialStatus` 는 상태 배지가 있을 때만 아래에서 덧붙인다.
                    "Badges": badge_spans if badge_spans is not None else [],
                    # 인생픽 칸 원문('9위' / '공개전'). 순위 해석은 백엔드가 한다.
                    "LifePick": _info_value(soup, "인생픽"),
                    "FirstEpView": -1, "FirstEpNum": -1,
                    "Ep30View": -1, "Ep30Num": -1,
                    "RecentBaseView": -1, "RecentBaseNum": -1,
                    "TargetLatestEpView": -1, "TargetLatestEpNum": -1,
                }

                # Fetch episode data for retention rate calculation
                if item["Eps"] > 0:
                    # 회차 목록을 끝내 못 받은 창. 그 결과 -1 로 남은 값을 '30화 미만이라 계산 안 함'과
                    # 구별하려고 항목에 싣는다(정상이면 필드 자체가 없다).
                    retention_fetch_errors = []
                    early_valid_eps = []   # (ep_id_str, ep_num_int), sort=DOWN order (oldest first)
                    recent_valid_eps = []  # (ep_id_str, ep_num_int), sort=UP order (newest first)

                    # --- Early window: sort=DOWN, 최대 2페이지 ---
                    # 페이지당 2개 기준, 유효 30개 확보.
                    # 중복 ep_id 감지로 API 마지막 페이지 반복 반환 방어.
                    early_seen_ids: set = set()
                    try:
                        for page_num in range(2):
                            html = _get_episode_list_html(session, novel_id, 'DOWN', page=page_num, pages=raw_pages)
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
                        retention_fetch_errors.append("early")

                    # --- Recent window: sort=UP, 최대 5페이지 ---
                    # Early의 2.5배 탐색: 최신화 앞에 BONUS + 역순 30개 확보.
                    recent_seen_ids: set = set()
                    try:
                        for page_num in range(5):
                            html = _get_episode_list_html(session, novel_id, 'UP', page=page_num, pages=raw_pages)
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
                        retention_fetch_errors.append("recent")

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

                    if retention_fetch_errors:
                        item["RetentionFetchError"] = retention_fetch_errors
                else:
                    _log(logging.INFO, execution_id, "Novel has 0 episodes. Skipping retention data.", novel_id=novel_id)

                if serial_status:
                    item["SerialStatus"] = serial_status
                serial_days = _info_value(soup, "연재")
                if serial_days:
                    # 작가가 정한 연재 요일 원문('월/화/수' / '비정기'). 없으면 싣지 않는다.
                    item["SerialDays"] = serial_days

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

    # 원본 HTML 을 **SQS 메시지에 얹어** consolidate 로 보낸다.
    #
    # 한때 소설마다 S3 에 하나씩 올렸는데(개별 gzip, 편당 91KB), 그러면 PUT 이 소설
    # 수만큼 들고 나중에 하루치를 묶으려면 전부 다시 읽어야 했다. gzip 은 윈도가
    # 32KB 라 묶어도 이득이 없어서(실측), consolidate 가 전건을 모아 zstd 로 한 번에
    # 묶는 쪽으로 바꿨다 — 편당 91KB → 9KB, PUT 500회 → 1회.
    #
    # 파싱이 실패해 placeholder 를 보내는 경우에도 원본은 붙인다. 그래야 나중에
    # "그날 그 페이지가 어떻게 생겼길래 실패했나"를 볼 수 있다.
    if raw_pages and item_to_send is not None:
        try:
            encoded, summary = raw_store.build_message_payload(
                novel_id, today, raw_pages,
                meta={"parse_status": status, "user_agent": Config.USER_AGENT},
            )
            item_to_send[raw_store.RAW_FIELD] = encoded
            _log(logging.INFO, execution_id, "Attached raw HTML to message.",
                 novel_id=novel_id, **{k: v for k, v in summary.items() if k != 'suspect'})
        except Exception as raw_e:  # noqa: BLE001
            # 원본은 부가 정보다. 실패해도 항목 전송은 막지 않는다.
            _log(logging.WARNING, execution_id, f"Failed to attach raw HTML: {raw_e}",
                 novel_id=novel_id)

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
