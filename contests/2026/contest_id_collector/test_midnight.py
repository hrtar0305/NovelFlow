"""자정 경로: 장애 응답으로 남은 번호 다시 보기 · 표시 수 다시 읽기 — `cd contests/2026/contest_id_collector && python -m unittest test_midnight`."""
import os
import unittest
from datetime import datetime, timedelta
from unittest import mock

os.environ.setdefault('S3_BUCKET_NAME', 'test-bucket')
import app  # noqa: E402


def ago(hours):
    return (datetime.now(app.KST) - timedelta(hours=hours)).strftime('%Y-%m-%dT%H:%M:%S%z')


class Midnight(unittest.TestCase):
    def run_midnight(self, recheck, pages, listed=2):
        """recheck: 재확인 목록. pages: {번호: check 결과}. 끝 번호(100)는 '잘못된 소설 번호'라 훑기는 바로 끝난다."""
        state = {app.STATE_KEY: {'next_id': 100, 'last_checked_id': 99},
                 app.CONTEST_META_KEY: {'1': {'found_at': ago(30)}}, app.RECHECK_KEY: recheck, app.GONE_KEY: []}
        self.put, self.checked = {}, []

        def check(_s, nid):
            self.checked.append(nid)
            return pages.get(nid, ('invalid', '잘못된 소설 번호'))
        ctx = mock.Mock(get_remaining_time_in_millis=lambda: 600_000)
        with mock.patch.object(app, '_get', side_effect=lambda k, d: state.get(k, d)), \
             mock.patch.object(app, '_put', side_effect=lambda k, o: self.put.__setitem__(k, o)), \
             mock.patch.object(app, 'check', side_effect=check), \
             mock.patch.object(app, 'listed_total', return_value=listed), \
             mock.patch.object(app.time, 'sleep'):
            return app.handler({'execution_id': 'm'}, ctx)

    def test_outage_retry_found_at_midnight_counts_as_new(self):
        # 2026-10-25: 빈 페이지(200·0바이트)로 '다시 볼 번호'가 된 참가작 2편이 그날 기록에서 빠졌다. 자정에 바로 다시 본다.
        out = self.run_midnight({'50': {'reason': 'no title (status 200, 0 bytes)', 'first_seen': ago(1), 'status': 'retry'}},
                                {50: ('contest', {'author_id': None, 'author': 'a', 'title': 't'})})
        self.assertEqual(self.put[app.ID_LIST_KEY], [1, 50])
        meta = self.put[app.CONTEST_META_KEY]['50']
        self.assertEqual(meta['via'], 'midnight-recheck')   # 번호 훑기와 같은 시점 — 적재가 신작으로 친다
        self.assertEqual(self.put[app.RECHECK_KEY]['50']['status'], 'contest')
        self.assertEqual(out['alive_contest'], 2)

    def test_old_outage_retry_is_not_new(self):
        # 하루 넘게 묵은 번호는 등록이 그 전일 수 있다 — 첫날 일간 값을 매기지 않는 'recheck' 로 둔다.
        self.run_midnight({'50': {'reason': 'request failed: timeout', 'first_seen': ago(30), 'status': 'retry'}},
                          {50: ('contest', {'author_id': None, 'author': 'a', 'title': 't'})})
        self.assertEqual(self.put[app.CONTEST_META_KEY]['50']['via'], 'recheck')

    def test_private_alert_is_left_to_prep(self):
        # 경고창(비공개·삭제)은 제대로 된 응답이다 — 자정엔 다시 보지 않는다(준비 실행이 본다).
        self.run_midnight({'60': {'reason': '잘못된 접근입니다.', 'first_seen': ago(1), 'status': 'retry'}}, {}, listed=1)
        self.assertNotIn(60, self.checked)


class ListedTotal(unittest.TestCase):
    def test_retries_until_the_count_shows(self):
        # 장애 중엔 목록 페이지도 비어 온다 — 한 번 못 읽었다고 수 비교를 건너뛰지 않는다(10-25 은 건너뛰어 2편을 놓쳤다).
        s = mock.Mock()
        s.get.side_effect = [mock.Mock(text=''), mock.Mock(text=''), mock.Mock(text='<b>총 1,234개 작품</b>')]
        with mock.patch.object(app.time, 'sleep'):
            self.assertEqual(app.listed_total(s), 1234)


if __name__ == '__main__':
    unittest.main()
