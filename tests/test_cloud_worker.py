import base64
from datetime import datetime, timedelta, timezone
import json
import socket
import unittest
from unittest.mock import patch

import cloud_worker as worker


class CloudWorkerTests(unittest.TestCase):
    def snapshot(self):
        return {'schema_version': 2, 'exported_at': '2026-01-01T00:00:00Z', 'tables': {
            'manga': [{'id': 1, 'title': 'Example', 'aliases': '', 'raw_done': '', 'eng_done': '', 'th_done': '', 'translated': '', 'tracked': 1}],
            'sources': [{'id': 1, 'manga_id': 1, 'name': 'feed', 'url': 'https://feed.example/rss', 'kind': 'rss', 'lang': 'RAW', 'interval': 60, 'enabled': 1, 'checked': None, 'status': 'ยังไม่ตรวจ'}],
            'releases': [], 'translation_tasks': [], 'logs': [], 'settings': [{'key': 'refresh_mode', 'value': 'all'}]}}

    def test_public_endpoint_rejects_private_and_ip_hosts(self):
        with patch.object(worker.socket, 'getaddrinfo', return_value=[(socket.AF_INET, socket.SOCK_STREAM, 6, '', ('127.0.0.1', 443))]):
            with self.assertRaises(ValueError):
                worker.public_endpoint('https://internal.example/feed')
        with self.assertRaises(ValueError):
            worker.public_endpoint('https://127.0.0.1/feed')
        with self.assertRaises(ValueError):
            worker.public_endpoint('http://feed.example/rss')
        with patch.object(worker.socket, 'getaddrinfo', return_value=[(socket.AF_INET, socket.SOCK_STREAM, 6, '', ('93.184.215.14', 443))]):
            self.assertEqual(worker.public_endpoint('https://feed.example/rss')[2], '93.184.215.14')

    def test_https_connection_uses_pinned_address_and_original_tls_name(self):
        conn = worker.PinnedHTTPS('feed.example', '93.184.215.14')
        with patch.object(worker.socket, 'create_connection', return_value=object()) as dial, patch.object(conn._context, 'wrap_socket', return_value=object()) as tls:
            conn.connect()
        self.assertEqual(dial.call_args.args[0], ('93.184.215.14', 443))
        self.assertEqual(tls.call_args.kwargs['server_hostname'], 'feed.example')

    def test_worker_releases_are_deduplicated_and_tasks_follow_raw(self):
        snapshot = self.snapshot()
        rss = b'<rss><channel><item><title>Example Chapter 1.5</title><link>https://feed.example/chapter</link></item></channel></rss>'
        seen = []
        def requester(url, **_kwargs):
            seen.append(url)
            return 200, rss
        moment = datetime(2026, 11, 18, tzinfo=timezone.utc)
        with patch.object(worker.time, 'sleep'):
            first = worker.process_snapshot(snapshot, requester, moment)
            self.assertEqual(first, {'checked': 1, 'new': 1})
            self.assertEqual(snapshot['tables']['releases'][0]['chapter'], '1.5')
            self.assertEqual(snapshot['tables']['translation_tasks'][0]['release_id'], 1)
            second = worker.process_snapshot(snapshot, requester, moment + timedelta(minutes=30))
            self.assertEqual(second, {'checked': 0, 'new': 0})
            third = worker.process_snapshot(snapshot, requester, moment + timedelta(minutes=61))
            self.assertEqual(third, {'checked': 1, 'new': 0})
            self.assertEqual(len(snapshot['tables']['releases']), 1)
            self.assertEqual(len(seen), 2)

    def test_tracked_mode_and_error_recovery(self):
        snapshot = self.snapshot()
        snapshot['tables']['settings'][0]['value'] = 'tracked'
        snapshot['tables']['manga'][0]['tracked'] = 0
        with patch.object(worker.time, 'sleep'):
            self.assertEqual(worker.process_snapshot(snapshot, lambda _url: (500, b''))['checked'], 0)
            snapshot['tables']['manga'][0]['tracked'] = 1
            self.assertEqual(worker.process_snapshot(snapshot, lambda _url: (500, b''))['checked'], 1)
            self.assertEqual(snapshot['tables']['sources'][0]['status'], 'ผิดพลาด')
            snapshot['tables']['sources'][0]['checked'] = None
            worker.process_snapshot(snapshot, lambda _url: (200, b'<rss><channel/></rss>'))
            self.assertEqual(snapshot['tables']['logs'][-1]['status'], 'ปกติ')

    def test_store_sha_conflict_and_no_secret_in_snapshot(self):
        env = {'MW_DATA_OWNER': 'owner', 'MW_DATA_REPO': 'private', 'MW_DATA_TOKEN': 'secret'}
        payload = self.snapshot()
        calls = []
        def requester(url, **kwargs):
            calls.append((url, kwargs))
            if kwargs.get('method') == 'PUT':
                body = json.loads(kwargs['body'])
                self.assertEqual(body['sha'], 'old')
                self.assertNotIn('secret', base64.b64decode(body['content']).decode())
                return 409, b'{}'
            return 200, json.dumps({'sha': 'old', 'encoding': 'base64', 'size': 100, 'content': base64.b64encode(json.dumps(payload).encode()).decode()}).encode()
        data, sha = worker.read_store(env, requester)
        self.assertEqual(sha, 'old')
        with self.assertRaisesRegex(RuntimeError, 'ไม่เขียนทับ'):
            worker.write_store(env, data, sha, requester)
        self.assertTrue(calls[0][0].endswith('?ref=main'))


if __name__ == '__main__':
    unittest.main()
