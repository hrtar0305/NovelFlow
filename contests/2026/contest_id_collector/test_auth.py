"""로그인 세션 확인 점검 — `cd contests/2026/contest_id_collector && python -m unittest test_auth`."""
import json
import os
import unittest
from unittest import mock

os.environ.setdefault('S3_BUCKET_NAME', 'test-bucket')
import app  # noqa: E402

COOKIES = json.dumps([{'name': 'LOGINKEY', 'value': 'x', 'domain': '.novelpia.com', 'path': '/'}])


def pages(*ages):
    return [{'page': 1, 'raw': {'writer_other_novel': {'list': [{'novel_no': '1', 'novel_age': a} for a in ages]}}}]


class AuthSessions(unittest.TestCase):
    def setUp(self):
        ssm = mock.Mock()
        ssm.get_parameter.return_value = {'Parameter': {'Value': COOKIES}}
        self.ssm = mock.patch.object(app.boto3, 'client', return_value=ssm)
        self.ssm.start()

    def tearDown(self):
        self.ssm.stop()

    def test_adult_work_on_a_canary_means_logged_in(self):
        with mock.patch.object(app, 'author_works', side_effect=[pages('0'), pages('15', '19')]):
            s = app.auth_sessions('t')
        self.assertEqual(len(s), app.WORKERS)
        self.assertEqual(s[0].cookies.get('LOGINKEY'), 'x')

    def test_no_adult_work_anywhere_means_anonymous(self):
        # 만료된 쿠키는 오류 없이 익명 결과를 준다 — 그대로 받으면 19금이 빠진 목록이 굳는다.
        with mock.patch.object(app, 'author_works', return_value=pages('0', '15')):
            self.assertIsNone(app.auth_sessions('t'))

    def test_unreadable_cookie_skips(self):
        app.boto3.client.return_value.get_parameter.side_effect = RuntimeError('denied')
        self.assertIsNone(app.auth_sessions('t'))


if __name__ == '__main__':
    unittest.main()
