"""Discord delivery for committed MangaWatcher releases; no webhook in snapshots."""

import json
import re
import time
from urllib.parse import urlsplit


OUTBOX_KEY = 'discord_outbox'
MAX_PENDING = 500
BATCH_SIZE = 3


def webhook_endpoint(value):
    parts = urlsplit(value.strip())
    if (parts.scheme != 'https' or parts.hostname != 'discord.com' or
            parts.port not in (None, 443) or parts.username or parts.password or
            parts.query or parts.fragment or
            not re.fullmatch(r'/api/webhooks/[0-9]+/[A-Za-z0-9._-]+', parts.path)):
        raise ValueError('Discord Webhook URL ไม่ถูกต้อง')
    return value.strip() + '?wait=true'


def pending_ids(snapshot):
    row = next((item for item in snapshot['tables']['settings'] if item['key'] == OUTBOX_KEY), None)
    if row is None:
        return []
    try:
        ids = json.loads(row['value'])
    except (TypeError, ValueError) as exc:
        raise ValueError('คิวแจ้งเตือน Discord ไม่ถูกต้อง') from exc
    if (not isinstance(ids, list) or len(ids) > MAX_PENDING or
            any(type(item) is not int or item < 1 for item in ids) or
            len(set(ids)) != len(ids)):
        raise ValueError('คิวแจ้งเตือน Discord ไม่ถูกต้อง')
    return ids


def save_pending(snapshot, ids):
    if len(ids) > MAX_PENDING:
        raise ValueError('คิวแจ้งเตือน Discord เต็ม; กรุณาตรวจการส่งก่อน')
    settings = snapshot['tables']['settings']
    row = next((item for item in settings if item['key'] == OUTBOX_KEY), None)
    if row is None:
        settings.append({'key': OUTBOX_KEY, 'value': json.dumps(ids)})
    else:
        row['value'] = json.dumps(ids)


def enqueue(snapshot, release_ids):
    if not release_ids:
        return
    old = pending_ids(snapshot)
    save_pending(snapshot, old + [item for item in release_ids if item not in old])


def _plain(value, limit):
    return ' '.join(str(value).replace('`', '').replace('*', '').split())[:limit]


def message(snapshot, release_ids):
    tables = snapshot['tables']
    releases = {row['id']: row for row in tables['releases']}
    sources = {row['id']: row for row in tables['sources']}
    manga = {row['id']: row for row in tables['manga']}
    lines = ['📚 MangaWatcher พบตอนใหม่']
    included = []
    for release_id in release_ids:
        release = releases.get(release_id)
        source = sources.get(release['source_id']) if release else None
        title = manga.get(source['manga_id']) if source else None
        if not title:
            continue
        line = (f"• {_plain(title['title'], 100)} — ตอน {_plain(release['chapter'], 30)} "
                f"({_plain(release['lang'], 5)}, {_plain(source['name'], 50)})\n"
                f"{_plain(release['url'], 250)}")
        if sum(len(part) + 1 for part in lines) + len(line) > 1900:
            break
        lines.append(line)
        included.append(release_id)
    return '\n'.join(lines), included


def post_message(webhook, content, requester, pause=time.sleep):
    endpoint = webhook_endpoint(webhook)
    body = json.dumps({'content': content, 'username': 'MangaWatcher',
                       'allowed_mentions': {'parse': []}}, ensure_ascii=False).encode('utf-8')
    for attempt in range(3):
        status, raw = requester(endpoint, method='POST', body=body, tries=1)
        if status == 200:
            try:
                if json.loads(raw).get('id'):
                    return
            except (TypeError, ValueError):
                pass
            raise RuntimeError('Discord ไม่ยืนยันข้อความที่ส่ง')
        if status == 429 and attempt < 2:
            try:
                delay = float(json.loads(raw).get('retry_after', 1))
            except (TypeError, ValueError):
                delay = 1
            if not 0 <= delay <= 30:
                raise RuntimeError('Discord ขอให้รอนานเกิน 30 วินาที')
            pause(delay)
            continue
        if status in (500, 502, 503, 504) and attempt < 2:
            pause(2 ** attempt)
            continue
        raise RuntimeError('Discord ส่งข้อความไม่สำเร็จ (HTTP %s)' % status)


def deliver_pending(env, webhook, snapshot, read_store, write_store, requester, pause=time.sleep):
    """Acknowledge only confirmed sends. A crash after send and before ack may repeat a batch."""
    sent = 0
    while pending_ids(snapshot):
        batch = pending_ids(snapshot)[:BATCH_SIZE]
        content, included = message(snapshot, batch)
        if included:
            post_message(webhook, content, requester, pause)
        # Also remove IDs whose releases were deleted after they were queued.
        for attempt in range(3):
            fresh, sha = read_store(env)
            remaining = [item for item in pending_ids(fresh) if item not in batch]
            save_pending(fresh, remaining)
            try:
                write_store(env, fresh, sha)
                snapshot = fresh
                sent += len(included)
                break
            except RuntimeError as exc:
                if 'ข้อมูลเปลี่ยนระหว่างตรวจ' not in str(exc) or attempt == 2:
                    raise
        if pending_ids(snapshot):
            pause(1)
    return sent
