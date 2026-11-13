import test from 'node:test';
import assert from 'node:assert/strict';
import {NasAlbums} from '../nas-albums.js';
test('failed refresh preserves the pending snapshot so fast polling can continue',async()=>{
 const origin='https://fixture.trycloudflare.com';
 const key=origin+'\nhome\n""\n\n';const previous={time:Date.now(),data:{indexing:true,items:[]}};
 const fake={ready:Promise.resolve(),g:{connected:true,features:{sharedArchive:true},client:{origin,sharedAlbum:async()=>{throw Error('temporary failure');}}},vault:{load:async()=>null},folder:()=>'',years:new Map(),cache:new Map([[key,previous]]),pending:new Map(),refreshKeys:new Set()};
 await assert.rejects(()=>NasAlbums.prototype.collection.call(fake,'home',{refresh:true}),/temporary failure/);
 assert.equal(fake.cache.get(key),previous);assert.equal(fake.pending.size,0);
});
test('background polling surfaces failures while retaining the displayed album',async()=>{
 const note={textContent:''};const host={isConnected:true,querySelector:()=>note};
 const fake={host,key:'home',version:1,g:{connected:true},cache:new Map([['pending',{data:{indexing:true}}]]),pollTime:0,collection:async()=>{throw Error('fixture failure');}};
 await NasAlbums.prototype.poll.call(fake);
 assert.match(note.textContent,/fixture failure/);assert.equal(fake.host,host);
});

test('new page gets a new random visit while same-page renders retain selection',()=>{
 const fake={visitPage:null,cache:new Map(),pending:new Map()};
 NasAlbums.prototype.beginVisit.call(fake,'home');const first=fake.visitSeed;
 NasAlbums.prototype.beginVisit.call(fake,'home');assert.equal(fake.visitSeed,first);
 NasAlbums.prototype.beginVisit.call(fake,'gallery');
 NasAlbums.prototype.beginVisit.call(fake,'home');assert.notEqual(fake.visitSeed,first);
 assert.match(fake.visitSeed,/^[a-f0-9]{32}$/);
});
