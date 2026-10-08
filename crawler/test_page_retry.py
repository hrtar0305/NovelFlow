"""쓸 수 없는 페이지를 같은 호출 안에서 다시 받는지 — `cd crawler && python -m unittest test_page_retry`."""
import json, os, sys, unittest
from unittest import mock
os.environ.setdefault('SQS_QUEUE_URL', 'https://example.invalid/q')
os.environ.setdefault('AWS_DEFAULT_REGION', 'ap-northeast-2')
os.environ.setdefault('RAW_HTML_BUCKET', 'raw-bucket')   # app 의 Config 는 import 때 굳는다 — 다른 테스트와 같은 값
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import app

EVENT = {'execution_id': 't', 'auth_cookies_version': '1', 'novel': {'id': '330363', 'ranking': 97, 'score': 1, 'date': '2026-10-08'}}
GOOD = {'ID': '330363', 'Title': '부캐 키우는 황태자님', 'Date': '2026-10-08', 'Ranking': 97}


def run(*outcomes):
    """_collect_detail 이 차례로 내놓을 결과(예외 또는 항목). 원본 한 쪽씩 쌓는다."""
    seq = iter(outcomes)

    def collect(session, novel_info, raw_pages, execution_id):
        raw_pages.append({'kind': 'detail', 'html': '<html>'})
        o = next(seq)
        if isinstance(o, Exception):
            raise o
        return dict(o), None

    sqs = mock.Mock()
    with mock.patch.object(app, '_collect_detail', side_effect=collect), \
         mock.patch.object(app, '_load_auth_cookies', return_value=[]), \
         mock.patch.object(app, '_update_history', return_value={}), \
         mock.patch.object(app.time, 'sleep') as sleep, \
         mock.patch.object(app.boto3, 'client', return_value=sqs), \
         mock.patch.object(app.raw_store, 'build_message_payload', side_effect=lambda nid, d, pages, meta: (pages, {})):
        out = app.parse_novel_details(dict(EVENT), None)
    sent = json.loads(sqs.send_message.call_args.kwargs['MessageBody'])
    return out, sent, sleep


class PageRetry(unittest.TestCase):
    def test_truncated_page_recovers_on_retry(self):
        # 2026-10-08 330363: 200 인데 31KB 에서 잘린 쪽 — 필수 요소가 없어 ValueError. 다시 받으면 멀쩡했다.
        out, sent, sleep = run(ValueError('Missing required detail selectors: TITLE'), GOOD)
        self.assertEqual(out['status'], 'SUCCESS')
        self.assertEqual(sent['Title'], GOOD['Title'])
        self.assertEqual([p['kind'] for p in sent[app.raw_store.RAW_FIELD]], ['detail_failed', 'detail'])
        sleep.assert_called_once_with(2)

    def test_placeholder_only_after_all_attempts_keeps_reason(self):
        out, sent, sleep = run(*[app.PageUnusable('Inaccessible')] * app.PAGE_ATTEMPTS)
        self.assertEqual(out['status'], 'PLACEHOLDER_CREATED')
        self.assertEqual(sent['Title'], 'N/A (Inaccessible)')
        self.assertEqual(sleep.call_count, app.PAGE_ATTEMPTS - 1)

    def test_missing_retention_is_retried_once_without_refetching_detail(self):
        partial = {**GOOD, 'RetentionFetchError': ['views'], 'FirstEpView': 7}
        cases = ((['views'], ['views'], -1, ['<html>', 'second']), (None, None, -1, ['<html>', 'second']),
                 (['views', 'recent'], ['views'], 7, ['<html>']))
        for again, expect, first_view, raw in cases:
            def retention(session, nid, item, raw_pages, eid, again=again):
                raw_pages.append({'kind': 'episode_list', 'html': 'second'})
                if again:
                    item['RetentionFetchError'] = again
            with mock.patch.object(app, '_collect_retention', side_effect=retention) as r:
                out, sent, _ = run(partial)                         # 상세는 한 번만 받았다(run 의 결과가 하나뿐)
            self.assertEqual(out['status'], 'SUCCESS')              # 행은 살린다 — 빠진 값만 표시
            self.assertEqual(sent.get('RetentionFetchError'), expect)
            self.assertEqual(r.call_count, 1)
            self.assertEqual(sent['FirstEpView'], first_view)       # 더 많이 빠진 재시도는 첫 결과로 되돌린다
            self.assertEqual([p['html'] for p in sent[app.raw_store.RAW_FIELD]], raw)   # 두 시도의 목록을 겹쳐 싣지 않는다

DETAIL = ('<html><div class="epnew-novel-title">제목</div><a class="writer-name" href="/user/42">작가</a>'
          '<div class="counter-line-a"><span>1,000</span><span>10</span></div>'
          '<div class="info-count2"><span class="gray-txt">5</span><span class="gray-txt">6</span><span class="gray-txt">35회차</span></div>'
          '<div class="synopsis-story">소개</div></html>')


def ep_list(ids):
    return ''.join(f'<div class="ep_style2"><span>EP.{i}</span><span class="episode_count_view novel_count_view_{i}">1</span>'
                   f'<b>26.10.0{1 + i % 7}</b></div>' for i in ids)


class Resp:
    status_code = 200

    def __init__(self, text):
        self.text = text

    def raise_for_status(self):
        pass


class DetailSession:
    def get(self, url, timeout=None):
        return Resp(DETAIL)


class CollectDetail(unittest.TestCase):
    """_collect_detail·_collect_retention 을 실제 셀렉터로 — 통째로 mock 하면 들여쓰기 실수가 숨는다(리뷰 2026-10-08)."""

    def collect(self, views):
        lists = lambda s, nid, sort, page=0, pages=None: ep_list(range(1, 36) if sort == 'DOWN' else range(35, 0, -1)) if page == 0 else ''
        with mock.patch.object(app, '_get_episode_list_html', side_effect=lists), \
             mock.patch.object(app, '_get_episode_view_counts', side_effect=lambda s, nid, ids, e: views(ids)):
            item, _ = app._collect_detail(DetailSession(), EVENT['novel'], [], 't')
        return item

    def test_all_retention_values_filled(self):
        item = self.collect(lambda ids: {int(i): 100 + int(i) for i in ids})
        self.assertEqual((item['FirstEpNum'], item['Ep30Num'], item['TargetLatestEpNum'], item['RecentBaseNum']), (1, 30, 35, 6))
        self.assertEqual(item['FirstEpView'], 101)
        self.assertNotIn('RetentionFetchError', item)

    def test_missing_view_count_is_marked(self):
        item = self.collect(lambda ids: {int(i): 1 for i in ids if i != '30'})
        self.assertEqual(item['RetentionFetchError'], ['views'])
        self.assertEqual(item['FirstEpView'], 1)          # 받은 값은 그대로 채운다
