"""analysis_report 순수 계산 점검 — `cd webapp/backend && ../../venv/bin/python -m unittest discover tests`."""
import os, sys, unittest
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'api'))
import analysis_report as AR


def snap(date, eps):
    return {'date': date, 'ids': ['1'], 'rank': [5], 'eps': [eps], 'view': [1000], 'like': [10]}


class RecentlyAdded(unittest.TestCase):
    def test_stopped_serial_has_no_recent_episodes(self):
        # 기간 초반에만 올리고 마지막 7일엔 회차가 그대로면 '연재 중'이 아니다(최신 잔류가 계속 차오르는 작품).
        w = AR.per_work([snap('2026-09-01', 10), snap('2026-09-03', 14), snap('2026-09-20', 14), snap('2026-09-30', 14)])['1']
        self.assertEqual(w['added_eps'], 4)
        self.assertEqual(w['recent_added_eps'], 0)

    def test_recent_episodes_count_from_last_value_a_week_before(self):
        w = AR.per_work([snap('2026-09-01', 10), snap('2026-09-22', 12), snap('2026-09-25', 13), snap('2026-09-30', 15)])['1']
        self.assertEqual(w['recent_added_eps'], 3)   # 09-22(마지막 날 −7일 이하 마지막 값) 12 → 15

    def test_short_observation_uses_first_value(self):
        w = AR.per_work([snap('2026-09-28', 10), snap('2026-09-30', 11)])['1']
        self.assertEqual(w['recent_added_eps'], 1)


if __name__ == '__main__':
    unittest.main()
