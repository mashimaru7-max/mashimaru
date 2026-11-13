import {safeBase,safePath} from './nas-client.mjs?v=20261113-autoalbums2';
export const ALBUM_KEYS=['home','travel','growth:다온','growth:라온','growth:함께'];
export function validateAlbumBindings(data) {
  if (!data || data.kind!=='album-folders' || !data.origins || typeof data.origins!=='object') return {};
  const result={};
  for(const [origin,entries] of Object.entries(data.origins).slice(0,20)) {
    try {
      if(safeBase(origin)!==origin || !entries || typeof entries!=='object') continue;
      const values={};
      for(const key of ALBUM_KEYS) if(typeof entries[key]==='string') values[key]=safePath(entries[key]);
      result[origin]=values;
    } catch { /* Corrupt mappings cannot become request destinations or paths. */ }
  }
  return result;
}
// Preview discovery, not an all-NAS index. Always use the authenticated list client.
export async function scanFolderPhotos(client,root='',{limit=12,pageBudget=16,folderBudget=32,current=()=>true}={}) {
  safePath(root);
  const queue=[{path:root,depth:0,offset:0}],items=[],seen=new Set(),folders=new Set();
  let pages=0,issues=0,limited=false;
  while(queue.length && items.length<limit && pages<pageBudget) {
    if(!current()) throw new DOMException('Stale album request','AbortError');
    const task=queue.shift();
    let data;
    try { data=await client.list(task.path,task.offset); }
    catch(e) {
      if(task.path===root || ['HTTP_401','AUTH','ABORT'].includes(e.code)) throw e;
      issues++;continue;
    }
    pages++; folders.add(task.path);
    if(!current()) throw new DOMException('Stale album request','AbortError');
    for(const item of data.items) {
      if(item.dir || seen.has(item.path)) continue;
      seen.add(item.path);items.push(item);
      if(items.length===limit) break;
    }
    if(data.items.some(item=>!item.dir && !seen.has(item.path)))limited=true;
    for(const item of data.items) if(item.dir) {
      if(task.depth>=8 || folders.size+queue.filter(x=>!x.offset).length>=folderBudget) {limited=true;continue;}
      if(!queue.some(x=>x.path===item.path) && !folders.has(item.path)) queue.push({path:item.path,depth:task.depth+1,offset:0});
    }
    if(data.next!==null) queue.push({...task,offset:data.next});
  }
  return {items,limited:limited || !!queue.length,issues,folders:folders.size};
}
