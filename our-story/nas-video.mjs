const workerURL=new URL('./nas-media-worker.js?v=20261114-travel1',import.meta.url);
let preparing;
const pageGrants=new Map();
globalThis.navigator?.serviceWorker?.addEventListener('message',event=>{
 if(event.data?.type!=='nas-media-refresh'||!event.ports?.[0]||!event.source?.scriptURL)return;
 const source=new URL(event.source.scriptURL);if(source.origin!==workerURL.origin||source.pathname!==workerURL.pathname)return;
 const grant=pageGrants.get(event.data.id);event.ports[0].postMessage(grant&&grant.expires>Date.now()?grant:null);
});
export async function mediaWorker(){
 if(!globalThis.navigator?.serviceWorker)throw new Error('이 브라우저는 안전한 영상 재생을 지원하지 않아요. Chrome·Safari의 일반 창에서 열어 주세요.');
 if(!preparing)preparing=(async()=>{
  await navigator.serviceWorker.register(workerURL,{scope:new URL('./',import.meta.url).pathname});
  await navigator.serviceWorker.ready;
  if(!navigator.serviceWorker.controller)await new Promise((resolve,reject)=>{
   const timer=setTimeout(()=>{navigator.serviceWorker.removeEventListener('controllerchange',done);reject(new Error('영상 준비 후 페이지를 새로고침해 주세요.'));},10000);
   function done(){if(navigator.serviceWorker.controller){clearTimeout(timer);navigator.serviceWorker.removeEventListener('controllerchange',done);resolve();}}
   navigator.serviceWorker.addEventListener('controllerchange',done);done();
  });
  return navigator.serviceWorker.controller;
 })().catch(e=>{preparing=null;throw e;});
 await preparing;return navigator.serviceWorker.controller;
}
export async function workerMessage(data){
 if(data.action==='clear')pageGrants.clear();else if(data.action==='release')pageGrants.delete(data.id);else if(data.action==='grant')pageGrants.set(data.id,data);
 const worker=await mediaWorker();return new Promise((resolve,reject)=>{
  const channel=new MessageChannel(),timer=setTimeout(()=>{channel.port1.close();reject(new Error('영상 연결이 지연되고 있어요. 새로고침 후 다시 열어 주세요.'));},10000);
  channel.port1.onmessage=e=>{clearTimeout(timer);channel.port1.close();if(e.data?.ok)resolve();else reject(new Error('영상 연결을 확인할 수 없어요. 다시 로그인해 주세요.'));};worker.postMessage(data,[channel.port2]);
 });
}
export function clearVideoAccess(){pageGrants.clear();if(globalThis.navigator?.serviceWorker?.controller)void workerMessage({action:'clear'}).catch(()=>{});}
export async function firstFrame(handle,signal){
 const video=document.createElement('video');video.muted=true;video.playsInline=true;video.preload='metadata';
 try{return await new Promise((resolve,reject)=>{
  let settled=false;const finish=(error,blob)=>{if(settled)return;settled=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);if(error)reject(error);else resolve(blob);};
  const abort=()=>finish(new Error('미리보기 취소'));const timer=setTimeout(()=>finish(new Error('영상 미리보기 지연')),15000);
  signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted){abort();return;}
  video.onloadedmetadata=()=>{if(Number.isFinite(video.duration)&&video.duration>0)video.currentTime=Math.min(.05,video.duration/2);};
  const draw=()=>{if(!video.videoWidth||settled)return;try{const canvas=document.createElement('canvas');canvas.width=Math.min(640,video.videoWidth);canvas.height=Math.round(canvas.width*video.videoHeight/video.videoWidth);canvas.getContext('2d').drawImage(video,0,0,canvas.width,canvas.height);canvas.toBlob(blob=>finish(blob?null:new Error('미리보기 불가'),blob),'image/jpeg',.8);}catch(error){finish(error);}};
  video.onseeked=draw;video.onloadeddata=draw;video.onerror=()=>finish(new Error('이 영상 형식은 브라우저 미리보기를 지원하지 않아요.'));video.src=handle.url;video.load();
 });}finally{video.pause();video.removeAttribute('src');video.load();await handle.release();}
}
export const hashBlob=async blob=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await blob.arrayBuffer())),n=>n.toString(16).padStart(2,'0')).join('');
export async function videoFingerprint(file){
 return hashBlob(new Blob([file.name,'\0',String(file.size),'\0',file.slice(0,65536),file.slice(Math.max(0,file.size-65536))]));
}
export async function sendVideoChunks(file,state,{chunkSize,send,finish,progress=()=>{},active=()=>true}){
 const stop=()=>{if(!active())throw new Error('업로드를 멈췄어요. 같은 파일을 다시 선택하면 이어 올려요.');};
 if(!state||!Number.isSafeInteger(state.offset)||state.offset<0||state.offset>file.size||state.size!==file.size||!Array.isArray(state.chunks)||state.chunks.length>512)throw new Error('업로드 상태를 확인할 수 없어요.');
 let verified=0;
 for(const chunk of state.chunks){stop();if(chunk.offset!==verified||chunk.size!==Math.min(chunkSize,file.size-verified)||await hashBlob(file.slice(chunk.offset,chunk.offset+chunk.size))!==chunk.hash)throw new Error('이전에 올리던 파일과 내용이 달라요. 파일 이름을 바꿔 새로 올려 주세요.');verified+=chunk.size;progress(verified,file.size,true);}
 if(verified!==state.offset)throw new Error('업로드 이어 올리기 상태를 확인해 주세요.');
 if(state.done){stop();return finish(state.id);}
 for(let offset=state.offset;offset<file.size;){stop();const blob=file.slice(offset,offset+chunkSize),hash=await hashBlob(blob);stop();const result=await send(state.id,offset,hash,blob);if(result.offset!==offset+blob.size)throw new Error('전송 위치를 확인할 수 없어요. 같은 파일을 다시 선택해 주세요.');offset=result.offset;progress(offset,file.size,false);}
 stop();return finish(state.id);
}
