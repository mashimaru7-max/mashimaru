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
