import boto3
import logging
import json
import os
import requests
import time
from urllib.parse import urljoin
from bs4 import BeautifulSoup

import raw_store
from botocore.exceptions import ClientError as BotoClientError

# --- Basic Setup ---
logger = logging.getLogger()
logger.setLevel(logging.INFO)

class Config:
    # 원본 HTML 적재(ELT). 비워 두면 적재를 건너뛰므로 기존 동작 그대로다.
    RAW_BUCKET = os.environ.get('RAW_HTML_BUCKET')
    RAW_PREFIX = os.environ.get('RAW_HTML_PREFIX', 'raw')
    CONTEST_YEAR = os.environ.get('CONTEST_YEAR', '2025')
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
        "Eps": -1, "Tags": [], "Synopsis": ""
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


# 쓸 수 없는 페이지를 다시 받는 횟수와 그 사이 대기(데일리 크롤러와 같은 값 — 잘림이 몰린 구간이 0.3~5.6초였다).
PAGE_ATTEMPTS = 3
PAGE_RETRY_WAITS = (2, 5)


def _fetch_contest_novel(session, novel_id, crawl_date, raw_batch, execution_id):
    """한 편을 받아 항목(dict)을 낸다. 쓸 수 없는 페이지면 placeholder 사유(str). 네트워크 오류는 3번 뒤 그대로 던진다
    (묶음 전체를 SQS 가 다시 보낸다)."""
    for attempt in range(Config.MAX_INTERNAL_RETRIES):
        try:
            novel_url = Config.NOVEL_URL_TEMPLATE.format(novel_id)
            response = session.get(novel_url, timeout=15)
            response.raise_for_status()
            raw_batch.append((novel_id, [{"kind": "detail", "url": novel_url, "method": "GET",
                                          "status": response.status_code, "html": response.text}]))
            soup = BeautifulSoup(response.text, 'html.parser')
            if soup.select_one(Config.Selectors.ALERT_MODAL):
                return "Inaccessible"
            try:
                counter_line_a = soup.select(Config.Selectors.COUNTER_SPANS)
                info_count2 = soup.select(Config.Selectors.INFO_SPANS)
                tags_raw = [tag.get_text(strip=True) for tag in soup.select(Config.Selectors.TAGS)]
                return {
                    "Date": crawl_date, "ID": novel_id,
                    "Title": soup.select_one(Config.Selectors.TITLE).get_text(strip=True),
                    "AuthorName": soup.select_one(Config.Selectors.AUTHOR_LINK).get_text(strip=True),
                    "AuthorID": str(soup.select_one(Config.Selectors.AUTHOR_LINK)['href'].split("/")[-1]),
                    "View": _parse_int_from_raw_text(counter_line_a[0].get_text(strip=True)),
                    "Like": _parse_int_from_raw_text(counter_line_a[1].get_text(strip=True)),
                    "Fav": _parse_int_from_raw_text(info_count2[0].get_text(strip=True)),
                    "Alr": _parse_int_from_raw_text(info_count2[1].get_text(strip=True)),
                    "Eps": _parse_int_from_raw_text(info_count2[2].get_text(strip=True), "회차"),
                    "Tags": [t.lstrip("#") for t in tags_raw],
                    "Synopsis": soup.select_one(Config.Selectors.SYNOPSIS).get_text(separator='\n', strip=True),
                    "ThumbnailURL": _extract_thumbnail_url(soup),
                }
            except Exception as e:  # noqa: BLE001 — 셀렉터가 없거나 숫자가 아닌 페이지
                _log(logging.WARNING, execution_id, f"Unusable page for {novel_id}: {e}", novel_id=novel_id,
                     response_length=len(response.text or ""))
                return f"ParsingFailed: {type(e).__name__}"
        except requests.exceptions.RequestException as e:
            if attempt < Config.MAX_INTERNAL_RETRIES - 1:
                _log(logging.WARNING, execution_id, f"Retriable network error for {novel_id} (attempt {attempt + 1}/{Config.MAX_INTERNAL_RETRIES}): {e}. Retrying...", novel_id=novel_id)
            else:
                _log(logging.ERROR, execution_id, f"Retriable network error for {novel_id} failed after {Config.MAX_INTERNAL_RETRIES} attempts: {e}. The batch will be retried by SQS.", novel_id=novel_id)
                raise


def _send_result(sqs_client, execution_id, novel_id, item):
    try:
        sqs_client.send_message(QueueUrl=Config.SQS_RESULT_QUEUE_URL, MessageBody=json.dumps(item, ensure_ascii=False))
    except BotoClientError as sqs_e:
        _log(logging.ERROR, execution_id, f"Failed to send message to SQS for {novel_id}: {sqs_e}. The batch will be retried by SQS.", novel_id=novel_id, exc_info=True)
        raise


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
    # 이 배치가 받은 원본. 배치 끝에 한 덩어리로 묶어 올린다.
    #
    # **소설마다 올리지 않는다.** 실측(2026-09-05, 상세 1페이지 40편):
    #   배치  1편 → 편당 67.5KB      배치 20편 → 편당  5.7KB
    #   배치 10편 → 편당  9.1KB      배치 40편 → 편당  4.0KB
    # 배치가 클수록 문서 간 중복이 걷힌다. 공모전 파서는 SQS batch 80 이라
    # 편당 4KB 아래로 떨어진다.
    #
    # **데일리처럼 consolidate 에서 묶지 않는 이유**: 공모전은 4,719편이라
    # 비압축 원본이 3.5GB 다. consolidate 가 전건을 들면 Lambda 메모리가 5GB 대가
    # 된다. 배치 단위로 묶으면 80편 × 753KB = 60MB 뿐이다.
    raw_batch = []

    # 쓸 수 없는 페이지(경고창·파싱 실패)는 **묶음 끝에서 다시 받는다**(사용자 결정 2026-10-08). 실측: 2026-07-12 한 묶음의
    # 11편이 5.6초 동안 셀렉터 없는 페이지를 받아 ParsingFailed 가 됐고 그중 6편은 전날·다음 날 멀쩡했다 — 다시 받았으면 살았다.
    # 작품마다 쉬지 않고 묶음 끝에 모아 받는다 — 묶음의 경고창(삭제·비공개)이 절반이 넘어 편마다 쉬면 Lambda 제한을 넘는다.
    pending, reasons = [str(n).strip() for n in batch_items], {}
    for attempt in range(1, PAGE_ATTEMPTS + 1):
        last = attempt == PAGE_ATTEMPTS
        retry = []
        for novel_id in pending:
            outcome = _fetch_contest_novel(session, novel_id, crawl_date, raw_batch, execution_id)
            if isinstance(outcome, dict):
                if attempt > 1:
                    _log(logging.INFO, execution_id, "Recovered on retry.", novel_id=novel_id, attempt=attempt)
                _send_result(sqs_client, execution_id, novel_id, outcome)
                success_count += 1
            else:
                reasons[novel_id] = outcome
                retry.append(novel_id)
        # 다시 받을 시간이 없으면(Lambda 230초) 지금 결과로 끝낸다 — 묶음이 시간 초과되면 SQS 가 80편을 통째로 다시 보낸다.
        # 실측: 묶음 최장 82초(30일), 경고창이 절반이라 두 번 더 받아도 약 180초.
        out_of_time = context is not None and context.get_remaining_time_in_millis() < 60_000
        if not retry or last or out_of_time:
            for novel_id in retry:
                _log(logging.WARNING, execution_id, f"Still unusable after {attempt} attempts: {reasons[novel_id]}. Creating placeholder.",
                     novel_id=novel_id, out_of_time=out_of_time)
                _send_result(sqs_client, execution_id, novel_id, _create_placeholder_item(novel_id, crawl_date, reason=reasons[novel_id]))
                placeholder_count += 1
            break
        _log(logging.WARNING, execution_id, f"Retrying {len(retry)} unusable pages.", attempt=attempt, novel_ids=retry[:20])
        time.sleep(PAGE_RETRY_WAITS[attempt - 1])
        pending = retry

    _upload_raw_batch(execution_id, raw_batch, crawl_date, context)

    _log(logging.INFO, execution_id, f"Batch processing complete. Success: {success_count}, Placeholders: {placeholder_count}, Total: {len(batch_items)}.")
    return {"status": "SUCCESS", "processed_count": success_count + placeholder_count}
