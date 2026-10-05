"""태그 상위권 집중도 — `cd webapp/backend && ../../venv/bin/python -m unittest discover tests`."""
import os, sys, unittest
os.environ.setdefault('AWS_DEFAULT_REGION', 'ap-northeast-2')
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'api'))
import main as M


class ContestLift(unittest.TestCase):
    def test_single_top_work_is_not_a_signal_in_a_large_field(self):
        # 참가작 2,708편: 5편짜리 태그가 상위 100위에 1편만 들어도 6.5배가 된다 — 우연과 구별되지 않아 계산하지 않는다.
        self.assertIsNone(M._compute_local_lift(1, 5, rest_total=2608, min_top=2))
        self.assertAlmostEqual(M._compute_local_lift(2, 5, rest_total=2608, min_top=2), (2 / 100) / (3 / 2608))
        self.assertEqual(M._compute_local_lift(0, 30, rest_total=2608, min_top=2), 0.0)

    def test_single_top_work_still_counts_when_it_says_not_concentrated(self):
        # 175편 중 상위 100 안 1편(기대 6.5편)은 '덜 몰렸다'는 분명한 신호다 — 1편만으로 막는 건 '몰렸다'(1.0 이상)는 주장뿐.
        self.assertAlmostEqual(M._compute_local_lift(1, 175, rest_total=2608, min_top=2), (1 / 100) / (174 / 2608))

    def test_daily_rule_unchanged(self):
        self.assertAlmostEqual(M._compute_local_lift(1, 5), (1 / 100) / (4 / 400))


if __name__ == '__main__':
    unittest.main()
