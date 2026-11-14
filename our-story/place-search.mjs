// Explicit place lookups only: never autocomplete or send family credentials.
export const PLACE_SEARCH_URL='https://nominatim.openstreetmap.org/search';
const cache=new Map();let lastRequest=0;let queue=Promise.resolve();
export function normalizePlaces(data){
 if(!Array.isArray(data))throw Error('Invalid place response');
 return data.filter(p=>p.lat!==''&&p.lon!==''&&Number.isFinite(Number(p.lat))&&Number.isFinite(Number(p.lon))&&Math.abs(Number(p.lat))<=90&&Math.abs(Number(p.lon))<=180).slice(0,5).map(p=>({lat:Number(p.lat),lng:Number(p.lon),label:String(p.display_name||p.name||'검색한 위치'),type:p.addresstype||p.type,bounds:Array.isArray(p.boundingbox)?p.boundingbox.map(Number):null}));
}
export function placeZoom(place){return place.type==='country'?5:['state','province','region'].includes(place.type)?7:['city','town','municipality','county'].includes(place.type)?11:13;}
export async function searchPlaces(term,{domestic=false,fetcher=fetch}={}){
 const q=String(term).trim().slice(0,160);if(q.length<2)return [];
 const key=JSON.stringify([q,domestic]);if(cache.has(key))return cache.get(key);
 const task=async()=>{
  if(cache.has(key))return cache.get(key);
  // Serialize and cache this small family's manual requests, including other tabs.
  const run=async()=>{
   let stamp=lastRequest;try{stamp=Math.max(stamp,Number(localStorage.getItem('our-story-place-request'))||0);}catch{}
   await new Promise(r=>setTimeout(r,Math.max(0,1100-(Date.now()-stamp))));lastRequest=Date.now();try{localStorage.setItem('our-story-place-request',String(lastRequest));}catch{}
   const url=new URL(PLACE_SEARCH_URL);url.search=new URLSearchParams({q,format:'jsonv2','accept-language':'en',limit:'5',...(domestic?{countrycodes:'kr'}:{})});
   const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),12000);
   try{const response=await fetcher(url,{credentials:'omit',referrerPolicy:'strict-origin-when-cross-origin',signal:controller.signal});if(!response.ok)throw Error('Place lookup unavailable');const places=normalizePlaces(await response.json());if(cache.size>=30)cache.delete(cache.keys().next().value);cache.set(key,places);return places;}finally{clearTimeout(timer);}
  };
  return globalThis.navigator?.locks? navigator.locks.request('our-story-place-search',run):run();
 };
 const result=queue.then(task,task);queue=result.catch(()=>{});return result;
}
