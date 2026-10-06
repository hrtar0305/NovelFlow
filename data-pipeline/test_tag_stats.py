import os, sys, unittest
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import tag_stats as T


class DailyTagStats(unittest.TestCase):
    def test_score_sum_total_and_pruning(self):
        items = [
            {'Ranking': 1, 'Score': 1000, 'Tags': ['a', 'b']},
            {'Ranking': 101, 'Score': 100, 'Tags': ['a', 'c']},
            {'Ranking': 300, 'Score': 50, 'Tags': ['a', 'b']},
            {'Ranking': 0, 'Score': 999, 'Tags': ['a']},          # 순위 없는 행은 무시
        ]
        s = T.daily_tag_stats(items)
        self.assertEqual(s['TagCounts'], {'a': 3, 'b': 2})       # c 는 1회라 가지치기
        self.assertEqual(s['TagCountsTop100'], {'a': 1, 'b': 1})
        self.assertEqual(s['TagScoreSum'], {'a': 1150, 'b': 1050})
        self.assertEqual((s['ScoreTotal'], s['RankedTotal']), (1150, 3))   # 가지치기와 무관
        self.assertAlmostEqual(s['TagWeightedScoresLogarithmic']['b'], 1 / 0.6931471805599453 + 1 / 5.707110264748875)

    def test_missing_score_counts_as_zero(self):
        s = T.daily_tag_stats([{'Ranking': 1, 'Score': None, 'Tags': ['a']}, {'Ranking': 2, 'Tags': ['a']}])
        self.assertEqual((s['TagScoreSum'], s['ScoreTotal']), ({'a': 0}, 0))


if __name__ == '__main__':
    unittest.main()
