// No offline cache. Secrets live only in worker memory and are bound to the owning page.
const grants=new Map(),scope=new URL(self.registration.scope),prefix=scope.pathname+'nas-private-media/';
self.addEventListener('install',event=>event.waitUntil(self.skipWaiting()));
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));
function validateGrant(data,client){
  const origin=new URL(data.origin);
  if(!/^https:\/\/[a-z0-9-]+\.trycloudflare\.com$/.test(origin.origin)||origin.href!==origin.origin+'/'||!/^[-_A-Za-z0-9]{43}$/.test(data.secret)||!/^[-a-f0-9]{36}$/.test(data.id)||!/^video(?:-download)?$/.test(data.kind)||!/^[-a-f0-9]{64}$/.test(data.revision)||typeof data.path!=='string'||data.path.length>4096||/[\\%\x00-\x1f]/.test(data.path)||data.path.split('/').some(p=>!p||p.startsWith('.')||p.startsWith('@')||['#recycle','#snapshot'].includes(p.toLowerCase())))throw Error();
  if(grants.size>=1000&&!grants.has(data.id))throw Error();
  const expires=Math.min(Number(data.expires),Date.now()+6*3600000);if(!Number.isFinite(expires)||expires<=Date.now())throw Error();
 return {client,origin:origin.origin,secret:data.secret,path:data.path,revision:data.revision,kind:data.kind,expires};
}
self.addEventListener('message',event=>{
 const source=event.source,port=event.ports?.[0],data=event.data;
 if(!source?.id||!port||!source.url)return;
 const page=new URL(source.url);if(page.origin!==scope.origin||!page.pathname.startsWith(scope.pathname))return;
 for(const [id,g] of grants)if(g.expires<=Date.now())grants.delete(id);
 if(data?.action==='clear'){for(const [id,g] of grants)if(g.client===source.id)grants.delete(id);port.postMessage({ok:true});return;}
 if(data?.action==='release'){if(grants.get(data.id)?.client===source.id)grants.delete(data.id);port.postMessage({ok:true});return;}
 try{grants.set(data.id,validateGrant(data,source.id));port.postMessage({ok:true});}catch{port.postMessage({ok:false});}
});
self.addEventListener('fetch',event=>{
 const url=new URL(event.request.url);if(url.origin!==scope.origin||!url.pathname.startsWith(prefix))return;
 event.respondWith((async()=>{
  const id=url.pathname.slice(prefix.length);let grant=grants.get(id);
  if(!grant&&event.clientId){
   const page=await self.clients.get(event.clientId);
   if(page){const data=await new Promise(resolve=>{const channel=new MessageChannel(),timer=setTimeout(()=>{channel.port1.close();resolve(null);},5000);channel.port1.onmessage=e=>{clearTimeout(timer);channel.port1.close();resolve(e.data);};page.postMessage({type:'nas-media-refresh',id},[channel.port2]);});
    try{if(data?.id===id){grant=validateGrant(data,event.clientId);grants.set(id,grant);}}catch{}
   }
  }
  const reject=(status)=>new Response('다시 로그인하거나 영상을 다시 열어 주세요.',{status,headers:{'Cache-Control':'no-store','Content-Type':'text/plain;charset=utf-8'}});
  if(event.request.method!=='GET'||url.search||!grant||grant.client!==event.clientId||grant.expires<=Date.now())return reject(403);
  const target=new URL(grant.origin+'/api/'+grant.kind);target.searchParams.set('path',grant.path);target.searchParams.set('revision',grant.revision);
  const headers={Authorization:'Bearer '+grant.secret};const range=event.request.headers.get('Range');if(range)headers.Range=range;
  try{
   const response=await fetch(target.href,{headers,credentials:'omit',redirect:'error',cache:'no-store',referrerPolicy:'no-referrer',signal:event.request.signal});
   if(![200,206,416].includes(response.status)){if(response.status===401)grants.delete(id);return reject(response.status);}
   const out=new Headers({'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
   for(const key of ['Content-Type','Content-Length','Content-Range','Accept-Ranges','Content-Disposition','ETag'])if(response.headers.has(key))out.set(key,response.headers.get(key));
   return new Response(response.body,{status:response.status,headers:out});
  }catch{return reject(502);}
 })());
});
