import test from 'node:test';
import assert from 'node:assert/strict';
import {recordFromFields,JournalController} from '../journal-controller.mjs';
import {journalForm,journalDetails,journalRow} from '../growth-journal.mjs';
const common={date:'2026-11-14',author:'엄마'};
test('distinct forms serialize only their own fields and retain optional measurements',()=>{
 const diary=recordFromFields('다온','diary',{...common,title:'첫 도전',topic:'학교',body:'직접 해냈다',feeling:'기특함',height:'120'},[]);
 assert.equal(diary.body,'직접 해냈다');assert.ok(!('height'in diary));
 const words=recordFromFields('라온','words',{...common,quote:'나도 할래',listener:'아빠',context:'걷다가',body:'ignored'},[]);
 assert.equal(words.quote,'나도 할래');assert.ok(!('body'in words));
 const measure=recordFromFields('다온','measure',{...common,height:'125.5',weight:'',note:'집'},[]);
 assert.equal(measure.height,125.5);assert.equal(measure.weight,null);
 assert.throws(()=>recordFromFields('다온','measure',{...common,height:'',weight:''},[]));
});
test('saved text is escaped in forms, rows and detail without adding executable markup',()=>{
 const record=recordFromFields('다온','diary',{...common,title:'<img src=x onerror=alert(1)>',topic:'일상',body:'</textarea><script>bad()</script>',feeling:''},[]);
 const item={id:'11111111-1111-4111-8111-111111111111',revision:1,record,deleted:false};
 for(const html of [journalForm('다온','diary',item),journalDetails(item),journalRow(item)]){assert.ok(!html.includes('<script>'));assert.ok(!html.includes('<img src=x'));assert.ok(html.includes('&lt;'));}
 assert.ok(journalForm('다온','measure').includes('name="height"'));assert.ok(!journalForm('다온','letter').includes('name="height"'));
});
test('a failed save keeps the draft, revision context and enabled controls for retry',async()=>{
 const OriginalFormData=globalThis.FormData;
 const values={...common,title:'남겨 둘 내용',topic:'일상',body:'저장 실패해도 유지',feeling:''};
 const error={textContent:''},picker={},controls=[{disabled:false,value:values.body},{disabled:true}];
 const listeners={};const form={isConnected:true,addEventListener:(name,fn)=>{listeners[name]=fn;},querySelector:selector=>selector==='#journal-form-error'?error:picker,querySelectorAll:()=>controls};
 const fake={canClose:()=>true,g:{connected:true,features:{journalRecords:true},refreshFeatures:async()=>{},client:{capabilities:async()=>({journalRecords:true}),journalWrite:async()=>{throw Error('충돌');}}},target:'다온',revoke:()=>{},modal:()=>{},dialog:{querySelector:()=>form},paintSelected:async()=>{}};
 try{
  globalThis.FormData=class{constructor(){return new Map(Object.entries(values));}};
  await JournalController.prototype.open.call(fake,'diary');listeners.input();await form.onsubmit({preventDefault(){}});
  assert.equal(controls[0].value,'저장 실패해도 유지');assert.equal(controls[0].disabled,false);assert.equal(controls[1].disabled,true);
  assert.equal(fake.dirty,true);assert.equal(fake.busy,false);assert.match(error.textContent,/충돌/);
 }finally{globalThis.FormData=OriginalFormData;}
});

test('logout removes private record markup and cached records',()=>{
 let closed=0,cleared=0;const content={replaceChildren:()=>{cleared++;}};
 const fake={version:1,g:{connected:false},items:new Map([['private',{}]]),form:{isConnected:true},dirty:true,dialog:{querySelector:s=>s==='#dialog-content'?content:null,close:()=>{closed++;}},revoke:()=>{}};
 JournalController.prototype.release.call(fake);assert.equal(fake.items.size,0);assert.equal(fake.form,null);assert.equal(closed,1);assert.equal(cleared,1);
});
