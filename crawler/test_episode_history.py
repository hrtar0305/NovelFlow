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

    def test_partial_history_marks_unknown_before_oldest(self):
        h = {'Episodes': {'a': ['2026-10-04', None, None]}, 'CheckedAt': '2026-10-05T12:00:00+09:00',
             'Complete': False, 'OldestDate': '2026-10-03'}
        r = eh.day_counts(h, '2026-10-01', '2026-10-06', cutoff_iso=None)
        self.assertEqual(r['days']['2026-10-02'], None)        # 받지 못한 앞부분
        self.assertEqual(r['days']['2026-10-03'], 0)
        self.assertEqual(r['days']['2026-10-06'], None)        # 마지막 확인 뒤
        self.assertEqual(r['known_until'], '2026-10-05')

if __name__ == '__main__':
    unittest.main()
