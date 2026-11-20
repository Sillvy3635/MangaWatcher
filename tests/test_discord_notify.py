import copy
import json
import os
import unittest
from datetime import datetime, timedelta, timezone
from unittest.mock import patch

import cloud_worker
from discord_notify import deliver_pending, enqueue, message, pending_ids, post_message, webhook_endpoint


WEBHOOK = 'https://discord.com/api/webhooks/123456789/TEST_token-123'


def snapshot():
    return {'schema_version': 2, 'exported_at': '', 'tables': {
        'manga': [{'id': 1, 'title': '@everyone Example', 'aliases': '', 'raw_done': '',
                   'eng_done': '', 'th_done': '', 'translated': '', 'tracked': 1}],
        'sources': [{'id': 1, 'manga_id': 1, 'name': 'MangaDex',
                     'url': 'https://mangadex.org/title/11111111-1111-1111-1111-111111111111',
                     'kind': 'mangadex', 'lang': 'ENG', 'interval': 60, 'enabled': 1,
                     'checked': None, 'status': 'ยังไม่ตรวจ'}],
        'releases': [], 'translation_tasks': [], 'logs': [],
        'settings': [{'key': 'refresh_mode', 'value': 'all'}]}}


class DiscordNotificationTests(unittest.TestCase):
    def test_webhook_allowlist(self):
        self.assertEqual(webhook_endpoint(WEBHOOK), WEBHOOK + '?wait=true')
        for url in ('http://discord.com/api/webhooks/1/token',
                    'https://discord.com.evil.test/api/webhooks/1/token',
                    'https://discord.com@evil.test/api/webhooks/1/token',
                    'https://discord.com/api/webhooks/1/token?wait=false'):
            with self.assertRaises(ValueError):
                webhook_endpoint(url)

    def test_baseline_is_silent_and_future_release_is_queued_once(self):
        data = snapshot()
        chapters = [1, 2]
        def feed(_url):
            rows = [{'id': f'chapter-{n}', 'attributes': {'chapter': str(n),
                    'title': '', 'translatedLanguage': 'en',
                    'publishAt': f'2026-11-{n:02d}T00:00:00Z'}} for n in reversed(chapters)]
            return 200, json.dumps({'result': 'ok', 'data': rows}).encode()
        moment = datetime(2026, 11, 20, tzinfo=timezone.utc)
        with patch.object(cloud_worker.time, 'sleep'):
            self.assertEqual(cloud_worker.process_snapshot(data, feed, moment, notify_enabled=True)['new'], 0)
            self.assertEqual(pending_ids(data), [])
            chapters.append(3)
            self.assertEqual(cloud_worker.process_snapshot(data, feed, moment + timedelta(minutes=61), notify_enabled=True)['new'], 1)
            self.assertEqual(pending_ids(data), [2])
            cloud_worker.process_snapshot(data, feed, moment + timedelta(minutes=122), notify_enabled=True)
            self.assertEqual(pending_ids(data), [2])
        self.assertNotIn('TEST_token', json.dumps(data))

    def test_confirmed_post_is_acknowledged_and_mentions_disabled(self):
        data = snapshot()
        data['tables']['releases'].append({'id': 1, 'source_id': 1, 'chapter': '3',
            'title': '', 'url': 'https://mangadex.org/chapter/abc', 'published': None,
            'detected': '2026-11-20T00:00:00Z', 'lang': 'ENG', 'external_id': 'abc'})
        enqueue(data, [1])
        stored = copy.deepcopy(data)
        calls = []
        def post(url, **kwargs):
            self.assertEqual(url, WEBHOOK + '?wait=true')
            self.assertEqual(kwargs['method'], 'POST')
            body = json.loads(kwargs['body'])
            self.assertEqual(body['allowed_mentions'], {'parse': []})
            self.assertIn('@everyone Example', body['content'])
            calls.append(body)
            return 200, b'{"id":"discord-message-1"}'
        def read(_env):
            return copy.deepcopy(stored), 'sha'
        def write(_env, fresh, _sha):
            nonlocal stored
            stored = copy.deepcopy(fresh)
        sent = deliver_pending({}, WEBHOOK, data, read, write, post, lambda _: None)
        self.assertEqual(sent, 1)
        self.assertEqual(pending_ids(stored), [])
        self.assertEqual(len(calls), 1)
        self.assertEqual(deliver_pending({}, WEBHOOK, stored, read, write, post, lambda _: None), 0)
        self.assertEqual(len(calls), 1)

    def test_rss_first_check_does_not_alert_historical_items(self):
        data = snapshot()
        data['tables']['sources'][0].update(kind='rss', url='https://feed.example/rss')
        chapter = [1]
        def feed(_url):
            items = ''.join(f'<item><title>@everyone Example Chapter {n}</title>'
                            f'<link>https://feed.example/chapter-{n}</link></item>' for n in chapter)
            return 200, ('<rss><channel>' + items + '</channel></rss>').encode()
        moment = datetime(2026, 11, 20, tzinfo=timezone.utc)
        with patch.object(cloud_worker.time, 'sleep'):
            self.assertEqual(cloud_worker.process_snapshot(data, feed, moment, notify_enabled=True)['new'], 1)
            self.assertEqual(pending_ids(data), [])
            chapter.append(2)
            self.assertEqual(cloud_worker.process_snapshot(data, feed, moment + timedelta(minutes=61), notify_enabled=True)['new'], 1)
            self.assertEqual(pending_ids(data), [2])
    def test_http_failure_keeps_outbox_and_rate_limit_is_retried(self):
        with self.assertRaisesRegex(RuntimeError, 'HTTP 403'):
            post_message(WEBHOOK, 'test', lambda *_args, **_kwargs: (403, b'{}'))
        responses = iter([(429, b'{"retry_after":0.5}'), (200, b'{"id":"ok"}')])
        waits = []
        post_message(WEBHOOK, 'test', lambda *_args, **_kwargs: next(responses), waits.append)
        self.assertEqual(waits, [0.5])
        data = snapshot()
        data['tables']['releases'].append({'id': 9, 'source_id': 1, 'chapter': '9',
            'title': '', 'url': 'https://mangadex.org/chapter/nine', 'published': None,
            'detected': '2026-11-20T00:00:00Z', 'lang': 'ENG', 'external_id': 'nine'})
        enqueue(data, [9])
        with self.assertRaisesRegex(RuntimeError, 'HTTP 403'):
            deliver_pending({}, WEBHOOK, data, lambda _: (data, 'sha'),
                            lambda *_: None, lambda *_args, **_kwargs: (403, b'{}'))
        self.assertEqual(pending_ids(data), [9])

    def test_manual_connection_test_is_labelled_and_requires_secret(self):
        with patch.dict(os.environ, {'MW_DISCORD_TEST': 'true'}, clear=True):
            with self.assertRaisesRegex(ValueError, 'MW_DISCORD_WEBHOOK_URL'):
                cloud_worker.main()
        with patch.dict(os.environ, {'MW_DISCORD_TEST': 'true',
                                      'MW_DISCORD_WEBHOOK_URL': WEBHOOK}, clear=True), \
             patch.object(cloud_worker, 'read_store', return_value=(snapshot(), 'sha')), \
             patch.object(cloud_worker, 'process_snapshot', return_value={'checked': 0, 'new': 0}), \
             patch.object(cloud_worker, 'deliver_pending', return_value=0), \
             patch.object(cloud_worker, 'post_message') as send, \
             patch('builtins.print'):
            cloud_worker.main()
        self.assertIn('ทดสอบ', send.call_args.args[1])
        self.assertIn('ไม่มีข้อมูลตอนจำลอง', send.call_args.args[1])


if __name__ == '__main__':
    unittest.main()
