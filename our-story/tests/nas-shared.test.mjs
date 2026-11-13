import test from 'node:test';
import assert from 'node:assert/strict';
import {FamilySettings} from '../nas-shared.mjs';
const origin='https://fixture.trycloudflare.com';
const clone=x=>structuredClone(x);
const vault=value=>({load:async()=>clone(value)});
function backend() {
  let value={revision:0,albums:{},home:null};
  return {get value(){return value;},async request(p){if(p===undefined)return clone(value);if(p.revision!==value.revision)throw Object.assign(new Error('conflict'),{code:'HTTP_409'});value={revision:value.revision+1,albums:{...value.albums,...p.albums},home:Object.hasOwn(p,'home')?p.home:value.home};return clone(value);}};
}
function device(server,{albums=null,home=null}={}) {
  const g={connected:true,client:{origin,sharedSettings:p=>server.request(p)}};
  const notices=[];
  const settings=new FamilySettings(g,{albumVault:vault(albums),homeVault:vault(home),notify:m=>notices.push(m)});
  return {g,settings,notices};
}
test('two independent devices share folder rules and hero, across tunnel address changes',async()=>{
  const server=backend(),a=device(server),b=device(server);
  await a.settings.albumVault.saveKey('growth:함께',{type:'name',text:'오니둥이',mode:'numbered',root:''});
  await a.settings.homeVault.save({path:'2020/one.jpg',name:'one.jpg'});
  const data=await b.settings.albumVault.load();assert.equal(data.origins[origin]['growth:함께'].text,'오니둥이');
  assert.equal((await b.settings.homeVault.load()).path,'2020/one.jpg');
  b.g.client.origin='https://changed.trycloudflare.com';
  assert.equal((await b.settings.homeVault.load()).origin,b.g.client.origin);
  await b.settings.homeVault.clear();await a.settings.refresh();assert.equal(await a.settings.homeVault.load(),null);
});
test('old device settings migrate once and do not overwrite an existing family configuration',async()=>{
  const server=backend(),old={kind:'album-folders',origins:{[origin]:{travel:'2019'}}};
  const a=device(server,{albums:old});await a.settings.ensure();assert.equal(server.value.albums.travel,'2019');
  const b=device(server,{albums:{kind:'album-folders',origins:{[origin]:{travel:'wrong'}}}});
  assert.equal((await b.settings.albumVault.load()).origins[origin].travel,'2019');
  await a.settings.homeVault.clear();
  const c=device(server,{home:{kind:'home-photo',origin,path:'old.jpg',name:'old'}});
  assert.equal(await c.settings.homeVault.load(),null);
});
test('concurrent changes to separate albums are preserved',async()=>{
  const server=backend(),a=device(server),b=device(server);
  await Promise.all([a.settings.albumVault.saveKey('travel','2020'),b.settings.albumVault.saveKey('growth:다온','2021')]);
  assert.deepEqual(server.value.albums,{travel:'2020','growth:다온':'2021'});
});
test('legacy server warns and rejects save rather than reporting a local save as shared',async()=>{
  const server={request:async()=>{throw Object.assign(new Error('old'),{code:'HTTP_404'});}},a=device(server);
  await a.settings.ensure();assert.equal(a.notices.length,1);
  await assert.rejects(a.settings.homeVault.save({path:'one.jpg',name:'one'}),/업데이트/);
  await assert.rejects(a.settings.albumVault.saveKey('travel','2020'),/업데이트/);
});
test('failed network write never changes the accepted shared settings',async()=>{
  const server=backend(),a=device(server);await a.settings.ensure();
  const request=server.request.bind(server);server.request=async p=>{if(p)throw new Error('offline');return request(p);};
  await assert.rejects(a.settings.homeVault.save({path:'one.jpg',name:'one'}),/offline/);
  assert.equal(a.settings.data.home,null);assert.equal(server.value.revision,0);
});
