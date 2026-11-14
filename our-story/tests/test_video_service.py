"""Video tests use temporary files only; no real NAS or family media."""
import hashlib
import io
import json
import os
from pathlib import Path
import unittest
from unittest.mock import patch
from urllib.parse import urlencode
import test_nas_service as fixture
api=fixture.api
class VideoTests(unittest.TestCase):
    setUp=fixture.ServiceTests.setUp
    tearDown=fixture.ServiceTests.tearDown
    request=fixture.ServiceTests.request
    def data(self,size=100):return b'\x00\x00\x00\x18ftypisom'+b'0'*(size-12)
    def video(self):
        raw=self.data();(self.root/'film.mp4').write_bytes(raw);rev=api.revision((self.root/'film.mp4').stat());return raw,rev
    def route(self,rev,download=False):return '/api/'+('video-download' if download else 'video')+'?'+urlencode({'path':'film.mp4','revision':rev})
    def test_authenticated_full_and_partial_video_streams(self):
        raw,rev=self.video();route=self.route(rev)
        status,body,headers=self.request(route);self.assertEqual(status,200);self.assertEqual(body,raw);self.assertEqual(headers['Content-Type'],'video/mp4');self.assertEqual(headers['Cache-Control'],'no-store')
        for value,expected in [('bytes=0-9',raw[:10]),('bytes=12-',raw[12:]),('bytes=-8',raw[-8:])]:
            status,body,h=self.request(route,headers={'Range':value});self.assertEqual(status,206);self.assertEqual(body,expected);self.assertIn('Content-Range',h)
        for value in ['bytes=999-','bytes=20-10','bytes=0-1,5-6','bytes=-0','invalid']:
            status,_,h=self.request(route,headers={'Range':value});self.assertEqual(status,416);self.assertEqual(h['Content-Range'],'bytes */100')
        status,body,h=self.request(self.route(rev,True));self.assertEqual(body,raw);self.assertIn('attachment;',h['Content-Disposition'])
        self.assertEqual(self.request(route,headers={'Authorization':'wrong'})[0],401);self.assertEqual(self.request(route,headers={'Origin':'https://evil.example'})[0],403)
        self.assertEqual(self.request(self.route('0'*64))[0],409)
        (self.root/'link.mp4').symlink_to(self.root/'film.mp4');self.assertNotEqual(self.request('/api/video?'+urlencode({'path':'link.mp4','revision':rev}))[0],200)
    def test_gallery_includes_video_but_shared_photo_album_excludes_it(self):
        self.video();items=json.loads(self.request('/api/list')[1])['items'];self.assertIn('film.mp4',[i['name'] for i in items])
        self.settings.patch({'revision':0,'albums':{'growth:함께':''}})
        album=self.server.archive.collection('growth:함께','','',False)
        self.assertNotIn('film.mp4',[i['name'] for i in album['items']]);self.assertEqual(album['total'],1)
    def native(self,route,method='GET',headers=None):
        import http.client
        connection=http.client.HTTPConnection(*self.server.server_address,timeout=4);connection.request(method,route,headers=headers or {});response=connection.getresponse();result=(response.status,response.read(),dict(response.getheaders()));connection.close();return result
    def ticket(self,rev):
        session=self.server.auth.login({'username':'오니둥이','password':'fixture-password'})['session']
        status,raw,_=self.request('/api/video-download-ticket','POST',{'path':'film.mp4','revision':rev},{'Authorization':'Bearer '+session});self.assertEqual(status,200)
        return '/api/video-file/'+json.loads(raw)['ticket'],session
    def test_native_download_without_origin_or_bearer_is_single_use_and_allows_downloads(self):
        raw,rev=self.video();self.server.auth.setup({'username':'오니둥이','password':'fixture-password'});route,session=self.ticket(rev)
        self.assertNotIn(session,route)
        status,body,h=self.native(route,'HEAD');self.assertEqual(status,200);self.assertEqual(body,b'');self.assertEqual(int(h['Content-Length']),len(raw))
        status,body,h=self.native(route,headers={'Range':'bytes=0-3'});self.assertEqual(status,200);self.assertEqual(body,raw);self.assertEqual(h['Accept-Ranges'],'none');self.assertIn('allow-downloads',h['Content-Security-Policy']);self.assertIn('attachment;',h['Content-Disposition']);self.assertEqual(h['Referrer-Policy'],'no-referrer')
        self.assertEqual(self.native(route)[0],410)
    def test_native_download_denies_expiry_logout_changed_file_and_untrusted_issuance(self):
        raw,rev=self.video();self.server.auth.setup({'username':'오니둥이','password':'fixture-password'})
        self.assertEqual(self.request('/api/video-download-ticket','POST',{'path':'film.mp4','revision':rev})[0],401)
        route,session=self.ticket(rev)
        with patch.object(api.time,'time',return_value=api.time.time()+121):self.assertEqual(self.native(route)[0],410)
        route,session=self.ticket(rev);self.server.auth.logout(session);self.assertEqual(self.native(route)[0],401)
        route,session=self.ticket(rev);(self.root/'film.mp4').write_bytes(b'changed');self.assertEqual(self.native(route)[0],409)
        self.assertEqual(self.native('/api/video-file/invalid')[0],404)
    def begin(self,name='upload.mp4',raw=None,owner='fixture-owner'):
        raw=raw or self.data();return self.server.videos.start({'action':'init','path':'','name':name,'size':len(raw),'fingerprint':hashlib.sha256(raw).hexdigest()},owner)
    def send(self,state,raw,owner='fixture-owner'):
        return self.server.videos.chunk(state['id'],owner,state['offset'],hashlib.sha256(raw).hexdigest(),io.BytesIO(raw),len(raw))
    def test_chunk_publish_is_durable_idempotent_and_does_not_overwrite(self):
        raw=self.data();state=self.begin(raw=raw);self.assertFalse((self.root/'upload.mp4').exists());self.assertEqual(self.begin(raw=raw)['id'],state['id'])
        result=self.send(state,raw);self.assertEqual(result['offset'],len(raw));self.assertEqual(self.send(state,raw)['offset'],len(raw))
        restarted=api.VideoUploads(self.store,self.settings);self.assertEqual(restarted.start({'action':'init','path':'','name':'upload.mp4','size':len(raw),'fingerprint':hashlib.sha256(raw).hexdigest()},'fixture-owner')['offset'],len(raw))
        restarted.finish(state['id'],'fixture-owner');self.assertEqual((self.root/'upload.mp4').read_bytes(),raw);self.assertTrue(restarted.finish(state['id'],'fixture-owner')['done'])
        with self.assertRaises(api.APIError):self.begin(owner='another-owner')
        self.assertEqual((self.root/'upload.mp4').read_bytes(),raw)
    def test_resume_discards_only_uncommitted_tail_and_checks_owner_hash_and_readonly(self):
        raw=self.data();state=self.begin(raw=raw);temp=self.root/('.our-story-video-'+state['id']);temp.write_bytes(b'uncommitted')
        self.begin(raw=raw);self.assertEqual(temp.stat().st_size,0)
        with self.assertRaises(api.APIError):self.send(state,raw,owner='another-owner')
        with self.assertRaises(api.APIError):self.server.videos.chunk(state['id'],'fixture-owner',0,'0'*64,io.BytesIO(raw),len(raw))
        self.assertFalse((self.root/'upload.mp4').exists());self.store.writable=False
        with self.assertRaises(api.APIError):self.send(state,raw)
    def test_changed_temp_parent_invalid_container_and_unfinished_file_remain_private(self):
        state=self.begin(raw=b'not a video');self.send(state,b'not a video')
        with self.assertRaises(api.APIError) as error:self.server.videos.finish(state['id'],'fixture-owner')
        self.assertEqual(error.exception.status,415);self.assertNotIn('upload.mp4',[i['name'] for i in self.store.listing('',0)['items']])
        temp=self.root/('.our-story-video-'+state['id']);temp.unlink();temp.symlink_to(self.root/'one.jpg')
        with self.assertRaises(OSError):self.server.videos.finish(state['id'],'fixture-owner')
        self.assertEqual((self.root/'one.jpg').read_bytes(),fixture.PHOTO)
    def test_video_trash_restore_and_move_keep_original_bytes(self):
        raw,rev=self.video();self.store.trash('film.mp4',rev);trash=self.store.trash_list()['items'][0];self.server.files.restore(trash['id']);self.assertEqual((self.root/'film.mp4').read_bytes(),raw)
        import uuid
        rev=api.revision((self.root/'film.mp4').stat());self.server.files.perform({'action':'move','path':'film.mp4','revision':rev,'name':'renamed.mp4','destination':'기억','operationId':uuid.uuid4().hex});self.assertEqual((self.root/'기억/renamed.mp4').read_bytes(),raw)
    def test_expired_partial_upload_cleanup_never_deletes_original_or_symlink_target(self):
        state=self.begin();temp=self.root/('.our-story-video-'+state['id'])
        with self.server.videos.db() as db:
            data=self.server.videos.get(db,state['id'],'fixture-owner');data['updated']=0;self.server.videos.save(db,data,'fixture-owner')
        self.begin('fresh.mp4');self.assertFalse(temp.exists());self.assertTrue((self.root/'one.jpg').exists())
    def test_multiple_chunks_resume_and_publication_crash_recovery(self):
        raw=self.data(30)
        with patch.object(api,'VIDEO_CHUNK',16):
            state=self.begin(raw=raw);self.send(state,raw[:16]);resumed=self.begin(raw=raw);self.assertEqual(resumed['offset'],16)
            self.send(resumed,raw[16:]);real_save=self.server.videos.save
            def crash(db,data,owner):
                if data['done']:raise OSError('fixture interruption before receipt')
                real_save(db,data,owner)
            with patch.object(self.server.videos,'save',side_effect=crash):
                with self.assertRaises(OSError):self.server.videos.finish(state['id'],'fixture-owner')
            self.assertEqual((self.root/'upload.mp4').read_bytes(),raw)
            self.server.videos.finish(state['id'],'fixture-owner');self.assertEqual((self.root/'upload.mp4').read_bytes(),raw)
    def test_video_upload_http_requires_session_and_enforces_chunk_limit(self):
        self.server.auth.setup({'username':'오니둥이','password':'fixture-password'});session=self.server.auth.login({'username':'오니둥이','password':'fixture-password'})['session'];h={'Authorization':'Bearer '+session}
        raw=self.data();body={'action':'init','path':'','name':'new.mp4','size':len(raw),'fingerprint':hashlib.sha256(raw).hexdigest()}
        self.assertEqual(self.request('/api/video-upload','POST',body)[0],401)
        status,result,_=self.request('/api/video-upload','POST',body,h);self.assertEqual(status,200);state=json.loads(result)
        route='/api/video-upload-chunk?'+urlencode({'id':state['id'],'offset':0,'hash':hashlib.sha256(raw).hexdigest()})
        self.assertEqual(self.request(route,'POST',raw,{**h,'Content-Type':'application/octet-stream'})[0],200)
        self.assertEqual(self.request('/api/video-upload','POST',{'action':'finish','id':state['id']},h)[0],200);self.assertEqual((self.root/'new.mp4').read_bytes(),raw)
if __name__=='__main__':unittest.main()
