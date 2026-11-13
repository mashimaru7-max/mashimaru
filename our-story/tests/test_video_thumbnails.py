"""Real ffmpeg fixtures and isolated temp storage only; never real NAS files."""
import hashlib
import io
import json
import os
import shutil
import subprocess
import tempfile
import threading
import time
import unittest
from pathlib import Path
from unittest.mock import patch
from urllib.parse import urlencode
import test_nas_service as fixture
api=fixture.api
class ThumbnailTests(unittest.TestCase):
    setUp=fixture.ServiceTests.setUp
    tearDown=fixture.ServiceTests.tearDown
    request=fixture.ServiceTests.request
    @classmethod
    def setUpClass(cls):
        if not shutil.which('ffmpeg'):raise unittest.SkipTest('ffmpeg integration fixtures need ffmpeg')
        cls.fixtures=tempfile.TemporaryDirectory();cls.sources={}
        for name,codec in [('h264','libx264'),('hevc','libx265')]:
            target=Path(cls.fixtures.name)/(name+'.mp4')
            cmd=['ffmpeg','-nostdin','-loglevel','error','-f','lavfi','-i','color=c=orange:s=96x64:d=0.2','-an','-c:v',codec,'-threads','1']
            if codec=='libx265':cmd+=['-x265-params','pools=none:frame-threads=1:log-level=error']
            subprocess.run(cmd+['-y',str(target)],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,check=True,timeout=20);cls.sources[name]=target.read_bytes()
    @classmethod
    def tearDownClass(cls):cls.fixtures.cleanup()
    def source(self,codec='h264'):
        path=self.root/'film.mp4';path.write_bytes(self.sources[codec]);return path,api.revision(path.stat())
    def route(self,rev):return '/api/video-thumbnail?'+urlencode({'path':'film.mp4','revision':rev})
    def test_hevc_produces_jpeg_without_changing_video_and_survives_restart(self):
        path,rev=self.source('hevc');original=path.read_bytes();status,raw,h=self.request(self.route(rev));self.assertEqual(status,200,raw);self.assertEqual(h['Content-Type'],'image/jpeg');self.assertEqual(h['Cache-Control'],'no-store')
        with api.Image.open(io.BytesIO(raw)) as image:self.assertEqual(image.format,'JPEG');self.assertLessEqual(max(image.size),640)
        self.assertEqual(path.read_bytes(),original);self.assertEqual(api.revision(path.stat()),rev)
        self.assertEqual(len(list((self.settings_dir/'video-thumbnails').glob('*.jpg'))),1)
        restarted=api.VideoThumbnails(self.settings)
        with patch.object(api.subprocess,'run',side_effect=AssertionError('cache must not decode again')):
            with self.store.photo('film.mp4',media=True) as (fd,st):self.assertEqual(restarted.thumbnail(fd,st,'film.mp4'),raw)
    def test_auth_origin_revision_and_symlink_checks_apply_to_thumbnails(self):
        path,rev=self.source();route=self.route(rev)
        self.assertEqual(self.request(route,headers={'Authorization':'wrong'})[0],401);self.assertEqual(self.request(route,headers={'Origin':'https://evil.example'})[0],403)
        self.assertEqual(self.request(self.route('0'*64))[0],409)
        (self.root/'link.mp4').symlink_to(path)
        self.assertNotEqual(self.request('/api/video-thumbnail?'+urlencode({'path':'link.mp4','revision':rev}))[0],200)
        self.assertFalse((self.settings_dir/'video-thumbnails').exists())
    def test_missing_decoder_and_corrupt_video_are_reported_without_modifying_source(self):
        path,rev=self.source()
        with patch.object(self.server.video_thumbs,'executable',return_value=None):self.assertEqual(self.request(self.route(rev))[0],501)
        path.write_bytes(b'not a video');rev=api.revision(path.stat())
        self.assertEqual(self.request(self.route(rev))[0],415)
        with patch.object(api.subprocess,'run',side_effect=AssertionError('failed decode is temporarily remembered')):self.assertEqual(self.request(self.route(rev))[0],415)
        self.assertEqual(path.read_bytes(),b'not a video')
    def test_changed_source_and_timeout_never_publish_a_stale_frame(self):
        path,rev=self.source()
        with patch.object(api.subprocess,'run',side_effect=subprocess.TimeoutExpired('ffmpeg',20)):
            self.assertEqual(self.request(self.route(rev))[0],415)
        self.assertFalse((self.settings_dir/'video-thumbnails').exists())
        self.server.video_thumbs.failures.clear();real_run=api.subprocess.run
        def mutate(*args,**kwargs):
            result=real_run(*args,**kwargs);path.write_bytes(self.sources['hevc']);return result
        with patch.object(api.subprocess,'run',side_effect=mutate):self.assertEqual(self.request(self.route(rev))[0],409)
        self.assertFalse((self.settings_dir/'video-thumbnails').exists())
    def test_parallel_requests_decode_once_and_cached_images_work_in_readonly_mode(self):
        path,rev=self.source();self.store.writable=False;real_run=api.subprocess.run;calls=[]
        def counted(*args,**kwargs):calls.append(1);time.sleep(.05);return real_run(*args,**kwargs)
        results=[]
        def request():results.append(self.request(self.route(rev)))
        with patch.object(api.subprocess,'run',side_effect=counted):
            threads=[threading.Thread(target=request) for _ in range(2)]
            for thread in threads:thread.start()
            for thread in threads:thread.join()
        self.assertEqual([r[0] for r in results],[200,200]);self.assertEqual(len(calls),1);self.assertEqual(results[0][1],results[1][1])
if __name__=='__main__':unittest.main()
