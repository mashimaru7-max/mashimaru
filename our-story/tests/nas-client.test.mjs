import test from 'node:test';
import assert from 'node:assert/strict';
import { NasClient, safeBase, safePath, validateListing } from '../nas-client.mjs';
const base='https://fixture-archive.trycloudflare.com';
const token='fixture-only-token-not-a-real-secret-0000';
const root={path:'',total:2,next:null,items:[{name:'여행',path:'여행',dir:true},{name:'one.jpg',path:'one.jpg',dir:false}]};
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json'}});
function fixture(handler=()=>json(root),options={}) {
 const calls=[]; const client=new NasClient({...options,fetchImpl:async(url,init)=>{calls.push({url,init});return handler(new URL(url),init,calls.length);}});
 return {client,calls};
}
const connect=client=>client.connect({base,token});
test('only HTTPS Quick Tunnel origin is accepted, without embedded credentials or path/query/port',()=>{
 assert.equal(safeBase(base+'/'),base);
 for(const u of ['http://fixture.trycloudflare.com','https://example.com','https://a.trycloudflare.com.evil.org','https://a.trycloudflare.com/a','https://a.trycloudflare.com/?token=x','https://a.trycloudflare.com/#x','https://u:p@a.trycloudflare.com','https://a.trycloudflare.com:444','https://127.0.0.1'])assert.throws(()=>safeBase(u));
});
test('relative paths preserve Korean and reject traversals and double-decoding ambiguities',()=>{
 assert.equal(safePath('여행/봄 사진.jpg'),'여행/봄 사진.jpg');
 for(const p of ['../x','/x','x/../y','x//y','x\\y','x\0y','%2e%2e/x','%252e%252e/x','x/','./x'])assert.throws(()=>safePath(p));
});
test('listing parser rejects unexpected paths, duplicates, malformed pagination and unsafe entries',()=>{
 assert.equal(validateListing(root,'',0).items.length,2);
 for(const data of [{...root,path:'other'},{...root,next:0},{...root,total:-1},{...root,items:[{name:'x',path:'../x',dir:false}]},{...root,items:[root.items[0],root.items[0]]}])assert.throws(()=>validateListing(data,'',0));
});
test('list parser omits system directories and unsupported video, preserves metadata as text',()=>{
 const data={path:'',total:3,next:null,items:[{name:'@eaDir',path:'@eaDir',dir:true},{name:'video.mp4',path:'video.mp4',dir:false},{name:'<img onerror=x>.jpg',path:'<img onerror=x>.jpg',dir:false}]};
 assert.deepEqual(validateListing(data,'',0).items.map(x=>x.name),['<img onerror=x>.jpg']);
});
test('legacy connection validates list and sends secret only in Authorization, never URL; redirects and cookies disabled',async()=>{
 const {client,calls}=fixture();const data=await connect(client);assert.equal(client.connected,true);assert.equal(data.path,'');
 const call=calls[0];assert.equal(call.init.headers.Authorization,'Bearer '+token);assert(!call.url.includes(token));assert.equal(call.init.redirect,'error');assert.equal(call.init.credentials,'omit');assert.equal(call.init.cache,'no-store');assert.equal(call.init.referrerPolicy,'no-referrer');assert.equal(call.init.method,'GET');await client.disconnect();assert.equal(client.connected,false);assert.equal(calls.length,1);
});
test('invalid token or unsafe origin never sends network request',async()=>{
 const {client,calls}=fixture();await assert.rejects(client.connect({base,token:'short'}));await assert.rejects(client.connect({base:'https://evil.example',token}));assert.equal(calls.length,0);assert(!client.connected);
});
test('session login uses explicit POST then authenticated list, password excluded from later requests',async()=>{
 const {client,calls}=fixture((u)=>u.pathname==='/api/login'?json({session:'fixture-session-000000000000000',expiresIn:3600}):u.pathname==='/api/logout'?json({ok:true}):json(root));
 await client.connect({base,mode:'login',username:'fixture',password:'fixture-password'});assert(client.connected);assert.equal(calls[0].init.method,'POST');assert(!calls[0].init.headers.Authorization);assert.equal(JSON.parse(calls[0].init.body).password,'fixture-password');assert(!JSON.stringify(calls[1]).includes('fixture-password'));await client.disconnect();assert.equal(new URL(calls[2].url).pathname,'/api/logout');assert(!client.connected);
});
test('login mode never falls back to a static token on an unsupported endpoint',async()=>{
 const {client,calls}=fixture(()=>json({},404));await assert.rejects(client.connect({base,mode:'login',username:'x',password:'x'}),e=>e.code==='HTTP_404');assert.equal(calls.length,1);assert(!client.connected);
});
test('wrong initial credential returns an error without reporting an expired active session',async()=>{
 let expired=0;const {client}=fixture(()=>json({},401),{onExpire:()=>expired++});await assert.rejects(connect(client),e=>e.code==='HTTP_401');assert.equal(expired,0);assert(!client.connected);
});
test('401 after connection purges credentials and signals expiration exactly once',async()=>{
 let expired=0;const {client,calls}=fixture((u,i,n)=>n===1?json(root):json({},401),{onExpire:()=>expired++});await connect(client);await assert.rejects(client.list(),e=>e.code==='HTTP_401');assert.equal(expired,1);assert(!client.connected);await assert.rejects(client.list(),e=>e.code==='AUTH');assert.equal(calls.length,2);
});
test('folder and pagination requests preserve path in query only and reject invalid offsets',async()=>{
 const {client,calls}=fixture(u=>u.searchParams.get('path')==='여행'?json({path:'여행',total:201,next:200,items:[{name:'봄.jpg',path:'여행/봄.jpg',dir:false}]}):json(root));await connect(client);await client.list('여행',100);assert.equal(new URL(calls[1].url).searchParams.get('offset'),'100');assert.equal(new URL(calls[1].url).searchParams.get('path'),'여행');await assert.rejects(client.list('',-1));await assert.rejects(client.list('../outside'));await client.disconnect();
});
test('authenticated image returns a bounded image blob, rejects HTML and SVG',async()=>{
 let type='image/jpeg';const {client,calls}=fixture(u=>u.pathname==='/api/image'?new Response(new Uint8Array([1,2,3]),{headers:{'content-type':type}}):json(root));await connect(client);assert.equal((await client.image('one.jpg')).size,3);assert.equal(calls[1].init.headers.Authorization,'Bearer '+token);type='text/html';await assert.rejects(client.image('one.jpg'),e=>e.code==='IMAGE');await assert.rejects(client.image('x.svg'),e=>e.code==='IMAGE');await client.disconnect();
});
test('rejects oversized content-length and chunks even without declared length',async()=>{
 let chunked=false;const {client}=fixture(u=>u.pathname==='/api/image'?new Response(new Uint8Array(chunked?15*1024*1024+1:1),{headers:{'content-type':'image/jpeg',...(chunked?{}:{'content-length':String(16*1024*1024)})}}):json(root));await connect(client);await assert.rejects(client.image('one.jpg'),e=>e.code==='SIZE');chunked=true;await assert.rejects(client.image('one.jpg'),e=>e.code==='SIZE');await client.disconnect();
});
test('disconnect cancels outstanding requests and prevents late responses from reauthenticating',async()=>{
 let release;const {client}=fixture(()=>new Promise(r=>release=()=>r(json(root))));const pending=connect(client);await new Promise(r=>setTimeout(r,0));await client.disconnect();release();await assert.rejects(pending,e=>e.code==='ABORT');assert(!client.connected);
});
test('concurrent connects cannot reuse or overwrite another connection epoch',async()=>{
 const {client,calls}=fixture();const a=connect(client);const b=connect(client);await assert.rejects(a,e=>e.code==='ABORT');await b;assert(client.connected);assert.equal(calls.length,1);await client.disconnect();
});
test('network errors never echo endpoint or credentials back into UI errors',async()=>{
 const {client}=fixture(()=>{throw new Error(base+' '+token);});await assert.rejects(connect(client),e=>e.code==='NETWORK'&&!e.message.includes(token)&&!e.message.includes(base));
});
test('timeouts abort requests and report a timeout rather than generic authentication failure',async()=>{
 const {client}=fixture((u,init)=>new Promise((r,reject)=>init.signal.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')))),{timeoutMs:10});await assert.rejects(connect(client),e=>e.code==='TIMEOUT');assert(!client.connected);
});
test('connect accepts neither redirect HTML nor malformed API replies as a successful login',async()=>{
 const {client}=fixture(()=>new Response('<html>tunnel unavailable</html>'));await assert.rejects(connect(client),e=>e.code==='FORMAT');assert(!client.connected);
});
function memoryVault(initial=null){let saved=initial?structuredClone(initial):null;return {load:async()=>saved?structuredClone(saved):null,save:async v=>{saved=structuredClone(v);return true;},clear:async()=>{saved=null;},has:async()=>!!saved};}
test('remembered token reconnects after a fresh client without token input or password login',async()=>{
 const first=fixture(),vault=memoryVault();await connect(first.client);await first.client.remember(vault);await first.client.disconnect({revoke:false});const second=fixture();assert.equal((await second.client.restore(vault)).path,'');assert(second.client.connected);assert.equal(second.calls.length,1);assert.equal(second.calls[0].init.method,'GET');assert.equal(second.calls[0].init.headers.Authorization,'Bearer '+token);await second.client.disconnect();
});
test('only a validated connected client can be remembered',async()=>{
 const {client}=fixture(),vault=memoryVault();await assert.rejects(client.remember(vault),e=>e.code==='AUTH');assert.equal(await vault.load(),null);
});
test('session remember keeps the expiring session, never the login password',async()=>{
 const {client}=fixture(u=>u.pathname==='/api/login'?json({session:'fixture-session-only-000000000',expiresIn:3600}):json(root));const vault=memoryVault();await client.connect({base,mode:'login',username:'fixture',password:'not-to-be-persisted'});await client.remember(vault);const saved=await vault.load();assert.equal(saved.mode,'login');assert(saved.expiresAt>Date.now());assert(!JSON.stringify(saved).includes('not-to-be-persisted'));await client.disconnect();
});
test('expired saved sessions are deleted without sending them to the server',async()=>{
 const {client,calls}=fixture(),vault=memoryVault({version:1,base,mode:'login',secret:'fixture-session-only-000000000',expiresAt:Date.now()-1});await assert.rejects(client.restore(vault),e=>e.code==='EXPIRED');assert.equal(calls.length,0);assert.equal(await vault.load(),null);
});
test('temporary network failure retains remembered credentials for retry',async()=>{
 const vault=memoryVault({version:1,base,mode:'token',secret:token,expiresAt:null});const {client}=fixture(()=>{throw Error('offline');});await assert.rejects(client.restore(vault),e=>e.code==='NETWORK');assert(await vault.has());assert(!client.connected);assert.equal(client.origin,base);
});
test('authentication rejection deletes remembered credentials',async()=>{
 const vault=memoryVault({version:1,base,mode:'token',secret:token,expiresAt:null});const {client}=fixture(()=>json({},401));await assert.rejects(client.restore(vault),e=>e.code==='HTTP_401');assert(!await vault.has());assert(!client.connected);
});
test('tunnel address can change while reusing encrypted credential payload, no password needed',async()=>{
 const vault=memoryVault({version:1,base,mode:'token',secret:token,expiresAt:null}),{client,calls}=fixture();const changed='https://changed-fixture.trycloudflare.com';await client.restore(vault,{base:changed});assert.equal(new URL(calls[0].url).origin,changed);assert.equal(calls[0].init.headers.Authorization,'Bearer '+token);await client.remember(vault);assert.equal((await vault.load()).base,changed);await client.disconnect();
});
test('malformed stored origin is not contacted and is discarded',async()=>{
 const vault=memoryVault({version:1,base:'https://evil.example',mode:'token',secret:token,expiresAt:null}),{client,calls}=fixture();await assert.rejects(client.restore(vault),e=>e.code==='URL');assert.equal(calls.length,0);assert(!await vault.has());
});
test('full list URL pasted by the user normalizes to origin without forwarding a URL path',()=>{
 assert.equal(safeBase(base+'/api/list'),base);assert.equal(safeBase(base+'/api/list/'),base);
});
test('capabilities gracefully keeps old servers read-only, modern capabilities are opt-in',async()=>{
 const f=fixture((url)=>url.pathname==='/api/capabilities'?json({},404):json(root));await connect(f.client);assert.deepEqual(await f.client.capabilities(),{});
 const m=fixture(url=>url.pathname==='/api/capabilities'?json({version:2,upload:true,trash:'true',thumbnails:true,download:true,maxUpload:999999999}):json(root));await connect(m.client);assert.deepEqual(await m.client.capabilities(),{upload:true,trash:false,thumbnails:true,download:true,maxUpload:64*1024*1024});
});
test('uploads use authenticated binary POST without putting credentials in URLs',async()=>{
 const f=fixture((url)=>url.pathname==='/api/list'?json(root):json({ok:true}));await connect(f.client);
 const file=new File([new Uint8Array([255,216,255])],'우리 사진.jpg',{type:'image/jpeg'});await f.client.upload('여행',file);
 const c=f.calls.at(-1);assert.equal(c.init.method,'POST');assert.equal(c.init.body,file);assert.equal(c.init.headers['Content-Type'],'application/octet-stream');assert.equal(c.init.headers.Authorization,'Bearer '+token);assert.equal(new URL(c.url).searchParams.get('name'),'우리 사진.jpg');assert(!c.url.includes(token));
 await assert.rejects(f.client.upload('',new File(['x'],'../bad.jpg')));await assert.rejects(f.client.upload('',new File(['x'],'test.svg')));
});
test('soft delete requires a revision and restore rejects malformed IDs before network',async()=>{
 const f=fixture(url=>url.pathname==='/api/list'?json(root):json({ok:true}));await connect(f.client);
 assert.throws(()=>f.client.trash({path:'one.jpg'}));assert.throws(()=>f.client.restoreTrash('../bad'));
 await f.client.trash({path:'one.jpg',revision:'a'.repeat(64)});assert.deepEqual(JSON.parse(f.calls.at(-1).init.body),{path:'one.jpg',revision:'a'.repeat(64)});
 await f.client.restoreTrash('b'.repeat(32));assert.equal(new URL(f.calls.at(-1).url).pathname,'/api/restore');
});
test('download fallback uses legacy image API and modern original download is separate',async()=>{
 const f=fixture(url=>url.pathname==='/api/list'?json(root):new Response('image-bytes',{headers:{'content-type':'image/jpeg'}}));await connect(f.client);
 assert.equal((await f.client.download('one.jpg')).size,11);assert.equal(new URL(f.calls.at(-1).url).pathname,'/api/image');
 await f.client.download('one.jpg',true);assert.equal(new URL(f.calls.at(-1).url).pathname,'/api/download');
 await f.client.thumbnail('one.jpg');assert.equal(new URL(f.calls.at(-1).url).pathname,'/api/thumbnail');
});
test('upload transfer cancellation aborts the request',async()=>{
 const f=fixture((url,init)=>url.pathname==='/api/list'?json(root):new Promise((_,reject)=>init.signal.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')))));await connect(f.client);
 const pending=f.client.upload('',new File(['data'],'one.jpg'));f.client.cancelTransfers();await assert.rejects(pending,e=>e.code==='ABORT');
});
test('thumbnail requests share a two-slot limit across hero, covers and albums',async()=>{
 const pending=[];const f=fixture(url=>url.pathname==='/api/list'?json(root):new Promise(resolve=>pending.push(resolve)));await connect(f.client);
 const a=f.client.thumbnail('a.jpg'),b=f.client.thumbnail('b.jpg'),c=f.client.thumbnail('c.jpg');assert.equal(pending.length,2);
 pending[0](new Response('a',{headers:{'content-type':'image/jpeg'}}));await a;await new Promise(resolve=>setImmediate(resolve));assert.equal(pending.length,3);
 pending[1](new Response('b',{headers:{'content-type':'image/jpeg'}}));pending[2](new Response('c',{headers:{'content-type':'image/jpeg'}}));assert.equal((await b).size,1);assert.equal((await c).size,1);
});
test('disconnect cancels queued thumbnails without sending them under another connection',async()=>{
 const f=fixture((url,init)=>url.pathname==='/api/list'?json(root):new Promise((_,reject)=>init.signal.addEventListener('abort',()=>reject(new DOMException('aborted','AbortError')))));await connect(f.client);
 const work=[f.client.thumbnail('a.jpg'),f.client.thumbnail('b.jpg'),f.client.thumbnail('c.jpg')];const finished=Promise.allSettled(work);await f.client.disconnect();
 const result=await finished;assert(result.every(r=>r.status==='rejected'&&r.reason.code==='ABORT'));assert.equal(f.calls.length,3);
});

test('family account setup sends Korean username and password only in an authenticated POST body',async()=>{
 const f=fixture(url=>url.pathname==='/api/account'?json({username:'오니둥이'},201):json(root));
 await connect(f.client);await f.client.createFamilyAccount('fixture password 12345');
 const call=f.calls.at(-1);assert.equal(new URL(call.url).pathname,'/api/account');
 assert.equal(new URL(call.url).search,'');assert.equal(call.init.method,'POST');
 assert.deepEqual(JSON.parse(call.init.body),{username:'오니둥이',password:'fixture password 12345'});
 assert.ok(call.init.headers.Authorization.startsWith('Bearer '));
});
test('journal writes preserve conflict errors without changing the submitted draft',async()=>{
 const f=fixture(url=>url.pathname==='/api/journal'?json({error:'conflict'},409):json(root));await connect(f.client);
 const draft={action:'save',id:'11111111-1111-4111-8111-111111111111',revision:2,record:{body:'keep this'}};
 await assert.rejects(()=>f.client.journalWrite(draft),e=>e.code==='HTTP_409'&&e.message.includes('입력 내용은 유지'));
 assert.equal(draft.record.body,'keep this');assert.deepEqual(JSON.parse(f.calls.at(-1).init.body),draft);
});
test('journal backup uses an authenticated bounded binary response',async()=>{
 const f=fixture(url=>url.pathname==='/api/journal-backup'?new Response('SQLite format 3\0fixture',{headers:{'content-type':'application/octet-stream'}}):json(root));
 await connect(f.client);const blob=await f.client.journalBackup();assert.equal(blob.type,'application/octet-stream');assert.ok((await blob.text()).startsWith('SQLite format 3'));
 assert.ok(f.calls.at(-1).init.headers.Authorization.startsWith('Bearer '));assert.equal(new URL(f.calls.at(-1).url).search,'');
});
test('file management sends paths and stable operation ids in authenticated POST bodies',async()=>{
 const f=fixture(url=>url.pathname==='/api/files'?json({ok:true,path:'정리/가족.jpg',linkedRecords:1}):json(root));await connect(f.client);
 const data={action:'move',path:'one.jpg',revision:'a'.repeat(64),destination:'정리',name:'가족.jpg',operationId:'b'.repeat(32)};
 const result=await f.client.fileOperation(data);assert.equal(result.path,'정리/가족.jpg');assert.deepEqual(JSON.parse(f.calls.at(-1).init.body),data);assert.equal(new URL(f.calls.at(-1).url).search,'');assert.ok(f.calls.at(-1).init.headers.Authorization.startsWith('Bearer '));
 const before=f.calls.length;await assert.rejects(()=>f.client.fileOperation({action:'mkdir',parent:'',name:'../bad'}));assert.equal(f.calls.length,before);
});
test('file conflicts and unsupported atomic moves never report success',async()=>{
 for(const status of [409,501,503]){
  const f=fixture(url=>url.pathname==='/api/files'?json({},status):json(root));await connect(f.client);
  await assert.rejects(()=>f.client.fileOperation({action:'move',path:'one.jpg',destination:'',name:'new.jpg',revision:'a'.repeat(64),operationId:'b'.repeat(32)}),e=>e.code==='HTTP_'+status);
 }
});
test('photo write permission and upload size errors describe NAS settings',async()=>{
 const f=fixture(url=>url.pathname==='/api/upload'?json({},403):json(root));await connect(f.client);
 const file=new Blob(['fixture'],{type:'image/jpeg'});file.name='fixture.jpg';await assert.rejects(()=>f.client.upload('',file),e=>e.code==='HTTP_403'&&e.message.includes('쓰기'));
});
test('folder trash sends an explicit kind without changing ordinary photo requests',async()=>{
 const f=fixture(url=>url.pathname==='/api/trash'?json({ok:true,id:'b'.repeat(32)}):json(root));await connect(f.client);
 await f.client.trash({path:'여행',dir:true,revision:'a'.repeat(64)});
 assert.deepEqual(JSON.parse(f.calls.at(-1).init.body),{path:'여행',revision:'a'.repeat(64),kind:'folder'});
 await f.client.trash({path:'one.jpg',dir:false,revision:'a'.repeat(64)});assert.ok(!('kind'in JSON.parse(f.calls.at(-1).init.body)));
});

test('permanent trash uses POST bodies and incorrect reauthentication preserves login',async()=>{
 const {client,calls}=fixture((u,init)=>u.pathname==='/api/trash-purge/prepare'?json({},422):u.pathname==='/api/trash-purge/commit'?json({deleted:[],incomplete:[],unprocessed:[]}):json(root));
 await connect(client);await assert.rejects(client.purgePrepare([{id:'a'.repeat(32),revision:'b'.repeat(64),path:'private.jpg'}],'fixture-password'),e=>e.code==='HTTP_422');assert(client.connected);
 const call=calls.at(-1),body=JSON.parse(call.init.body);assert.deepEqual(Object.keys(body.items[0]),['id','revision']);assert.equal(body.password,'fixture-password');assert(!call.url.includes('fixture-password'));assert.equal(call.init.method,'POST');
 await client.purgeCommit('c'.repeat(43));assert.deepEqual(JSON.parse(calls.at(-1).init.body),{ticket:'c'.repeat(43),confirm:true});
});
