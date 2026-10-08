"""다시 받기와 품질 게이트 — `cd contests/2025/contest_detail_parser && python -m unittest test_retry_gate`."""
import json, os, sys, unittest
from unittest import mock
os.environ.setdefault('AWS_DEFAULT_REGION', 'ap-northeast-2')
os.environ.setdefault('DYNAMODB_TABLE_NAME', 't')
os.environ.setdefault('SQS_RESULT_QUEUE_URL', 'q')
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import parser as P
import consolidate_contest_data as C


def batch(ids):
    return {'Records': [{'body': json.dumps({'execution_id': 'e', 'date': '2026-10-08', 'novel_id': i})} for i in ids]}


class Retry(unittest.TestCase):
    def run_batch(self, ids, outcomes, context=None):
        """outcomes[id] = 그 작품이 차례로 내놓을 결과 목록(dict 항목 또는 사유 문자열)."""
        seq = {i: iter(o) for i, o in outcomes.items()}
        sqs = mock.Mock()
        with mock.patch.object(P, '_fetch_contest_novel', side_effect=lambda s, nid, d, raw, e: next(seq[nid])), \
             mock.patch.object(P.boto3, 'client', return_value=sqs), mock.patch.object(P, '_upload_raw_batch'), \
             mock.patch.object(P.time, 'sleep') as sleep:
            P.parse_contest_novel_details_batch(batch(ids), context)
        return {json.loads(c.kwargs['MessageBody'])['ID']: json.loads(c.kwargs['MessageBody'])['Title']
                for c in sqs.send_message.call_args_list}, sleep

    def test_unusable_page_is_retried_at_batch_end(self):
        sent, sleep = self.run_batch(['1', '2'], {'1': ['ParsingFailed: AttributeError', {'ID': '1', 'Title': 'a'}],
                                                 '2': [{'ID': '2', 'Title': 'b'}]})
        self.assertEqual(sent, {'1': 'a', '2': 'b'})
        sleep.assert_called_once_with(2)          # 편마다가 아니라 묶음 끝에서 한 번 쉰다

    def test_placeholder_after_all_attempts(self):
        sent, _ = self.run_batch(['1'], {'1': ['Inaccessible'] * P.PAGE_ATTEMPTS})
        self.assertEqual(sent, {'1': 'N/A (Inaccessible)'})


class NoTime(unittest.TestCase):
    def test_no_time_left_keeps_placeholder_with_its_reason(self):
        ctx = mock.Mock(get_remaining_time_in_millis=lambda: 30_000)
        sent, sleep = Retry.run_batch(Retry(), ['1'], {'1': ['ParsingFailed: AttributeError']}, ctx)
        self.assertEqual(sent, {'1': 'N/A (ParsingFailed: AttributeError)'})
        sleep.assert_not_called()


class Table:
    def __init__(self, prev_rows):
        self.prev = prev_rows

    def get_item(self, Key):
        return {'Item': {'dates': {'2026-10-07'}}}

    def query(self, **kw):
        return {'Items': self.prev}


def items(real, failed=0, inacc=()):
    out = [{'ID': str(i), 'Date': '2026-10-08', 'Title': 't'} for i in range(real)]
    out += [{'ID': f'f{i}', 'Date': '2026-10-08', 'Title': 'N/A (ParsingFailed: X)'} for i in range(failed)]
    return out + [{'ID': i, 'Date': '2026-10-08', 'Title': 'N/A (Inaccessible)'} for i in inacc]


class Gate(unittest.TestCase):
    def check(self, data, prev=()):
        with mock.patch.object(C, '_notify') as notify:
            C._check_quality('e', data, Table([{'ID': i, 'Title': 't'} for i in prev]))
        return [c.args[2] for c in notify.call_args_list]

    def test_parsing_failed(self):
        self.assertEqual(self.check(items(99, 1)), ['다시 받아도 못 읽은 작품 1편'])   # 1% — 쓰되 알린다
        with self.assertRaises(ValueError):
            self.check(items(97, 3))                                                    # 3%

    def test_new_inaccessible_counts_only_works_real_the_day_before(self):
        old = [f'o{i}' for i in range(2000)]          # 오래전부터 접근 불가 — 세지 않는다
        self.assertEqual(self.check(items(10, inacc=old)), [])
        new = [f'n{i}' for i in range(C.Config.WARN_NEW_INACCESSIBLE + 1)]
        self.assertEqual(self.check(items(10, inacc=new), prev=new), [f'하루 사이 접근 불가가 된 작품 {len(new)}편'])
        many = [f'n{i}' for i in range(C.Config.MAX_NEW_INACCESSIBLE + 1)]
        with self.assertRaises(ValueError):
            self.check(items(10, inacc=many), prev=many)


if __name__ == '__main__':
    unittest.main()
