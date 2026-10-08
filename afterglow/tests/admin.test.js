import test from 'node:test';
import assert from 'node:assert/strict';
import {ArtStore,passwordRecord,passwordMatches} from '../admin-storage.js';
test('password verifier accepts correct input, rejects wrong input and uses random salt',async()=>{const record=await passwordRecord('test-password');assert.equal(await passwordMatches('test-password',record),true);assert.equal(await passwordMatches('wrong-password',record),false);assert.notDeepEqual(record.salt,(await passwordRecord('test-password')).salt);await assert.rejects(passwordRecord('abc'));});
test('admin wrong password does not unlock settings',async()=>{const store=new ArtStore();await assert.rejects(store.login('wrong-password'));assert.equal(store.unlocked,false);store.unlocked=true;store.lock();assert.equal(store.unlocked,false);});
