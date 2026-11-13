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
        for route in ['/api/delete','/api/purge','/api/setup','/api/login']:
            self.assertEqual(self.request(route,'POST',{})[0],404)
        self.assertEqual(self.request('/api/restore','POST',{'id':'../x'})[0],400)
    def test_duplicate_queries_rejected(self):self.assertEqual(self.request('/api/list?path=&path=other')[0],400)

if __name__=='__main__':unittest.main()
