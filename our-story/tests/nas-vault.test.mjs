import test from 'node:test';
import assert from 'node:assert/strict';
import { ConnectionVault, indexedConnectionStore } from '../nas-vault.mjs';
const payload={version:1,base:'https://fixture-only.trycloudflare.com',mode:'token',secret:'fixture-only-not-real-token-000000000',expiresAt:null};
function fixture(){let record;let writes=0;return {store:{read:async()=>record?structuredClone(record):null,write:async r=>{record=structuredClone(r);writes++;},clear:async()=>{record=null;}},get record(){return record;},get writes(){return writes;}};}
test('persists encrypted credentials with a nonextractable key and restores the exact record',async()=>{
 const f=fixture(),vault=new ConnectionVault({store:f.store});assert.equal(await vault.load(),null);assert(await vault.save(payload));assert(await vault.has());assert.notEqual(new TextDecoder().decode(f.record.ciphertext).indexOf(payload.secret),0);assert(!new TextDecoder().decode(f.record.ciphertext).includes(payload.secret));assert.equal(f.record.key.extractable,false);await assert.rejects(crypto.subtle.exportKey('raw',f.record.key));assert.deepEqual(await vault.load(),payload);assert(!('secret' in f.record));
});
test('new vault instance recovers device key and ciphertext using structured clone',async()=>{
 const f=fixture();await new ConnectionVault({store:f.store}).save(payload);assert.deepEqual(await new ConnectionVault({store:f.store}).load(),payload);
});
test('saving the same credential uses fresh random IV and encryption key',async()=>{
 const f=fixture(),vault=new ConnectionVault({store:f.store});await vault.save(payload);const first=f.record;await vault.save(payload);assert.notDeepEqual(first.iv,f.record.iv);assert.notDeepEqual(new Uint8Array(first.ciphertext),new Uint8Array(f.record.ciphertext));
});
test('tampered ciphertext cannot be restored and is removed',async()=>{
 const f=fixture(),vault=new ConnectionVault({store:f.store});await vault.save(payload);new Uint8Array(f.record.ciphertext)[0]^=1;await assert.rejects(vault.load(),e=>e.code==='CORRUPT');assert.equal(await vault.load(),null);
});
test('forget removes both ciphertext and persisted crypto key',async()=>{
 const f=fixture(),vault=new ConnectionVault({store:f.store});await vault.save(payload);await vault.clear();assert(!f.record);assert.equal(await new ConnectionVault({store:f.store}).load(),null);
});
test('forget requested during encryption cannot be undone by a late save',async()=>{
 const f=fixture(),vault=new ConnectionVault({store:f.store});const save=vault.save(payload);const clear=vault.clear();assert.equal(await save,false);await clear;assert.equal(await vault.load(),null);assert.equal(f.writes,0);
});
test('latest save wins when two writes overlap',async()=>{
 const f=fixture(),vault=new ConnectionVault({store:f.store});const a=vault.save(payload);const b=vault.save({...payload,base:'https://new-fixture.trycloudflare.com'});assert.equal(await a,false);assert.equal(await b,true);assert.equal((await vault.load()).base,'https://new-fixture.trycloudflare.com');
});
test('storage errors are explicit and never expose original error details',async()=>{
 const vault=new ConnectionVault({store:{read:async()=>null,write:async()=>{throw Error(payload.secret);},clear:async()=>{}}});await assert.rejects(vault.save(payload),e=>e.code==='STORAGE'&&!e.message.includes(payload.secret));
});
test('unavailable IndexedDB fails clearly instead of claiming persistence',async()=>{
 await assert.rejects(indexedConnectionStore(null).read(),e=>e.code==='STORAGE');
});
