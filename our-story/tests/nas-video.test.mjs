import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {hashBlob,sendVideoChunks} from '../nas-video.mjs';
const source=await readFile(new URL('../nas-media-worker.js',import.meta.url),'utf8');
const origin='https://mashimaru7-max.github.io',page=origin+'/mashimaru/our-story/',id='11111111-1111-4111-8111-111111111111',secret='s'.repeat(43);
const grant={action:'grant',id,origin:'https://fixture-video.trycloudflare.com',secret,path:'2019/film.mp4',revision:'a'.repeat(64),kind:'video',expires:Date.now()+60000};
function worker({refresh=null}={}){
 const handlers={},calls=[];
 const self={registration:{scope:page},addEventListener:(type,fn)=>handlers[type]=fn,clients:{claim:async()=>{},get:async client=>({id:client,postMessage:(data,ports)=>ports[0].postMessage(refresh)})},skipWaiting:async()=>{}};
 vm.runInNewContext(source,{self,URL,Headers,Response,MessageChannel,setTimeout,clearTimeout,Date,fetch:async(url,init)=>{calls.push({url,init});return new Response('fixture',{status:206,headers:{'content-type':'video/mp4','content-range':'bytes 0-6/100','content-length':'7','content-disposition':'attachment; filename=film.mp4'}});}});
 return {calls,message(data,client='owner'){let result;handlers.message({source:{id:client,url:page},data,ports:[{postMessage:x=>result=x}]});return result;},request(client='owner',headers={},url=page+'nas-private-media/'+id){let promise;handlers.fetch({clientId:client,request:new Request(url,{headers}),respondWith:p=>promise=p});return promise;}};
}
test('video worker forwards Authorization and Range without secrets in URL, streams response',async()=>{
 const w=worker();assert(w.message(grant).ok);const response=await w.request('owner',{Range:'bytes=0-6'});assert.equal(response.status,206);assert.equal(await response.text(),'fixture');assert.equal(response.headers.get('Content-Range'),'bytes 0-6/100');assert.equal(response.headers.get('Cache-Control'),'no-store');assert.equal(w.calls[0].init.headers.Authorization,'Bearer '+secret);assert.equal(w.calls[0].init.headers.Range,'bytes=0-6');assert(!w.calls[0].url.includes(secret));assert.equal(w.calls[0].init.credentials,'omit');
});
test('video worker denies other pages, expired grants and cleared sessions',async()=>{
 const w=worker();w.message(grant);assert.equal((await w.request('other-page')).status,403);assert.equal(w.calls.length,0);w.message({action:'clear'});assert.equal((await w.request()).status,403);assert.equal(w.message({...grant,expires:Date.now()-1}).ok,false);
});
test('restarted worker restores a grant only from the requesting owning page memory',async()=>{
 const w=worker({refresh:grant});assert.equal((await w.request()).status,206);const wrong=worker({refresh:{...grant,id:'different'}});assert.equal((await wrong.request()).status,403);
});
test('video worker rejects arbitrary origins and unsafe paths, ignores unrelated requests',async()=>{
 const w=worker();for(const bad of [{origin:'https://evil.example'},{path:'../private.mp4'},{path:'#recycle/a.mp4'},{path:'a%2fb.mp4'},{secret:'short'}])assert.equal(w.message({...grant,...bad}).ok,false);
 assert.equal(w.request('owner',{},page+'app.js'),undefined);assert.equal(w.calls.length,0);
});
test('download uses the same authenticated stream and preserves filename headers',async()=>{
 const w=worker();w.message({...grant,kind:'video-download'});const r=await w.request();assert.match(w.calls[0].url,/\/api\/video-download\?/);assert.match(r.headers.get('Content-Disposition'),/attachment/);
});
function file(text){return new Blob([text]);}
test('chunk upload verifies completed bytes, resumes at saved offset and finalizes once',async()=>{
 const f=file('abcdefghij'),hash=await hashBlob(f.slice(0,4)),sent=[],progress=[];
 await sendVideoChunks(f,{id:'id',size:10,offset:4,chunks:[{offset:0,size:4,hash}],done:false},{chunkSize:4,send:async(id,offset,digest,blob)=>{sent.push([offset,await blob.text(),digest]);return {offset:offset+blob.size};},finish:async id=>{assert.equal(id,'id');return {done:true};},progress:n=>progress.push(n)});
 assert.deepEqual(sent.map(x=>x.slice(0,2)),[[4,'efgh'],[8,'ij']]);assert.deepEqual(progress,[4,8,10]);
});
test('different file prefix or cancelled upload sends no new chunks',async()=>{
 const f=file('abcdefgh');let sent=0;const options={chunkSize:4,send:async()=>sent++,finish:async()=>{}};
 await assert.rejects(sendVideoChunks(f,{size:8,offset:4,chunks:[{offset:0,size:4,hash:'0'.repeat(64)}]},options));
 await assert.rejects(sendVideoChunks(f,{size:8,offset:0,chunks:[]},{...options,active:()=>false}));assert.equal(sent,0);
});
