"""다시 받기 마감 — `cd contests/2026/contest_detail_parser && python -m unittest test_refetch_window`."""
import unittest
from datetime import datetime
import app as A


def kst(s):
    return datetime.fromisoformat(s + '+09:00')


class Window(unittest.TestCase):
    def test_thirty_minutes_after_midnight(self):
        # 자정 실행은 약 10분 — 실패 뒤 한 번 다시 하는 데 30분이면 된다. 그보다 늦게 받은 값은 일간 증가를 그만큼 부풀린다(사용자 2026-10-27).
        A.check_refetch_allowed('2026-10-26', kst('2026-10-27T00:29:59'))
        with self.assertRaises(A.LateRefetchRefused):
            A.check_refetch_allowed('2026-10-26', kst('2026-10-27T00:30:01'))

    def test_reprocess_and_shadow_runs_are_exempt(self):
        A.check_refetch_allowed('2026-10-26', kst('2026-10-27T09:00:00'), reprocess=True)
        A.check_refetch_allowed('2026-10-26', kst('2026-10-27T09:00:00'), dry_run=True)


if __name__ == '__main__':
    unittest.main()
