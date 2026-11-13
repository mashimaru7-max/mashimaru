"""Directory writes use disposable fixtures, never a user's NAS."""
import contextlib
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import uuid
ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('file_api',ROOT/'nas-service/server.py');api=importlib.util.module_from_spec(spec);spec.loader.exec_module(api)
class FileTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.root=Path(self.temp.name);self.photos=self.root/'photos';self.state=self.root/'state'
        self.photos.mkdir();self.state.mkdir();(self.photos/'2019/오니둥이').mkdir(parents=True);(self.photos/'정리').mkdir()
        self.old='2019/오니둥이/a.jpg';(self.photos/self.old).write_bytes((ROOT/'assets/beach.jpg').read_bytes())
        self.store=api.PhotoStore(self.photos,True);self.settings=api.SharedSettings(self.state)
        self.settings.patch({'revision':0,'albums':{'growth:함께':'2019/오니둥이','home':{'type':'name','text':'오니둥이','mode':'numbered','root':'2019/오니둥이'}},'home':{'path':self.old,'name':'a.jpg'}})
        self.journal=api.JournalStore(self.state,self.store);self.archive=api.SharedArchive(self.settings,self.store)
        with self.store.photo(self.old) as (fd,st):self.ref={'path':self.old,'revision':api.revision(st)}
        self.record=self.journal.mutate({'action':'save','id':str(uuid.uuid4()),'revision':0,'record':{'target':'다온','kind':'words','date':'2026-11-14','author':'엄마','quote':'남겨 둘 한마디','listener':'아빠','context':'함께 걸으며','attachments':[self.ref]}})
        self.manager=api.FileManager(self.store,self.settings,self.journal,self.archive)
        self.assertTrue(self.manager.safe_moves())
    def tearDown(self):os.close(self.store.root);self.temp.cleanup()
    def request(self,path='2019/오니둥이',name='함께한날',destination='정리'):
        st=os.stat(self.photos/path,follow_symlinks=False)
        return {'action':'move','path':path,'revision':api.revision(st),'destination':destination,'name':name,'operationId':uuid.uuid4().hex}
    def test_folder_move_preserves_bytes_and_updates_all_primary_references(self):
        digest=hashlib.sha256((self.photos/self.old).read_bytes()).digest()
        data=self.request();self.manager.perform(data)
        new='정리/함께한날/a.jpg';self.assertFalse((self.photos/'2019/오니둥이').exists())
        self.assertEqual(hashlib.sha256((self.photos/new).read_bytes()).digest(),digest)
        settings=self.settings.read();self.assertEqual(settings['albums']['growth:함께'],'정리/함께한날')
        self.assertEqual(settings['albums']['home']['root'],'정리/함께한날');self.assertEqual(settings['albums']['home']['text'],'오니둥이')
        self.assertEqual(settings['home']['path'],new)
        record=self.journal.get(self.record['id']);self.assertEqual(record['revision'],2);self.assertEqual(record['record']['attachments'][0]['path'],new)
        self.assertEqual(self.manager.perform(data)['path'],'정리/함께한날');self.assertEqual(self.journal.get(self.record['id'])['revision'],2)
        with self.manager.db() as db:
            raw=db.execute('SELECT payload FROM operations').fetchone()[0];self.assertNotIn('남겨 둘 한마디',raw)
    def test_photo_rename_refreshes_revision_and_manual_home_name(self):
        self.manager.perform(self.request(self.old,'new.jpg','정리'))
        updated=self.journal.get(self.record['id'])['record']['attachments'][0]
        with self.store.photo('정리/new.jpg') as (fd,st):self.assertEqual(updated['revision'],api.revision(st))
        self.assertEqual(updated['path'],'정리/new.jpg');self.assertEqual(self.settings.read()['home']['name'],'new.jpg')
    def test_conflict_stale_paths_and_unsupported_rename_do_not_overwrite(self):
        destination=self.photos/'정리/함께한날';destination.mkdir();(destination/'keep.txt').write_text('keep')
        with self.assertRaises(api.APIError) as error:self.manager.perform(self.request())
        self.assertEqual(error.exception.status,409);self.assertEqual((destination/'keep.txt').read_text(),'keep');self.assertTrue((self.photos/self.old).exists())
        for data in [self.request(destination='2019/오니둥이/sub'),self.request(name='../bad')]:
            with self.assertRaises((api.APIError,OSError)):self.manager.perform(data)
        stale=self.request(name='fresh');stale['revision']='0'*64
        with self.assertRaises(api.APIError):self.manager.perform(stale)
        with patch.object(api,'rename_no_replace',side_effect=api.APIError(501)):
            with self.assertRaises(api.APIError) as error:self.manager.perform(self.request(name='fresh'))
            self.assertEqual(error.exception.status,501)
        self.assertTrue((self.photos/self.old).exists())
    def test_restart_completes_metadata_after_rename_and_preserves_a_stale_attachment(self):
        (self.photos/self.old).write_bytes((self.photos/self.old).read_bytes())
        with patch.object(self.manager,'finalize',side_effect=OSError('simulated crash')):
            with self.assertRaises(api.APIError):self.manager.perform(self.request())
        self.assertTrue((self.photos/'정리/함께한날/a.jpg').exists())
        recovered=api.FileManager(self.store,self.settings,self.journal,self.archive);recovered.recover()
        ref=self.journal.get(self.record['id'])['record']['attachments'][0]
        self.assertEqual(ref['path'],'정리/함께한날/a.jpg');self.assertEqual(ref['revision'],self.ref['revision'])
        with self.store.photo(ref['path']) as (fd,st):self.assertNotEqual(ref['revision'],api.revision(st))
    def test_restart_after_settings_commit_does_not_double_increment_revisions(self):
        original=self.journal.db;calls=0
        @contextlib.contextmanager
        def failing_db():
            nonlocal calls
            calls+=1
            if calls>=2:raise OSError('simulated record database outage')
            with original() as db:yield db
        with patch.object(self.journal,'db',failing_db):
            with self.assertRaises(api.APIError):self.manager.perform(self.request())
        self.assertEqual(self.settings.read()['revision'],2)
        recovered=api.FileManager(self.store,self.settings,self.journal,self.archive);recovered.recover();recovered.recover()
        self.assertEqual(self.settings.read()['revision'],2);self.assertEqual(self.journal.get(self.record['id'])['revision'],2)
    def test_prepared_but_unstarted_move_is_cancelled_on_restart(self):
        with patch.object(api,'rename_no_replace',side_effect=KeyboardInterrupt):
            with self.assertRaises(KeyboardInterrupt):self.manager.perform(self.request())
        recovered=api.FileManager(self.store,self.settings,self.journal,self.archive);recovered.recover()
        self.assertTrue((self.photos/self.old).exists());self.assertEqual(self.settings.read()['revision'],1)
        self.assertEqual(self.journal.get(self.record['id'])['revision'],1)
    def test_recovery_keeps_an_externally_recreated_source_folder(self):
        with patch.object(self.manager,'finalize',side_effect=OSError('simulated crash')):
            with self.assertRaises(api.APIError):self.manager.perform(self.request())
        recreated=self.photos/'2019/오니둥이';recreated.mkdir();(recreated/'external.txt').write_text('keep')
        recovered=api.FileManager(self.store,self.settings,self.journal,self.archive);recovered.recover()
        self.assertEqual((recreated/'external.txt').read_text(),'keep')
        self.assertEqual(self.journal.get(self.record['id'])['record']['attachments'][0]['path'],'정리/함께한날/a.jpg')
    def test_trash_restore_reconnects_saved_records_without_modifying_photo_bytes(self):
        data=(self.photos/self.old).read_bytes();trashed=self.store.trash(self.old,self.ref['revision'])
        self.assertFalse((self.photos/self.old).exists());self.manager.restore(trashed['id'])
        self.assertEqual((self.photos/self.old).read_bytes(),data)
        ref=self.journal.get(self.record['id'])['record']['attachments'][0]
        with self.store.photo(self.old) as (fd,st):self.assertEqual(ref['revision'],api.revision(st))
        self.manager.restore(trashed['id']);self.assertEqual(self.journal.get(self.record['id'])['revision'],2)
    def test_nas_system_recycle_snapshot_and_symlink_paths_are_protected(self):
        for name in ['#recycle','#snapshot','@database']:
            (self.photos/name).mkdir();(self.photos/name/'keep.txt').write_text('protected')
            with self.assertRaises(api.APIError):self.manager.perform({'action':'mkdir','parent':name,'name':'changed'})
            self.assertEqual((self.photos/name/'keep.txt').read_text(),'protected')
        self.assertFalse(any(i['name'].startswith(('#','@')) for i in self.store.listing('',0)['items']))
        os.symlink(self.photos/'2019',self.photos/'shortcut')
        with self.assertRaises((api.APIError,OSError)):self.manager.perform({'action':'mkdir','parent':'shortcut','name':'changed'})
    def test_folder_creation_is_exclusive_and_read_only_mode_denies_writes(self):
        self.manager.perform({'action':'mkdir','parent':'정리','name':'학교생활'})
        with self.assertRaises(FileExistsError):self.manager.perform({'action':'mkdir','parent':'정리','name':'학교생활'})
        self.store.writable=False
        with self.assertRaises(api.APIError) as error:self.manager.perform({'action':'mkdir','parent':'정리','name':'another'})
        self.assertEqual(error.exception.status,403)
