import test from 'node:test';
import assert from 'node:assert/strict';
import {validateSharedAlbum} from '../nas-client.mjs';
const fixture=()=>({shared:true,items:[{path:'2020/오니둥이/a.jpg',name:'a.jpg',revision:'a'.repeat(64),folderYear:'2020',albumFolder:'2020/오니둥이'}],total:1,indexing:false,issues:0,snapshot:1,matchedFolders:[{name:'오니둥이',path:'2020/오니둥이',year:'2020'}],selectedYear:'',path:'',rule:{type:'name',text:'오니둥이',mode:'numbered',root:''}});
test('canonical album retains saved order, revision and year labels',()=>{
 const d=fixture();assert.deepEqual(validateSharedAlbum(d).items,d.items);
 assert.deepEqual(validateSharedAlbum({items:[],shared:true,unbound:true}),{items:[],shared:true,unbound:true});
});
test('reject traversal, duplicate paths and malformed canonical responses',()=>{
 for(const change of [d=>d.items[0].path='../a.jpg',d=>d.items.push({...d.items[0]}),d=>d.items[0].revision='bad',d=>d.total=-1,d=>d.snapshot='1',d=>d.matchedFolders[0].path='../x',d=>d.indexing='yes']){
  const d=fixture();change(d);assert.throws(()=>validateSharedAlbum(d));
 }
});
