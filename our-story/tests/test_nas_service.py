"""All write tests use disposable directories. Never connect to a user's NAS."""
import contextlib
import http.client
import importlib.util
import io
import json
import os
from pathlib import Path
import tempfile
import threading
import unittest

ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('nas_service',ROOT/'nas-service/server.py')
api=importlib.util.module_from_spec(spec);spec.loader.exec_module(api)
TOKEN='fixture-only-token-never-a-production-secret'
ORIGIN='https://mashimaru7-max.github.io'
PHOTO=(ROOT/'assets/beach.jpg').read_bytes()

class ServiceTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory()
        self.root=Path(self.temp.name)
        (self.root/'기억').mkdir()
        (self.root/'one.jpg').write_bytes(PHOTO)
        self.store=api.PhotoStore(self.root,True)
        self.settings_temp=tempfile.TemporaryDirectory();self.settings_dir=Path(self.settings_temp.name)
        self.settings=api.SharedSettings(self.settings_dir)
        self.server=api.Server(('127.0.0.1',0),self.store,TOKEN,ORIGIN,self.settings)
        self.thread=threading.Thread(target=self.server.serve_forever,daemon=True);self.thread.start()
    def tearDown(self):
        self.server.shutdown();self.server.server_close();os.close(self.store.root);self.temp.cleanup();self.settings_temp.cleanup()
    def request(self,path,method='GET',body=None,headers=None):
        h={'Origin':ORIGIN,'Authorization':'Bearer '+TOKEN}
        if headers: h.update(headers)
        if isinstance(body,dict):body=json.dumps(body).encode();h['Content-Type']='application/json'
        c=http.client.HTTPConnection(*self.server.server_address,timeout=4)
        c.request(method,path,body,h);r=c.getresponse();data=r.read();status=r.status;heads=dict(r.getheaders());c.close()
        return status,data,heads
    def listing(self): return json.loads(self.request('/api/list')[1])
    def item(self):return next(x for x in self.listing()['items'] if x['name']=='one.jpg')
    def trash(self):return self.request('/api/trash','POST',{'path':'one.jpg','revision':self.item()['revision']})
    def test_auth_and_cors_on_every_route(self):
        for path in ['/api/list','/api/capabilities','/api/image?path=one.jpg','/api/download?path=one.jpg','/api/trash']:
            self.assertEqual(self.request(path,headers={'Authorization':'Bearer wrong'})[0],401)
            self.assertEqual(self.request(path,headers={'Origin':'https://evil.example'})[0],403)
        self.assertEqual(self.request('/api/upload?name=a.jpg','POST',PHOTO,{'Authorization':'','Content-Type':'application/octet-stream'})[0],401)
        self.assertFalse((self.root/'a.jpg').exists())
    def test_shared_family_settings_persist_and_preserve_originals(self):
        self.store.writable=False
        status,raw,_=self.request('/api/settings')
        self.assertEqual(status,200);self.assertEqual(json.loads(raw)['revision'],0)
        rule={'type':'name','text':'오니둥이','mode':'numbered','root':''}
        patch={'revision':0,'albums':{'growth:함께':rule},'home':{'path':'one.jpg','name':'one.jpg'}}
        self.assertEqual(self.request('/api/settings','POST',patch)[0],200)
        # A new HTTP connection and a fresh store see the same persisted configuration.
        shared=json.loads(self.request('/api/settings')[1])
        self.assertEqual(shared['albums']['growth:함께'],rule)
        self.assertEqual(api.SharedSettings(self.settings_dir).read(),shared)
        self.assertEqual((self.root/'one.jpg').read_bytes(),PHOTO)
        self.assertEqual(sorted(x.name for x in self.root.iterdir()),['one.jpg','기억'])
        self.assertEqual(self.request('/api/settings','POST',patch)[0],409)
        self.assertEqual(self.request('/api/settings','POST',{'revision':1,'albums':{'travel':'기억'}})[0],200)
        shared=json.loads(self.request('/api/settings')[1]);self.assertEqual(shared['home']['path'],'one.jpg')
        self.assertEqual(shared['albums']['growth:함께'],rule)
        self.assertEqual(self.request('/api/settings','POST',{'revision':2,'home':None})[0],200)
        self.assertIsNone(api.SharedSettings(self.settings_dir).read()['home'])
    def test_settings_auth_schema_and_secrets(self):
        for method,body in [('GET',None),('POST',{'revision':0,'albums':{}})]:
            self.assertEqual(self.request('/api/settings',method,body,{'Authorization':'Bearer wrong'})[0],401)
            self.assertEqual(self.request('/api/settings',method,body,{'Origin':'https://evil.example'})[0],403)
        for patch in [
            {'revision':0,'token':'secret'}, {'revision':True},
            {'revision':0,'albums':{'unknown':''}}, {'revision':0,'albums':{'travel':'../private'}},
            {'revision':0,'albums':{'travel':{'type':'name','text':'a','mode':'regex','root':''}}},
            {'revision':0,'home':{'path':'../../one.jpg','name':'bad'}},
        ]:
            self.assertEqual(self.request('/api/settings','POST',patch)[0],400)
        self.assertEqual(self.settings.read()['revision'],0)
        self.assertFalse(any(self.settings_dir.iterdir()))
        self.assertEqual(self.request('/api/settings','POST',{'revision':0,'home':None})[0],200)
        self.assertNotIn(TOKEN,(self.settings_dir/'settings.json').read_text())
    def test_preflight(self):
        status,_,h=self.request('/api/upload','OPTIONS',headers={'Authorization':''})
        self.assertEqual(status,204);self.assertEqual(h['Access-Control-Allow-Origin'],ORIGIN)
    def test_capabilities_and_read_only_enforcement(self):
        self.store.writable=False
        c=json.loads(self.request('/api/capabilities')[1]);self.assertFalse(c['upload']);self.assertTrue(c['download'])
        self.assertEqual(self.request('/api/upload?name=new.jpg','POST',PHOTO,{'Content-Type':'application/octet-stream'})[0],403)
        self.assertEqual(self.trash()[0],403);self.assertFalse((self.root/api.TRASH).exists())
    def test_list_pagination_and_private_folders(self):
        (self.root/'.secret').mkdir();(self.root/'@eaDir').mkdir();(self.root/'video.mp4').write_bytes(b'video')
        for i in range(120):(self.root/f'{i:03}.jpg').write_bytes(PHOTO[:64])
        data=self.listing();self.assertEqual(data['total'],122);self.assertEqual(len(data['items']),100);self.assertEqual(data['next'],100)
        tail=json.loads(self.request('/api/list?offset=100')[1]);self.assertEqual(len(tail['items']),22);self.assertIsNone(tail['next'])
        self.assertEqual(self.request('/api/list?offset=-1')[0],400)
    def test_upload_and_no_overwrite(self):
        route='/api/upload?path=%EA%B8%B0%EC%96%B5&name=hello.jpg'
        self.assertEqual(self.request(route,'POST',PHOTO,{'Content-Type':'application/octet-stream'})[0],201)
        self.assertEqual((self.root/'기억/hello.jpg').read_bytes(),PHOTO)
        self.assertEqual(self.request(route,'POST',PHOTO,{'Content-Type':'application/octet-stream'})[0],409)
        self.assertFalse(any(p.name.startswith('.our-story-upload') for p in (self.root/'기억').iterdir()))
    def test_invalid_upload_and_size(self):
        for name,data in [('a.jpg',b'<html>no</html>'),('a.svg',b'<svg/>'),('a.jpg',b'\xff\xd8\xffbroken')]:
            self.assertEqual(self.request('/api/upload?name='+name,'POST',data,{'Content-Type':'application/octet-stream'})[0],415)
        self.assertEqual(self.request('/api/upload?name=a.jpg','POST',b'',{'Content-Type':'application/octet-stream'})[0],413)
        with self.assertRaises(api.APIError):self.store.upload('','big.jpg',io.BytesIO(),api.MAX_UPLOAD+1)
        self.assertEqual(sorted(x.name for x in self.root.iterdir()),['one.jpg','기억'])
    def test_interrupted_upload_cleans_own_temp(self):
        with self.assertRaises(api.APIError):self.store.upload('','partial.jpg',io.BytesIO(PHOTO[:20]),len(PHOTO))
        self.assertFalse((self.root/'partial.jpg').exists());self.assertFalse(any(p.name.startswith('.our-story-upload') for p in self.root.iterdir()))
    def test_traversal_hidden_and_symlinks(self):
        (self.root/'link').symlink_to('/tmp',target_is_directory=True)
        (self.root/'linked.jpg').symlink_to(self.root/'one.jpg')
        self.assertNotIn('linked.jpg',[x['name'] for x in self.listing()['items']])
        for path in ['../one.jpg','%2e%2e/one.jpg','%252e%252e/one.jpg','link/x.jpg','linked.jpg','.our-story-trash/x/photo']:
            self.assertNotEqual(self.request('/api/image?path='+path)[0],200)
        self.assertNotEqual(self.request('/api/upload?path=link&name=x.jpg','POST',PHOTO,{'Content-Type':'application/octet-stream'})[0],201)
        self.assertEqual(self.request('/api/upload?name=linked.jpg','POST',PHOTO,{'Content-Type':'application/octet-stream'})[0],409)
    def test_original_download_and_security_headers(self):
        status,data,h=self.request('/api/download?path=one.jpg')
        self.assertEqual(status,200);self.assertEqual(data,PHOTO);self.assertEqual(h['Cache-Control'],'no-store');self.assertIn('attachment',h['Content-Disposition']);self.assertEqual(h['X-Content-Type-Options'],'nosniff')
    def test_thumbnail_is_smaller_and_original_unchanged(self):
        if not api.Image:self.skipTest('Pillow optional')
        status,data,_=self.request('/api/thumbnail?path=one.jpg');self.assertEqual(status,200)
        with api.Image.open(io.BytesIO(data)) as image:self.assertLessEqual(max(image.size),1600);self.assertFalse(image.getexif())
        self.assertEqual((self.root/'one.jpg').read_bytes(),PHOTO)
    def test_soft_delete_restore_preserves_bytes(self):
        status,data,_=self.trash();self.assertEqual(status,200);ident=json.loads(data)['id']
        self.assertFalse((self.root/'one.jpg').exists())
        rows=json.loads(self.request('/api/trash')[1]);self.assertEqual(rows['items'][0]['path'],'one.jpg')
        self.assertNotIn(api.TRASH,[x['name'] for x in self.listing()['items']])
        self.assertEqual(self.request('/api/restore','POST',{'id':ident})[0],200)
        self.assertEqual((self.root/'one.jpg').read_bytes(),PHOTO)
    def test_changed_revision_and_restore_conflict(self):
        self.assertEqual(self.request('/api/trash','POST',{'path':'one.jpg','revision':'0'*64})[0],409)
        self.assertEqual((self.root/'one.jpg').read_bytes(),PHOTO)
        ident=json.loads(self.trash()[1])['id'];(self.root/'one.jpg').write_bytes(b'new')
        self.assertEqual(self.request('/api/restore','POST',{'id':ident})[0],409)
        self.assertEqual((self.root/'one.jpg').read_bytes(),b'new');self.assertEqual((self.root/api.TRASH/ident/'photo').read_bytes(),PHOTO)
    def test_no_permanent_delete_or_setup_routes(self):
        for route in ['/api/delete','/api/purge','/api/setup']:
            self.assertEqual(self.request(route,'POST',{})[0],404)
        self.assertEqual(self.request('/api/restore','POST',{'id':'../x'})[0],400)
    def test_duplicate_queries_rejected(self):self.assertEqual(self.request('/api/list?path=&path=other')[0],400)

    def test_shared_index_same_order_persistent_and_name_rules(self):
        rule={'type':'name','text':'오니둥이','mode':'numbered','root':''}
        for folder in ['2019/오니둥이','2020/오니둥이1','2021/오니둥이친구','2022/오니둥이2']:
            directory=self.root/folder;directory.mkdir(parents=True)
            (directory/'a.jpg').write_bytes(PHOTO)
        self.store.writable=False
        self.settings.patch({'revision':0,'albums':{'growth:함께':rule}})
        status,raw,_=self.request('/api/album-index','POST',{'key':'growth:함께'})
        self.assertEqual(status,200);data=json.loads(raw)
        self.assertEqual(data['total'],3);self.assertFalse(data['indexing'])
        self.assertEqual([i['folderYear'] for i in data['items']],['2022','2020','2019'])
        restarted=api.SharedArchive(api.SharedSettings(self.settings_dir),self.store)
        self.assertEqual(restarted.collection('growth:함께',rule)['items'],data['items'])
        self.assertEqual(restarted.collection('growth:함께',rule,'2020')['total'],1)
        self.assertEqual(json.loads(self.request('/api/album-index','POST',{'key':'travel'})[1])['unbound'],True)
    def test_shared_index_resumes_and_preserves_snapshot_until_complete(self):
        archive=self.server.archive
        for n in range(4):
            d=self.root/str(n);d.mkdir();(d/'a.jpg').write_bytes(PHOTO)
        data=archive.collection('home','',budget=1)
        self.assertTrue(data['indexing']);self.assertEqual(data['total'],1)
        self.assertEqual(data['items'][0]['name'],'one.jpg')
        self.assertEqual(data['progress'],{'scanned':1,'pending':5,'found':1})
        archive=api.SharedArchive(self.settings,self.store)
        data=archive.collection('home','',budget=20)
        self.assertFalse(data['indexing']);self.assertEqual(data['total'],5)
        (self.root/'new.jpg').write_bytes(PHOTO)
        building=archive.collection('home','',refresh=True,budget=1)
        self.assertTrue(building['indexing']);self.assertEqual(building['items'],data['items'])
        finished=archive.collection('home','',budget=20)
        self.assertEqual(finished['total'],6)
        self.assertNotEqual(finished['snapshot'],data['snapshot'])
    def test_index_auth_schema_and_missing_source_preserves_last_good(self):
        self.assertEqual(self.request('/api/album-index','POST',{'key':'home'},headers={'Authorization':'wrong'})[0],401)
        for payload in [{'key':'../x'},{'key':'home','year':'<bad>'},{'key':'home','refresh':'yes'},{'key':[]}]:
            self.assertEqual(self.request('/api/album-index','POST',payload)[0],400)
        archive=self.server.archive
        good=archive.collection('home','기억')
        (self.root/'기억').rmdir()
        bad=archive.collection('home','기억',refresh=True)
        self.assertEqual(bad['snapshot'],good['snapshot']);self.assertEqual(bad['issues'],1)
    @unittest.skipIf(api.Image is None,'Pillow required')
    def test_thumbnail_persists_reuses_and_invalidates_without_editing_source(self):
        from unittest.mock import patch
        original=(self.root/'one.jpg').read_bytes()
        self.assertEqual(self.request('/api/thumbnail?path=one.jpg')[0],200)
        cache=list((self.settings_dir/'thumbnails').glob('v1-*.jpg'));self.assertEqual(len(cache),1)
        self.server.archive=api.SharedArchive(self.settings,self.store)
        with patch.object(api.Image,'open',side_effect=AssertionError('must use saved thumbnail')):
            self.assertEqual(self.request('/api/thumbnail?path=one.jpg')[0],200)
        (self.root/'one.jpg').write_bytes(original)
        self.assertEqual(self.request('/api/thumbnail?path=one.jpg')[0],200)
        self.assertEqual(len(list((self.settings_dir/'thumbnails').glob('v1-*.jpg'))),2)
        self.assertEqual((self.root/'one.jpg').read_bytes(),original)

    def test_random_visits_sample_full_index_and_keep_same_visit_stable(self):
        for i in range(40): (self.root/('photo-%02d.jpg'%i)).write_bytes(PHOTO)
        seed='a'*32;archive=self.server.archive
        first=archive.collection('home','',seed=seed)
        again=archive.collection('home','',seed=seed)
        other=archive.collection('home','',seed='b'*32)
        self.assertTrue(first['randomized']);self.assertEqual(len(first['items']),12)
        self.assertEqual(first['items'],again['items']);self.assertNotEqual(first['items'],other['items'])
        self.assertEqual(first['total'],41)
        default=archive.collection('home','')
        self.assertFalse(default['randomized']);self.assertNotEqual(first['items'],default['items'])
        self.assertEqual(self.request('/api/album-index','POST',{'key':'home','seed':'bad'})[0],400)
        status,raw,_=self.request('/api/album-index','POST',{'key':'home','seed':seed})
        self.assertEqual(status,200);self.assertEqual(json.loads(raw)['items'],first['items'])

    def test_family_account_bootstrap_korean_login_restart_and_logout(self):
        password='fixture password 12345'
        data={'username':'오니둥이','password':password}
        self.assertEqual(self.request('/api/account','POST',data,{'Authorization':'wrong'})[0],401)
        self.assertEqual(self.request('/api/login','POST',data)[0],409)
        self.assertEqual(self.request('/api/account','POST',data)[0],201)
        self.assertEqual(self.request('/api/list')[0],401) # Old token loses access.
        self.assertEqual(self.request('/api/login','POST',data,{'Origin':'https://evil.example'})[0],403)
        status,raw,_=self.request('/api/login','POST',data)
        self.assertEqual(status,200);session=json.loads(raw)['session'];headers={'Authorization':'Bearer '+session}
        self.assertEqual(self.request('/api/list',headers=headers)[0],200)
        self.server.auth=api.FamilyAuth(self.settings_dir)
        self.assertEqual(self.request('/api/list',headers=headers)[0],200)
        caps=json.loads(self.request('/api/capabilities',headers=headers)[1])
        self.assertTrue(caps['familyLogin']);self.assertFalse(caps['accountSetup'])
        self.assertEqual(self.request('/api/account','POST',data,headers)[0],409)
        rawdb=(self.settings_dir/'auth.sqlite3').read_bytes()
        for secret in [password,session,TOKEN]:self.assertNotIn(secret.encode(),rawdb)
        self.assertEqual(self.request('/api/logout','POST',{},headers)[0],200)
        self.assertEqual(self.request('/api/list',headers=headers)[0],401)
    def test_family_account_wrong_password_rate_limit_and_expiry(self):
        from unittest.mock import patch
        auth=self.server.auth
        auth.setup({'username':'오니둥이','password':'fixture password 12345'})
        session=auth.login({'username':'오니둥이','password':'fixture password 12345'})['session']
        with auth.db() as db:db.execute('UPDATE sessions SET expires=0')
        self.assertFalse(auth.valid(session))
        with patch.object(auth,'derive',return_value=b'bad digest'):
            for _ in range(10):
                with self.assertRaises(api.APIError) as error:auth.login({'username':'오니둥이','password':'wrong'})
                self.assertEqual(error.exception.status,401)
            with self.assertRaises(api.APIError) as error:auth.login({'username':'오니둥이','password':'wrong'})
            self.assertEqual(error.exception.status,429)
        self.assertEqual(self.request('/api/login','POST',{'username':'오니둥이','password':'wrong'})[0],429)
    def test_family_setup_requires_fixed_name_and_strong_length(self):
        for payload in [{'username':'other','password':'fixture password 12345'},{'username':'오니둥이','password':'short'},{'username':'오니둥이','password':'x'*129}]:
            self.assertEqual(self.request('/api/account','POST',payload)[0],400)
        self.assertFalse(self.server.auth.configured())

    def test_journal_http_requires_login_supports_crud_and_private_backup(self):
        import uuid
        self.assertEqual(self.request('/api/journal?target=다온'.replace('다온','%EB%8B%A4%EC%98%A8'))[0],409)
        credentials={'username':'오니둥이','password':'fixture password 12345'}
        self.assertEqual(self.request('/api/account','POST',credentials)[0],201)
        session=json.loads(self.request('/api/login','POST',credentials)[1])['session'];headers={'Authorization':'Bearer '+session}
        self.store.writable=False
        record={'target':'다온','kind':'words','date':'2026-11-14','author':'아빠','quote':'할 수 있어!','listener':'엄마','context':'학교에 가는 길','attachments':[]}
        payload={'action':'save','id':str(uuid.uuid4()),'revision':0,'record':record}
        self.assertEqual(self.request('/api/journal','POST',payload)[0],401)
        self.assertEqual(self.request('/api/journal','POST',payload,{**headers,'Origin':'https://evil.example'})[0],403)
        status,raw,_=self.request('/api/journal','POST',payload,headers);self.assertEqual(status,200)
        saved=json.loads(raw);self.assertEqual(saved['record'],record)
        url='/api/journal?target=%EB%8B%A4%EC%98%A8'
        self.assertEqual(json.loads(self.request(url,headers=headers)[1])['total'],1)
        stale={**payload,'revision':1,'record':{**record,'quote':'수정한 말'}}
        self.assertEqual(self.request('/api/journal','POST',stale,headers)[0],200)
        self.assertEqual(self.request('/api/journal','POST',stale,headers)[0],409)
        status,raw,heads=self.request('/api/journal-backup',headers=headers)
        self.assertEqual(status,200);self.assertTrue(raw.startswith(b'SQLite format 3'))
        self.assertEqual(heads['Cache-Control'],'no-store');self.assertNotIn(session.encode(),raw)
        self.assertFalse(list(self.settings_dir.glob('.journal-backup-*')))
        self.assertEqual(self.request('/api/logout','POST',{},headers)[0],200)
        self.assertEqual(self.request(url,headers=headers)[0],401)

    def test_record_photo_reference_rejects_replaced_file_before_returning_bytes(self):
        rev=self.item()['revision']
        (self.root/'one.jpg').write_bytes(PHOTO)
        for route in ['image','thumbnail']:
            self.assertEqual(self.request('/api/'+route+'?path=one.jpg&revision='+rev)[0],409)
        new=self.item()['revision']
        self.assertEqual(self.request('/api/image?path=one.jpg&revision='+new)[0],200)

if __name__=='__main__':unittest.main()
