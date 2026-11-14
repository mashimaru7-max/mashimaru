import test from 'node:test';
import assert from 'node:assert/strict';
import {PAPERS,readLetter,writeLetter,paperPicker,bindPaperPicker} from '../letter-paper.mjs';
import {journalForm,journalDetails,journalRow} from '../growth-journal.mjs';
import {recordFromFields} from '../journal-controller.mjs';
const common={target:'라온',kind:'letter',date:'2026-11-14',author:'엄마',attachments:[],readOn:''};
test('all 20 designs survive save and reopen without leaking metadata into the displayed letter',()=>{
 assert.equal(PAPERS.length,20);assert.equal(new Set(PAPERS.map(([id])=>id)).size,20);
 for(const [paper] of PAPERS){
  const text='사랑하는 라온에게,\n\n오늘 쓴 동시를 오래 기억할게. <script>alert(1)</script>';
  const record=recordFromFields('라온','letter',{date:common.date,author:'엄마',body:text,readOn:'',paper},[]);
  assert.deepEqual(readLetter(record.body),{paper,text});
  const item={id:'fixture',revision:1,record:{...common,body:record.body},deleted:false};
  const form=journalForm('라온','letter',item),details=journalDetails(item),row=journalRow(item);
  assert(form.includes(`name="paper" value="${paper}"`));assert(details.includes(`data-paper="${paper}"`));
  for(const html of [form,details,row]){assert(!html.includes('[OUR-STORY-LETTER:'));assert(!html.includes('<script>'));}
 }
});
test('existing letters retain plain text; unknown headers and literal header text are never lost',()=>{
 assert.deepEqual(readLetter('예전 편지'),{paper:'classic',text:'예전 편지'});
 const literal='[OUR-STORY-LETTER:v1:blossom]\n\n원문';assert.equal(readLetter(writeLetter(literal,'classic')).text,literal);
 assert.equal(readLetter('[OUR-STORY-LETTER:v1:unknown]\n\n내용').paper,'classic');
 assert.throws(()=>writeLetter('','heart'));assert.throws(()=>writeLetter('내용','bad'));assert.throws(()=>writeLetter('a'.repeat(10000),'heart'));
});
test('picker changes the preview and saved value, marks selection, and collapses without losing keyboard focus',()=>{
 const buttons=[{dataset:{paperChoice:'classic'},setAttribute(k,v){this[k]=v;}},{dataset:{paperChoice:'sea'},setAttribute(k,v){this[k]=v;}}];let click,changed=0,focused=false;
 const title={},summary={focus(){focused=true;}},sheet={dataset:{}};
 const picker={open:true,addEventListener(_,fn){click=fn;},querySelector:s=>s==='summary'?summary:title,querySelectorAll:()=>buttons};
 const form={elements:{paper:{value:'classic'}},querySelector:s=>s==='.stationery-picker'?picker:sheet};
 bindPaperPicker(form,()=>changed++);click({target:{closest:()=>buttons[1]}});
 assert.equal(form.elements.paper.value,'sea');assert.equal(sheet.dataset.paper,'sea');assert.equal(picker.open,false);assert.equal(changed,1);assert(focused);assert.equal(buttons[1]['aria-pressed'],'true');assert.equal(buttons[0]['aria-pressed'],'false');
 assert.equal((paperPicker().match(/data-paper-choice=/g)||[]).length,20);
});
