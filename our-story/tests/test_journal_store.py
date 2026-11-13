"""Disposable records and photos only; no real NAS access."""
import concurrent.futures
import contextlib
import hashlib
import importlib.util
import sqlite3
import tempfile
import unittest
import uuid
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('journal_api',ROOT/'nas-service/server.py')
api=importlib.util.module_from_spec(spec);spec.loader.exec_module(api)
class JournalTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.root=Path(self.temp.name)
        (self.root/'photos').mkdir();(self.root/'state').mkdir()
        self.photo=self.root/'photos/a.jpg';self.photo.write_bytes((ROOT/'assets/beach.jpg').read_bytes())
        self.photos=api.PhotoStore(self.root/'photos',False)
        self.store=api.JournalStore(self.root/'state',self.photos)
    def tearDown(self):
        import os
        os.close(self.photos.root);self.temp.cleanup()
    def record(self,kind='diary',**patch):
        r={'target':'다온','kind':kind,'date':'2026-11-14','author':'엄마','attachments':[]}
        r.update({'diary':{'title':'처음 해낸 날','topic':'일상','body':'직접 해냈어요.','feeling':'기특했어요.'},'words':{'quote':'나도 할 수 있어!','listener':'아빠','context':'함께 걷다가'},'letter':{'body':'지금의 너에게 남기는 편지','readOn':'2030-11-14'},'measure':{'height':125.3,'weight':None,'note':'학교 신체검사'}}[kind]);r.update(patch);return r
    def save(self,record=None,ident=None,revision=0):
        return self.store.mutate({'action':'save','id':ident or str(uuid.uuid4()),'revision':revision,'record':record or self.record()})
    def test_all_four_kinds_persist_and_repeat_create_is_idempotent(self):
        for kind in ['diary','words','letter','measure']:
            ident=str(uuid.uuid4());r=self.record(kind);saved=self.save(r,ident)
            again=self.save(r,ident);self.assertEqual(saved,again)
            restarted=api.JournalStore(self.root/'state',self.photos)
            self.assertEqual(restarted.get(ident),saved)
        self.assertEqual(self.store.listing('다온')['total'],4)
    def test_concurrent_updates_reject_stale_revision_without_overwrite(self):
        saved=self.save();ident=saved['id'];second=api.JournalStore(self.root/'state',self.photos)
        def update(store,title):
            try:return store.mutate({'action':'save','id':ident,'revision':1,'record':self.record(title=title)})
            except api.APIError as error:return error.status
        with concurrent.futures.ThreadPoolExecutor(2) as pool:results=list(pool.map(lambda args:update(*args),[(self.store,'엄마의 수정'),(second,'아빠의 수정')]))
        self.assertEqual(sum(isinstance(r,dict) for r in results),1);self.assertIn(409,results)
        self.assertEqual(self.store.get(ident)['revision'],2)
    def test_trash_restore_preserve_record_and_original_photo(self):
        before=hashlib.sha256(self.photo.read_bytes()).digest()
        with self.photos.photo('a.jpg') as (fd,st):ref={'path':'a.jpg','revision':api.revision(st)}
        saved=self.save(self.record(attachments=[ref]));ident=saved['id']
        trashed=self.store.mutate({'action':'trash','id':ident,'revision':1})
        self.assertTrue(trashed['deleted']);self.assertEqual(self.store.listing('다온')['total'],0)
        self.assertEqual(self.store.listing('다온',trash=True)['total'],1)
        restored=self.store.mutate({'action':'restore','id':ident,'revision':2})
        self.assertFalse(restored['deleted']);self.assertEqual(restored['record'],saved['record'])
        self.assertEqual(hashlib.sha256(self.photo.read_bytes()).digest(),before)
    def test_attachment_revision_and_paths_are_verified(self):
        with self.photos.photo('a.jpg') as (fd,st):ref={'path':'a.jpg','revision':api.revision(st)}
        for bad in [{'path':'../a.jpg','revision':ref['revision']},{'path':'a.jpg','revision':'bad'}]:
            with self.assertRaises(api.APIError):self.save(self.record(attachments=[bad]))
        self.photo.write_bytes(self.photo.read_bytes())
        with self.assertRaises(api.APIError) as error:self.save(self.record(attachments=[ref]))
        self.assertEqual(error.exception.status,409)
    def test_kind_specific_validation_and_no_retargeting(self):
        invalid=[self.record('measure',height=None,weight=None),self.record('measure',height=True),self.record('measure',height=float('nan')),self.record(date='2026-02-30'),self.record('words',quote=''),self.record('diary',weight=30),self.record('letter',body=''),self.record(author='unknown'),self.record(attachments=[{}]*7)]
        for record in invalid:
            with self.assertRaises((api.APIError,ValueError)):self.save(record)
        saved=self.save()
        with self.assertRaises(api.APIError):self.save(self.record(target='라온'),saved['id'],1)
    def test_filters_pagination_and_backup_contain_only_record_database(self):
        for i in range(12):self.save(self.record(title='기록 '+str(i),date='2025-01-%02d'%(i+1)))
        self.save(self.record('words',target='라온'))
        page=self.store.listing('다온');self.assertEqual(len(page['items']),10);self.assertEqual(page['next'],10)
        self.assertEqual(len(self.store.listing('다온',offset=10)['items']),2)
        self.assertEqual(self.store.listing('라온',kind='words')['total'],1)
        self.assertEqual(self.store.listing('다온',year='2026')['total'],0)
        self.assertEqual(self.store.listing('다온',query="' OR 1=1 --")['total'],0)
        path=self.store.backup()
        try:
            with contextlib.closing(sqlite3.connect(path)) as db:
                self.assertEqual(db.execute('SELECT count(*) FROM records').fetchone()[0],13)
                self.assertEqual(db.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall(),[('records',)])
        finally:path.unlink()
