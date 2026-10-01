import boto3
import logging
import json
import os
import requests
from urllib.parse import urljoin
from bs4 import BeautifulSoup

import raw_store
import extract
from botocore.exceptions import ClientError as BotoClientError

# --- Basic Setup ---
logger = logging.getLogger()
logger.setLevel(logging.INFO)

class Config:
    # 원본 HTML 적재(ELT). 비워 두면 적재를 건너뛰므로 기존 동작 그대로다.
    RAW_BUCKET = os.environ.get('RAW_HTML_BUCKET')
    RAW_PREFIX = os.environ.get('RAW_HTML_PREFIX', 'raw')
    CONTEST_YEAR = os.environ.get('CONTEST_YEAR', '2026')
    """Houses all configuration variables for the contest novel parser."""
    # AWS Configuration
    AWS_REGION = "ap-northeast-2"
    SQS_RESULT_QUEUE_URL = os.environ.get('SQS_RESULT_QUEUE_URL')

    # Request & Parsing Configuration
    USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Safari/537.36"
    MAX_INTERNAL_RETRIES = 3 # Max retries for individual novel parsing
    
    # Novelpia URLs & Settings
    NOVELPIA_BASE_URL = "https://novelpia.com"
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
        COVER_IMAGE = "img.cover_img"
        OG_IMAGE = 'meta[property="og:image"]'
        # 성인 등급 배지. p.in-badge 로 반드시 한정한다(회차 목록에도 같은 class 가 있다 — DECISIONS 2026-08-24).
        ADULT_BADGE = "p.in-badge span.b_19"

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

def _create_placeholder_item(novel_id, crawl_date, reason="N/A"):
    """Creates a placeholder dictionary for a failed novel parse."""
    return {
        "Date": crawl_date, "ID": novel_id, "Title": f"N/A ({reason})",
        "AuthorName": "N/A", "AuthorID": "0", "View": -1, "Like": -1, "Fav": -1, "Alr": -1,
        "Eps": -1, "Tags": [], "Synopsis": "",
        # 정상 행과 키를 맞춘다(DECISIONS 2026-08-24 차기 공모전 체크리스트).
        "IsAdult": False,
    }

# =====================================================================================
# LAMBDA HANDLER: Parse Contest Novel Details
# =====================================================================================
def _upload_raw_batch(execution_id, raw_batch, crawl_date, context):
    """이 배치가 받은 원본을 한 덩어리로 묶어 S3 에 올린다.

    키는 `{prefix}/{year}/{date}/{request_id}.jsonl.zst` 다. 배치마다 객체가 하나씩
    생기므로(4,719편 / batch 80 ≈ 59개) 이름이 겹치면 안 되는데, Lambda 요청 ID 가
    호출마다 유일하고 재시도 시에도 새로 발급되므로 그대로 쓴다.

    실패해도 예외를 올리지 않는다 — 원본은 부가 기능이고, 여기서 raise 하면 SQS 가
    배치 전체를 재시도해 같은 소설을 다시 긁는다.
    """
    if not raw_batch or not Config.RAW_BUCKET:
        return
    try:
        payloads = []
        for novel_id, pages in raw_batch:
            body, _ = raw_store.build_json_payload(
                novel_id, crawl_date, pages,
                meta={"pipeline": "contest", "year": Config.CONTEST_YEAR},
            )
            payloads.append(body)

        blob = raw_store.bundle(payloads)
        rid = getattr(context, 'aws_request_id', 'unknown')
        key = f"{Config.RAW_PREFIX}/{Config.CONTEST_YEAR}/{crawl_date}/{rid}.jsonl.zst"
        boto3.client('s3', region_name=Config.AWS_REGION).put_object(
            Bucket=Config.RAW_BUCKET, Key=key, Body=blob, ContentType='application/zstd',
        )
        _log(logging.INFO, execution_id, "Uploaded raw batch.",
             key=key, novels=len(payloads), bytes=len(blob),
             per_novel_kb=round(len(blob) / len(payloads) / 1024, 1))
    except Exception as e:  # noqa: BLE001
        _log(logging.ERROR, execution_id, f"Failed to upload raw batch: {e}", exc_info=True)


def _parse_one(session, novel_id, crawl_date, execution_id):
    """한 편. (item, pages). 네트워크 오류는 올려서 호출부가 재시도하게 하고, 파싱 오류는 placeholder."""
    pages = []
    novel_url = Config.NOVEL_URL_TEMPLATE.format(novel_id)
    response = session.get(novel_url, timeout=15)
    response.raise_for_status()
    pages.append({"kind": "detail", "url": novel_url, "method": "GET",
                  "status": response.status_code, "html": response.text})
    soup = BeautifulSoup(response.text, 'html.parser')

    if soup.select_one(Config.Selectors.ALERT_MODAL):
        _log(logging.WARNING, execution_id, "Novel is inaccessible. Creating placeholder.", novel_id=novel_id)
        return _create_placeholder_item(novel_id, crawl_date, reason="Inaccessible"), pages, False

    try:
        counter_line_a = soup.select(Config.Selectors.COUNTER_SPANS)
        info_count2 = soup.select(Config.Selectors.INFO_SPANS)
        tags_raw = [tag.get_text(strip=True) for tag in soup.select(Config.Selectors.TAGS)]
        spans = extract.badge_spans(soup)
        item = {
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
            "ThumbnailURL": _extract_thumbnail_url(soup),
            # --- 2026 추가(데일리와 같은 규칙, 원문 그대로) ---
            "IsAdult": soup.select_one(Config.Selectors.ADULT_BADGE) is not None,
            "Badges": spans if spans is not None else [],
            "LifePick": extract.info_value(soup, "인생픽"),
        }
    except Exception as e:  # noqa: BLE001 — 셀렉터가 깨진 페이지: 재시도해도 같으므로 placeholder
        _log(logging.ERROR, execution_id, f"Parsing failed for {novel_id}: {e}. Creating placeholder.", novel_id=novel_id, exc_info=True)
        return _create_placeholder_item(novel_id, crawl_date, reason=f"ParsingFailed: {type(e).__name__}"), pages, False

    status = extract.serial_status(spans)
    if status:
        item["SerialStatus"] = status
    days = extract.info_value(soup, "연재")
    if days:
        item["SerialDays"] = days
    # 잔류율: 회차 30 이상만 회차 목록을 받는다(유효 회차 30개 미만이면 어차피 값이 없다).
    if item["Eps"] >= extract.RETENTION_MIN_EPS:
        item.update(extract.retention_fields(
            session, novel_id, pages, lambda lv, msg: _log(lv, execution_id, msg, novel_id=novel_id)))
    return item, pages, True


def parse_contest_novel_details_batch(event, context):
    """SQS 배치(최대 Config 에 맞춘 batch size)를 한 세션으로 처리한다.

    **실패한 작품만 다시 받는다(ReportBatchItemFailures).** 2025 는 한 편이 네트워크 오류로
    끝내 실패하면 배치 전체를 다시 던져 나머지 79편도 다시 긁었다(백로그 #29). 이벤트 소스
    매핑의 FunctionResponseTypes 에 ReportBatchItemFailures 를 켜야 동작한다.
    중복 결과는 완료 판정(유니크 ID)과 consolidate(최초 타임스탬프 우선)가 걸러낸다.
    """
    records = event.get('Records', [])
    if not records:
        logger.info("Received empty event, no records to process.")
        return {"batchItemFailures": []}

    first_message = json.loads(records[0]['body'])
    execution_id = first_message.get('execution_id', 'N/A')
    crawl_date = first_message.get('date')
    _log(logging.INFO, execution_id, f"Starting SQS batch processing for {len(records)} novels.")

    session = requests.Session()
    session.headers.update({"User-Agent": Config.USER_AGENT})
    sqs_client = boto3.client('sqs', region_name=Config.AWS_REGION)

    success_count = placeholder_count = 0
    failures = []
    # 배치가 받은 원본. 배치 끝에 한 덩어리로 묶어 올린다(소설마다 올리면 편당 67KB, 40편 묶음이면 4KB).
    raw_batch = []

    for record in records:
        novel_id = str(json.loads(record['body'])['novel_id']).strip()
        item = None
        for attempt in range(Config.MAX_INTERNAL_RETRIES):
            try:
                item, pages, ok = _parse_one(session, novel_id, crawl_date, execution_id)
                raw_batch.append((novel_id, pages))
                if ok:
                    success_count += 1
                else:
                    placeholder_count += 1
                break
            except requests.exceptions.RequestException as e:
                _log(logging.WARNING, execution_id, f"Network error for {novel_id} (attempt {attempt + 1}/{Config.MAX_INTERNAL_RETRIES}): {e}", novel_id=novel_id)
        if item is None:
            failures.append({"itemIdentifier": record['messageId']})
            continue
        try:
            sqs_client.send_message(QueueUrl=Config.SQS_RESULT_QUEUE_URL, MessageBody=json.dumps(item, ensure_ascii=False))
        except BotoClientError as sqs_e:
            _log(logging.ERROR, execution_id, f"Failed to send result for {novel_id}: {sqs_e}", novel_id=novel_id, exc_info=True)
            failures.append({"itemIdentifier": record['messageId']})

    _upload_raw_batch(execution_id, raw_batch, crawl_date, context)
    _log(logging.INFO, execution_id, "Batch processing complete.", success=success_count,
         placeholders=placeholder_count, failed=len(failures), total=len(records))
    return {"batchItemFailures": failures}


def parse_dmap_batch(event, context):
    """Distributed Map(ItemBatcher) 한 묶음 — SQS 대신 Step Functions 가 나눠 준다(2026-10 전환 준비).

    입력: {"Items": [novel_id, ...], "BatchInput": {"execution_id", "date"(기록 날짜), "raw": 원본 적재 여부}}
    출력: {"items": [...], "failed": [novel_id, ...]} — ResultWriter 가 S3 에 남기고 적재가 읽는다.
    끝내 네트워크 오류인 작품은 failed 로 돌려준다(묶음 전체를 다시 돌리지 않는다). 적재의 수량 검증이 잡는다.
    """
    bi = event.get('BatchInput') or {}
    execution_id, crawl_date = bi.get('execution_id', 'N/A'), bi.get('date')
    ids = [str(x).strip() for x in event.get('Items') or []]
    session = requests.Session()
    session.headers.update({"User-Agent": Config.USER_AGENT})
    results, failed, raw_batch = [], [], []
    for novel_id in ids:
        item = None
        for attempt in range(Config.MAX_INTERNAL_RETRIES):
            try:
                item, pages, _ok = _parse_one(session, novel_id, crawl_date, execution_id)
                raw_batch.append((novel_id, pages))
                break
            except requests.exceptions.RequestException as e:
                _log(logging.WARNING, execution_id, f"Network error for {novel_id} (attempt {attempt + 1}): {e}", novel_id=novel_id)
        if item is None:
            failed.append(novel_id)
        else:
            results.append(item)
    if bi.get('raw', True):
        _upload_raw_batch(execution_id, raw_batch, crawl_date, context)
    _log(logging.INFO, execution_id, "DMap batch complete.", total=len(ids), ok=len(results), failed=len(failed))
    return {"items": results, "failed": failed}
