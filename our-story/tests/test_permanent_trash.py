"""Permanent deletion is tested only against disposable local files."""
import hashlib
import importlib.util
import os
from pathlib import Path
import tempfile
import time
import unittest
from unittest.mock import patch
ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('purge_api',ROOT/'nas-service/server.py');api=importlib.util.module_from_spec(spec);spec.loader.exec_module(api)
class Auth:
    def login(self,data,verify_only=False):
        if data['password']!='fixture-password':raise api.APIError(401)
        assert verify_only
class PurgeTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.root=Path(self.temp.name);self.photos=self.root/'photos';self.photos.mkdir();self.state=self.root/'state';self.state.mkdir()
        self.store=api.PhotoStore(self.photos,True);self.settings=api.SharedSettings(self.state);self.journal=api.JournalStore(self.state,self.store);self.archive=api.SharedArchive(self.settings,self.store);self.files=api.FileManager(self.store,self.settings,self.journal,self.archive);self.purge=api.PermanentTrash(self.store,self.settings,self.journal)
    def tearDown(self):os.close(self.store.root);self.temp.cleanup()
    def trash(self,name='a.jpg',folder=False):
        path=self.photos/name
        if folder:path.mkdir();(path/'a.jpg').write_bytes(b'fixture');(path/'note.txt').write_text('keep until confirmed')
        else:path.write_bytes(b'fixture')
        rev=api.revision(path.stat())
        if folder:self.files.trash_folder(name,rev)
        else:self.store.trash(name,rev)
        return next(i for i in self.store.trash_list()['items'] if i['path']==name)
    def prepare(self,item):return self.purge.prepare([{'id':item['id'],'revision':item['revision']}],'fixture-password','fixture-session',Auth())['ticket']
    def commit(self,ticket):return self.purge.commit(ticket,True,'fixture-session')
    def test_selected_only_and_one_use(self):
        a=self.trash();b=self.trash('b.jpg');(self.photos/'live.jpg').write_bytes(b'live')
        ticket=self.prepare(a);result=self.commit(ticket);self.assertEqual(result['deleted'],[a['id']]);self.assertEqual(self.store.trash_list()['items'][0]['id'],b['id']);self.assertEqual((self.photos/'live.jpg').read_bytes(),b'live')
        with self.assertRaises(api.APIError):self.commit(ticket)
    def test_wrong_password_scope_expiry_and_confirmation(self):
        a=self.trash()
        with self.assertRaises(api.APIError) as error:self.purge.prepare([{'id':a['id'],'revision':a['revision']}],'wrong','fixture-session',Auth())
        self.assertEqual(error.exception.status,422);ticket=self.prepare(a)
        for confirm,session in [(False,'fixture-session'),(True,'other-session')]:
            with self.assertRaises(api.APIError):self.purge.commit(ticket,confirm,session)
        with patch.object(api.time,'time',return_value=time.time()+121):
            with self.assertRaises(api.APIError) as error:self.commit(ticket)
            self.assertEqual(error.exception.status,410)
        self.assertEqual(len(self.store.trash_list()['items']),1)
    def test_changed_descendant_rejects_all_before_deletion(self):
        a=self.trash(folder=True,name='album');ticket=self.prepare(a)
        with self.purge.entry(a['id']) as (_,fd):
            child=os.open('photo',api.DIR_FLAGS,dir_fd=fd)
            try:
                f=os.open('note.txt',os.O_WRONLY|os.O_APPEND,dir_fd=child);os.write(f,b'changed');os.close(f)
            finally:os.close(child)
        with self.assertRaises(api.APIError) as error:self.commit(ticket)
        self.assertEqual(error.exception.status,409);self.assertEqual(len(self.store.trash_list()['items']),1)
    def test_folder_symlink_never_follows_outside(self):
        outside=self.root/'outside';outside.write_text('protected');a=self.trash(folder=True,name='album')
        with self.purge.entry(a['id']) as (_,fd):
            child=os.open('photo',api.DIR_FLAGS,dir_fd=fd)
            try:os.symlink(str(outside),'link',dir_fd=child)
            finally:os.close(child)
        a=self.store.trash_list()['items'][0];self.commit(self.prepare(a));self.assertEqual(outside.read_text(),'protected');self.assertEqual(self.store.trash_list()['items'],[])
    def test_partial_failure_is_not_resumed_automatically(self):
        a=self.trash(folder=True,name='album');ticket=self.prepare(a)
        def partial(name,dir_fd):
            child=os.open(name,api.DIR_FLAGS,dir_fd=dir_fd)
            try:os.unlink('a.jpg',dir_fd=child)
            finally:os.close(child)
            raise OSError('simulated disk failure')
        with patch.object(api.shutil,'rmtree',side_effect=partial):result=self.commit(ticket)
        self.assertEqual(result['incomplete'],[a['id']]);self.purge.recover();self.assertIn(a['id'],self.purge.partial_ids())
        self.assertTrue((self.photos/'.our-story-trash'/a['id']/'photo/note.txt').exists())
    def test_recovery_finishes_metadata_only_after_payload_gone(self):
        a=self.trash();ticket=self.prepare(a)
        with patch.object(self.purge,'cleanup',side_effect=OSError('simulated interruption')):
            with self.assertRaises(api.APIError):self.commit(ticket)
        self.purge.recover();self.assertEqual(self.store.trash_list()['items'],[])
    def test_no_live_paths_wildcards_or_readonly(self):
        for items in [[{'path':'live.jpg','revision':'0'*64}],[{'id':'*','revision':'0'*64}],[]]:
            with self.assertRaises(api.APIError):self.purge.prepare(items,'fixture-password','fixture-session',Auth())
        a=self.trash();self.store.writable=False
        with self.assertRaises(api.APIError):self.prepare(a)
    def test_journal_text_survives_and_only_original_reference_is_removed(self):
        import uuid
        (self.photos/'a.jpg').write_bytes((ROOT/'assets/beach.jpg').read_bytes())
        original=api.revision((self.photos/'a.jpg').stat())
        record=self.journal.mutate({'action':'save','id':str(uuid.uuid4()),'revision':0,'record':{'target':'다온','kind':'words','date':'2026-11-14','author':'엄마','quote':'소중한 말','attachments':[{'path':'a.jpg','revision':original}]}})
        self.store.trash('a.jpg',original);a=self.store.trash_list()['items'][0]
        (self.photos/'a.jpg').write_bytes((ROOT/'assets/beach.jpg').read_bytes());replacement=api.revision((self.photos/'a.jpg').stat())
        newer=self.journal.mutate({'action':'save','id':str(uuid.uuid4()),'revision':0,'record':{'target':'라온','kind':'words','date':'2026-11-14','author':'아빠','quote':'새 사진','attachments':[{'path':'a.jpg','revision':replacement}]}})
        self.commit(self.prepare(a))
        old=self.journal.get(record['id'])['record'];self.assertEqual(old['quote'],'소중한 말');self.assertEqual(old['attachments'],[])
        self.assertEqual(self.journal.get(newer['id'])['record']['attachments'][0]['revision'],replacement);self.assertTrue((self.photos/'a.jpg').exists())
    def test_password_verification_does_not_create_session(self):
        auth=api.FamilyAuth(self.state);auth.setup({'username':'오니둥이','password':'fixture-password'})
        self.assertEqual(auth.login({'username':'오니둥이','password':'fixture-password'},verify_only=True),{'verified':True})
        with auth.db() as db:self.assertEqual(db.execute('SELECT count(*) FROM sessions').fetchone()[0],0)
if __name__=='__main__':unittest.main()
