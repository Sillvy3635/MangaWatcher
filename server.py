"""MangaWatcher local MVP. Python 3.10+, no third-party dependencies."""
import argparse, json, re, sqlite3, threading, time, uuid, webbrowser
from datetime import datetime, timezone, timedelta
from decimal import Decimal, InvalidOperation
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from contextlib import contextmanager, closing
from urllib.request import Request
from urllib.parse import urlparse, urlencode, urljoin
from xml.etree import ElementTree as ET
from email.utils import parsedate_to_datetime
import ipaddress, socket

ROOT = Path(__file__).resolve().parent
DB = ROOT / 'data' / 'mangawatcher.sqlite3'
# Preserve existing local data if upgrading from MangaPulse.
LEGACY_DB = ROOT / 'data' / 'mangapulse.sqlite3'
if not DB.exists() and LEGACY_DB.exists():
    DB = LEGACY_DB
WEB = ROOT / 'web'
BUILT_WEB = ROOT / 'frontend' / 'dist'
LOCK = threading.Lock()
DB_LOCK = threading.RLock()
LANGS = {'en':'ENG','th':'TH','ja':'RAW','ko':'RAW','zh':'RAW','zh-hk':'RAW'}
def now(): return datetime.now(timezone.utc).isoformat(timespec='seconds')
@contextmanager
def db():
    with DB_LOCK:
        DB.parent.mkdir(exist_ok=True)
        c = sqlite3.connect(DB, timeout=15); c.row_factory = sqlite3.Row
        try:
            c.execute('PRAGMA foreign_keys=ON')
            with c: yield c
        finally: c.close()

def init():
    # Keep a SQLite-consistent copy of existing data before additive migrations.
    if DB.exists():
        with closing(sqlite3.connect(DB)) as old:
            tables={row[0] for row in old.execute("SELECT name FROM sqlite_master WHERE type='table'")}
            needs_migration='manga' in tables and ('settings' not in tables or 'translation_tasks' not in tables)
            if needs_migration:
                label='settings' if 'settings' not in tables else 'tasks'
                backup = DB.with_name(DB.name + '.pre-' + label + '-' + datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ') + '.bak')
                with closing(sqlite3.connect(backup)) as copy: old.backup(copy)
    with db() as c:
        c.executescript('''
        CREATE TABLE IF NOT EXISTS manga(id INTEGER PRIMARY KEY, title TEXT NOT NULL, aliases TEXT NOT NULL DEFAULT '', raw_done TEXT DEFAULT '', eng_done TEXT DEFAULT '', th_done TEXT DEFAULT '', translated TEXT DEFAULT '', tracked INTEGER DEFAULT 1);
        CREATE TABLE IF NOT EXISTS sources(id INTEGER PRIMARY KEY, manga_id INTEGER NOT NULL REFERENCES manga(id) ON DELETE CASCADE, name TEXT NOT NULL, url TEXT NOT NULL, kind TEXT NOT NULL, lang TEXT NOT NULL, interval INTEGER NOT NULL DEFAULT 60, enabled INTEGER DEFAULT 1, checked TEXT, status TEXT DEFAULT 'ยังไม่ตรวจ', UNIQUE(manga_id,url,lang));
        CREATE TABLE IF NOT EXISTS releases(id INTEGER PRIMARY KEY, source_id INTEGER NOT NULL REFERENCES sources(id) ON DELETE CASCADE, chapter TEXT NOT NULL, title TEXT DEFAULT '', url TEXT NOT NULL, published TEXT, detected TEXT NOT NULL, lang TEXT NOT NULL, external_id TEXT NOT NULL, UNIQUE(source_id,external_id,lang));
        CREATE TABLE IF NOT EXISTS logs(id INTEGER PRIMARY KEY, source_id INTEGER REFERENCES sources(id) ON DELETE SET NULL, at TEXT NOT NULL, status TEXT NOT NULL, message TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS translation_tasks(release_id INTEGER PRIMARY KEY REFERENCES releases(id) ON DELETE CASCADE, stage TEXT NOT NULL DEFAULT 'RAW', updated TEXT NOT NULL);
        ''')
        c.execute("INSERT OR IGNORE INTO settings(key,value) VALUES('refresh_mode','all')")

def refresh_mode(c):
    row=c.execute("SELECT value FROM settings WHERE key='refresh_mode'").fetchone()
    return row['value'] if row and row['value'] in ('all','tracked') else 'all'

def retry_minutes(c, source_id, interval):
    # Recent consecutive failures delay only scheduled checks, never manual checks.
    statuses=c.execute('SELECT status FROM logs WHERE source_id=? ORDER BY id DESC LIMIT 5',(source_id,)).fetchall()
    failures=0
    for row in statuses:
        if row['status']!='ผิดพลาด': break
        failures+=1
    return min(1440, interval * (2 ** min(failures,4)))

def rows(c,sql,args=()): return [dict(r) for r in c.execute(sql,args)]
def chapter_key(value):
    try: return (1,Decimal(value)) if Decimal(value).is_finite() else (0,Decimal(0))
    except (InvalidOperation,ValueError,TypeError): return (0,Decimal(0))
def normalize(value):
    v=str(value if value is not None else '').strip()
    try:
        d=Decimal(v)
        if d.is_finite() and 0 <= d <= 100000: return format(d.normalize(),'f')
    except InvalidOperation: pass
    return v[:100] or 'พิเศษ'
def date_iso(v):
    if not v: return None
    try:
        d=datetime.fromisoformat(v.replace('Z','+00:00'))
    except ValueError:
        try: d=parsedate_to_datetime(v)
        except (ValueError,TypeError,OverflowError): return None
    return (d if d.tzinfo else d.replace(tzinfo=timezone.utc)).astimezone(timezone.utc).isoformat(timespec='seconds')
def public_url(url):
    p=urlparse(url)
    if p.scheme not in ('http','https') or not p.hostname or p.username or p.password: raise ValueError('ต้องใช้ URL http/https สาธารณะ')
    if p.port not in (None,80,443): raise ValueError('รองรับเฉพาะพอร์ต 80/443')
    for a in socket.getaddrinfo(p.hostname,p.port or (443 if p.scheme=='https' else 80),type=socket.SOCK_STREAM):
        if not ipaddress.ip_address(a[4][0]).is_global: raise ValueError('ไม่อนุญาต URL เครือข่ายส่วนตัว')
    return url

def fetch(url):
    # This is local-only. Disable redirects to avoid fetching an unexpected host.
    from urllib.request import build_opener, HTTPRedirectHandler
    class NoRedirect(HTTPRedirectHandler):
        def redirect_request(self,*a,**k): return None
    public_url(url)
    req=Request(url,headers={'User-Agent':'MangaWatcher-local/0.1 (personal metadata tracker)','Accept':'application/json, application/rss+xml, application/atom+xml, application/xml, text/xml'})
    with build_opener(NoRedirect()).open(req,timeout=15) as r:
        data=r.read(2_000_001)
        if len(data)>2_000_000: raise ValueError('ข้อมูลเกิน 2 MB')
        return data

def dex_id(url):
    p=urlparse(url)
    if p.hostname not in ('mangadex.org','www.mangadex.org') or not p.path.startswith('/title/'): raise ValueError('ใช้ลิงก์ MangaDex /title/UUID')
    return str(uuid.UUID(p.path.split('/')[2]))
def dex_parse(obj,lang):
    if obj.get('result')!='ok': raise ValueError('MangaDex API ไม่ส่งสถานะ ok')
    out=[]
    for r in obj.get('data',[]):
        a=r.get('attributes',{}); l=a.get('translatedLanguage','')
        out.append(dict(external_id=r['id'],chapter=normalize(a.get('chapter')),title=a.get('title') or '',url='https://mangadex.org/chapter/'+r['id'],published=date_iso(a.get('publishAt')),lang=LANGS.get(l,lang if lang!='ALL' else l.upper() or 'OTHER')))
    return out

def rss_parse(raw,source):
    if b'<!DOCTYPE' in raw.upper() or b'<!ENTITY' in raw.upper(): raise ValueError('ไม่รองรับ XML DTD/entities')
    try: root=ET.fromstring(raw)
    except ET.ParseError as e: raise ValueError('ฟีด XML ไม่ถูกต้อง') from e
    def local(tag): return tag.split('}')[-1]
    if local(root.tag) not in ('rss','RDF','feed'): raise ValueError('ไม่ใช่ RSS/Atom feed')
    def val(node,*names):
        for ch in node:
            if local(ch.tag) in names:
                if local(ch.tag)=='link' and ch.attrib.get('href') and ch.attrib.get('rel','alternate')=='alternate': return ch.attrib['href']
                if ch.text: return ch.text.strip()
        return ''
    aliases=[s.strip().casefold() for s in (source['manga_title']+'|'+source['aliases']).split('|') if s.strip()]
    out=[]
    for item in root.iter():
        if local(item.tag) not in ('item','entry'): continue
        title=val(item,'title'); raw_link=val(item,'link')
        if not raw_link: continue
        link=urljoin(source['url'],raw_link)
        if not any(a in title.casefold() for a in aliases): continue
        m=re.search(r'(?:chapter|ch\.?|ตอน(?:ที่)?|第)\s*[:#]?\s*(\d+(?:\.\d+)?)',title,re.I)
        if not m or urlparse(link).scheme not in ('http','https'): continue
        out.append(dict(external_id=val(item,'guid','id') or link,chapter=normalize(m.group(1)),title=title,url=link,published=date_iso(val(item,'pubDate','published','updated')),lang=source['lang']))
    return out

def check_mangadex(s):
    q=[('limit','100'),('order[publishAt]','desc'),('contentRating[]','safe'),('contentRating[]','suggestive')]
    for l in {'ENG':['en'],'TH':['th'],'RAW':['ja','ko','zh','zh-hk'],'ALL':[]}[s['lang']]: q.append(('translatedLanguage[]',l))
    return dex_parse(json.loads(fetch('https://api.mangadex.org/manga/'+dex_id(s['url'])+'/feed?'+urlencode(q))),s['lang'])

def check_rss(s):
    return rss_parse(fetch(s['url']),s)

# Register an adapter only after its source format and permission are verified.
ADAPTERS={'mangadex':check_mangadex,'rss':check_rss}
def check_source(s):
    if s['kind'] not in ADAPTERS: raise ValueError('แหล่งข้อมูลแบบกำหนดเองต้องเพิ่มตอนด้วยตัวเอง')
    return ADAPTERS[s['kind']](s)

def save_release(c,sid,r):
    inserted=c.execute('INSERT OR IGNORE INTO releases(source_id,chapter,title,url,published,detected,lang,external_id) VALUES(?,?,?,?,?,?,?,?)',(sid,r['chapter'],r['title'],r['url'],r.get('published'),now(),r['lang'],r['external_id'])).rowcount
    if inserted and r['lang']=='RAW':
        tracked=c.execute('SELECT m.tracked FROM manga m JOIN sources s ON s.manga_id=m.id WHERE s.id=?',(sid,)).fetchone()
        if tracked and tracked['tracked']:
            c.execute('INSERT INTO translation_tasks(release_id,stage,updated) VALUES(?,?,?)',(c.execute('SELECT last_insert_rowid()').fetchone()[0],'RAW',now()))
    return inserted

def refresh(sid=None, due=False, mode=None):
    if not LOCK.acquire(blocking=False): return {'busy':True,'new':0}
    n=0; checked=0
    try:
        with db() as c:
            mode=mode or refresh_mode(c)
            if mode not in ('all','tracked'): raise ValueError('โหมดตรวจสอบไม่ถูกต้อง')
            sources=rows(c,'''SELECT s.*,m.title manga_title,m.aliases,m.tracked FROM sources s JOIN manga m ON m.id=s.manga_id WHERE s.enabled=1 AND s.kind!='manual' '''+('AND s.id=?' if sid else 'AND (?=\'all\' OR m.tracked=1)'),(sid,) if sid else (mode,))
        for s in sources:
            if due and s['checked']:
                with db() as c: wait=retry_minutes(c,s['id'],s['interval'])
                try: elapsed=(datetime.now(timezone.utc)-datetime.fromisoformat(s['checked'])).total_seconds()
                except ValueError: elapsed=wait*60
                if elapsed<wait*60: continue
            try:
                incoming=check_source(s)
                with db() as c:
                    count=sum(save_release(c,s['id'],r) for r in incoming); n+=count
                    msg=f'พบ {len(incoming)} รายการ / เพิ่มใหม่ {count}'; status='ปกติ'
            except Exception as e: status='ผิดพลาด'; msg=str(e)[:400]
            with db() as c:
                c.execute('UPDATE sources SET checked=?,status=? WHERE id=?',(now(),status,s['id']))
                c.execute('INSERT INTO logs(source_id,at,status,message) VALUES(?,?,?,?)',(s['id'],now(),status,msg))
            checked+=1
            time.sleep(1)
        return {'new':n,'checked':checked}
    finally: LOCK.release()

def loop():
    while True:
        try: refresh(due=True)
        except Exception as e: print('scheduler:',e)
        time.sleep(60)

def state():
    with db() as c:
        sources=rows(c,'SELECT * FROM sources ORDER BY id DESC')
        for source in sources:
            source['next_due']=None
            if source['enabled'] and source['kind'] in ADAPTERS and source['checked']:
                try:
                    checked=datetime.fromisoformat(source['checked'])
                    source['next_due']=(checked+timedelta(minutes=retry_minutes(c,source['id'],source['interval']))).isoformat(timespec='seconds')
                except ValueError: pass
        return {'manga':rows(c,'SELECT * FROM manga ORDER BY title'),'sources':sources,'releases':rows(c,'''SELECT r.*,s.name source_name,s.manga_id,m.title manga_title FROM releases r JOIN sources s ON s.id=r.source_id JOIN manga m ON m.id=s.manga_id ORDER BY r.detected DESC,r.id DESC'''),'tasks':rows(c,'''SELECT t.release_id id,t.*,r.chapter,r.url,r.lang,s.name source_name,m.id manga_id,m.title manga_title FROM translation_tasks t JOIN releases r ON r.id=t.release_id JOIN sources s ON s.id=r.source_id JOIN manga m ON m.id=s.manga_id ORDER BY t.updated DESC,t.release_id DESC'''),'logs':rows(c,'SELECT l.*,s.name source_name FROM logs l LEFT JOIN sources s ON s.id=l.source_id ORDER BY l.id DESC LIMIT 100'),'refresh_mode':refresh_mode(c),'busy':LOCK.locked()}

EXPORT_COLUMNS={
    'manga':('id','title','aliases','raw_done','eng_done','th_done','translated','tracked'),
    'sources':('id','manga_id','name','url','kind','lang','interval','enabled','checked','status'),
    'releases':('id','source_id','chapter','title','url','published','detected','lang','external_id'),
    'translation_tasks':('release_id','stage','updated'),
    'logs':('id','source_id','at','status','message'),
    'settings':('key','value'),
}
def export_data():
    with db() as c:
        c.execute('BEGIN')
        return {'schema_version':2,'exported_at':now(),'tables':{table:rows(c,f'SELECT * FROM {table}') for table in EXPORT_COLUMNS}}

def restore_data(payload):
    if not isinstance(payload,dict) or payload.get('schema_version')!=2 or not isinstance(payload.get('tables'),dict): raise ValueError('ไฟล์สำรองไม่ใช่ MangaWatcher schema 2')
    tables=payload['tables']
    if set(tables)!=set(EXPORT_COLUMNS): raise ValueError('ตารางในไฟล์สำรองไม่ครบ')
    for table,columns in EXPORT_COLUMNS.items():
        items=tables[table]
        if not isinstance(items,list) or len(items)>100000 or any(not isinstance(item,dict) or set(item)!=set(columns) for item in items):
            raise ValueError('ข้อมูลตาราง '+table+' ไม่ถูกต้อง')
    if next((item['value'] for item in tables['settings'] if item['key']=='refresh_mode'),None) not in ('all','tracked'):
        raise ValueError('ค่าตั้งโหมดตรวจไม่ถูกต้อง')
    if not LOCK.acquire(blocking=False): raise ValueError('รอให้การตรวจสอบเสร็จก่อนนำเข้า')
    try:
        backup=DB.with_name(DB.name+'.pre-import-'+datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')+'.bak')
        with DB_LOCK:
            with closing(sqlite3.connect(DB)) as old,closing(sqlite3.connect(backup)) as copy: old.backup(copy)
            with db() as c:
                for table in ('logs','translation_tasks','releases','sources','manga','settings'): c.execute(f'DELETE FROM {table}')
                for table,columns in EXPORT_COLUMNS.items():
                    marks=','.join('?' for _ in columns)
                    c.executemany(f'INSERT INTO {table}({",".join(columns)}) VALUES({marks})',([item[column] for column in columns] for item in tables[table]))
                if c.execute('PRAGMA foreign_key_check').fetchone(): raise ValueError('ความสัมพันธ์ข้อมูลในไฟล์สำรองไม่ถูกต้อง')
        return {'ok':True,'backup':backup.name}
    finally: LOCK.release()

def required(p,k):
    v=str(p.get(k,'')).strip()
    if not v: raise ValueError('กรุณากรอก '+k)
    return v[:1000]
def mutate(path,p):
    with db() as c:
        if path=='/api/settings':
            mode=required(p,'refresh_mode')
            if mode not in ('all','tracked'): raise ValueError('โหมดตรวจสอบไม่ถูกต้อง')
            c.execute("UPDATE settings SET value=? WHERE key='refresh_mode'",(mode,))
        elif path=='/api/bulk-track':
            ids=p.get('ids')
            tracked=p.get('tracked')
            if not isinstance(ids,list) or not ids or len(ids)>100 or not all(type(v) is int and v>0 for v in ids) or len(set(ids))!=len(ids) or type(tracked) is not bool:
                raise ValueError('ข้อมูลการติดตามหลายรายการไม่ถูกต้อง')
            placeholders=','.join('?' for _ in ids)
            count=c.execute(f'SELECT count(*) FROM manga WHERE id IN ({placeholders})',ids).fetchone()[0]
            if count!=len(ids): raise ValueError('ไม่พบเรื่องบางรายการ')
            c.execute(f'UPDATE manga SET tracked=? WHERE id IN ({placeholders})',(int(tracked),*ids))
        elif path=='/api/task':
            release_id=int(p['release_id']); stage=required(p,'stage')
            if stage not in ('RAW','OCR','TRANSLATE','PROOFREAD','LETTERING','PUBLISHER','PUBLISHED'):
                raise ValueError('ขั้นตอนงานแปลไม่ถูกต้อง')
            release=c.execute('SELECT id FROM releases WHERE id=?',(release_id,)).fetchone()
            if not release: raise ValueError('ไม่พบตอนที่ระบุ')
            c.execute('INSERT INTO translation_tasks(release_id,stage,updated) VALUES(?,?,?) ON CONFLICT(release_id) DO UPDATE SET stage=excluded.stage,updated=excluded.updated',(release_id,stage,now()))
        elif path=='/api/manga':
            values=(required(p,'title'),str(p.get('aliases',''))[:1000],str(p.get('translated',''))[:100],int(bool(p.get('tracked',True))))
            if p.get('id'): c.execute('UPDATE manga SET title=?,aliases=?,translated=?,tracked=? WHERE id=?',(*values,int(p['id'])))
            else: c.execute('INSERT INTO manga(title,aliases,translated,tracked) VALUES(?,?,?,?)',values)
        elif path=='/api/source':
            kind=required(p,'kind'); lang=required(p,'lang'); url=required(p,'url')
            if kind not in ('manual','rss','mangadex') or lang not in ('RAW','ENG','TH','ALL') or (lang=='ALL' and kind!='mangadex'): raise ValueError('ชนิดหรือภาษาไม่ถูกต้อง')
            if urlparse(url).scheme not in ('http','https') or not urlparse(url).hostname: raise ValueError('URL ไม่ถูกต้อง')
            if kind=='mangadex': dex_id(url)
            values=(int(p['manga_id']),required(p,'name'),url,kind,lang,max(30,min(1440,int(p.get('interval',60)))),int(bool(p.get('enabled',True))))
            if p.get('id'): c.execute('UPDATE sources SET manga_id=?,name=?,url=?,kind=?,lang=?,interval=?,enabled=?,checked=NULL WHERE id=?',(*values,int(p['id'])))
            else: c.execute('INSERT INTO sources(manga_id,name,url,kind,lang,interval,enabled) VALUES(?,?,?,?,?,?,?)',values)
        elif path=='/api/release':
            s=c.execute('SELECT * FROM sources WHERE id=?',(int(p['source_id']),)).fetchone()
            if not s: raise ValueError('ไม่พบแหล่งข้อมูล')
            url=required(p,'url'); lang=p.get('lang',s['lang'])
            if urlparse(url).scheme not in ('http','https') or not urlparse(url).hostname or lang not in ('RAW','ENG','TH'): raise ValueError('URL หรือภาษาไม่ถูกต้อง')
            r=dict(chapter=normalize(required(p,'chapter')),title=str(p.get('title',''))[:500],url=url,published=None,lang=lang,external_id=url)
            save_release(c,s['id'],r)
        elif path=='/api/delete':
            table={'manga':'manga','source':'sources','release':'releases'}.get(p.get('type'))
            if not table: raise ValueError('ชนิดไม่ถูกต้อง')
            c.execute(f'DELETE FROM {table} WHERE id=?',(int(p['id']),))
        else: raise ValueError('ไม่พบ endpoint')
    return {'ok':True}

class Handler(BaseHTTPRequestHandler):
    def reply(self,code,obj):
        raw=json.dumps(obj,ensure_ascii=False).encode(); self.send_response(code); self.send_header('Content-Type','application/json; charset=utf-8'); self.send_header('Content-Length',str(len(raw))); self.send_header('Cache-Control','no-store'); self.end_headers(); self.wfile.write(raw)
    def valid_host(self):
        return self.headers.get('Host') in (f'127.0.0.1:{self.server.server_port}',f'localhost:{self.server.server_port}')
    def do_GET(self):
        if not self.valid_host(): return self.reply(403,{'error':'local host required'})
        path=urlparse(self.path).path
        if path=='/api/state': return self.reply(200,state())
        if path=='/api/export': return self.reply(200,export_data())
        if BUILT_WEB.joinpath('index.html').exists():
            relative='index.html' if path=='/' else path.lstrip('/')
            target=(BUILT_WEB/relative).resolve()
            if target.is_relative_to(BUILT_WEB.resolve()) and target.is_file():
                import mimetypes
                raw=target.read_bytes(); ctype=mimetypes.guess_type(target.name)[0] or 'application/octet-stream'
                self.send_response(200); self.send_header('Content-Type',ctype); self.send_header('Content-Length',str(len(raw))); self.send_header('Cache-Control','no-store' if target.name=='index.html' else 'public, max-age=3600'); self.end_headers(); self.wfile.write(raw); return
        files={'/':('index.html','text/html'),'/app.js':('app.js','text/javascript'),'/style.css':('style.css','text/css'),'/manifest.webmanifest':('manifest.webmanifest','application/manifest+json'),'/icon.svg':('icon.svg','image/svg+xml'),'/sw.js':('sw.js','text/javascript')}
        if path not in files: return self.reply(404,{'error':'not found'})
        file,ctype=files[path]; raw=(WEB/file).read_bytes(); self.send_response(200); self.send_header('Content-Type',ctype+'; charset=utf-8'); self.send_header('Content-Length',str(len(raw))); self.end_headers(); self.wfile.write(raw)
    def do_POST(self):
        if not self.valid_host(): return self.reply(403,{'error':'local host required'})
        # Prevent cross-origin pages from triggering local writes. No LAN binding.
        origin=self.headers.get('Origin'); host=self.headers.get('Host')
        if origin and origin!=f'http://{host}': return self.reply(403,{'error':'origin not allowed'})
        if self.headers.get('Content-Type','').split(';')[0]!='application/json': return self.reply(415,{'error':'JSON required'})
        try:
            length=int(self.headers.get('Content-Length','0'))
            if length<0 or length>(10_000_000 if urlparse(self.path).path=='/api/import' else 100000): raise ValueError('payload too long')
            p=json.loads(self.rfile.read(length)); path=urlparse(self.path).path
            if path=='/api/import': return self.reply(200,restore_data(p))
            if path=='/api/refresh':
                if LOCK.locked(): return self.reply(409,{'error':'กำลังตรวจสอบอยู่'})
                threading.Thread(target=refresh,args=(int(p['id']) if p.get('id') else None,),daemon=True).start(); return self.reply(202,{'ok':True})
            return self.reply(200,mutate(path,p))
        except (ValueError,KeyError,TypeError,sqlite3.IntegrityError) as e: return self.reply(400,{'error':str(e)})
    def log_message(self,*a): pass

def main():
    parser=argparse.ArgumentParser(); parser.add_argument('--port',type=int,default=8765); parser.add_argument('--no-browser',action='store_true'); parser.add_argument('--no-scheduler',action='store_true'); a=parser.parse_args(); init()
    server=ThreadingHTTPServer(('127.0.0.1',a.port),Handler)
    if not a.no_scheduler: threading.Thread(target=loop,daemon=True).start()
    url=f'http://127.0.0.1:{a.port}'; print('MangaWatcher:',url,flush=True)
    if not a.no_browser: threading.Timer(.5,lambda:webbrowser.open(url)).start()
    try: server.serve_forever()
    except KeyboardInterrupt: pass
    finally: server.server_close()
if __name__=='__main__': main()
