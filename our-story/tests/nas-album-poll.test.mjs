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

test('home album covers use existing family photos when section folders are unbound',async()=>{
 const previous=globalThis.document,hosts={travel:{isConnected:true,replaceChildren(image){this.image=image;}},growth:{isConnected:true,replaceChildren(image){this.image=image;}}},paths=[];
 globalThis.document={querySelector:s=>hosts[s.includes('travel')?'travel':'growth'],createElement:()=>({})};
 const home={items:[{path:'hero.jpg'},{path:'family-one.jpg'},{path:'family-two.jpg'}]};
 const fake={version:1,ready:Promise.resolve(),urls:[],g:{connected:true,features:{thumbnails:true},client:{origin:'https://fixture.trycloudflare.com',thumbnail:async path=>{paths.push(path);return new Blob(['fixture']);}}},collection:async()=>({items:[],unbound:true})};
 try{await NasAlbums.prototype.paintCovers.call(fake,home);assert.deepEqual(paths,['family-one.jpg','family-two.jpg']);assert.match(hosts.travel.image.alt,/가족 사진/);assert(hosts.growth.image.src.startsWith('blob:'));}
 finally{fake.urls.forEach(URL.revokeObjectURL);globalThis.document=previous;}
});
test('registered trip photos and a configured growth album take priority over generic home photos',async()=>{
 const previous=globalThis.document,paths=[];
 globalThis.document={querySelector:()=>({isConnected:true,replaceChildren(){}}),createElement:()=>({})};
 const fake={version:1,visitSeed:'a'.repeat(32),ready:Promise.resolve(),urls:[],g:{connected:true,features:{thumbnails:true,travelRecords:true},client:{origin:'https://fixture.trycloudflare.com',travelList:async()=>({items:[{id:'trip',revision:2,record:{folder:'여행'}}]}),travelAlbum:async()=>({items:[{path:'여행/sea.jpg'}]}),thumbnail:async path=>{paths.push(path);return new Blob(['fixture']);}}},collection:async key=>({items:key==='growth:함께'?[{path:'아이들/day.jpg'}]:[]})};
 try{await NasAlbums.prototype.paintCovers.call(fake,{items:[{path:'home.jpg'}]});assert.deepEqual(paths,['여행/sea.jpg','아이들/day.jpg']);}
 finally{fake.urls.forEach(URL.revokeObjectURL);globalThis.document=previous;}
});
