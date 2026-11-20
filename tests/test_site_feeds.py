import unittest
from datetime import datetime, timezone
from unittest.mock import patch

import cloud_worker
from server import rss_parse, select_feed_updates
from site_feeds import feed_urls, parse_site_feed, series_feed


def item(title, link):
    return f'<item><title>{title}</title><link>{link}</link><pubDate>Fri, 20 Nov 2026 00:00:00 GMT</pubDate></item>'


def feed(*items):
    return ('<rss><channel>' + ''.join(items) + '</channel></rss>').encode()


class SiteFeedTests(unittest.TestCase):
    def test_site_url_is_exact_allowlist(self):
        source = {'url': 'https://en-thunderscans.com/comics/survivalism', 'lang': 'ENG'}
        self.assertEqual(series_feed(source), ('thunder', 'survivalism'))
        self.assertEqual(len(feed_urls(source)), 6)
        for url in ('https://en-thunderscans.com.evil.test/comics/survivalism',
                    'https://en-thunderscans.com@evil.test/comics/survivalism',
                    'https://asurascans.com/comics/survivalism',
                    'http://en-thunderscans.com/comics/survivalism'):
            with self.assertRaises(ValueError):
                series_feed({'url': url, 'lang': 'ENG'})

    def test_thunder_feed_matches_exact_title_and_chapter_link(self):
        source = {'url': 'https://en-thunderscans.com/comics/survivalism', 'lang': 'ENG',
                  'manga_title': 'Survivalism', 'aliases': ''}
        raw = feed(
            item('Survivalism Chapter 21', 'https://en-thunderscans.com/survivalism-chapter-21/?utm_source=rss'),
            item('Survivalism Extra Chapter 22', 'https://en-thunderscans.com/survivalism-chapter-22/'),
            item('Survivalism Chapter 23', 'https://evil.test/survivalism-chapter-23/'),
            item('Other Survivalism Chapter 24', 'https://en-thunderscans.com/other-survivalism-chapter-24/'))
        found = parse_site_feed(raw, source, rss_parse)
        self.assertEqual([(row['chapter'], row['url']) for row in found],
                         [('21', 'https://en-thunderscans.com/survivalism-chapter-21/')])

    def test_qi_feed_exact_series_and_premium_label(self):
        source = {'url': 'https://qimanga.com/series/youngest-daughter', 'lang': 'ENG',
                  'manga_title': 'Youngest Daughter', 'aliases': ''}
        raw = feed(item('Youngest Daughter – Chapter 29 (Premium)',
                        'https://qimanga.com/series/youngest-daughter/chapter-29'),
                   item('Youngest Daughter – Chapter 30',
                        'https://qimanga.com/series/other/chapter-30'))
        found = parse_site_feed(raw, source, rss_parse)
        self.assertEqual([row['chapter'] for row in found], ['29'])
        self.assertEqual(found[0]['url'], 'https://qimanga.com/series/youngest-daughter/chapter-29/')

    def test_historical_chapter_is_not_reported_as_new(self):
        incoming = [{'chapter': str(ch), 'lang': 'ENG', 'published': None,
                     'external_id': str(ch)} for ch in (20, 21, 22)]
        existing = [{'chapter': '21', 'lang': 'ENG', 'published': None}]
        self.assertEqual([row['chapter'] for row in select_feed_updates(incoming, existing, True, 'site_feed')[0]], ['22'])
        self.assertEqual([row['chapter'] for row in select_feed_updates(incoming, [], True, 'site_feed')[0]], ['22'])

    def test_cloud_worker_reuses_shared_thunder_feed(self):
        manga = [{'id': n, 'title': title, 'aliases': '', 'raw_done': '', 'eng_done': '',
                  'th_done': '', 'translated': '', 'tracked': 1}
                 for n, title in ((1, 'Survivalism'), (2, 'Other Story'))]
        sources = [{'id': n, 'manga_id': n, 'name': 'Thunder',
                    'url': f'https://en-thunderscans.com/comics/{slug}', 'kind': 'site_feed',
                    'lang': 'ENG', 'interval': 60, 'enabled': 1, 'checked': None, 'status': 'ยังไม่ตรวจ'}
                   for n, slug in ((1, 'survivalism'), (2, 'other-story'))]
        snapshot = {'schema_version': 2, 'exported_at': '', 'tables': {
            'manga': manga, 'sources': sources, 'releases': [], 'translation_tasks': [],
            'logs': [], 'settings': [{'key': 'refresh_mode', 'value': 'all'}]}}
        calls = []
        def requester(url):
            calls.append(url)
            if url.endswith('/feed/'):
                return 200, feed(item('Survivalism Chapter 21', 'https://en-thunderscans.com/survivalism-chapter-21/'),
                                 item('Other Story Chapter 5', 'https://en-thunderscans.com/other-story-chapter-5/'))
            return 200, feed()
        with patch.object(cloud_worker.time, 'sleep'):
            result = cloud_worker.process_snapshot(snapshot, requester, datetime(2026, 11, 20, tzinfo=timezone.utc))
        self.assertEqual(result, {'checked': 2, 'new': 0})
        self.assertEqual(len(calls), 6)
        self.assertEqual({row['chapter'] for row in snapshot['tables']['releases']}, {'21', '5'})


if __name__ == '__main__':
    unittest.main()
