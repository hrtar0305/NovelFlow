import gzip, json, os, sys, unittest
from datetime import datetime, timezone
os.environ.setdefault('SQS_QUEUE_URL', 'https://example.invalid/q')
os.environ.setdefault('AWS_DEFAULT_REGION', 'ap-northeast-2')
os.environ.setdefault('RAW_HTML_BUCKET', 'raw-bucket')
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import app

def row(eid, label, date_txt):
    return (f'<div class="ep_style2"><span>{label}</span><span class="episode_count_view novel_count_view_{eid}">1</span>'
            f'<b>{date_txt}</b></div>')

class Resp:
    def __init__(self, text): self.text, self.status_code = text, 200
    def raise_for_status(self): pass

class Session:
    def __init__(self, pages): self.pages, self.calls = pages, []
    def post(self, url, data=None, **kw):
        self.calls.append(int(data['page']))
        return Resp(self.pages[min(int(data['page']), len(self.pages) - 1)])

class Table:
    class Conflict(Exception): pass
    def __init__(self, item=None): self.item, self.puts = item, 0
    def get_item(self, Key, ConsistentRead=False): return {'Item': dict(self.item)} if self.item else {}
    def put_item(self, Item, **kw): self.item, self.puts = Item, self.puts + 1

class S3:
    def __init__(self): self.objects = {}
    def put_object(self, Bucket, Key, Body, **kw): self.objects[(Bucket, Key)] = Body

AT = datetime(2026, 10, 5, 12, 2, tzinfo=timezone.utc)   # 21:02 KST

class T(unittest.TestCase):
    def up(self, page, html):
        return {'kind': 'episode_list', 'params': {'novel_no': '1', 'sort': 'UP', 'page': page}, 'html': html}

    def test_ranked_work_uses_retention_pages_only(self):
        t = Table({'NovelId': '1', 'Episodes': {'1': ['2026-10-04', None, None]}, 'CheckedAt': '2026-10-04T21:02:00+09:00',
                   'Complete': True, 'Version': 1})
        s, s3 = Session([]), S3()
        raw = [self.up(0, row(2, 'EP.2', '26.10.05') + row(1, 'EP.1', '26.10.04'))]
        r = app._update_history(s, '1', '2026-10-05', raw, AT, 'x', table=t, s3=s3, conflict=Table.Conflict)
        self.assertEqual(s.calls, [])
        self.assertEqual(s3.objects, {})                     # 추가로 받은 쪽이 없으면 따로 저장하지 않는다
        self.assertEqual(t.item['Episodes']['2'], ['2026-10-05', '2026-10-05T21:02:00+09:00', None])
        self.assertEqual(r['new'], 1)

    def test_reentry_fetches_gap_and_stores_extra_pages_outside_sqs(self):
        t = Table({'NovelId': '1', 'Episodes': {}, 'CheckedAt': '2026-09-20T21:02:00+09:00', 'Complete': True, 'Version': 3})
        s, s3 = Session(['', '', row(5, 'EP.5', '26.09.25') + row(4, 'EP.4', '26.09.19')]), S3()
        raw = [self.up(0, row(9, 'EP.9', '26.10.05') + row(8, 'EP.8', '26.10.01')), self.up(1, row(7, 'EP.7', '26.09.30') + row(6, 'EP.6', '26.09.28'))]
        n_before = len(raw)
        r = app._update_history(s, '1', '2026-10-05', raw, AT, 'x', table=t, s3=s3, conflict=Table.Conflict)
        self.assertEqual(s.calls, [2])
        self.assertEqual(len(raw), n_before)                 # SQS 로 가는 원본(raw_pages)에는 더하지 않는다
        (bucket, key), body = next(iter(s3.objects.items()))
        self.assertEqual((bucket, key), ('raw-bucket', 'episode-history/2026-10-05/1.json.gz'))
        self.assertEqual(len(json.loads(gzip.decompress(body))['pages']), 1)
        self.assertEqual(sorted(t.item['Episodes']), ['4', '5', '6', '7', '8', '9'])
        self.assertEqual(r['pages'], 1)

    def test_out_of_time_skips_write_for_existing_record(self):
        t = Table({'NovelId': '1', 'Episodes': {}, 'CheckedAt': '2026-09-20T21:02:00+09:00', 'Complete': True, 'Version': 3})
        s = Session(['', row(5, 'EP.5', '26.09.25')])
        raw = [self.up(0, row(9, 'EP.9', '26.10.05') + row(8, 'EP.8', '26.10.01'))]
        with self.assertRaises(app.eh.OutOfTime):
            app._update_history(s, '1', '2026-10-05', raw, AT, 'x', table=t, s3=S3(), conflict=Table.Conflict, out_of_time=lambda: True)
        self.assertEqual((s.calls, t.puts), ([], 0))


if __name__ == '__main__':
    unittest.main()
