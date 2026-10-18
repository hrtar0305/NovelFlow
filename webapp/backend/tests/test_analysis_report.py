"""analysis_report 순수 계산 점검 — `cd webapp/backend && ../../venv/bin/python -m unittest discover tests`."""
import os, sys, unittest
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'api'))
import analysis_report as AR


def snap(date, eps):
    return {'date': date, 'ids': ['1'], 'rank': [5], 'eps': [eps], 'view': [1000], 'like': [10]}


class Pace(unittest.TestCase):
    def test_added_eps_and_growing_flat(self):
        works = AR.per_work([
            {'date': '2026-09-01', 'ids': ['1', '2'], 'rank': [5, 6], 'eps': [10, 20], 'view': [1000, 900], 'like': [10, 9]},
            {'date': '2026-09-08', 'ids': ['1', '2'], 'rank': [5, 6], 'eps': [17, 20], 'view': [1500, 950], 'like': [15, 9]},
        ])
        self.assertEqual((works['1']['added_eps'], works['1']['per_week']), (7, 7.0))
        self.assertEqual(AR.pace_distribution(works, {'1', '2'}), {'growing': 1, 'flat': 1})


class Combinations(unittest.TestCase):
    def test_near_subset_pair_is_dropped(self):
        # 버튜버 21편 중 20편이 인터넷방송 — Jaccard 는 0.5 미만이어도 사실상 같은 묶음이라 조합이 아니다.
        rows = [{'Tags': ['버튜버', '인터넷방송']}] * 20 + [{'Tags': ['버튜버']}] \
            + [{'Tags': ['인터넷방송']}] * 30 + [{'Tags': ['기타']}] * 200
        self.assertEqual(AR.tag_combinations(rows, 2, 10, 15), [])

    def test_partial_overlap_pair_stays(self):
        rows = [{'Tags': ['a', 'b']}] * 10 + [{'Tags': ['a']}] * 20 + [{'Tags': ['b']}] * 20 + [{'Tags': ['기타']}] * 200
        self.assertEqual([c['tags'] for c in AR.tag_combinations(rows, 2, 10, 15)], [['a', 'b']])


if __name__ == '__main__':
    unittest.main()
