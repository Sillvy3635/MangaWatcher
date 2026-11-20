"""Public, publisher-provided chapter feeds for explicitly mapped series."""
import re
import unicodedata
from urllib.parse import urlparse, urlunparse


THUNDER_HOST = 'en-thunderscans.com'
QI_HOST = 'qimanga.com'
THUNDER_PAGES = 6


def series_feed(source):
    """Return a fixed feed and series slug; never fetch a URL inferred from feed data."""
    parsed = urlparse(source['url'])
    if parsed.scheme != 'https' or parsed.port not in (None, 443) or parsed.username or parsed.password or parsed.query or parsed.fragment or source['lang'] != 'ENG':
        raise ValueError('ต้องใช้ URL หน้าเรื่อง HTTPS ภาษา ENG ของเว็บไซต์ที่รองรับ')
    path = parsed.path.rstrip('/')
    if parsed.hostname == THUNDER_HOST and re.fullmatch(r'/comics/[a-z0-9-]+', path):
        return 'thunder', path.split('/')[-1]
    if parsed.hostname == QI_HOST and re.fullmatch(r'/series/[a-z0-9-]+', path):
        return 'qi', path.split('/')[-1]
    raise ValueError('ยังไม่รองรับ URL หน้าเรื่องนี้สำหรับฟีดเว็บไซต์')


def feed_urls(source):
    site, _ = series_feed(source)
    if site == 'thunder':
        return [f'https://{THUNDER_HOST}/feed/'] + [f'https://{THUNDER_HOST}/feed/?paged={page}' for page in range(2, THUNDER_PAGES + 1)]
    return [f'https://{QI_HOST}/rss.xml']


def _title_key(value):
    value = unicodedata.normalize('NFKC', value).casefold()
    return ''.join(ch for ch in value if ch.isalnum())


def parse_site_feed(raw, source, rss_parser):
    site, slug = series_feed(source)
    names = {_title_key(name.strip()) for name in (source['manga_title'] + '|' + source['aliases']).split('|') if name.strip()}
    result = []
    for item in rss_parser(raw, source):
        parsed = urlparse(item['url'])
        if parsed.scheme != 'https' or parsed.username or parsed.password or parsed.port not in (None, 443):
            continue
        path = parsed.path.rstrip('/')
        if site == 'thunder':
            if parsed.hostname != THUNDER_HOST or not re.fullmatch(re.escape('/' + slug + '-chapter-') + r'[a-z0-9.-]+', path):
                continue
        elif parsed.hostname != QI_HOST or not re.fullmatch(re.escape('/series/' + slug + '/chapter-') + r'[a-z0-9.-]+', path):
            continue
        match = re.fullmatch(r'(.+?)(?:\s*[–—:-]\s*|\s+)(?:Chapter|Ch\.?)\s*[:#]?\s*\d+(?:\.\d+)?(?:\s*\(Premium\))?', item['title'], re.IGNORECASE)
        if not match or _title_key(match.group(1)) not in names:
            continue
        canonical = urlunparse((parsed.scheme, parsed.netloc, path + '/', '', '', ''))
        item['url'] = canonical
        item['external_id'] = canonical
        result.append(item)
    return result
