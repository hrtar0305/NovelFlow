"""작품별 연재 기록 — 노벨피아 회차 목록 해석·병합·날짜별 화 수(설계 docs/superpowers/specs/2026-10-05-episode-upload-history-design.md).
해석·병합·창 계산은 순수 함수다. 저장(`update_record`)만 넘겨받은 테이블 객체를 쓴다. crawler/ 가 원본이고 contests/2026/contest_detail_parser/·webapp/backend/api/ 에 같은 파일을 둔다
(이미지·배포가 따로라 — scripts/check_copies.sh 로 확인).
"""
import re
from datetime import date, datetime, timedelta

KST_OFFSET = timedelta(hours=9)


def stamp(dt):
    """시각 → 'YYYY-MM-DDTHH:MM:SS+09:00'(KST, 초 단위). 처음 본 시각·마지막 확인·마감은 모두 이 꼴로 둔다 — 문자열 비교로 앞뒤를 가린다."""
    from datetime import timezone
    if isinstance(dt, str):
        dt = datetime.fromisoformat(dt.replace('Z', '+00:00'))
    return dt.astimezone(timezone(KST_OFFSET)).replace(microsecond=0).isoformat()


_REL = re.compile(r'(\d+)\s*(초|분|시간)\s*전')
_DATE = re.compile(r'^(\d{2})\.(\d{2})\.(\d{2})$')


def to_date(text, fetched_at):
    """목록 날짜 원문 → 'YYYY-MM-DD'. 'YY.MM.DD' 또는 그날 올린 회차의 'N초전·N분전·N시간전'(받은 시각 KST 에서 뺀다)."""
    t = (text or '').strip()
    m = _DATE.match(t)
    if m:
        return f'20{m[1]}-{m[2]}-{m[3]}'
    m = _REL.search(t)
    if m:
        n, unit = int(m[1]), m[2]
        return (fetched_at - {'초': timedelta(seconds=n), '분': timedelta(minutes=n), '시간': timedelta(hours=n)}[unit]).date().isoformat()
    return None


def parse_page(html, fetched_at):
    """회차 목록 한 쪽 → (회차들 [고유번호, 'EP.N'·'BONUS', 날짜, 원문], 예약 [고유번호, 제목, 원문, 받은 시각], 칸 수).
    회차 키는 고유 번호(`novel_count_view_N`) — 'EP.N' 은 순서라 삭제 때 당겨진다. 예약은 따로 된 줄(`tr.ep_style5`)."""
    from bs4 import BeautifulSoup
    soup = BeautifulSoup(html or '', 'html.parser')
    eps, scheduled = [], []
    for tr in soup.select('tr.ep_style5'):
        text = re.sub(r'\s+', ' ', tr.get_text(' ', strip=True))
        if '공개예정' not in text:
            continue
        m = re.search(r'/viewer/(\d+)', str(tr))
        title, when = tr.select_one('td.font12'), tr.select_one('td.ep_style3')
        scheduled.append([m.group(1) if m else None, re.sub(r'\s+', ' ', title.get_text(' ', strip=True))[:80] if title else None,
                          re.sub(r'\s+', ' ', when.get_text(' ', strip=True)) if when else text[:80], fetched_at.isoformat()])
    divs = soup.select('div.ep_style2')
    for d in divs:
        sp = d.select_one('span.episode_count_view')
        m = re.search(r'novel_count_view_(\d+)', ' '.join(sp.get('class', []))) if sp else None
        if not m:
            continue
        num, b = d.select_one('span:first-child'), d.select_one('b')
        raw = b.get_text(strip=True) if b else ''
        eps.append([m.group(1), num.get_text(strip=True) if num else None, to_date(raw, fetched_at), raw])
    return eps, scheduled, len(divs)


def is_last_page(new_count, labels, slots):
    """최신순으로 넘길 때 이 쪽이 끝인가. 새 고유 번호가 없으면(마지막 쪽을 넘기면 같은 쪽이 다시 온다) 끝.
    가장 오래된 공개 회차는 늘 EP.0 이나 EP.1 이다 — 다만 EP.1 이 꽉 찬 쪽(20칸) 맨 끝이면 EP.0 이 다음 쪽에 있을 수 있다.
    칸 수로는 판정하지 않는다(삭제가 있던 작품은 첫 쪽이 20칸보다 적다 — 378108)."""
    if new_count == 0 or 'EP.0' in labels:
        return True
    return 'EP.1' in labels and not (labels[-1] == 'EP.1' and slots >= 20)


def merge(history, seen, fetched_at_iso, covered_from, complete, scheduled):
    """기록에 이번에 본 회차를 더한다. 새 고유 번호는 [날짜, 이번 시각, None]. 이번에 받은 범위 — 날짜가 `covered_from` 보다
    **뒤**인 회차(그 날짜 자체는 받지 않은 다음 쪽에 더 있을 수 있다; 끝까지 받았으면 '0000-01-01') — 안에 있어야 하는데 없는 기존
    회차는 사라진 시각만 적는다(지우지 않는다 — 지워진 회차의 업로드 날도 연재로 센다). 다시 보이면 푼다."""
    h = dict(history or {})
    eps = {k: list(v) for k, v in (h.get('Episodes') or {}).items()}
    seen_ids = set()
    for eid, _label, d, _raw in seen:
        seen_ids.add(eid)
        if d is None:
            continue
        if eid in eps:
            eps[eid][2] = None
        else:
            eps[eid] = [d, fetched_at_iso, None]
    for eid, v in eps.items():
        if eid not in seen_ids and v[2] is None and covered_from and v[0] > covered_from:
            v[2] = fetched_at_iso
    dates = [v[0] for v in eps.values()]
    h.update({'Episodes': eps, 'CheckedAt': fetched_at_iso, 'CheckedCount': len(seen_ids),
              'Complete': bool(complete or h.get('Complete')),
              'OldestDate': min(dates) if dates else h.get('OldestDate'),
              'Scheduled': (h.get('Scheduled') or [])[-50:] + list(scheduled),
              'Version': int(h.get('Version') or 0) + 1})
    return h


# 백필한 날. 처음 본 시각이 없는(None) 회차는 이날 백필에서 왔고, 그 전 날짜는 하루 전체를 다 봤다.
BACKFILL_DATE = '2026-10-05'


def day_counts(history, start, end, cutoff_iso=None):
    """[start, end] 날짜별 올린 화 수. `cutoff_iso` 를 주면 처음 본 시각이 그 뒤인 회차는 뺀다(행 펼침 고정값 — 백필(None)은 날짜만 본다).
    값 None = 모름: 마지막 확인일 뒤, 또는 다 받지 못한 기록(`Complete=false`)의 가장 오래된 날짜 앞, 또는 **본 시각(마감 또는 마지막 확인)이
    든 날에 아직 아무것도 안 보였을 때** — 그날은 다 지나지 않았다(데일리는 21시쯤 본다: 23시에 올리는 작가의 그날이 '쉰 날'이 되면 안 된다).
    백필 전 날짜(`BACKFILL_DATE` 앞)는 하루 전체를 봤으므로 이 규칙을 쓰지 않는다."""
    eps = (history or {}).get('Episodes') or {}
    checked = (history or {}).get('CheckedAt')
    known_until = checked[:10] if checked else None
    known_from = None if (history or {}).get('Complete') else (history or {}).get('OldestDate')
    counts = {}
    for d, first_seen, _gone in eps.values():
        if cutoff_iso and first_seen and first_seen > cutoff_iso:
            continue
        counts[d] = counts.get(d, 0) + 1
    seen_at = min(t for t in (cutoff_iso, checked) if t) if (cutoff_iso or checked) else None
    open_day = seen_at[:10] if seen_at else None
    out, cur, last = {}, date.fromisoformat(start), date.fromisoformat(end)
    while cur <= last:
        k = cur.isoformat()
        unknown = (known_until is None or k > known_until) or (known_from is not None and k < known_from) \
            or (k == open_day and k >= BACKFILL_DATE and not counts.get(k))
        out[k] = None if unknown else counts.get(k, 0)
        cur += timedelta(days=1)
    return {'days': out, 'known_from': known_from, 'known_until': known_until}


FULL = '0000-01-01'   # 끝까지 받았다는 표시(collect 의 covered_from)


class OutOfTime(Exception):
    """시간 예산을 넘겼다(`collect` 의 `out_of_time`). 기록이 있는 작품은 쓰지 않는다 — 다음 확인이 마지막 확인일부터 다시 받는다."""


def collect(fetch, history, prefetched=None, max_pages=120, fetch_down=None, out_of_time=None):
    """최신순 0쪽부터 받는다. `fetch(page) -> (html, fetched_at)`, `prefetched` = 이미 받은 쪽 {page: (html, fetched_at)}(잔류율이
    받은 최신순 쪽을 다시 받지 않게). 멈춤: 끝(`is_last_page`), 또는 기록이 있고 그 쪽 가장 오래된 날짜가 마지막 확인 날짜 **앞**
    (같은 날이면 아직 아니다 — 확인 뒤 그날 올린 회차가 다음 쪽에 더 있을 수 있다), 또는 `max_pages`(처음 보는 긴 작품 — 다 받지 못하면
    `complete=False`). 다 받지 못한 기록(`Complete=false`)은 이어서 `fetch_down`(오래된 순)으로 아는 회차를 만날 때까지 받아 채운다
    (`max_pages` 안에 못 만나면 버린다 — 가운데가 빈 채 '다 앎'이 되지 않게). `out_of_time()` 이 참이면 더 받지 않는다: 처음 보는 작품은
    받은 데까지(`complete=False`), 기록이 있으면 `OutOfTime`.
    반환: seen(회차들), scheduled, covered_from(최신순으로 받은 가장 오래된 날짜, 끝까지면 FULL), complete, pages_fetched(새로 받은 쪽 수),
    fetched_at(첫 쪽을 받은 시각)."""
    prefetched = prefetched or {}
    if history and not history.get('Episodes'):
        # 목록이 비어 있던 기록(삭제·비공개였거나 첫 회차 전)은 처음 보듯 끝까지 받는다 — 마지막 확인일에서 멈추면 다시 열린 작품을
        # 첫 쪽만 받고 '다 받음'이 되어 그 앞 날짜가 전부 쉰 날이 된다.
        history = None
    checked = (history or {}).get('CheckedAt')
    checked_date = checked[:10] if checked else None
    seen, ids, scheduled, oldest, fetched, first_at = [], set(), [], None, 0, None
    reached_end = False

    def get(f, n):
        nonlocal fetched
        if out_of_time and out_of_time():
            raise OutOfTime()
        fetched += 1
        return f(n)

    for n in range(max_pages):
        if n in prefetched:
            html, at = prefetched[n]
        else:
            try:
                html, at = get(fetch, n)
            except OutOfTime:
                if history:
                    raise
                break
        first_at = first_at or at
        got, sch, slots = parse_page(html, at)
        if n == 0:
            scheduled = sch
        new = [e for e in got if e[0] not in ids]
        for e in new:
            ids.add(e[0])
            seen.append(e)
        dates = [e[2] for e in got if e[2]]
        if dates:
            oldest = min(dates) if oldest is None else min(oldest, min(dates))
        if is_last_page(len(new), [e[1] for e in got], slots):
            reached_end = True
            break
        if checked_date and dates and min(dates) < checked_date:
            break
    if reached_end:
        return {'seen': seen, 'scheduled': scheduled, 'covered_from': FULL, 'complete': True, 'pages_fetched': fetched, 'fetched_at': first_at}
    stopped_at_known = bool(checked_date and oldest and oldest < checked_date)
    complete = bool(stopped_at_known and (history or {}).get('Complete'))
    if stopped_at_known and not complete and fetch_down:
        known, down = set((history or {}).get('Episodes') or {}), []
        for n in range(max_pages):
            html, at = get(fetch_down, n)
            got, _, _ = parse_page(html, at)
            new = [e for e in got if e[0] not in ids]
            for e in new:
                ids.add(e[0])
                down.append(e)
            if not new or any(e[0] in known for e in got):
                seen += down
                complete = True
                break
    return {'seen': seen, 'scheduled': scheduled, 'covered_from': oldest,
            'complete': complete, 'pages_fetched': fetched, 'fetched_at': first_at}


def update_record(table, novel_id, fn, conflict=None, attempts=2):
    """기록을 읽어 `fn(old) -> new` 로 고쳐 쓴다. 낙관적 잠금(`Version`): 그 사이 다른 곳이 고쳤으면 다시 읽어 한 번 더.
    `table` 은 boto3 DynamoDB Table(또는 같은 모양). `conflict` 는 조건 실패 예외 클래스(기본: botocore ConditionalCheckFailed)."""
    if conflict is None:
        conflict = table.meta.client.exceptions.ConditionalCheckFailedException
    for i in range(attempts):
        old = table.get_item(Key={'NovelId': novel_id}, ConsistentRead=True).get('Item')
        new = {**fn(old), 'NovelId': novel_id}
        try:
            if old is None:
                table.put_item(Item=new, ConditionExpression='attribute_not_exists(NovelId)')
            else:
                table.put_item(Item=new, ConditionExpression='Version = :v', ExpressionAttributeValues={':v': old.get('Version')})
            return new
        except conflict:
            if i == attempts - 1:
                raise
