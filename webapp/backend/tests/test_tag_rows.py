"""태그 랭킹 하루 판정(DECISIONS 2026-10-06) — `cd webapp/backend && ../../venv/bin/python -m unittest discover tests`."""
import os, sys, unittest
os.environ.setdefault('AWS_DEFAULT_REGION', 'ap-northeast-2')
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'api'))
import main as M


class OneDayRows(unittest.TestCase):
    def test_share_and_order(self):
        rows = M._one_day_tag_rows({'a': 10, 'b': 5}, {'a': 2, 'b': 3}, {'a': 300, 'b': 700}, 1000, 500)
        self.assertEqual([(r['tag'], r['Rank'], r['score_share'], r['top100'], r['ranked_total']) for r in rows],
                         [('b', 1, 0.7, 3, 500), ('a', 2, 0.3, 2, 500)])

    def test_ties_sorted_by_name(self):
        rows = M._one_day_tag_rows({'나': 3, '가': 3}, {}, {'나': 100, '가': 100}, 1000, 500)
        self.assertEqual([r['tag'] for r in rows], ['가', '나'])

    def test_missing_score_fields(self):
        # 새 필드가 없는 날(소급 전 · 적재 실패): 점유율 없이 작품 수 순으로 낸다(터지지 않는다).
        rows = M._one_day_tag_rows({'a': 3, 'b': 9}, {'a': 1}, None, None, None)
        self.assertEqual([(r['tag'], r['score_share'], r['top100']) for r in rows], [('b', None, 0), ('a', None, 1)])

    def test_missing_tag_in_score_sum(self):
        rows = M._one_day_tag_rows({'a': 3}, {}, {}, 1000, 500)
        self.assertEqual(rows[0]['score_share'], 0.0)


class BlockedSubtraction(unittest.TestCase):
    def test_blocked_subtraction_includes_total(self):
        old, old_bl = M.HIDE_ADULT_CONTENT, M._adult_blocklist
        M.HIDE_ADULT_CONTENT, M._adult_blocklist = True, (lambda: frozenset())
        try:
            rows = [{'ID': '1', 'Ranking': 5, 'Score': 400, 'Tags': ['a'], 'IsAdult': True}]
            _, counts, top, ssum, stot = M._tag_stats_without_blocked('2026-10-05', {'a': 2.0}, {'a': 3}, {'a': 1}, rows,
                                                                       {'a': 900}, 2000)
            self.assertEqual((counts['a'], top['a'], ssum['a'], stot), (2, 0, 500, 1600))
        finally:
            M.HIDE_ADULT_CONTENT, M._adult_blocklist = old, old_bl


if __name__ == '__main__':
    unittest.main()
