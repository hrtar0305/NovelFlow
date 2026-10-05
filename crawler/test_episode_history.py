import unittest
from datetime import datetime, timedelta, timezone
import episode_history as eh

KST = timezone(timedelta(hours=9))
def row(eid, label, date_txt):
    return (f'<div class="ep_style2"><span>{label}</span><span class="episode_count_view novel_count_view_{eid}">1</span>'
            f'<b>{date_txt}</b></div>')

class T(unittest.TestCase):
    def test_parse_and_relative_dates(self):
        at = datetime(2026, 10, 5, 12, 0, tzinfo=KST)
        html = row(3, 'EP.3', '9시간전') + row(2, 'EP.2', '26.10.04') + \
            '<table><tr class="ep_style5"><td><a onclick="location=\'/viewer/9\'"></a></td><td class="font12">제목</td><td class="ep_style3">공개예정 5시간후</td></tr></table>'
        eps, sch, slots = eh.parse_page(html, at)
        self.assertEqual([e[:3] for e in eps], [['3', 'EP.3', '2026-10-05'], ['2', 'EP.2', '2026-10-04']])
        self.assertEqual(slots, 2)
        self.assertEqual(sch[0][0], '9')

    def test_relative_time_crosses_midnight(self):
        self.assertEqual(eh.to_date('2시간전', datetime(2026, 10, 5, 0, 30, tzinfo=KST)), '2026-10-04')
        self.assertEqual(eh.to_date('41초전', datetime(2026, 10, 5, 0, 0, 20, tzinfo=KST)), '2026-10-04')

    def test_short_page_is_not_last(self):
        self.assertFalse(eh.is_last_page(19, ['EP.60', 'EP.42'], 19))     # 삭제가 있던 첫 쪽
        self.assertTrue(eh.is_last_page(0, ['EP.60'], 20))                # 새 회차 없음(마지막 쪽 반복)
        self.assertTrue(eh.is_last_page(3, ['EP.2', 'EP.1', 'EP.0'], 3))
        self.assertFalse(eh.is_last_page(20, ['EP.20', 'EP.1'], 20))      # EP.1 이 꽉 찬 쪽 끝 → EP.0 이 다음 쪽일 수 있다

    def test_merge_adds_marks_gone_and_reappear_clears_gone(self):
        h = eh.merge(None, [['1', 'EP.1', '2026-10-01', '26.10.01'], ['2', 'EP.2', '2026-10-02', '26.10.02']],
                     '2026-10-02T21:00:00+09:00', covered_from='2026-10-01', complete=True, scheduled=[])
        self.assertEqual(h['Episodes']['2'], ['2026-10-02', '2026-10-02T21:00:00+09:00', None])
        h2 = eh.merge(h, [['1', 'EP.1', '2026-10-01', '26.10.01']], '2026-10-03T21:00:00+09:00', '2026-10-01', True, [])
        self.assertEqual(h2['Episodes']['2'][2], '2026-10-03T21:00:00+09:00')   # 사라짐 표시, 지우지 않음
        h3 = eh.merge(h2, [['1', 'EP.1', '2026-10-01', '26.10.01'], ['2', 'EP.1', '2026-10-02', '26.10.02']],
                      '2026-10-04T21:00:00+09:00', '2026-10-01', True, [])
        self.assertIsNone(h3['Episodes']['2'][2])
        self.assertEqual(h3['Episodes']['2'][1], '2026-10-02T21:00:00+09:00')   # 처음 본 시각은 그대로

    def test_window_cutoff(self):
        h = {'Episodes': {'a': ['2026-10-04', None, None], 'b': ['2026-10-04', '2026-10-05T21:00:00+09:00', None],
                          'c': ['2026-10-03', '2026-10-03T21:00:00+09:00', '2026-10-04T21:00:00+09:00']},
             'CheckedAt': '2026-10-05T21:00:00+09:00', 'Complete': True, 'OldestDate': '2026-10-01'}
        r = eh.day_counts(h, '2026-10-03', '2026-10-04', cutoff_iso='2026-10-04T22:00:00+09:00')
        self.assertEqual(r['days'], {'2026-10-03': 1, '2026-10-04': 1})   # b 는 마감 뒤에 봤다, c 는 지워졌어도 센다

    def test_day_of_the_check_is_not_rest_when_nothing_seen_yet(self):
        # 데일리는 21시쯤 본다 — 그날 23시에 올리는 작가의 그날이 '쉰 날'이 되면 안 된다(아직 모름). 올린 게 보였으면 올린 날.
        h = {'Episodes': {'a': ['2026-10-04', '2026-10-04T21:00:00+09:00', None]},
             'CheckedAt': '2026-10-05T21:00:00+09:00', 'Complete': True}
        self.assertEqual(eh.day_counts(h, '2026-10-04', '2026-10-05')['days'], {'2026-10-04': 1, '2026-10-05': None})
        r = eh.day_counts(h, '2026-10-03', '2026-10-04', cutoff_iso='2026-10-04T22:00:00+09:00')
        self.assertEqual(r['days'], {'2026-10-03': 0, '2026-10-04': 1})
        r = eh.day_counts(h, '2026-10-02', '2026-10-03', cutoff_iso='2026-10-03T22:00:00+09:00')
        self.assertEqual(r['days'], {'2026-10-02': 0, '2026-10-03': None})   # 마감(22시)까지 그날 올린 게 안 보였다

    def test_partial_history_marks_unknown_before_oldest(self):
        h = {'Episodes': {'a': ['2026-10-04', None, None]}, 'CheckedAt': '2026-10-05T12:00:00+09:00',
             'Complete': False, 'OldestDate': '2026-10-03'}
        r = eh.day_counts(h, '2026-10-01', '2026-10-06', cutoff_iso=None)
        self.assertEqual(r['days']['2026-10-02'], None)        # 받지 못한 앞부분
        self.assertEqual(r['days']['2026-10-03'], 0)
        self.assertEqual(r['days']['2026-10-06'], None)        # 마지막 확인 뒤
        self.assertEqual(r['known_until'], '2026-10-05')

def page(rows):
    return ''.join(row(*r) for r in rows)

class Collect(unittest.TestCase):
    AT = datetime(2026, 10, 5, 0, 5, tzinfo=KST)

    def fetcher(self, pages):
        calls = []
        def fetch(n):
            calls.append(n)
            return (pages[min(n, len(pages) - 1)], self.AT)
        return fetch, calls

    def test_no_history_fetches_to_the_end(self):
        fetch, calls = self.fetcher([page([(3, 'EP.3', '26.10.04'), (2, 'EP.2', '26.10.03')]), page([(1, 'EP.1', '26.10.01')])])
        r = eh.collect(fetch, None)
        self.assertEqual(calls, [0, 1])
        self.assertTrue(r['complete'])
        self.assertEqual(r['covered_from'], '0000-01-01')
        self.assertEqual([e[0] for e in r['seen']], ['3', '2', '1'])

    def test_with_history_stops_at_checked_date(self):
        fetch, calls = self.fetcher([page([(5, 'EP.5', '26.10.04'), (4, 'EP.4', '26.10.04')]),
                                     page([(3, 'EP.3', '26.10.03'), (2, 'EP.2', '26.10.02')]), page([(1, 'EP.1', '26.10.01')])])
        r = eh.collect(fetch, {'CheckedAt': '2026-10-03T21:00:00+09:00', 'Complete': True})
        self.assertEqual(calls, [0, 1])
        self.assertTrue(r['complete'])
        self.assertEqual(r['covered_from'], '2026-10-02')

    def test_page_cap_leaves_incomplete(self):
        fetch, calls = self.fetcher([page([(i, f'EP.{i}', '26.10.04')]) for i in range(10, 0, -1)])
        r = eh.collect(fetch, None, max_pages=3)
        self.assertEqual(len(calls), 3)
        self.assertFalse(r['complete'])

    def test_uploads_on_checked_date_past_page_boundary_are_fetched(self):
        # 확인(00:05) 뒤 그날 올린 회차가 한 쪽을 넘으면 다음 쪽까지 받아야 한다 — 그 날짜 '이하'에서 멈추면 영영 빠진다.
        fetch, calls = self.fetcher([page([(9, 'EP.9', '26.10.05'), (8, 'EP.8', '26.10.05')]),
                                     page([(7, 'EP.7', '26.10.05'), (6, 'EP.6', '26.10.04')]), page([(5, 'EP.5', '26.10.03')])])
        r = eh.collect(fetch, {'CheckedAt': '2026-10-05T00:05:00+09:00', 'Complete': True})
        self.assertEqual(calls, [0, 1])
        self.assertIn('7', [e[0] for e in r['seen']])

    def test_incomplete_history_resumes_from_the_oldest_end(self):
        # 처음에 120쪽 상한으로 다 받지 못한 기록은 오래된 순(DOWN)으로 아는 회차를 만날 때까지 이어 받는다.
        h = {'Episodes': {'5': ['2026-10-04', None, None], '4': ['2026-10-03', None, None]},
             'CheckedAt': '2026-10-04T21:00:00+09:00', 'Complete': False, 'OldestDate': '2026-10-03'}
        fetch, _ = self.fetcher([page([(6, 'EP.6', '26.10.05'), (5, 'EP.5', '26.10.04'), (4, 'EP.4', '26.10.03')])])
        down_calls = []
        downs = [page([(1, 'EP.1', '26.10.01'), (2, 'EP.2', '26.10.02')]), page([(3, 'EP.3', '26.10.02'), (4, 'EP.4', '26.10.03')])]
        def fetch_down(n):
            down_calls.append(n)
            return downs[n], self.AT
        r = eh.collect(fetch, h, fetch_down=fetch_down)
        self.assertEqual(down_calls, [0, 1])
        self.assertTrue(r['complete'])
        self.assertTrue({'1', '2', '3', '6'} <= {e[0] for e in r['seen']})
        merged = eh.merge(h, r['seen'], 'now', r['covered_from'], r['complete'], r['scheduled'])
        self.assertTrue(merged['Complete'])
        self.assertEqual(merged['OldestDate'], '2026-10-01')
        self.assertIsNone(merged['Episodes']['5'][2])

    def test_out_of_time(self):
        pages = [page([(i, f'EP.{i}', '26.10.04')]) for i in range(10, 0, -1)]
        fetch, calls = self.fetcher(pages)
        r = eh.collect(fetch, None, out_of_time=lambda: len(calls) >= 2)
        self.assertEqual(len(calls), 2)
        self.assertFalse(r['complete'])                     # 처음 보는 작품: 받은 데까지 남긴다(다음에 이어 받는다)
        fetch, calls = self.fetcher(pages)
        with self.assertRaises(eh.OutOfTime):                # 기록이 있으면 쓰지 않는다 — 다음 확인이 같은 자리부터 다시
            eh.collect(fetch, {'CheckedAt': '2026-09-01T21:00:00+09:00', 'Complete': True}, out_of_time=lambda: len(calls) >= 2)

    def test_prefetched_pages_are_reused(self):
        fetch, calls = self.fetcher([None, page([(1, 'EP.1', '26.10.01')])])
        r = eh.collect(fetch, None, prefetched={0: (page([(2, 'EP.2', '26.10.02')]), self.AT)})
        self.assertEqual(calls, [1])
        self.assertEqual(r['pages_fetched'], 1)

    def test_boundary_date_is_not_marked_gone(self):
        h = {'Episodes': {'9': ['2026-10-02', None, None]}, 'CheckedAt': 'x', 'Complete': True}
        h2 = eh.merge(h, [['3', 'EP.3', '2026-10-03', ''], ['2', 'EP.2', '2026-10-02', '']], 'now', '2026-10-02', True, [])
        self.assertIsNone(h2['Episodes']['9'][2])

class FakeTable:
    """DynamoDB Table 흉내: get_item / put_item(ConditionExpression 은 Version 비교만 흉내)."""
    class Conflict(Exception):
        pass
    def __init__(self, item=None, race=0):
        self.item, self.race, self.puts = item, race, 0
    def get_item(self, Key, ConsistentRead=False):
        return {'Item': dict(self.item)} if self.item else {}
    def put_item(self, Item, ConditionExpression=None, **kw):
        expected = (kw.get('ExpressionAttributeValues') or {}).get(':v')
        current = (self.item or {}).get('Version')
        if self.race:
            self.race -= 1
            self.item = {**(self.item or {'NovelId': Item['NovelId'], 'Episodes': {}}), 'Version': (current or 0) + 1}
            raise self.Conflict()
        if expected is not None and current != expected:
            raise self.Conflict()
        if expected is None and self.item is not None:
            raise self.Conflict()
        self.item, self.puts = Item, self.puts + 1

class Update(unittest.TestCase):
    def test_creates_then_updates(self):
        t = FakeTable()
        eh.update_record(t, '7', lambda old: eh.merge(old, [['1', 'EP.1', '2026-10-01', '']], 'a', eh.FULL, True, []), conflict=FakeTable.Conflict)
        self.assertEqual(t.item['Version'], 1)
        eh.update_record(t, '7', lambda old: eh.merge(old, [['1', 'EP.1', '2026-10-01', ''], ['2', 'EP.2', '2026-10-02', '']], 'b', eh.FULL, True, []), conflict=FakeTable.Conflict)
        self.assertEqual(sorted(t.item['Episodes']), ['1', '2'])
        self.assertEqual(t.item['Version'], 2)

    def test_retries_once_on_conflict(self):
        t = FakeTable(item={'NovelId': '7', 'Episodes': {}, 'Version': 1}, race=1)
        eh.update_record(t, '7', lambda old: eh.merge(old, [['1', 'EP.1', '2026-10-01', '']], 'a', eh.FULL, True, []), conflict=FakeTable.Conflict)
        self.assertEqual(t.puts, 1)
        self.assertIn('1', t.item['Episodes'])

if __name__ == '__main__':
    unittest.main()
