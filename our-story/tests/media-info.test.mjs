import test from 'node:test';
import assert from 'node:assert/strict';
import {mediaEntries,folderPeriod,infoHTML} from '../media-info.mjs';
test('photo/video filters preserve folder navigation and original item indices',()=>{
 const items=[{path:'폴더',dir:true},{path:'a.jpg',dir:false},{path:'b.MP4',dir:false},{path:'c.png',dir:false}];
 assert.deepEqual(mediaEntries(items,'video').map(e=>e.index),[0,2]);assert.deepEqual(mediaEntries(items,'photo').map(e=>e.index),[0,1,3]);assert.equal(mediaEntries(items).length,4);
});
test('folder period is visibly distinct from an actual EXIF date and filenames are not guessed',()=>{
 assert.equal(folderPeriod('은혜네/2024/1월 베트남/170511.jpg'),'2024년 1월');assert.equal(folderPeriod('2021년/12월/a.jpg'),'2021년 12월');assert.equal(folderPeriod('2024-02 여행/a.jpg'),'2024년 2월');assert.equal(folderPeriod('photos/20240101.jpg'),null);
 assert.match(infoHTML('2024/1월/a.jpg'),/폴더 이름 기준/);assert.match(infoHTML('2024/1월/a.jpg',{capturedAt:'2023-12-31T23:59:00',trips:[],gps:null}),/2023년 12월 31일/);
});
test('region names are labeled as linked trip data, text escaped and GPS only opens by explicit link',()=>{
 const html=infoHTML('a.jpg',{capturedAt:null,gps:{lat:37.5,lng:127},trips:[{country:'대한민국',city:'<img src=x>'}]});assert(!html.includes('<img src=x>'));assert.match(html,/연결한 여행의 지역/);assert.match(html,/openstreetmap.org/);assert.match(html,/noopener noreferrer/);
});
