import test from 'node:test';
import assert from 'node:assert/strict';
import {selectLoaded,trashSelection} from '../nas-selection.mjs';
const photo=name=>({name,path:name,dir:false,revision:'a'.repeat(64)});
test('select all snapshots only loaded items and respects folder capability',()=>{
 const items=[photo('a.jpg'),{...photo('folder'),dir:true}],selected=new Map();
 selectLoaded(selected,items);assert.equal(selected.size,1);
 selectLoaded(selected,items,{folders:true});assert.equal(selected.size,2);
 items.push(photo('later.jpg'));assert.equal(selected.size,2);assert.ok(!selected.has('later.jpg'));
});
test('partial conflicts keep successes and continue with independent items',async()=>{
 const completed=[],items=['a.jpg','b.jpg','c.jpg'].map(photo);
 const result=await trashSelection({trash:async item=>{if(item.name==='b.jpg')throw Object.assign(Error('changed'),{code:'HTTP_409'});}},items,{onSuccess:item=>completed.push(item.path)});
 assert.deepEqual(completed,['a.jpg','c.jpg']);assert.equal(result.completed,2);assert.equal(result.failed.length,1);assert.equal(result.unprocessed,0);
});
test('stop finishes the current item and leaves remaining items untouched',async()=>{
 let stopping=false,calls=0;
 const result=await trashSelection({trash:async()=>{calls++;stopping=true;}},['a','b','c'].map(photo),{stop:()=>stopping});
 assert.equal(calls,1);assert.equal(result.completed,1);assert.equal(result.unprocessed,2);
});
test('permission, gateway and uncertain network failures stop the batch',async()=>{
 for(const code of ['HTTP_403','HTTP_502','HTTP_503','TIMEOUT','FETCH']){
  let calls=0;const result=await trashSelection({trash:async()=>{calls++;throw Object.assign(Error('fixture failure'),{code});}},['a','b'].map(photo));
  assert.equal(calls,1);assert.equal(result.failed.length,1);assert.equal(result.unprocessed,1);
 }
});
test('navigation or logout prevents any new item from being sent',async()=>{
 let calls=0;const result=await trashSelection({trash:async()=>{calls++;}},[photo('a')],{active:()=>false});
 assert.equal(calls,0);assert.equal(result.unprocessed,1);
});
test('gallery renders accessible sibling checkboxes and explicit loaded-item selection',async()=>{
 const {NasGallery}=await import('../nas-gallery.js');
 const host={innerHTML:'',querySelector:()=>null};const fake={host,connected:true,path:'',features:{folderTrash:true},items:[photo('a.jpg'),{...photo('folder'),dir:true}],selection:new Map(),selecting:true,urls:new Map(),thumbErrors:new Map(),thumbnails:false,next:null,total:2,loading:false};
 NasGallery.prototype.render.call(fake);
 assert.match(host.innerHTML,/불러온 항목 전체 선택/);assert.equal((host.innerHTML.match(/data-nas-select=/g)||[]).length,2);
 let depth=0;for(const token of host.innerHTML.match(/<\/?button\b[^>]*>|<input\b[^>]*>/g)||[]){if(token.startsWith('</button'))depth--;else if(token.startsWith('<button'))depth++;else assert.equal(depth,0,'checkbox must not be nested inside a button');}
 assert.equal(depth,0);assert.match(host.innerHTML,/폴더 · 하위 내용 전체/);
});
