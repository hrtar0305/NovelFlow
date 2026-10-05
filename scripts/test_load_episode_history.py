import os, sys, unittest
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import load_episode_history as L

class T(unittest.TestCase):
    def test_backfill_record_becomes_complete_item_with_null_first_seen(self):
        rec = {'novel_id': '378108', 'source': 'daily', 'checked_at': '2026-10-05T12:00:00+09:00', 'status': 'ok',
               'episodes': [['6136739', 'EP.60', '2026-10-04', '26.10.04'], ['5230728', 'EP.42', '2025-12-24', '25.12.24']],
               'scheduled': [['9', '제목', '공개예정 5시간후', '2026-10-05T12:00:00+09:00']], 'pages': 4}
        it = L.to_item(rec)
        self.assertEqual(it['NovelId'], '378108')
        self.assertEqual(it['Episodes']['6136739'], ['2026-10-04', None, None])
        self.assertTrue(it['Complete'])
        self.assertEqual(it['OldestDate'], '2025-12-24')
        self.assertEqual(it['CheckedCount'], 2)
        self.assertEqual(it['Version'], 1)

    def test_empty_status_is_empty_complete_item(self):
        it = L.to_item({'novel_id': '1', 'checked_at': '2026-10-05T12:00:00+09:00', 'status': 'empty', 'episodes': [], 'scheduled': []})
        self.assertEqual(it['Episodes'], {})
        self.assertTrue(it['Complete'])
        self.assertIsNone(it['OldestDate'])

    def test_episode_without_date_is_skipped(self):
        it = L.to_item({'novel_id': '2', 'checked_at': 'x', 'status': 'ok', 'episodes': [['5', 'EP.1', None, '?']], 'scheduled': []})
        self.assertEqual(it['Episodes'], {})

if __name__ == '__main__':
    unittest.main()
