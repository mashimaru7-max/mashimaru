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
const {validateNameRule,matchesFolderName,findNamedFolders,previewNamedFolders}=await import('../nas-album-model.mjs');
const rule={type:'name',text:'남매사진',mode:'numbered',root:''};
test('base name matches no suffix or a numeric suffix, not other words',()=>{
 for(const name of ['남매사진','남매사진1','남매사진2','남매사진123','남매사진 4'])assert(matchesFolderName(name,rule),name);
 for(const name of ['남매사진여행','남매사진1보관','남매사진#','다른남매사진1','남매사진-1'])assert(!matchesFolderName(name,rule),name);
 assert(matchesFolderName('a+b(1)2',{...rule,text:'a+b(1)'}));assert(!matchesFolderName('ab12',{...rule,text:'a+b(1)'}));
});
test('exact and contains modes are literal, and invalid rules are rejected',()=>{
 assert(matchesFolderName('남매사진',{...rule,mode:'exact'}));assert(!matchesFolderName('남매사진1',{...rule,mode:'exact'}));
 assert(matchesFolderName('가족-남매사진-생일',{...rule,mode:'contains'}));
 assert.throws(()=>validateNameRule({...rule,text:''}));assert.throws(()=>validateNameRule({...rule,root:'../private'}));assert.throws(()=>validateNameRule({...rule,text:'a/b'}));
});
test('name discovery finds every year before reading photos and skips nonmatching files',async()=>{
 const calls=[];const tree={'':[dir('2019'),dir('2020'),dir('2021')],'2019':[dir('2019/남매사진')],'2020':[dir('2020/남매사진1'),dir('2020/남매사진여행')],'2021':[dir('2021/남매사진2'),photo('2021/남매사진.jpg')],'2020/남매사진여행':[]};
 const result=await findNamedFolders({list:async p=>{calls.push(p);return listing(p,tree[p]||[]);}},rule);
 assert.deepEqual(result.matches.map(i=>i.path),['2021/남매사진2','2020/남매사진1','2019/남매사진']);assert(!result.limited);assert(!calls.includes('2021/남매사진2'));assert.deepEqual(result.matches.map(i=>i.year),['2021','2020','2019']);
});
test('name search continues from an in-memory cursor across a bounded scan and pagination',async()=>{
 const c={list:async(p,offset)=>!p?listing('',offset?[dir('2020')]:[dir('2019')],offset?null:100):listing(p,[dir(p+'/남매사진1')])};
 let result=await findNamedFolders(c,rule,{pageBudget:1});assert(result.canContinue);assert.equal(result.matches.length,0);
 result=await findNamedFolders(c,rule,{cursor:result.cursor,pageBudget:20});assert(!result.canContinue);assert.equal(result.matches.length,2);assert.equal(new Set(result.matches.map(i=>i.path)).size,2);
});
test('named preview spreads across year folders, preserves paths and never downloads images in the model',async()=>{
 const matches=[{path:'2021/남매사진2',year:'2021'},{path:'2020/남매사진1',year:'2020'},{path:'2019/남매사진',year:'2019'}];
 const result=await previewNamedFolders({list:async p=>listing(p,Array.from({length:20},(_,i)=>photo(p+'/'+i+'.jpg')))},matches,{limit:6});
 assert.equal(result.items.length,6);assert.deepEqual([...new Set(result.items.map(i=>i.folderYear))],['2021','2020','2019']);assert(result.limited);
});
test('old folder strings and new name rules survive binding validation together',()=>{
 const base='https://fixture-only.trycloudflare.com';const result=validateAlbumBindings({kind:'album-folders',origins:{[base]:{travel:'여행','growth:함께':rule}}});
 assert.equal(result[base].travel,'여행');assert.deepEqual(result[base]['growth:함께'],rule);
});
test('name discovery does not publish stale matches after disconnect',async()=>{
 let ready=true;await assert.rejects(findNamedFolders({list:async p=>{ready=false;return listing(p,[dir('남매사진1')]);}},rule,{current:()=>ready}),e=>e.name==='AbortError');
});
test('a selected scope that itself matches is included with its descendants by the preview',async()=>{
 let reads=0;const data=await findNamedFolders({list:async()=>{reads++;}}, {...rule,root:'2020/남매사진2'});
 assert.equal(data.matches[0].path,'2020/남매사진2');assert.equal(reads,1);assert(!data.canContinue);
});
test('preview samples every matching folder when its count fits the photo limit',async()=>{
 const matches=Array.from({length:5},(_,i)=>({path:String(2020+i)+'/남매사진'+i,year:String(2020+i)}));
 const result=await previewNamedFolders({list:async p=>listing(p,Array.from({length:20},(_,i)=>photo(p+'/'+i+'.jpg')))},matches,{limit:12});
 assert.equal(result.items.length,12);assert.equal(new Set(result.items.map(i=>i.albumFolder)).size,5);
});

test('matching scope names do not count missing folders as discovered',async()=>{await assert.rejects(findNamedFolders({list:async()=>{throw Object.assign(new Error('missing'),{code:'HTTP_404'});}}, {...rule,root:'2020/남매사진2'}),e=>e.code==='HTTP_404');});
