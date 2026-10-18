"""usage_watch 판정 점검 — `python -m unittest utils/test_usage_watch.py` (AWS 호출 없음)."""
import os
import sys
import unittest
from datetime import date

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import usage_watch as U


class Judge(unittest.TestCase):
    def test_projection_is_linear_over_the_month(self):
        # 10월 18일까지 6,000건이면 31일 기준 약 10,333건 — 월 한도 1만 건을 넘을 전망
        self.assertAlmostEqual(U.project(6000, date(2026, 10, 18)), 6000 / 18 * 31)

    def test_levels(self):
        m = lambda used, limit, proj=None: U.Meter('x', used, limit, '건', projected=proj)
        self.assertIsNone(U.level_of(m(100, 10000, 300)))            # 1% · 전망 3%
        self.assertEqual(U.level_of(m(5000, 10000, 8000)), 'info')     # 50%
        self.assertEqual(U.level_of(m(8000, 10000, 9000)), 'warn')     # 80%
        self.assertEqual(U.level_of(m(10000, 10000)), 'fail')          # 100%
        self.assertEqual(U.level_of(m(3000, 10000, 12000)), 'warn')    # 지금은 30% 지만 월말 전망 120%
        # 프리 티어(넘으면 소액 청구될 뿐 멈추지 않음)는 그것만으로 알리지 않는다 — Step Functions 는 이미 매달 넘는다
        self.assertIsNone(U.level_of(U.Meter('sfn', 4000, 4000, '', projected=6889, soft=True)))

    def test_report_picks_worst_level_and_skips_quiet_days(self):
        quiet = [U.Meter('a', 10, 100, '건', projected=20)]
        self.assertIsNone(U.build_notice(quiet, date(2026, 10, 18), weekly=False))
        self.assertEqual(U.build_notice(quiet, date(2026, 10, 19), weekly=True)['level'], 'ok')   # 월요일 요약은 조용해도 보낸다
        loud = quiet + [U.Meter('b', 90, 100, '건', projected=150)]
        n = U.build_notice(loud, date(2026, 10, 18), weekly=False)
        self.assertEqual(n['level'], 'warn')
        self.assertTrue(any('b' in line for line in n['lines']))


if __name__ == '__main__':
    unittest.main()
