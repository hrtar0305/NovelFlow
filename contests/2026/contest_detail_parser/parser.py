import boto3
import logging
import json
import os
import requests
import time
from datetime import datetime, timezone
from urllib.parse import urljoin
from bs4 import BeautifulSoup

import raw_store
import episode_history as eh
import extract
from app import raw_accept_until   # 같은 이미지에 든 날짜 함수(app.py) — 받기 마감 규칙을 한 곳에 둔다

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

    # Request & Parsing Configuration
    USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Safari/537.36"
    MAX_INTERNAL_RETRIES = 3 # Max retries for individual novel parsing
    # DMap 판: 묶음 하나에 쓸 시간. 자식이 EXPRESS(최대 5분)라 넘기면 받은 작품까지 통째로 버려진다. 넘으면 남은 작품을
    # `failed`(TimeBudget)로 돌려주고 Reconcile 이 다음 라운드에 다시 받는다. 예산 뒤에도 진행 중인 한 편(최악 약 95초)과
    # 원본 업로드가 ParseBatch 제한(280초) 안에 들어가도록 잡는다.
    DMAP_TIME_BUDGET_SECONDS = float(os.environ.get('DMAP_TIME_BUDGET_SECONDS', '170'))
    # 연재 기록(설계 docs/superpowers/specs/2026-10-05-episode-upload-history-design.md)
    EPISODE_HISTORY_TABLE = os.environ.get('EPISODE_HISTORY_TABLE', 'NovelFlowEpisodeHistory')
    
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

def _create_placeholder_item(novel_id, crawl_date, reason="N/A", crawled_at=None):
    """Creates a placeholder dictionary for a failed novel parse."""
    return {
        "Date": crawl_date, "ID": novel_id, "Title": f"N/A ({reason})", "CrawledAt": crawled_at or _now_iso(),
        "AuthorName": "N/A", "AuthorID": "0", "View": -1, "Like": -1, "Fav": -1, "Alr": -1,
        "Eps": -1, "Tags": [], "Synopsis": "",
        # 정상 행과 키를 맞춘다(DECISIONS 2026-08-24 차기 공모전 체크리스트).
        "IsAdult": False,
    }

# =====================================================================================
# LAMBDA HANDLER: Parse Contest Novel Details
# =====================================================================================
def _now_iso():
    """받은 시각(UTC). 같은 작품이 두 번 오면(Express 자식은 최소 1회 실행) 더 이른 쪽을 남기는 기준 — 자정에 가까운 값."""
    return datetime.now(timezone.utc).isoformat(timespec='milliseconds')


def _upload_raw_batch(execution_id, raw_batch, crawl_date, context):
    """이 배치가 받은 원본을 한 덩어리로 묶어 S3 에 올린다.

    키는 `{prefix}/{year}/{date}/{request_id}.jsonl.zst` 다. 묶음마다 객체가 하나씩
    생기므로 이름이 겹치면 안 되는데, Lambda 요청 ID 가 호출마다 유일하고 재시도
    시에도 새로 발급되므로 그대로 쓴다.

    실패해도 예외를 올리지 않는다 — 원본은 부가 기능이고, 여기서 raise 하면 묶음 전체가
    실패해 받은 작품까지 버려진다. 대신 `False` 를 돌려주고 호출부가 `raw_failed` 로 센다.
    """
    if not raw_batch or not Config.RAW_BUCKET:
        return True
    try:
        payloads = []
        for entry in raw_batch:
            novel_id, pages = entry[0], entry[1]
            meta = {"pipeline": "contest", "year": Config.CONTEST_YEAR}
            if len(entry) > 2 and entry[2]:
                meta["crawled_at"] = entry[2]   # 같은 작품이 두 묶음에 들어가면(Express 최소 1회) 이른 쪽을 고를 기준
            body, _ = raw_store.build_json_payload(novel_id, crawl_date, pages, meta=meta)
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
        return True
    except Exception as e:  # noqa: BLE001
        _log(logging.ERROR, execution_id, f"Failed to upload raw batch: {e}", exc_info=True)
        return False


class ReplayMissing(Exception):
    """원본 재계산 중 저장된 원본에 없는 요청 — 그때 받지 않았거나(옛 묶음의 회차 조회수 응답) 형식이 다르다.

    `requests.exceptions.RequestException` 이 아니다 — 실시간 경로의 '다시 받으면 된다'와 섞이지 않게.
    """


class _ReplayResponse:
    def __init__(self, page):
        self.status_code = int(page.get('status') or 200)
        self.text = page.get('html') or ''

    def raise_for_status(self):
        if self.status_code >= 400:
            raise requests.exceptions.HTTPError(f"saved response status {self.status_code}")

    def json(self):
        return json.loads(self.text)


def _request_key(method, url, params):
    """요청의 동일성 — 저장된 `params`(dict 또는 [키, 값] 목록)와 실시간 요청 인자를 같은 꼴로 맞춘다."""
    if isinstance(params, dict):
        norm = tuple(sorted((str(k), str(v)) for k, v in params.items()))
    elif params:
        norm = tuple((str(kv[0]), str(kv[1])) for kv in params)
    else:
        norm = ()
    return (str(method).upper(), url, norm)


class ReplaySession:
    """원본 묶음의 `pages` 를 요청 그대로 돌려주는 세션 — `requests.Session` 대신 `_parse_one` 에 넣는다.

    해석 코드(상세 필드·배지·잔류율의 페이지 넘김 판단)는 실시간 수집과 **같은 함수**를 지나므로, 같은 원본이면 같은 값이 나온다.
    해석이 그때와 다른 요청을 하면(저장된 원본에 없으면) `ReplayMissing`.
    """
    def __init__(self, pages):
        self.headers = {}
        self._pages = {}
        for p in pages or []:
            self._pages.setdefault(_request_key(p.get('method') or 'GET', p.get('url'), p.get('params')), p)

    def _replay(self, method, url, params):
        page = self._pages.get(_request_key(method, url, params))
        if page is None:
            raise ReplayMissing(f"{method} {url} not in saved pages")
        return _ReplayResponse(page)

    def get(self, url, params=None, **_kw):
        return self._replay('GET', url, params)

    def post(self, url, data=None, **_kw):
        return self._replay('POST', url, data)


def _parse_detail(html, novel_id, crawl_date, execution_id, crawled_at):
    """상세 페이지 HTML → (item, ok). 받기와 무관한 해석만 한다 — 실시간 수집과 원본 재계산이 같이 쓴다.

    경고창(삭제·비공개)이면 Inaccessible, 셀렉터가 깨진 페이지면 ParsingFailed placeholder 로 `ok=False`.
    """
    soup = BeautifulSoup(html, 'html.parser')

    if soup.select_one(Config.Selectors.ALERT_MODAL):
        _log(logging.WARNING, execution_id, "Novel is inaccessible. Creating placeholder.", novel_id=novel_id)
        return _create_placeholder_item(novel_id, crawl_date, reason="Inaccessible", crawled_at=crawled_at), False

    try:
        counter_line_a = soup.select(Config.Selectors.COUNTER_SPANS)
        info_count2 = soup.select(Config.Selectors.INFO_SPANS)
        tags_raw = [tag.get_text(strip=True) for tag in soup.select(Config.Selectors.TAGS)]
        spans = extract.badge_spans(soup)
        item = {
            "Date": crawl_date, "ID": novel_id, "CrawledAt": crawled_at,
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
        return _create_placeholder_item(novel_id, crawl_date, reason=f"ParsingFailed: {type(e).__name__}", crawled_at=crawled_at), False

    status = extract.serial_status(spans)
    if status:
        item["SerialStatus"] = status
    days = extract.info_value(soup, "연재")
    if days:
        item["SerialDays"] = days
    return item, True


def _attach_retention(item, session, novel_id, crawl_date, pages, execution_id):
    """잔류율: 회차 30 이상만 회차 목록을 받는다(유효 회차 30개 미만이면 어차피 값이 없다). `session` 이 받기를 맡는다."""
    if item["Eps"] < extract.RETENTION_MIN_EPS:
        return
    try:
        item.update(extract.retention_fields(
            session, novel_id, pages, lambda lv, msg: _log(lv, execution_id, msg, novel_id=novel_id),
            before=crawl_date[2:].replace('-', '.')))   # 기록 날짜 D 에 올린 회차는 뺀다(하루 오프셋, extract.py 머리말)
    except requests.exceptions.RequestException:
        raise   # 네트워크 오류는 호출부가 다시 받는다
    except ReplayMissing as e:
        # 원본 재계산에서 그때 남기지 않은 응답(2026-10-04 이전 묶음의 회차 조회수 응답 등) — 값 없음(-1). 다시 받지 않는다:
        # 지금 받으면 자정 값이 아니다(DECISIONS 2026-10-04 「하루의 값은 자정 값」).
        _log(logging.INFO, execution_id, f"Retention not reproducible from raw for {novel_id}: {e}", novel_id=novel_id)
        item.update(extract.RETENTION_DEFAULTS)
    except Exception as e:  # noqa: BLE001 — 부가 필드의 해석 오류로 묶음 전체(Lambda)를 죽이지 않는다. 값 없음(-1)으로 둔다
        _log(logging.WARNING, execution_id, f"Retention parse failed for {novel_id}: {e}", novel_id=novel_id, exc_info=True)
        item.update(extract.RETENTION_DEFAULTS)


def _parse_one(session, novel_id, crawl_date, execution_id, crawled_at=None):
    """한 편 → (item, pages, ok). 받기는 `session` 이 맡는다 — 실시간 수집이면 `requests.Session`(노벨피아),
    원본 재계산이면 `ReplaySession`(그날 자정에 저장한 원본). 해석은 `_parse_detail`·`_attach_retention` 하나라 두 경로가 같다.

    네트워크 오류는 올려서 호출부가 재시도하게 하고, 파싱 오류는 placeholder. `crawled_at` 을 주지 않으면 상세를 받은 시각(UTC).
    """
    pages = []
    novel_url = Config.NOVEL_URL_TEMPLATE.format(novel_id)
    response = session.get(novel_url, timeout=15)
    response.raise_for_status()
    pages.append({"kind": "detail", "url": novel_url, "method": "GET",
                  "status": response.status_code, "html": response.text})
    item, ok = _parse_detail(response.text, novel_id, crawl_date, execution_id, crawled_at or _now_iso())
    if ok:
        _attach_retention(item, session, novel_id, crawl_date, pages, execution_id)
    return item, pages, ok


_history_table_obj = None


def _history_table():
    global _history_table_obj
    if _history_table_obj is None:
        _history_table_obj = boto3.resource('dynamodb', region_name=Config.AWS_REGION).Table(Config.EPISODE_HISTORY_TABLE)
    return _history_table_obj


def _attach_history(session, novel_id, pages, crawled_at, write, execution_id, table=None, conflict=None, out_of_time=None, eps=None):
    """연재 기록 갱신 — 매일 전 작품의 최신순 목록을 마지막 확인일까지 본다(회차 수가 같아도: 삭제 후 재업로드는 고유 번호가 달라
    여기서 잡힌다). 잔류율이 이미 받은 최신순 쪽은 다시 받지 않고, 새로 받은 쪽은 `pages` 에 더해 원본 묶음에 들어간다.
    처음 본 시각 = 상세를 받은 시각(`crawled_at`, 재시도에도 같다). `write=False`(그림자 실행)면 쓰지 않고 셈만 돌려준다.
    반환: {new, gone, pages, complete}."""
    table = table or _history_table()
    seen_at = eh.stamp(crawled_at)
    at = datetime.fromisoformat(seen_at)
    prefetched = {int((p.get('params') or {}).get('page', 0)): (p['html'], at) for p in pages
                  if p.get('kind') == 'episode_list' and (p.get('params') or {}).get('sort') == 'UP'}
    old = table.get_item(Key={'NovelId': novel_id}).get('Item')
    if eps == 0 and not (old or {}).get('Episodes'):
        # 첫 회차 전(상세 회차 수 0, 기록에도 없음 — 하루 약 400편)은 목록을 받지 않는다. 첫 회차가 오르면 그날 처음부터 받는다.
        return {'new': 0, 'gone': 0, 'pages': 0, 'complete': bool((old or {}).get('Complete'))}

    def fetch(n):
        return extract._episode_list_html(session, novel_id, 'UP', n, pages), at

    def fetch_down(n):   # 다 받지 못한 기록을 오래된 쪽부터 채울 때
        return extract._episode_list_html(session, novel_id, 'DOWN', n, pages), at

    r = eh.collect(fetch, old, prefetched=prefetched, fetch_down=fetch_down, out_of_time=out_of_time)
    known = (old or {}).get('Episodes') or {}
    seen_ids = {e[0] for e in r['seen']}
    summary = {'new': sum(1 for e in r['seen'] if e[0] not in known and e[2]),
               'gone': sum(1 for k, v in known.items() if k not in seen_ids and v[2] is None and v[0] > (r['covered_from'] or '9999')),
               'pages': r['pages_fetched'], 'complete': r['complete']}
    if write:
        eh.update_record(table, novel_id, lambda cur: eh.merge(cur, r['seen'], seen_at, r['covered_from'], r['complete'], r['scheduled']),
                         conflict=conflict)
    return summary


def parse_dmap_batch(event, context):
    """Distributed Map(ItemBatcher) 한 묶음 — Step Functions 가 S3 ID 목록을 나눠 준다(SQS 판은 2026-10-04 에 걷어냈다).

    입력: {"Items": [novel_id, ...], "BatchInput": {"execution_id", "date"(기록 날짜), "raw": 원본 적재 여부}}
    이 Lambda 는 원본 재계산(`reprocess`)의 두 단계도 맡는다 — `action: reprocess_index` 면 `reprocess_index`,
    `BatchInput.reprocess` 면 `reparse_raw_batch`(같은 이미지·같은 해석 코드, 별도 Lambda 를 두지 않는다).
    출력: {"items": [...], "failed": [{"id", "error"}], "raw_failed": 원본을 못 올린 작품 수}
    — ResultWriter 가 S3 에 남기고 대조 단계(consolidate `reconcile`)가 읽는다.

    실패는 **묶음 안에 가둔다**: 네트워크 오류는 간격을 두고 다시 받고, 끝내 실패한 작품만 `failed` 로 돌려준다
    (묶음 전체를 실패시키면 받은 39편까지 버려진다). 대조 단계가 빠진 작품만 모아 다시 돌린다.
    경고창·파싱 오류는 다시 받아도 같으므로 placeholder 로 끝낸다.
    **시간 예산**(`DMAP_TIME_BUDGET_SECONDS`)을 넘기면 새 작품·새 시도를 시작하지 않고 남은 작품을 `failed`(TimeBudget)로
    돌려준다 — EXPRESS 자식 5분을 넘겨 받은 작품까지 버려지는 것보다, 받은 것은 남기고 나머지만 다음 라운드로 넘기는 편이 낫다.
    """
    if event.get('action') == 'reprocess_index':
        return reprocess_index(event, context)
    if (event.get('BatchInput') or {}).get('reprocess'):
        return reparse_raw_batch(event, context)
    started = time.monotonic()

    def over_budget():
        return time.monotonic() - started > Config.DMAP_TIME_BUDGET_SECONDS

    bi = event.get('BatchInput') or {}
    execution_id, crawl_date = bi.get('execution_id', 'N/A'), bi.get('date')
    ids = [str(x).strip() for x in event.get('Items') or []]
    session = requests.Session()
    session.headers.update({"User-Agent": Config.USER_AGENT})
    results, failed, raw_batch = [], [], []
    history = {'new': 0, 'gone': 0, 'pages': 0, 'errors': 0}
    # 재시도 경로 시험(그림자 실행 전용): 첫 라운드에서 번호 % N == 0 인 작품을 받지 않고 네트워크 실패로 돌려준다.
    inject = int(bi.get('inject_fail_mod') or 0) if bi.get('dry_run') and int(bi.get('round') or 0) == 0 else 0
    for novel_id in ids:
        item, last_error = None, None
        if inject and int(novel_id) % inject == 0:
            failed.append({"id": novel_id, "error": "injected"})
            continue
        if over_budget():
            failed.append({"id": novel_id, "error": "TimeBudget"})
            continue
        for attempt in range(Config.MAX_INTERNAL_RETRIES):
            if attempt and over_budget():
                last_error = f"TimeBudget (after {last_error})"
                break
            try:
                item, pages, _ok = _parse_one(session, novel_id, crawl_date, execution_id)
                if _ok:
                    try:
                        h = _attach_history(session, novel_id, pages, item.get("CrawledAt"), write=not bi.get('dry_run'), execution_id=execution_id,
                                            out_of_time=over_budget, eps=item.get("Eps"))
                        for k in ('new', 'gone', 'pages'):
                            history[k] += h[k]
                    except Exception as he:  # noqa: BLE001 — 기록은 다음 확인이 마지막 확인일부터 채운다. 작품 처리는 막지 않는다.
                        history['errors'] += 1
                        _log(logging.WARNING, execution_id, f"Episode history update failed for {novel_id}: {he}", novel_id=novel_id)
                raw_batch.append((novel_id, pages, item.get("CrawledAt")))
                break
            except requests.exceptions.RequestException as e:
                last_error = f"{type(e).__name__}: {str(e)[:160]}"
                _log(logging.WARNING, execution_id, f"Network error for {novel_id} (attempt {attempt + 1}): {e}", novel_id=novel_id)
                if attempt + 1 < Config.MAX_INTERNAL_RETRIES:
                    time.sleep(2 * (attempt + 1))   # 2초, 4초 — 순간적인 끊김을 넘긴다
        if item is None:
            failed.append({"id": novel_id, "error": last_error})
        else:
            results.append(item)
    # 그림자 실행(dry_run)은 원본을 올리지 않는다 — 받기 마감(자정 + 1시간)에서 면제라 며칠 뒤에 받은 값일 수 있고, 그 묶음이
    # `{date}/` 접두어에 섞이면 원본 재계산이 늦은 값을 그 날짜의 자정 값으로 적재한다(리뷰 2026-10-04). `raw: false` 를 빠뜨려도 막힌다.
    upload = bi.get('raw', True) and not bi.get('dry_run')
    raw_ok = _upload_raw_batch(execution_id, raw_batch, crawl_date, context) if upload else True
    _log(logging.INFO, execution_id, "DMap batch complete.", total=len(ids), ok=len(results), failed=len(failed), raw_ok=raw_ok,
         history=history,
         over_budget=sum(1 for f in failed if str(f.get("error") or "").startswith("TimeBudget")),
         seconds=round(time.monotonic() - started, 1))
    return {"items": results, "failed": failed, "raw_failed": 0 if raw_ok else len(raw_batch), "history": history}


# --- 원본 재계산(reprocess) ---------------------------------------------------------------
# 받기는 끝났는데 적재가 실패한 날을, 노벨피아에서 다시 받지 않고 그날 자정에 저장한 원본 묶음
# (`{RAW_PREFIX}/{year}/{date}/{request_id}.jsonl.zst`, raw_store.bundle)에서 다시 계산한다. 늦게 다시 받으면 그 시각의 값이
# 그 날짜 이름으로 적재되므로 막았고(DECISIONS 2026-10-04 「하루의 값은 자정 값」, 상태 머신 `StartAttempt`), 이 경로만 남긴다.
# 해석은 `_parse_one` 그대로 — `ReplaySession` 이 저장된 응답을 돌려줄 뿐이다.

class ReprocessNoRaw(Exception):
    """그 날짜의 원본 묶음이 없다 — 다시 계산할 재료가 없다(상태 머신이 재시도하지 않는다)."""


class ReprocessIncomplete(Exception):
    """원본이 그날의 일부뿐이다 — 읽을 수 없는 묶음이 있거나, 자정 기대 목록에 견줘 원본에 없는 작품이 상한을 넘는다.
    다시 계산하면 하루가 일부만 쓰이므로 쓰지 않는다(상태 머신이 재시도하지 않는다)."""


# 원본 재계산의 범위 검사 상한 — 자정 실행의 기대 목록 중 원본에 없는 작품이 이 비율을 넘으면 쓰지 않는다.
# 적재 단계의 결손 상한(consolidate `DMAP_MAX_MISSING_FRACTION`, 5%)과 같은 뜻·같은 값이다(이미지가 달라 따로 읽는다).
REPROCESS_MAX_MISSING_FRACTION = float(os.environ.get('DMAP_MAX_MISSING_FRACTION', '0.05'))


def _ts(value):
    """ISO 시각 → aware datetime. 모르면 None."""
    if not value:
        return None
    try:
        dt = datetime.fromisoformat(str(value).replace('Z', '+00:00'))
    except ValueError:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def _too_late(crawled_at, cutoff):
    """이 줄을 그 날짜의 자정 값으로 쓰기엔 늦게 받았나(`app.raw_accept_until`). 시각을 모르면 늦지 않은 것으로 본다 —
    줄의 crawled_at 이 없으면 묶음 객체의 LastModified 를 쓰므로(올린 시각 ≥ 받은 시각) 실제로는 늘 시각이 있다."""
    t = _ts(crawled_at)
    return t is not None and t > cutoff


def _midnight_reference(s3, state_bucket, date, execution_id):
    """그 날짜 자정 실행의 기대 목록 — 원본이 그날을 얼마나 덮는지 견줄 기준. (번호 집합, 출처 키) 또는 (None, None).

    `runs/{date}/{실행}/expected.json` 중 원본 재계산 실행(`reprocess-index.json` 이 있는 것)과 이 실행을 빼고 가장 먼저 쓰인 것
    — 자정 실행(또는 그 자동 재실행)이다. 자정 실행이 첫 대조 전에 실패했으면 없고, 그때는 그림자 실행의 목록이 남는다.
    """
    pre = f"runs/{date}/"
    files = {}
    for page in s3.get_paginator('list_objects_v2').paginate(Bucket=state_bucket, Prefix=pre):
        for o in page.get('Contents') or []:
            run, _, name = o['Key'][len(pre):].partition('/')
            files.setdefault(run, {})[name] = o
    cands = [(f['expected.json'].get('LastModified'), run) for run, f in files.items()
             if run != execution_id and 'expected.json' in f and 'reprocess-index.json' not in f]
    if not cands:
        return None, None
    _, run = min(cands, key=lambda x: str(x[0]))
    key = f"{pre}{run}/expected.json"
    return {str(x) for x in json.loads(s3.get_object(Bucket=state_bucket, Key=key)['Body'].read())}, key


def _raw_prefix(date):
    return f"{Config.RAW_PREFIX}/{Config.CONTEST_YEAR}/{date}/"


def _bundle_lines(s3, bucket, key):
    """원본 묶음 하나 → JSON 줄(bytes) 목록. `raw_store.bundle` 의 역(zstd 해제 → 줄 나누기)."""
    import zstandard as zstd
    blob = s3.get_object(Bucket=bucket, Key=key)['Body'].read()
    data = zstd.ZstdDecompressor().decompressobj().decompress(blob)
    return [ln for ln in data.split(b'\n') if ln.strip()]


def _iso_utc(value):
    """묶음 객체의 LastModified(ItemReader: 에포크 초 또는 ISO 문자열, boto3: datetime) → 파서의 CrawledAt 꼴. 모르면 None."""
    if value is None or value == '':
        return None
    try:
        if isinstance(value, datetime):
            dt = value
        elif isinstance(value, (int, float)) or str(value).replace('.', '', 1).isdigit():
            dt = datetime.fromtimestamp(float(value), tz=timezone.utc)
        else:
            dt = datetime.fromisoformat(str(value).replace('Z', '+00:00'))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc).isoformat(timespec='milliseconds')
    except (TypeError, ValueError, OverflowError):
        return None


def _earlier(a, b):
    """CrawledAt 둘 중 이른 쪽(None 은 가장 늦은 것으로 — `_dedupe_prefer_real` 와 같은 순서)."""
    return min(a, b, key=lambda x: x or '~')


def reprocess_index(event, context=None):
    """원본 재계산의 기대 목록 — 그 날짜 원본 묶음에 든 작품 번호 전부(오늘의 ID 목록이 아니다).

    입력: {"action": "reprocess_index", "date", "execution_id", "state_bucket", "dry_run", "accept_partial"}
    `runs/{date}/{execution}/reprocess-index.json`(상태 버킷)에 {ids: {번호: 가장 이른 crawled_at}, bundles, unreadable} 을 쓰고,
    Map 의 ItemReader 가 목록을 뽑을 위치(bucket·prefix)를 돌려준다. 묶음 안 crawled_at 이 없으면(옛 묶음) 객체 LastModified.

    쓰지 않고 실패하는 경우(`ReprocessIncomplete`, dry_run 이면 보고만 — `accept_partial` 이면 범위 검사만 건너뛴다):
    - 읽을 수 없는 묶음이 있다 — 그 안의 작품을 몰라 하루가 일부만 다시 쓰인다.
    - 자정 실행의 기대 목록(`_midnight_reference`) 중 원본에 없는 작품이 상한(5%)을 넘거나, 견줄 기대 목록이 없다. 기대 목록이
      원본 자체라서, 받기가 중간에 끊긴 날(ParseMap 도중 실패, 두 시도 모두 실패)을 다시 계산하면 결손 0 으로 보여 적재 단계의
      결손 상한을 지나 반쪽 하루가 '완전한 날'로 수집일 집합에 오른다(리뷰 2026-10-04) — 그 다음 수집일의 일간 순위에서 빠진
      작품들이 통째로 사라진다.
    `app.raw_accept_until(date)`(D+1 02:45 KST)보다 늦게 받은 줄은 버린다 — 자정 값이 아니다(`late_lines` 로 센다).
    """
    execution_id, date = event.get('execution_id', 'N/A'), event['date']
    state_bucket = event.get('state_bucket') or os.environ.get('STATE_BUCKET')
    if not Config.RAW_BUCKET or not state_bucket:
        raise ValueError("RAW_HTML_BUCKET env and state_bucket are required for reprocess.")
    s3 = boto3.client('s3', region_name=Config.AWS_REGION)
    prefix = _raw_prefix(date)
    objects = []
    for page in s3.get_paginator('list_objects_v2').paginate(Bucket=Config.RAW_BUCKET, Prefix=prefix):
        objects += [o for o in page.get('Contents') or [] if o['Key'].endswith('.jsonl.zst')]
    if not objects:
        raise ReprocessNoRaw(f"{date} 의 원본 묶음이 없습니다(s3://{Config.RAW_BUCKET}/{prefix}) — 다시 계산할 재료가 없습니다.")
    cutoff = raw_accept_until(date)
    ids, unreadable, other_date, late_lines = {}, [], 0, 0
    for o in objects:
        fallback = _iso_utc(o.get('LastModified'))
        try:
            lines = _bundle_lines(s3, Config.RAW_BUCKET, o['Key'])
            for ln in lines:
                rec = json.loads(ln)
                if rec.get('date') != date:
                    other_date += 1
                    continue
                nid = str(rec['novel_id']).strip()
                ca = rec.get('crawled_at') or fallback
                if _too_late(ca, cutoff):
                    late_lines += 1
                    continue
                ids[nid] = _earlier(ids[nid], ca) if nid in ids else ca
        except Exception as e:  # noqa: BLE001
            _log(logging.ERROR, execution_id, f"Unreadable raw bundle {o['Key']}: {e}", exc_info=True)
            unreadable.append(o['Key'])
    ref, ref_key = _midnight_reference(s3, state_bucket, date, execution_id)
    not_in_raw = sorted(ref - set(ids)) if ref is not None else None
    out = {"bucket": Config.RAW_BUCKET, "prefix": prefix, "bundles": len(objects), "novels": len(ids),
           "unreadable": len(unreadable), "other_date_lines": other_date, "late_lines": late_lines,
           "reference": ref_key, "reference_novels": len(ref) if ref is not None else None,
           "not_in_raw": len(not_in_raw) if not_in_raw is not None else None}
    _log(logging.INFO, execution_id, "Reprocess index built.", date=date, not_in_raw_sample=(not_in_raw or [])[:10], **out)
    dry_run, accept_partial = bool(event.get('dry_run')), bool(event.get('accept_partial'))
    if unreadable and not dry_run:
        raise ReprocessIncomplete(f"{date} 원본 묶음 {len(unreadable)}개를 읽을 수 없어 쓰지 않습니다 — 그 안의 작품을 몰라 하루가 "
                                  f"일부만 다시 쓰입니다. 묶음: {unreadable[:5]}")
    if not dry_run and not accept_partial:
        if ref is None:
            raise ReprocessIncomplete(
                f"{date} 자정 실행의 기대 목록(runs/{date}/*/expected.json)이 없어 원본이 그날을 다 덮는지 알 수 없습니다 — 자정 "
                f"실행이 첫 받기 라운드도 끝내지 못했다면 원본은 일부뿐입니다. 원본 {len(ids)}편으로 확인했으면 \"accept_partial\": true.")
        if len(not_in_raw) > REPROCESS_MAX_MISSING_FRACTION * len(ref):
            raise ReprocessIncomplete(
                f"{date} 원본이 그날의 일부뿐입니다: 자정 기대 목록 {len(ref)}편 중 {len(not_in_raw)}편이 원본에 없습니다(상한 "
                f"{REPROCESS_MAX_MISSING_FRACTION:.0%}) — 받기가 중간에 끊긴 날입니다. 다시 계산하면 반쪽 하루가 완전한 날로 "
                f"적재됩니다. 그날은 비워 두세요. 예: {not_in_raw[:5]}")
    key = f"runs/{date}/{execution_id}/reprocess-index.json"
    s3.put_object(Bucket=state_bucket, Key=key, ContentType='application/json',
                  Body=json.dumps({"ids": ids, "bundles": len(objects), "unreadable": unreadable}, ensure_ascii=False).encode())
    return {**out, "index_key": key}


def reparse_raw_batch(event, context=None):
    """원본 재계산 Map 의 한 묶음 — Items 는 ItemReader(S3 ListObjectsV2)가 준 원본 묶음 객체들({Key, LastModified, …}).

    묶음 안의 작품마다 저장된 `pages` 로 `_parse_one` 을 그대로 돌린다(받기만 `ReplaySession`). CrawledAt 은 묶음의
    `crawled_at`(없으면 객체 LastModified, 그것도 없으면 싣지 않는다). 같은 작품이 여러 묶음에 있으면 대조 단계가
    `_dedupe_prefer_real`(실데이터 우선 → 이른 CrawledAt)로 고른다. 출력 모양은 `parse_dmap_batch` 와 같다.
    `reprocess_index` 와 같은 규칙으로 늦게 받은 줄(`app.raw_accept_until`)은 버린다 — 두 단계의 작품 집합이 같아야 한다.
    묶음을 못 읽으면(S3 오류) 예외로 이 자식을 실패시킨다 — 상태 머신이 다시 부르고, 끝내 실패하면 대조 단계가 시도를 실패시킨다.
    """
    started = time.monotonic()
    bi = event.get('BatchInput') or {}
    execution_id, crawl_date = bi.get('execution_id', 'N/A'), bi.get('date')
    s3 = boto3.client('s3', region_name=Config.AWS_REGION)
    cutoff = raw_accept_until(crawl_date)
    results, failed, bundles, late_lines = [], [], 0, 0
    for obj in event.get('Items') or []:
        key = obj.get('Key') if isinstance(obj, dict) else str(obj)
        if not key or not key.endswith('.jsonl.zst'):
            continue
        fallback = _iso_utc(obj.get('LastModified')) if isinstance(obj, dict) else None
        lines = _bundle_lines(s3, Config.RAW_BUCKET, key)   # 못 읽으면 자식 실패 → 재시도, 끝내 실패하면 대조가 시도를 실패시킨다
        bundles += 1
        for ln in lines:
            rec = json.loads(ln)
            if rec.get('date') != crawl_date:
                continue
            novel_id = str(rec['novel_id']).strip()
            crawled_at = rec.get('crawled_at') or fallback
            if _too_late(crawled_at, cutoff):
                late_lines += 1
                continue
            try:
                item, _pages, _ok = _parse_one(ReplaySession(rec.get('pages')), novel_id, crawl_date, execution_id,
                                               crawled_at=crawled_at or 'unknown')
            except Exception as e:  # noqa: BLE001 — 저장된 상세가 없거나 오류 응답: 그 작품만 빠진 것으로(대조 → placeholder)
                failed.append({"id": novel_id, "error": f"Reparse {type(e).__name__}: {str(e)[:160]}"})
                continue
            if not crawled_at:
                item.pop('CrawledAt', None)
            results.append(item)
    _log(logging.INFO, execution_id, "Reparse batch complete.", bundles=bundles, ok=len(results), failed=len(failed),
         late_lines=late_lines, seconds=round(time.monotonic() - started, 1))
    return {"items": results, "failed": failed, "raw_failed": 0}
