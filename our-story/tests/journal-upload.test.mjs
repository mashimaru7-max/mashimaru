import test from 'node:test';
import assert from 'node:assert/strict';
import {journalUploadFile,uploadJournalPhoto} from '../journal-upload.mjs';
const id='12345678-1234-4234-8234-123456789012';
const file=new File(['picture'],'라온의 동시.png',{type:'image/png'});
test('image validation rejects documents and oversized files before NAS mutations',()=>{
 assert.throws(()=>journalUploadFile(new File(['pdf'],'poem.pdf')));assert.throws(()=>journalUploadFile(file,2));
 const renamed=journalUploadFile(file);assert(renamed.name.endsWith('-라온의 동시.png'));assert.equal(renamed.size,file.size);
});
test('upload preserves existing folders, uses a unique file and attaches server revision',async()=>{
 const calls=[];let uploaded;
 const client={fileOperation:async data=>{calls.push(data);const e=new Error('exists');e.code='HTTP_409';throw e;},upload:async(path,photo)=>{uploaded={path,photo};return {ok:true};},list:async(path)=>({items:uploaded&&path===uploaded.path?[{name:uploaded.photo.name,path:path+'/'+uploaded.photo.name,revision:'a'.repeat(64),dir:false}]:[],next:null})};
 const ref=await uploadJournalPhoto(client,{target:'라온',id,file});assert.equal(calls.length,2);assert(calls.every(c=>c.action==='mkdir'));assert(ref.path.startsWith('우리라는이야기-성장기록/라온-'+id+'/'));assert.equal(ref.revision,'a'.repeat(64));
});
test('failed upload never reports a saved attachment',async()=>{
 const client={fileOperation:async()=>({ok:true}),upload:async()=>{throw Error('network failed');}};
 await assert.rejects(uploadJournalPhoto(client,{target:'다온',id,file}),/network failed/);
});
