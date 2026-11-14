"""Travel persistence and folder bindings use disposable fixtures only."""
import json
import os
import uuid
import unittest
from unittest.mock import patch
import test_nas_service as fixture
api=fixture.api
class TravelTests(unittest.TestCase):
    setUp=fixture.ServiceTests.setUp
    tearDown=fixture.ServiceTests.tearDown
    request=fixture.ServiceTests.request
    def record(self,**changes):
        return dict(kind='trip',title='함께한 바다',country='대한민국',city='제주',scope='domestic',author='엄마',start='2026-01-01',end='2026-01-03',lat=33.4,lng=126.5,members=['아빠','엄마','다온','라온'],story='기억하고 싶은 하루',folder='기억',reviews={'다온':'재미있었어','라온':'다시 가고 싶어'},**changes)
    def save(self,record=None,ident=None,revision=0):
        return self.server.travel.mutate({'action':'save','id':ident or str(uuid.uuid4()),'revision':revision,'record':record or self.record()})
    def test_persistence_idempotent_create_conflict_and_private_storage(self):
        first=self.save();retry=self.save(first['record'],first['id']);self.assertEqual(first,retry)
        restarted=api.TravelStore(self.settings_dir,self.store);self.assertEqual(restarted.get(first['id']),first);self.assertEqual(os.stat(self.settings_dir/'travel.sqlite3').st_mode&0o777,0o600)
        changed=dict(first['record'],story='새로운 이야기');updated=self.save(changed,first['id'],1);self.assertEqual(updated['revision'],2)
        with self.assertRaises(api.APIError) as error:self.save(first['record'],first['id'],1)
        self.assertEqual(error.exception.status,409);self.assertEqual(restarted.get(first['id'])['record']['story'],'새로운 이야기')
    def test_validation_and_root_symlink_folder_safety(self):
        (self.root/'unsafe').symlink_to(self.settings_dir,target_is_directory=True)
        for changes in [{'lat':None},{'lng':float('nan')},{'end':'2025-01-01'},{'members':[]},{'members':['누군가']},{'folder':'../settings'},{'folder':'unsafe'},{'title':''},{'reviews':{'unknown':'text'}}]:
            value=self.record();value.update(changes)
            with self.assertRaises((api.APIError,OSError)):self.save(value)
        root=self.record();root['folder']='';self.assertEqual(self.save(root)['record']['folder'],'')
    def test_stats_search_year_pins_and_wishes_are_separate_from_examples(self):
        self.assertEqual(self.server.travel.listing()['stats'],{'trips':0,'cities':0,'countries':0,'wishes':0})
        self.save();another=self.record();another.update(title='일본 여행',country='일본',city='도쿄',scope='international',lat=35.6,lng=139.7,start='2025-01-01',end='2025-01-03');self.save(another)
        wish={'kind':'wish','title':'기차 여행','country':'스위스','city':'루체른','scope':'international','author':'아빠','month':'2027-02','note':'산을 보자','done':False};self.save(wish)
        data=self.server.travel.listing();self.assertEqual(data['stats'],{'trips':2,'countries':2,'cities':2,'wishes':1});self.assertEqual(len(data['pins']),2)
        self.assertEqual(self.server.travel.listing(year='2025')['total'],1);self.assertEqual(self.server.travel.listing(scope='domestic')['total'],1);self.assertEqual(self.server.travel.listing(query='없는 곳')['total'],0)
        self.assertEqual(self.server.travel.listing(kind='wish')['items'][0]['record']['month'],'2027-02')
    def test_trash_restore_do_not_touch_nas_and_readonly_photos_can_save_records(self):
        self.store.writable=False;item=self.save();self.server.travel.mutate({'action':'trash','id':item['id'],'revision':1});self.assertEqual(self.server.travel.listing()['stats']['trips'],0)
        self.assertEqual(self.server.travel.listing(trash=True)['total'],1);self.server.travel.mutate({'action':'restore','id':item['id'],'revision':2});self.assertEqual(self.server.travel.listing()['total'],1);self.assertTrue((self.root/'기억').is_dir());self.assertFalse((self.root/api.TRASH).exists())
    def test_folder_moves_update_travel_bindings_and_recover_after_metadata_failure(self):
        item=self.save();plan={'action':'move','path':'기억','revision':api.revision((self.root/'기억').stat()),'name':'다시본바다','destination':'','operationId':uuid.uuid4().hex}
        manager=self.server.files
        with patch.object(self.server.travel.__class__,'apply_moves',side_effect=api.APIError(503)):
            with self.assertRaises(api.APIError):manager.perform(plan)
        self.assertTrue((self.root/'다시본바다').is_dir());manager.recover();updated=self.server.travel.get(item['id']);self.assertEqual(updated['record']['folder'],'다시본바다');self.assertEqual(updated['revision'],2)
        manager.recover();self.assertEqual(self.server.travel.get(item['id'])['revision'],2)
    def test_http_auth_cors_schema_and_album_binding(self):
        self.assertEqual(self.request('/api/travel',headers={'Authorization':'wrong'})[0],401);self.assertEqual(self.request('/api/travel',headers={'Origin':'https://evil.example'})[0],403)
        self.server.auth.setup({'username':'오니둥이','password':'fixture-password'});secret=self.server.auth.login({'username':'오니둥이','password':'fixture-password'})['session'];headers={'Authorization':'Bearer '+secret}
        body={'action':'save','id':str(uuid.uuid4()),'revision':0,'record':self.record()}
        status,raw,_=self.request('/api/travel','POST',body,headers);self.assertEqual(status,200,raw);item=json.loads(raw)
        (self.root/'기억/real.jpg').write_bytes(fixture.PHOTO)
        status,raw,_=self.request('/api/travel-album','POST',{'id':item['id'],'seed':'a'*32},headers);self.assertEqual(status,200,raw);self.assertEqual(json.loads(raw)['items'][0]['path'],'기억/real.jpg')
        status,raw,_=self.request('/api/travel?scope=domestic',headers=headers);self.assertEqual(status,200);self.assertEqual(json.loads(raw)['stats']['trips'],1)
        self.assertEqual(self.request('/api/travel?unknown=1',headers=headers)[0],400)
        self.assertEqual(self.request('/api/travel-album','POST',{'id':item['id'],'path':'../bad'},headers)[0],400)
if __name__=='__main__':unittest.main()
