"""쓸 수 없는 결과 다시 받기와 적재 게이트 — `cd contests/2026/contest_detail_parser && python -m unittest test_retry_gate`."""
import os, sys, unittest
from unittest import mock
os.environ.setdefault('AWS_DEFAULT_REGION', 'ap-northeast-2')
os.environ.setdefault('DYNAMODB_TABLE_NAME', 't')
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import parser as P
import consolidate_contest_data as C

DATE = '2026-10-08'


def real(nid):
    return {'ID': nid, 'Title': f't{nid}', 'View': 10, 'CrawledAt': 'x'}


def holder(nid, reason):
    return {'ID': nid, 'Title': f'N/A ({reason})', 'View': -1}


class BatchRetry(unittest.TestCase):
    def run_batch(self, outcomes):
        """outcomes[id] = 차례로 낼 (item, ok)."""
        seq = {k: iter(v) for k, v in outcomes.items()}
        with mock.patch.object(P, '_parse_one', side_effect=lambda s, nid, d, e: (lambda r: (r[0], [{'kind': 'detail', 'n': nid}], r[1]))(next(seq[nid]))), \
             mock.patch.object(P.time, 'sleep') as sleep, mock.patch.object(P, '_upload_raw_batch', return_value=True) as up:
            out = P.parse_dmap_batch({'Items': list(outcomes), 'BatchInput': {'date': DATE}}, None)
        self.raw = up.call_args.args[1]
        return {i['ID']: i['Title'] for i in out['items']}, out, sleep

    def test_truncated_page_recovers_at_batch_end(self):
        titles, out, sleep = self.run_batch({'1': [(holder('1', 'ParsingFailed: AttributeError'), False), (real('1'), True)],
                                            '2': [(real('2'), True)]})
        self.assertEqual(titles, {'1': 't1', '2': 't2'})
        self.assertEqual(out['failed'], [])
        sleep.assert_called_once_with(2)
        # 원본은 작품마다 마지막(성공한) 시도의 쪽·시각만 — 원본 재계산이 그 결과를 그대로 되풀이한다
        self.assertEqual(sorted((k, at) for k, _, at in self.raw), [('1', 'x'), ('2', 'x')])

    def test_still_unusable_keeps_last_placeholder(self):
        titles, _, sleep = self.run_batch({'1': [(holder('1', 'Inaccessible'), False)] * 3})
        self.assertEqual(titles, {'1': 'N/A (Inaccessible)'})
        self.assertEqual(sleep.call_count, len(P.PAGE_RETRY_WAITS))

    def test_retention_parse_failure_is_retried(self):
        partial = {**real('1'), 'RetentionFetchError': ['parse']}
        titles, out, _ = self.run_batch({'1': [(partial, True), (real('1'), True)]})
        self.assertNotIn('RetentionFetchError', out['items'][0])


class Budget(unittest.TestCase):
    def test_unretried_for_budget_goes_back_to_reconcile(self):
        # 재시도 라운드에서 예산을 넘기면 placeholder 로 굳히지 않고 '받지 못함'으로 돌려 reconcile 이 다시 받게 한다.
        clock = iter([0, 0])   # 시작·첫 확인까지는 여유, 재시도 라운드에서 예산 초과
        with mock.patch.object(P.time, 'monotonic', side_effect=lambda: next(clock, 1000)):
            titles, out, sleep = BatchRetry.run_batch(BatchRetry(), {'1': [(holder('1', 'ParsingFailed: X'), False)]})
        self.assertEqual(titles, {})
        self.assertEqual([f['id'] for f in out['failed']], ['1'])
        self.assertTrue(out['failed'][0]['error'].startswith('TimeBudget'))


class Gate(unittest.TestCase):
    def consolidate(self, items, expected, gone=()):
        store = {f'runs/{DATE}/e/expected.json': expected,
                 f'runs/{DATE}/e/collected.json': {'items': items, 'errors': {}, 'raw_failed': 0, 'children_failed': 0},
                 'state/gone_ids.json': list(gone)}
        written = {}
        with mock.patch.object(C, '_run_prefix', return_value=f'runs/{DATE}/e'), \
             mock.patch.object(C, '_get_json', side_effect=lambda k, d=None: store.get(k, d)), \
             mock.patch.object(C, '_put_json', side_effect=lambda k, o: written.__setitem__(k, o)), \
             mock.patch.object(C.boto3, 'resource'), mock.patch.object(C, '_process_and_upload_data'):
            return C.handler_dmap({'execution_id': 'e', 'date': DATE}, None), written

    def test_unreadable_pages_count_toward_the_limit(self):
        # 예전엔 FetchFailed 만 세서, 셀렉터가 깨져 전부 ParsingFailed 인 날이 그대로 적재됐다.
        ids = [str(i) for i in range(100)]
        items = [real(k) for k in ids[:97]] + [holder(k, 'ParsingFailed: AttributeError') for k in ids[97:]]
        with self.assertRaises(C.TooManyMissing):
            self.consolidate(items, ids)
        out, _ = self.consolidate([real(k) for k in ids[:98]] + [holder(k, 'ParsingFailed: X') for k in ids[98:]], ids)
        self.assertTrue(out['degraded'])           # 2편 = 2% — 쓰되 알린다

    def test_old_inaccessible_is_not_new(self):
        ids = [str(i) for i in range(1000)]
        items = [real(k) for k in ids[:400]] + [holder(k, 'Inaccessible') for k in ids[400:]]
        out, written = self.consolidate(items, ids, gone=ids[400:])
        self.assertEqual(written[f'failures/{DATE}.json']['new_inaccessible'], [])
        with self.assertRaises(C.TooManyMissing):
            self.consolidate(items, ids)            # 600편이 하루 사이 경고창 — 장애


if __name__ == '__main__':
    unittest.main()
