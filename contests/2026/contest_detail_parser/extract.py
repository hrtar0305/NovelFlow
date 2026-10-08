"""2026 공모전 파서의 추출 규칙 — 데일리 크롤러(`crawler/app.py`)와 **같은 규칙**이어야 한다.

크롤러 이미지와 따로 빌드되므로 함수를 복사해 둔다(`raw_store.py` 와 같은 사정). 크롤러 쪽 규칙을
바꾸면 여기도 맞출 것. 해석(완결·순위 숫자 등)은 하지 않고 원문을 싣는다 — 판정은 백엔드가 한다.
"""
import json
import logging
import re

NOVEL_URL_TEMPLATE = "https://novelpia.com/novel/{}"
EPISODE_LIST_URL = "https://novelpia.com/proc/episode_list"
NOVEL_PROC_URL = "https://novelpia.com/proc/novel"

EPISODE_INFO_DIV = "div.ep_style2"
EPISODE_UPLOAD_DATE = "b"
EPISODE_NUMBER = "span:first-child"
EPISODE_VIEW_COUNT_SPAN = "span.episode_count_view"

# 잔류율을 계산하려고 회차 목록을 받는 기준(상세의 '회차' 수). 유효 회차가 30개 이상이어야 값이 나오므로
# 그 아래는 받아도 쓸 데가 없다(유효 회차 ⊂ 전체 회차). 요청은 작품당 최대 8번이라 공모전 전수에 걸면 부담이 크다.
#
# **유효 회차는 데일리와 한 군데 다르다 — 하루 오프셋**(DECISIONS 2026-10-03). 노벨피아는 **그날(달력) 올린 회차만**
# 'N시간 전'으로 보이고 전날 것부터 날짜를 찍는다. 데일리는 21시에 모아 '그날 올린 회차'가 저절로 빠지지만(최신화가 최소
# 21시간 지난 회차), 공모전은 자정 직후에 모아 방금 끝난 날 23:59 에 올린 회차까지 날짜로 들어온다. 그래서 공모전은
# **날짜가 기록 날짜 D 보다 이른 회차만** 유효로 친다(`before`) — 최신화가 늘 24시간 이상 지난 회차가 된다.
RETENTION_MIN_EPS = 30
# 잔류율 원재료 8개의 '값 없음'. 받다가 해석 오류가 나도 이 값으로 둔다(파서 `_parse_one`).
RETENTION_DEFAULTS = {"FirstEpView": -1, "FirstEpNum": -1, "Ep30View": -1, "Ep30Num": -1,
                      "RecentBaseView": -1, "RecentBaseNum": -1, "TargetLatestEpView": -1, "TargetLatestEpNum": -1}


def badge_spans(soup):
    """`p.in-badge` 안의 span 을 하나도 빼지 않고 기록한다(crawler `_extract_badge_spans`)."""
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


def serial_status(spans):
    """`b_*` class 가 없고 텍스트가 있는 배지의 텍스트(연재중단·연재지연 …). 없으면 None — 필드를 싣지 않는다."""
    if spans is None:
        return None
    for sp in spans:
        if not sp["class"] and sp["text"]:
            return sp["text"]
    return None


def info_value(soup, label):
    """작품 정보 영역의 `span.category-title` 이 `label` 인 칸의 값 원문(인생픽 '9위'/'공개전', 연재 '월/화'/'비정기')."""
    root = soup.select_one("div.epnew-novel-info")
    if root is None:
        return None
    for t in root.select("span.category-title"):
        if t.get_text(strip=True) == label:
            v = t.find_next_sibling("span")
            return (v.get_text(strip=True) or None) if v else None
    return None


def _episode_list_html(session, novel_id, sort_order, page, pages):
    payload = {"novel_no": novel_id, "sort": sort_order, "page": page}
    headers = {"Referer": NOVEL_URL_TEMPLATE.format(novel_id), "X-Requested-With": "XMLHttpRequest"}
    r = session.post(EPISODE_LIST_URL, data=payload, headers=headers, timeout=10)
    r.raise_for_status()
    pages.append({"kind": "episode_list", "url": EPISODE_LIST_URL, "method": "POST",
                  "params": payload, "status": r.status_code, "html": r.text})
    return r.text


def _valid_episodes(soup, before=None):
    """(ep_id, ep_num) — EP.숫자 + YY.MM.DD 날짜 + 조회수 span 이 있는 회차만(crawler `_parse_valid_episodes`).

    `before`('YY.MM.DD')를 주면 그 날짜보다 이른 회차만 남긴다(공모전 하루 오프셋). YY.MM.DD 는 같은 세기 안에서
    문자열 순서가 곧 날짜 순서다.
    """
    result = []
    for ep_div in soup.select(EPISODE_INFO_DIV):
        num_el = ep_div.select_one(EPISODE_NUMBER)
        date_el = ep_div.select_one(EPISODE_UPLOAD_DATE)
        date_txt = date_el.get_text(strip=True) if date_el else ''
        if (num_el and date_el and re.match(r"^EP\.\s*\d+$", num_el.get_text(strip=True))
                and re.match(r"^\d{2}\.\d{2}\.\d{2}$", date_txt) and (before is None or date_txt < before)):
            span = ep_div.select_one(EPISODE_VIEW_COUNT_SPAN)
            if span:
                m = re.search(r'novel_count_view_(\d+)', ' '.join(span.get('class', [])))
                if m:
                    result.append((m.group(1), int(re.search(r'\d+', num_el.get_text(strip=True)).group())))
    return result


def _episode_view_counts(session, novel_id, episode_ids, log, pages=None):
    if not episode_ids:
        return {}
    payload = [("novel_no", novel_id), ("cmd", "get_episode_count_view")]
    for eid in episode_ids:
        payload.append(("episode_arr[]", f"episode_count_view novel_count_view_{eid}"))
    headers = {"Referer": NOVEL_URL_TEMPLATE.format(novel_id), "X-Requested-With": "XMLHttpRequest"}
    r = session.post(NOVEL_PROC_URL, data=payload, headers=headers, timeout=10)
    r.raise_for_status()
    # 응답(JSON)도 원본으로 남긴다(2026-10-04~) — 원본 재계산(`parser.reparse_raw_batch`)이 잔류율까지 다시 낼 수 있게.
    # 그 전 묶음에는 이 페이지가 없어 재계산하면 잔류율 8개가 -1(값 없음)이 된다. 크롤러(`crawler/app.py`)는 아직 남기지 않는다.
    if pages is not None:
        pages.append({"kind": "episode_view_counts", "url": NOVEL_PROC_URL, "method": "POST",
                      "params": [list(kv) for kv in payload], "status": r.status_code, "html": r.text})
    if not r.text.strip():
        return {}
    try:
        return {it['episode_no']: int(it['count_view'].replace(',', '')) for it in r.json().get('list', [])}
    # TypeError·AttributeError: `list` 가 null·응답이 배열·`count_view` 가 숫자처럼 모양이 다른 응답
    except (json.JSONDecodeError, ValueError, KeyError, TypeError, AttributeError) as e:
        log(logging.WARNING, f"Failed to parse /proc/novel response: {e}")
        return {}


def retention_fields(session, novel_id, pages, log, before=None):
    """잔류율 원재료 8개(crawler 와 같은 이름·규칙 — 유효 회차만 `before` 로 하루 앞당긴다). 받은 회차 목록과 회차 조회수 응답은
    `pages` 에 원본으로 담긴다. `session` 은 실시간이면 requests.Session, 원본 재계산이면 저장된 응답을 돌려주는 재생 세션이다.

    초기 30 유효 회차(오래된 순, 최대 2쪽)와 최근 30 유효 회차(최신순, 최대 5쪽)를 모아
    1화·30화·최신화·최신 30번째 전 회차의 조회수를 한 번에 받는다. 값을 못 얻으면 -1.
    목록에서 한 화도 못 읽었거나(`early_empty`·`recent_empty`) 회차 조회수가 빠졌으면(`views`) `RetentionFetchError` 에 적는다
    — 크롤러와 같은 규칙. 호출부가 다시 받을지 정한다(DECISIONS 2026-10-08).
    """
    from bs4 import BeautifulSoup
    item = dict(RETENTION_DEFAULTS)

    rows = {}   # 목록에 회차 줄이 하나라도 있었나 — `before` 로 다 걸러져 빈 것(기록 날짜에 30화 넘게 올림)은 결손이 아니다

    def collect(sort_order, max_pages):
        eps, seen = [], set()
        for page in range(max_pages):
            soup = BeautifulSoup(_episode_list_html(session, novel_id, sort_order, page, pages), 'html.parser')
            if not soup.select(EPISODE_INFO_DIV):
                break
            rows[sort_order] = True
            parsed = _valid_episodes(soup, before)
            ids = {e[0] for e in parsed}
            if ids and ids.issubset(seen):
                break  # 마지막 페이지가 반복 반환됨
            for e in parsed:
                if e[0] not in seen:
                    eps.append(e)
                    seen.add(e[0])
            if len(eps) >= 30:
                break
        return eps

    early = collect('DOWN', 2)
    recent = collect('UP', 5)
    first_id = early[0][0] if early else None
    ep30_id = early[29][0] if len(early) >= 30 else None
    latest_id = recent[0][0] if recent else None
    base_id = recent[29][0] if len(recent) >= 30 else None
    errors = [k for k, eps, sort in (("early_empty", early, 'DOWN'), ("recent_empty", recent, 'UP')) if not eps and not rows.get(sort)]
    if errors:
        item["RetentionFetchError"] = errors
    if not first_id:
        return item
    ids = list(dict.fromkeys(e for e in [first_id, ep30_id, base_id, latest_id] if e))
    vc = _episode_view_counts(session, novel_id, ids, log, pages)
    if any(int(e) not in vc for e in ids):
        item["RetentionFetchError"] = errors + ["views"]
    if int(first_id) in vc:
        item["FirstEpView"], item["FirstEpNum"] = vc[int(first_id)], early[0][1]
    if latest_id and latest_id != first_id and int(latest_id) in vc:
        item["TargetLatestEpView"], item["TargetLatestEpNum"] = vc[int(latest_id)], recent[0][1]
    if ep30_id and int(ep30_id) in vc:
        item["Ep30View"], item["Ep30Num"] = vc[int(ep30_id)], early[29][1]
    if base_id and int(base_id) in vc:
        item["RecentBaseView"], item["RecentBaseNum"] = vc[int(base_id)], recent[29][1]
    return item
