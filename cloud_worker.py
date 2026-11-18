"""Scheduled private JSON metadata checker. Never use local SQLite here."""

import base64
from datetime import datetime, timezone
import http.client
import ipaddress
import json
import os
import socket
import ssl
import time
from urllib.parse import quote, urlencode, urlsplit

from server import dex_id, dex_parse, rss_parse

MAX_BYTES = 900_000
USER_AGENT = 'MangaWatcher-cloud/0.1 (personal metadata tracker)'


def utc_now():
    return datetime.now(timezone.utc).isoformat(timespec='seconds')


def public_endpoint(url):
    parts = urlsplit(url)
    if parts.scheme != 'https' or not parts.hostname or parts.username or parts.password or parts.port not in (None, 443):
        raise ValueError('worker รับเฉพาะ HTTPS พอร์ต 443')
    host = parts.hostname.encode('idna').decode('ascii')
    try:
        ipaddress.ip_address(host)
    except ValueError:
        pass
    else:
        raise ValueError('worker ไม่รับ URL ที่เป็น IP โดยตรง')
    addresses = socket.getaddrinfo(host, 443, type=socket.SOCK_STREAM)
    if not addresses or any(not ipaddress.ip_address(item[4][0]).is_global for item in addresses):
        raise ValueError('ไม่อนุญาต URL เครือข่ายส่วนตัว')
    return parts, host, addresses[0][4][0]


class PinnedHTTPS(http.client.HTTPSConnection):
    def __init__(self, host, address):
        super().__init__(host, timeout=15, context=ssl.create_default_context())
        self.address = address

    def connect(self):
        sock = socket.create_connection((self.address, 443), self.timeout)
        self.sock = self._context.wrap_socket(sock, server_hostname=self.host)


def request_bytes(url, method='GET', body=None, token=None, tries=3):
    parts, host, address = public_endpoint(url)
    path = parts.path or '/'
    if parts.query:
        path += '?' + parts.query
    headers = {'Host': host, 'User-Agent': USER_AGENT, 'Accept': 'application/vnd.github+json' if token else 'application/json, application/rss+xml, application/atom+xml, application/xml, text/xml'}
    if token:
        if host != 'api.github.com':
            raise ValueError('token ใช้ได้กับ GitHub API เท่านั้น')
        headers['Authorization'] = 'Bearer ' + token
        headers['X-GitHub-Api-Version'] = '2026-03-10'
    if body is not None:
        headers['Content-Type'] = 'application/json'
    for attempt in range(tries):
        conn = PinnedHTTPS(host, address)
        try:
            conn.request(method, path, body=body, headers=headers)
            response = conn.getresponse()
            response_limit = 1_400_000 if token else MAX_BYTES
            raw = response.read(response_limit + 1)
            if len(raw) > response_limit:
                raise ValueError('ข้อมูลที่รับเกินขนาดที่รองรับ')
            status = response.status
            if status in (301, 302, 303, 307, 308):
                raise ValueError('worker ไม่ตาม redirect')
            if status in (429, 500, 502, 503, 504) and method == 'GET' and attempt + 1 < tries:
                time.sleep(min(10, 2 ** attempt))
                continue
            return status, raw
        finally:
            conn.close()
    raise RuntimeError('คำขอไม่สำเร็จ')


def store_url(env):
    owner, repo = env['MW_DATA_OWNER'], env['MW_DATA_REPO']
    path = env.get('MW_DATA_PATH') or 'mangawatcher.json'
    branch = env.get('MW_DATA_BRANCH') or 'main'
    if not all(part and all(c.isalnum() or c in '-_.' for c in part) for part in (owner, repo)) or not path or '..' in path or path.startswith('/'):
        raise ValueError('ตั้งค่า private repository ไม่ถูกต้อง')
    base = 'https://api.github.com/repos/' + quote(owner) + '/' + quote(repo) + '/contents/' + '/'.join(quote(part) for part in path.split('/'))
    return base, branch


def read_store(env, requester=request_bytes):
    base, branch = store_url(env)
    status, raw = requester(base + '?ref=' + quote(branch), token=env['MW_DATA_TOKEN'])
    if status != 200:
        raise RuntimeError('อ่าน private JSON ไม่สำเร็จ (HTTP %s); นำเข้า backup ก่อนหากยังไม่มีไฟล์' % status)
    file = json.loads(raw)
    if file.get('encoding') != 'base64' or not file.get('sha') or file.get('size', MAX_BYTES + 1) > MAX_BYTES:
        raise ValueError('private JSON ไม่ถูกต้องหรือใหญ่เกินขนาด')
    snapshot = json.loads(base64.b64decode(file['content']))
    tables = snapshot.get('tables', {})
    if snapshot.get('schema_version') != 2 or any(not isinstance(tables.get(name), list) for name in ('manga', 'sources', 'releases', 'translation_tasks', 'logs', 'settings')):
        raise ValueError('private JSON schema ไม่ถูกต้อง')
    return snapshot, file['sha']


def write_store(env, snapshot, sha, requester=request_bytes):
    base, branch = store_url(env)
    content = json.dumps(snapshot, ensure_ascii=False, separators=(',', ':')).encode('utf-8')
    if len(content) > MAX_BYTES:
        raise ValueError('private JSON ใหญ่เกิน 900 KB; ต้องแบ่งไฟล์ก่อนบันทึก')
    body = json.dumps({'message': 'MangaWatcher: scheduled metadata check', 'content': base64.b64encode(content).decode('ascii'), 'sha': sha, 'branch': branch}).encode('utf-8')
    status, _ = requester(base, method='PUT', body=body, token=env['MW_DATA_TOKEN'], tries=1)
    if status in (409, 422):
        raise RuntimeError('ข้อมูลเปลี่ยนระหว่างตรวจ; ไม่เขียนทับ กรุณารันใหม่')
    if status not in (200, 201):
        raise RuntimeError('บันทึก private JSON ไม่สำเร็จ (HTTP %s)' % status)


def due(source, logs, current):
    if not source.get('checked'):
        return True
    errors = 0
    for log in sorted((row for row in logs if row['source_id'] == source['id']), key=lambda row: row['id'], reverse=True):
        if log['status'] != 'ผิดพลาด':
            break
        errors += 1
        if errors == 4:
            break
    minutes = min(1440, source['interval'] * (2 ** errors))
    try:
        checked = datetime.fromisoformat(source['checked'].replace('Z', '+00:00'))
        if checked.tzinfo is None:
            checked = checked.replace(tzinfo=timezone.utc)
        return (current - checked).total_seconds() >= minutes * 60
    except (ValueError, TypeError):
        return True


def check_source(source, manga, requester):
    if source['kind'] == 'mangadex':
        q = [('limit', '100'), ('order[publishAt]', 'desc'), ('contentRating[]', 'safe'), ('contentRating[]', 'suggestive')]
        for lang in {'ENG': ['en'], 'TH': ['th'], 'RAW': ['ja', 'ko', 'zh', 'zh-hk'], 'ALL': []}[source['lang']]:
            q.append(('translatedLanguage[]', lang))
        endpoint = 'https://api.mangadex.org/manga/' + dex_id(source['url']) + '/feed?' + urlencode(q)
        status, raw = requester(endpoint)
        if status != 200:
            raise RuntimeError('MangaDex HTTP %s' % status)
        return dex_parse(json.loads(raw), source['lang'])
    if source['kind'] == 'rss':
        status, raw = requester(source['url'])
        if status != 200:
            raise RuntimeError('RSS HTTP %s' % status)
        return rss_parse(raw, {**source, 'manga_title': manga['title'], 'aliases': manga['aliases']})
    raise ValueError('ยังไม่มี adapter สำหรับแหล่งนี้')


def process_snapshot(snapshot, requester=request_bytes, current=None):
    current = current or datetime.now(timezone.utc)
    tables = snapshot['tables']
    manga_by_id = {row['id']: row for row in tables['manga']}
    mode = next((row['value'] for row in tables['settings'] if row['key'] == 'refresh_mode'), 'all')
    known = {(row['source_id'], row['external_id'], row['lang']) for row in tables['releases']}
    next_release = max((row['id'] for row in tables['releases']), default=0) + 1
    next_log = max((row['id'] for row in tables['logs']), default=0) + 1
    checked = added = 0
    for source in tables['sources']:
        manga = manga_by_id.get(source['manga_id'])
        if not manga or not source['enabled'] or source['kind'] == 'manual' or (mode == 'tracked' and not manga['tracked']) or not due(source, tables['logs'], current):
            continue
        try:
            incoming = check_source(source, manga, requester)
            new = 0
            for item in incoming:
                if item['lang'] not in ('RAW', 'ENG', 'TH'):
                    continue
                key = source['id'], item['external_id'], item['lang']
                if key in known:
                    continue
                release = {'id': next_release, 'source_id': source['id'], 'chapter': item['chapter'], 'title': item['title'], 'url': item['url'], 'published': item.get('published'), 'detected': current.isoformat(), 'lang': item['lang'], 'external_id': item['external_id']}
                tables['releases'].append(release)
                if item['lang'] == 'RAW' and manga['tracked']:
                    tables['translation_tasks'].append({'release_id': next_release, 'stage': 'RAW', 'updated': current.isoformat()})
                known.add(key)
                next_release += 1
                new += 1
            added += new
            source['status'] = 'ปกติ'
            previous = next((row for row in reversed(tables['logs']) if row['source_id'] == source['id']), None)
            if new or (previous and previous['status'] == 'ผิดพลาด'):
                tables['logs'].append({'id': next_log, 'source_id': source['id'], 'at': current.isoformat(), 'status': 'ปกติ', 'message': 'เพิ่มตอนใหม่ %s รายการ' % new})
                next_log += 1
        except Exception as exc:
            source['status'] = 'ผิดพลาด'
            tables['logs'].append({'id': next_log, 'source_id': source['id'], 'at': current.isoformat(), 'status': 'ผิดพลาด', 'message': str(exc)[:400]})
            next_log += 1
        source['checked'] = current.isoformat()
        checked += 1
        time.sleep(1)
    if checked:
        snapshot['exported_at'] = current.isoformat()
    return {'checked': checked, 'new': added}


def main():
    env = os.environ
    snapshot, sha = read_store(env)
    result = process_snapshot(snapshot)
    if result['checked']:
        write_store(env, snapshot, sha)
    print(json.dumps(result))


if __name__ == '__main__':
    main()
