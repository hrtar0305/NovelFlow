import os, sys, unittest
os.environ.setdefault('AWS_DEFAULT_REGION', 'ap-northeast-2')
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import parser as P

def row(eid, label, date_txt):
    return (f'<div class="ep_style2"><span>{label}</span><span class="episode_count_view novel_count_view_{eid}">1</span>'
            f'<b>{date_txt}</b></div>')

class Resp:
    def __init__(self, text): self.text, self.status_code = text, 200
    def raise_for_status(self): pass

class Session:
    def __init__(self, pages): self.pages, self.calls = pages, []
    def post(self, url, data=None, **kw):
        self.calls.append(data['page'])
        return Resp(self.pages[min(int(data['page']), len(self.pages) - 1)])

class Table:
    class Conflict(Exception): pass
    def __init__(self, item=None): self.item, self.puts = item, 0
    def get_item(self, Key, ConsistentRead=False): return {'Item': dict(self.item)} if self.item else {}
    def put_item(self, Item, **kw): self.item, self.puts = Item, self.puts + 1

class T(unittest.TestCase):
    def test_new_work_full_list_written_with_crawl_time(self):
        s, t = Session([row(2, 'EP.2', '26.10.04') + row(1, 'EP.1', '26.10.03')]), Table()
        pages = []
        r = P._attach_history(s, '455999', pages, '2026-10-04T15:01:00+00:00', write=True, execution_id='t', table=t, conflict=Table.Conflict)
        self.assertEqual(r, {'new': 2, 'gone': 0, 'pages': 1, 'complete': True})
        self.assertEqual(t.item['Episodes']['2'], ['2026-10-04', '2026-10-05T00:01:00+09:00', None])   # 처음 본 시각 = 상세 받은 시각(KST)
        self.assertEqual(len(pages), 1)            # 받은 목록 쪽은 원본 묶음에 들어간다

    def test_dry_run_does_not_write(self):
        s, t = Session([row(1, 'EP.1', '26.10.03')]), Table()
        r = P._attach_history(s, '455999', [], '2026-10-04T15:01:00+00:00', write=False, execution_id='t', table=t, conflict=Table.Conflict)
        self.assertEqual(r['new'], 1)
        self.assertEqual(t.puts, 0)

    def test_reuses_retention_up_page(self):
        s, t = Session([row(9, 'EP.9', '26.10.04')]), Table()
        pages = [{'kind': 'episode_list', 'params': {'sort': 'UP', 'page': 0}, 'html': row(2, 'EP.2', '26.10.04') + row(1, 'EP.1', '26.10.03')}]
        P._attach_history(s, '455999', pages, '2026-10-04T15:01:00+00:00', write=True, execution_id='t', table=t, conflict=Table.Conflict)
        self.assertEqual(s.calls, [])
        self.assertEqual(sorted(t.item['Episodes']), ['1', '2'])

class NoEpisodes(unittest.TestCase):
    def test_zero_episode_work_without_record_is_not_fetched(self):
        # 상세의 회차 수가 0 이고 기록에도 회차가 없으면(첫 회차 전 — 하루 약 400편) 목록을 받지 않는다. 기록도 쓰지 않는다.
        s, t = Session(['']), Table({'NovelId': '455999', 'Episodes': {}, 'CheckedAt': '2026-10-04T00:05:00+09:00', 'Complete': True, 'Version': 1})
        r = P._attach_history(s, '455999', [], '2026-10-04T15:01:00+00:00', write=True, execution_id='t', table=t, conflict=Table.Conflict, eps=0)
        self.assertEqual((s.calls, t.puts, r['pages']), ([], 0, 0))

    def test_zero_episode_work_with_known_episodes_is_still_checked(self):
        # 회차를 다 지운 작품은 받아야 사라진 시각을 적는다.
        s, t = Session(['']), Table({'NovelId': '455999', 'Episodes': {'1': ['2026-10-02', None, None]}, 'CheckedAt': '2026-10-04T00:05:00+09:00', 'Complete': True, 'Version': 1})
        r = P._attach_history(s, '455999', [], '2026-10-04T15:01:00+00:00', write=True, execution_id='t', table=t, conflict=Table.Conflict, eps=0)
        self.assertEqual((s.calls, r['gone']), ([0], 1))


if __name__ == '__main__':
    unittest.main()
