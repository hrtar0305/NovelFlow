import os, sys, unittest
os.environ.setdefault('AWS_DEFAULT_REGION', 'ap-northeast-2')
os.environ.setdefault('DYNAMODB_TABLE_NAME', 'test-table')
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import consolidate_contest_data as C


class OpeningDay(unittest.TestCase):
    def test_opening_day_ranks_everyone_by_view_as_new(self):
        # 개막일(10/01 12:00 개막)은 직전 수집이 없지만 참가작이 모두 0 에서 출발했다 — 누적 조회가 곧 그날 조회다.
        items = [{'ID': '1', 'View': 50}, {'ID': '2', 'View': 900}, {'ID': '3', 'View': -1}]
        C.daily_rank(items, {}, C.opening_day_ids(None, '2026-10-01', items))
        self.assertEqual([(i['ID'], i.get('DailyRank'), i.get('ViewDelta'), i.get('IsNew')) for i in items],
                         [('1', 2, 50, True), ('2', 1, 900, True), ('3', None, None, None)])

    def test_other_days_without_previous_collection_stay_empty(self):
        items = [{'ID': '1', 'View': 50}]
        self.assertEqual(C.opening_day_ids(None, '2026-10-02', items), set())
        self.assertEqual(C.opening_day_ids('2026-09-30', '2026-10-01', items), set())


if __name__ == '__main__':
    unittest.main()
