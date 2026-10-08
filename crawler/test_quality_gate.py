"""품질 게이트 — `cd crawler && python -m unittest test_quality_gate`."""
import os, sys, unittest
from unittest import mock
os.environ.setdefault('AWS_DEFAULT_REGION', 'ap-northeast-2')
for k in ('S3_BUCKET_NAME', 'SQS_QUEUE_URL'):
    os.environ.setdefault(k, 'x')
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import consolidate_data as C


def rows(n_real, n_holder=0):
    real = [{'ID': str(i), 'Ranking': i, 'Title': f't{i}', 'View': 100, 'IsAdult': i % 4 == 0} for i in range(1, n_real + 1)]
    return real + [{'ID': f'p{i}', 'Ranking': 900 + i, 'Title': 'N/A (ParsingFailed: x)', 'View': 0} for i in range(n_holder)]


class Gate(unittest.TestCase):
    def gate(self, data, prev=None):
        with mock.patch.object(C, '_load_previous_day_views', return_value=prev or {}), \
             mock.patch.object(C, '_notify') as notify:
            C._quality_gate(None, 't', data, '2026-10-08')
        return [c.args[2] for c in notify.call_args_list]

    def test_any_remaining_placeholder_warns_but_saves(self):
        self.assertEqual(self.gate(rows(499, 1)), ['다시 받아도 끝내 못 받은 작품 1편'])

    def test_more_than_limit_fails(self):
        self.gate(rows(490, 10))                     # 2% — 쓰되 알린다
        with self.assertRaises(ValueError):
            self.gate(rows(489, 11))
        with self.assertRaises(ValueError):
            self.gate(rows(8, 2))                    # 작은 수동 실행도 비율로 잰다

    def test_view_decrease_warns_then_fails(self):
        self.assertEqual(self.gate(rows(500), {'1': 101}), ['누적 조회수가 줄어든 작품 1편'])
        with self.assertRaises(ValueError):
            self.gate(rows(500), {str(i): 101 for i in range(1, C.MAX_VIEW_DECREASE_COUNT + 2)})

    def test_clean_day_is_silent(self):
        self.assertEqual(self.gate(rows(500), {'1': 100}), [])


if __name__ == '__main__':
    unittest.main()
