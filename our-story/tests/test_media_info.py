import io
import json
import uuid
import unittest
from urllib.parse import urlencode
import test_nas_service as fixture
api=fixture.api
class MediaInfoTests(unittest.TestCase):
    setUp=fixture.ServiceTests.setUp
    tearDown=fixture.ServiceTests.tearDown
    request=fixture.ServiceTests.request
    def photo(self):
        exif=api.Image.Exif();exif[34665]={36867:'2024:01:13 10:22:30'};exif[34853]={1:'N',2:(37.0,30.0,0.0),3:'E',4:(127.0,0.0,0.0)}
        target=self.root/'기억/date.jpg';api.Image.new('RGB',(16,16),'orange').save(target,exif=exif)
        return target,api.revision(target.stat())
    def route(self,rev,path='기억/date.jpg'):return '/api/media-info?'+urlencode({'path':path,'revision':rev})
    def test_original_capture_date_and_gps_are_read_without_modifying_photo(self):
        target,rev=self.photo();raw=target.read_bytes();status,body,h=self.request(self.route(rev));self.assertEqual(status,200,body);data=json.loads(body)
        self.assertEqual(data['capturedAt'],'2024-01-13T10:22:30');self.assertEqual(data['gps'],{'lat':37.5,'lng':127.0});self.assertEqual(data['trips'],[]);self.assertEqual(target.read_bytes(),raw);self.assertEqual(api.revision(target.stat()),rev);self.assertEqual(h['Cache-Control'],'no-store')
    def test_auth_revision_path_checks_and_missing_exif_do_not_guess_dates(self):
        target,rev=self.photo();self.assertEqual(self.request(self.route(rev),headers={'Authorization':'wrong'})[0],401);self.assertEqual(self.request(self.route(rev),headers={'Origin':'https://evil.example'})[0],403);self.assertEqual(self.request(self.route('0'*64))[0],409)
        self.assertEqual(self.request(self.route(rev,'../date.jpg'))[0],400)
        rev=api.revision((self.root/'one.jpg').stat());data=json.loads(self.request(self.route(rev,'one.jpg'))[1]);self.assertIsNone(data['capturedAt']);self.assertIsNone(data['gps'])
    def test_linked_region_is_only_taken_from_a_matching_registered_trip_folder(self):
        target,rev=self.photo()
        record={'kind':'trip','title':'우리 여행','country':'대한민국','city':'서울','scope':'domestic','author':'엄마','start':'2024-01-13','end':'2024-01-14','lat':37.5,'lng':127.0,'members':['엄마'],'story':'','folder':'기억','reviews':{}}
        ident=str(uuid.uuid4());self.server.travel.mutate({'action':'save','id':ident,'revision':0,'record':record})
        data=json.loads(self.request(self.route(rev))[1]);self.assertEqual(data['trips'][0]['city'],'서울');self.assertEqual(data['trips'][0]['id'],ident)
        unrelated=api.revision((self.root/'one.jpg').stat());self.assertEqual(json.loads(self.request(self.route(unrelated,'one.jpg'))[1])['trips'],[])
if __name__=='__main__':unittest.main()
