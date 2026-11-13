import test from 'node:test';
import assert from 'node:assert/strict';
import {scanFolderPhotos,validateAlbumBindings} from '../nas-album-model.mjs';
const photo=path=>({name:path.split('/').at(-1),path,dir:false});
const dir=path=>({name:path.split('/').at(-1),path,dir:true});
const listing=(path,items,next=null)=>({path,items,next,total:items.length});
test('home discovery includes nested photos and deduplicates repeated paths without guessing dates or people',async()=>{
 const calls=[];const c={list:async(p)=>{calls.push(p);return p===''?listing('',[dir('여행'),dir('다온')]):listing(p,[photo(p+'/a.jpg'),photo(p+'/a.jpg')]);}};
 const d=await scanFolderPhotos(c);assert.equal(d.items.length,2);assert.deepEqual(calls,['','여행','다온']);assert.deepEqual(Object.keys(d.items[0]),['name','path','dir']);
});
test('preview discovery respects photo and request budgets',async()=>{
 let calls=0;const c={list:async p=>{calls++;return listing(p,Array.from({length:20},(_,i)=>photo(p+i+'.jpg')));}};
 assert.equal((await scanFolderPhotos(c,'',{limit:4})).items.length,4);assert.equal(calls,1);
 let pages=0;const empty={list:async p=>{pages++;return listing(p,[],pages*100);}};
 const result=await scanFolderPhotos(empty,'',{pageBudget:3});assert.equal(pages,3);assert.equal(result.limited,true);
});
test('pagination does not block discovering photos inside the first folder',async()=>{
 const calls=[];const c={list:async(p,offset)=>{calls.push([p,offset]);return p===''?listing('',[dir('album')],100):listing(p,[photo('album/a.jpg')]);}};
 const result=await scanFolderPhotos(c,'',{limit:1,pageBudget:2});assert.equal(result.items[0].path,'album/a.jpg');assert.deepEqual(calls,[['',0],['album',0]]);
});
test('failed subfolders are reported but authentication failures propagate',async()=>{
 const c={list:async p=>{if(!p)return listing('',[dir('bad'),dir('good')]);if(p==='bad')throw Object.assign(new Error('permission'),{code:'HTTP_403'});return listing(p,[photo('good/a.jpg')]);}};
 assert.equal((await scanFolderPhotos(c)).issues,1);
 c.list=async()=>{throw Object.assign(new Error('expired'),{code:'HTTP_401'});};await assert.rejects(scanFolderPhotos(c),e=>e.code==='HTTP_401');
});
test('stale scans stop before collecting late responses',async()=>{
 let current=true;const c={list:async p=>{current=false;return listing(p,[photo('a.jpg')]);}};
 await assert.rejects(scanFolderPhotos(c,'',{current:()=>current}),e=>e.name==='AbortError');
});
test('unsafe root path is rejected before any network request',async()=>{
 let called=false;await assert.rejects(scanFolderPhotos({list:async()=>{called=true;}},'../private'));assert.equal(called,false);
});
test('bindings are scoped to a validated origin and known album targets',()=>{
 const base='https://fixture-only.trycloudflare.com';
 const result=validateAlbumBindings({kind:'album-folders',origins:{[base]:{home:'',travel:'여행','growth:다온':'아이들/다온',unknown:'x'},'https://evil.example':{home:'a'}}});
 assert.deepEqual(result,{[base]:{home:'',travel:'여행','growth:다온':'아이들/다온'}});
 assert.deepEqual(validateAlbumBindings({kind:'album-folders',origins:{[base]:{home:'../private'}}}),{});
});
test('folder budget bounds large directory trees',async()=>{
 let calls=0;const c={list:async p=>{calls++;return listing(p,Array.from({length:100},(_,i)=>dir((p?p+'/':'')+i)));}};
 const d=await scanFolderPhotos(c,'',{folderBudget:3,pageBudget:20});assert(calls<=3);assert.equal(d.limited,true);
});
