"""작품별 연재 기록 — 노벨피아 회차 목록 해석·병합·날짜별 화 수(설계 docs/superpowers/specs/2026-10-05-episode-upload-history-design.md).
순수 함수만 둔다(I/O 없음). crawler/ 가 원본이고 contests/2026/contest_detail_parser/·webapp/backend/api/ 에 같은 파일을 둔다
(이미지·배포가 따로라 — scripts/check_copies.sh 로 확인).
"""
import re
from datetime import date, datetime, timedelta

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
    """기록에 이번에 본 회차를 더한다. 새 고유 번호는 [날짜, 이번 시각, None]. 이번에 받은 범위(`covered_from` 이후 날짜) 안에
    있어야 하는데 없는 기존 회차는 사라진 시각만 적는다(지우지 않는다 — 지워진 회차의 업로드 날도 연재로 센다). 다시 보이면 푼다."""
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
        if eid not in seen_ids and v[2] is None and covered_from and v[0] >= covered_from:
            v[2] = fetched_at_iso
    dates = [v[0] for v in eps.values()]
    h.update({'Episodes': eps, 'CheckedAt': fetched_at_iso, 'CheckedCount': len(seen_ids),
              'Complete': bool(complete or h.get('Complete')),
              'OldestDate': min(dates) if dates else h.get('OldestDate'),
              'Scheduled': (h.get('Scheduled') or [])[-50:] + list(scheduled),
              'Version': int(h.get('Version') or 0) + 1})
    return h


def day_counts(history, start, end, cutoff_iso=None):
    """[start, end] 날짜별 올린 화 수. `cutoff_iso` 를 주면 처음 본 시각이 그 뒤인 회차는 뺀다(행 펼침 고정값 — 백필(None)은 날짜만 본다).
    값 None = 모름: 마지막 확인일 뒤, 또는 다 받지 못한 기록(`Complete=false`)의 가장 오래된 날짜 앞."""
    eps = (history or {}).get('Episodes') or {}
    checked = (history or {}).get('CheckedAt')
    known_until = checked[:10] if checked else None
    known_from = None if (history or {}).get('Complete') else (history or {}).get('OldestDate')
    counts = {}
    for d, first_seen, _gone in eps.values():
        if cutoff_iso and first_seen and first_seen > cutoff_iso:
            continue
        counts[d] = counts.get(d, 0) + 1
    out, cur, last = {}, date.fromisoformat(start), date.fromisoformat(end)
    while cur <= last:
        k = cur.isoformat()
        unknown = (known_until is None or k > known_until) or (known_from is not None and k < known_from)
        out[k] = None if unknown else counts.get(k, 0)
        cur += timedelta(days=1)
    return {'days': out, 'known_from': known_from, 'known_until': known_until}
