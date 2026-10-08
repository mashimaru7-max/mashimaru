import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {once} from 'node:events';
import {createApi} from '../server/server.js';
import {passwordRecord} from '../admin-storage.js';
test('server authenticates writes, shares saved artwork/settings and persists across restarts',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'afterglow-test-')),passwordVerifier=await passwordRecord('test-admin-password');let server;
 async function start(){server=await createApi({dataDir:dir,passwordVerifier});server.listen(0,'127.0.0.1');await once(server,'listening');return 'http://127.0.0.1:'+server.address().port;}
 try{let url=await start();const config={rounds:[{target:85,timeLimit:120,enemyCount:4,enemySpeed:1.5}]};
 assert.equal((await fetch(url+'/config',{method:'PUT',body:JSON.stringify(config)})).status,401);
 assert.equal((await fetch(url+'/login',{method:'POST',body:JSON.stringify({password:'wrong'})})).status,401);
 const login=await fetch(url+'/login',{method:'POST',body:JSON.stringify({password:'test-admin-password'})});assert.equal(login.status,200);const {token}=await login.json(),headers={Authorization:'Bearer '+token};
 assert.equal((await fetch(url+'/config',{method:'PUT',headers,body:JSON.stringify(config)})).status,200);
 const form=new FormData();form.append('base',new Blob([new Uint8Array([255,216,255,1,2])],{type:'image/jpeg'}),'test.jpg');
 assert.equal((await fetch(url+'/round/1',{method:'PUT',headers,body:form})).status,200);
 assert.ok((await (await fetch(url+'/round/1')).json()).base.startsWith('data:image/jpeg;base64,'));
 await new Promise(resolve=>server.close(resolve));url=await start();assert.deepEqual(await (await fetch(url+'/config')).json(),config);assert.ok((await (await fetch(url+'/round/1')).json()).base);
 assert.equal((await fetch(url+'/config',{method:'PUT',headers,body:JSON.stringify({rounds:[]})})).status,400);
 assert.equal((await fetch(url+'/round/1',{method:'DELETE',headers})).status,200);assert.deepEqual(await (await fetch(url+'/round/1')).json(),{});
 assert.equal((await fetch(url+'/config',{headers:{Origin:'https://unwanted.example'}})).status,403);
 }finally{if(server?.listening)await new Promise(resolve=>server.close(resolve));await rm(dir,{recursive:true,force:true});}
});
