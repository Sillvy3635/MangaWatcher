import unittest, tempfile, sqlite3, io, json, threading
from contextlib import closing
from datetime import datetime
from pathlib import Path
from unittest.mock import patch, MagicMock
from http.server import ThreadingHTTPServer
from urllib.request import urlopen, Request
import server as s
class Tests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory(); self.old=s.DB;s.DB=Path(self.tmp.name)/'db.sqlite3';s.init()
        s.mutate('/api/manga',{'title':'Example Manga','aliases':'ตัวอย่าง|例','translated':'9'}); self.mid=s.state()['manga'][0]['id']
        s.mutate('/api/source',{'manga_id':self.mid,'name':'Sample RSS','url':'https://example.com/feed','lang':'ENG','kind':'rss','interval':60});self.sid=s.state()['sources'][0]['id']
    def tearDown(self): s.DB=self.old;self.tmp.cleanup()
    def test_normalize(self):
        self.assertEqual(s.normalize('010.50'),'10.5');self.assertEqual(s.normalize('Special'),'Special');self.assertEqual(s.normalize('0'),'0')
    def test_rss_and_dedup(self):
        rss=b'<rss><channel><item><title>Example Manga Chapter 10.5</title><link>https://example.com/10</link><guid>abc</guid><pubDate>Wed, 18 Nov 2026 12:00:00 +0000</pubDate></item><item><title>Unrelated Chapter 7</title><link>https://example.com/7</link></item></channel></rss>'
        with patch.object(s,'fetch',return_value=rss),patch.object(s.time,'sleep'):
            self.assertEqual(s.refresh()['new'],1);self.assertEqual(s.refresh()['new'],0)
        st=s.state();self.assertEqual(st['releases'][0]['chapter'],'10.5');self.assertEqual(len(st['logs']),2)
    def test_manual_and_cascade(self):
        payload={'source_id':self.sid,'chapter':'12','url':'https://example.com/12','lang':'ENG'}
        s.mutate('/api/release',payload);s.mutate('/api/release',payload);self.assertEqual(len(s.state()['releases']),1)
        s.mutate('/api/delete',{'type':'manga','id':self.mid});self.assertEqual(len(s.state()['releases']),0)
    def test_dex(self):
        rows=s.dex_parse({'result':'ok','data':[{'id':'abc','attributes':{'chapter':'12.0','translatedLanguage':'th','publishAt':'2026-11-18T12:00:00Z'}}]},'ALL');self.assertEqual(rows[0]['lang'],'TH');self.assertEqual(rows[0]['chapter'],'12')
    def test_error_log(self):
        with patch.object(s,'fetch',side_effect=RuntimeError('blocked')),patch.object(s.time,'sleep'): s.refresh()
        self.assertEqual(s.state()['sources'][0]['status'],'ผิดพลาด')
    def test_bad_urls(self):
        with self.assertRaises(ValueError):s.public_url('http://127.0.0.1/')
        with self.assertRaises(ValueError):s.dex_id('https://example.com/title/123')
    def test_xml_entity(self):
        with self.assertRaises(ValueError):s.rss_parse(b'<!DOCTYPE root [<!ENTITY a "value">]><root/>',{})
    def test_adapters_and_malformed_feeds(self):
        source={**s.state()['sources'][0],'manga_title':'Example Manga','aliases':'ตัวอย่าง'}
        atom=b'<feed xmlns="http://www.w3.org/2005/Atom"><entry><title>Example Manga Ch. 4</title><id>entry-4</id><link href="https://example.com/4"/><updated>2026-11-18T12:00:00Z</updated></entry></feed>'
        with patch.object(s,'fetch',return_value=atom):
            self.assertEqual(s.check_source(source)[0]['chapter'],'4')
        with patch.object(s,'fetch',return_value=b'<html><item><title>Example Manga Ch 4</title></item></html>'):
            with self.assertRaisesRegex(ValueError,'RSS/Atom'): s.check_source(source)
        with self.assertRaisesRegex(ValueError,'XML'):s.rss_parse(b'<rss><broken>',source)
        dex={**source,'kind':'mangadex','url':'https://mangadex.org/title/11111111-1111-1111-1111-111111111111','lang':'TH'}
        with patch.object(s,'fetch',return_value=b'{"result":"ok","data":[]}') as fetch:
            self.assertEqual(s.check_source(dex),[])
            self.assertIn('translatedLanguage%5B%5D=th',fetch.call_args.args[0])
        with self.assertRaises(ValueError):s.check_source({**source,'kind':'manual'})
    def test_refresh_mode_and_manual_override(self):
        s.mutate('/api/manga',{'title':'Unwatched','tracked':False})
        mid=next(m['id'] for m in s.state()['manga'] if m['title']=='Unwatched')
        s.mutate('/api/source',{'manga_id':mid,'name':'Second','url':'https://example.org/feed','lang':'ENG','kind':'rss'})
        sid=next(x['id'] for x in s.state()['sources'] if x['manga_id']==mid)
        s.mutate('/api/settings',{'refresh_mode':'tracked'})
        self.assertEqual(s.state()['refresh_mode'],'tracked')
        with patch.object(s,'check_source',return_value=[] ) as check,patch.object(s.time,'sleep'):
            self.assertEqual(s.refresh()['checked'],1)
            self.assertEqual(check.call_count,1)
            self.assertEqual(s.refresh(sid)['checked'],1)
            self.assertEqual(s.refresh(mode='all')['checked'],2)
        with self.assertRaises(ValueError):s.mutate('/api/settings',{'refresh_mode':'invalid'})
    def test_bulk_tracking_is_atomic(self):
        s.mutate('/api/manga',{'title':'Second','tracked':False})
        other=next(m['id'] for m in s.state()['manga'] if m['title']=='Second')
        s.mutate('/api/bulk-track',{'ids':[self.mid,other],'tracked':False})
        self.assertEqual([m['tracked'] for m in s.state()['manga']],[0,0])
        with self.assertRaisesRegex(ValueError,'ไม่พบเรื่อง'):
            s.mutate('/api/bulk-track',{'ids':[self.mid,999999],'tracked':True})
        self.assertEqual([m['tracked'] for m in s.state()['manga']],[0,0])
    def test_scheduled_backoff(self):
        with patch.object(s,'check_source',side_effect=RuntimeError('temporary')),patch.object(s.time,'sleep'):
            self.assertEqual(s.refresh()['checked'],1)
            self.assertEqual(s.refresh(due=True)['checked'],0)
        source=s.state()['sources'][0]
        self.assertEqual((datetime.fromisoformat(source['next_due'])-datetime.fromisoformat(source['checked'])).total_seconds(),7200)
        with s.db() as c:
            c.execute("UPDATE sources SET checked='2026-01-01T00:00:00+00:00' WHERE id=?",(self.sid,))
        with patch.object(s,'check_source',return_value=[]),patch.object(s.time,'sleep'):
            self.assertEqual(s.refresh(due=True)['checked'],1)
        with s.db() as c:self.assertEqual(s.retry_minutes(c,self.sid,60),60)
    def test_existing_db_backup_and_settings_migration(self):
        with s.db() as c:c.execute('DROP TABLE settings')
        s.init()
        self.assertEqual(s.state()['manga'][0]['title'],'Example Manga')
        backups=list(s.DB.parent.glob('db.sqlite3.pre-settings-*.bak'))
        self.assertEqual(len(backups),1)
        with closing(sqlite3.connect(backups[0])) as c:
            self.assertEqual(c.execute('SELECT count(*) FROM manga').fetchone()[0],1)
            self.assertFalse(c.execute("SELECT 1 FROM sqlite_master WHERE name='settings'").fetchone())
    def test_translation_task_is_per_release(self):
        s.mutate('/api/release',{'source_id':self.sid,'chapter':'12','url':'https://example.com/raw/12','lang':'RAW'})
        s.mutate('/api/release',{'source_id':self.sid,'chapter':'12','url':'https://example.com/raw/12','lang':'RAW'})
        task=s.state()['tasks'][0]
        self.assertEqual((len(s.state()['tasks']),task['stage'],task['chapter']),(1,'RAW','12'))
        s.mutate('/api/task',{'release_id':task['release_id'],'stage':'OCR'})
        self.assertEqual(s.state()['tasks'][0]['stage'],'OCR')
        with self.assertRaisesRegex(ValueError,'ขั้นตอน'):
            s.mutate('/api/task',{'release_id':task['release_id'],'stage':'INVALID'})
    def test_tasks_migration_backup(self):
        with s.db() as c:c.execute('DROP TABLE translation_tasks')
        s.init()
        self.assertEqual(s.state()['manga'][0]['title'],'Example Manga')
        self.assertEqual(len(list(s.DB.parent.glob('db.sqlite3.pre-tasks-*.bak'))),1)
    def test_export_import_and_failed_restore_rollback(self):
        s.mutate('/api/release',{'source_id':self.sid,'chapter':'8','url':'https://example.com/raw/8','lang':'RAW'})
        snapshot=s.export_data()
        s.mutate('/api/manga',{'title':'After export'})
        result=s.restore_data(snapshot)
        self.assertTrue(result['backup'].startswith('db.sqlite3.pre-import-'))
        self.assertEqual(s.export_data()['tables'],snapshot['tables'])
        s.mutate('/api/manga',{'title':'Keep on failed import'})
        corrupted=s.export_data()
        corrupted['tables']['releases'][0]['source_id']=999999
        with self.assertRaises(sqlite3.IntegrityError):s.restore_data(corrupted)
        self.assertIn('Keep on failed import',[m['title'] for m in s.state()['manga']])
    def test_fetch_disables_redirects(self):
        opener=MagicMock();opener.open.return_value.__enter__.return_value=io.BytesIO(b'ok')
        with patch.object(s,'public_url',return_value='https://example.com/feed'),patch('urllib.request.build_opener',return_value=opener) as factory:
            self.assertEqual(s.fetch('https://example.com/feed'),b'ok')
        redirect_handler=factory.call_args.args[0]
        self.assertIsNone(redirect_handler.redirect_request(None,None,302,'Found',{},'https://example.net/'))
    def test_local_http_state_export_and_task_api(self):
        http=ThreadingHTTPServer(('127.0.0.1',0),s.Handler)
        thread=threading.Thread(target=http.serve_forever,daemon=True);thread.start()
        base=f'http://127.0.0.1:{http.server_port}'
        try:
            self.assertEqual(json.load(urlopen(base+'/api/state'))['manga'][0]['title'],'Example Manga')
            self.assertEqual(json.load(urlopen(base+'/api/export'))['schema_version'],2)
            s.mutate('/api/release',{'source_id':self.sid,'chapter':'3','url':'https://example.com/raw/3','lang':'RAW'})
            rid=s.state()['tasks'][0]['release_id']
            request=Request(base+'/api/task',data=json.dumps({'release_id':rid,'stage':'OCR'}).encode(),headers={'Content-Type':'application/json','Origin':base},method='POST')
            self.assertTrue(json.load(urlopen(request))['ok'])
            self.assertEqual(s.state()['tasks'][0]['stage'],'OCR')
        finally:
            http.shutdown();http.server_close();thread.join(timeout=2)
if __name__=='__main__':unittest.main()
