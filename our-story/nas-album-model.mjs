import {safeBase,safePath} from './nas-client.mjs?v=20261114-travel1';
const fatalListError=e=>e.name==='AbortError'||['HTTP_401','AUTH','ABORT','NETWORK','TIMEOUT','HTTP_429'].includes(e.code)||/^HTTP_5/.test(e.code||'');
export const ALBUM_KEYS=['home','travel','growth:다온','growth:라온','growth:함께'];
export function validateAlbumBindings(data) {
  if (!data || data.kind!=='album-folders' || !data.origins || typeof data.origins!=='object') return {};
  const result={};
  for(const [origin,entries] of Object.entries(data.origins).slice(0,20)) {
    try {
      if(safeBase(origin)!==origin || !entries || typeof entries!=='object') continue;
      const values={};
      for(const key of ALBUM_KEYS) {
        if(typeof entries[key]==='string')values[key]=safePath(entries[key]);
        else if(entries[key]?.type==='name')values[key]=validateNameRule(entries[key]);
      }
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
      if(task.path===root || fatalListError(e)) throw e;
      issues++;continue;
    }
    pages++; folders.add(task.path);
    if(!current()) throw new DOMException('Stale album request','AbortError');
    for(const item of data.items) {
      if(item.dir || item.video || seen.has(item.path)) continue;
      seen.add(item.path);items.push(item);
      if(items.length===limit) break;
    }
    if(data.items.some(item=>!item.dir && !item.video && !seen.has(item.path)))limited=true;
    for(const item of data.items) if(item.dir) {
      if(task.depth>=8 || folders.size+queue.filter(x=>!x.offset).length>=folderBudget) {limited=true;continue;}
      if(!queue.some(x=>x.path===item.path) && !folders.has(item.path)) queue.push({path:item.path,depth:task.depth+1,offset:0});
    }
    if(data.next!==null) queue.push({...task,offset:data.next});
  }
  return {items,limited:limited || !!queue.length,issues,folders:folders.size};
}

export function validateNameRule(value) {
  const text=typeof value?.text==='string'?value.text.normalize('NFC').trim():'';
  if(value?.type!=='name' || !text || text.length>80 || /[\\/\x00-\x1f\x7f]/.test(text) || !['numbered','exact','contains'].includes(value.mode))
    throw new TypeError('기본 폴더 이름을 1~80자로 입력해 주세요.');
  return {type:'name',text,mode:value.mode,root:safePath(value.root??'')};
}
export function matchesFolderName(name,rawRule) {
  const rule=validateNameRule(rawRule),base=rule.text.toLowerCase(),candidate=String(name).normalize('NFC').trim().toLowerCase();
  if(rule.mode==='contains')return candidate.includes(base);
  if(candidate===base)return true;
  return rule.mode==='numbered' && candidate.startsWith(base) && /^\s*[0-9]+$/.test(candidate.slice(base.length));
}
export function folderYear(path) {
  for(const segment of path.split('/')) {const match=segment.match(/^((?:19|20)\d{2})(?:년)?$/);if(match)return match[1];}
  return '';
}
// Scan folder names only. Never download images to discover matching folders.
// Continuation remains in memory; persisted settings contain only the rule.
export async function findNamedFolders(client,rawRule,{pageBudget=160,maxDepth=12,maxQueue=5000,cursor,current=()=>true,onProgress=()=>{}}={}) {
  const rule=validateNameRule(rawRule);
  const state=cursor||{queue:[{path:rule.root,depth:0,offset:0}],matches:[],visited:new Set(),issues:0,truncated:false,deep:false,pages:0};
  if(!cursor && rule.root && matchesFolderName(rule.root.split('/').at(-1),rule)) {
    if(!current())throw new DOMException('Stale folder search','AbortError');
    await client.list(rule.root,0);
    if(!current())throw new DOMException('Stale folder search','AbortError');
    state.visited.add(rule.root);state.pages++;
    state.queue=[];state.matches=[{path:rule.root,name:rule.root.split('/').at(-1),year:folderYear(rule.root)}];
  }
  let spent=0;
  while(state.queue.length && spent<pageBudget) {
    if(!current())throw new DOMException('Stale folder search','AbortError');
    const task=state.queue.shift();
    let data;
    spent++;state.pages++;
    try{data=await client.list(task.path,task.offset);}
    catch(e){if(task.path===rule.root || fatalListError(e)){state.queue.unshift(task);throw e;}state.issues++;continue;}
    if(!current())throw new DOMException('Stale folder search','AbortError');
    state.visited.add(task.path);
    const dirs=data.items.filter(i=>i.dir).sort((a,b)=>b.name.localeCompare(a.name,'ko',{numeric:true}));
    for(const item of dirs) {
      if(matchesFolderName(item.name,rule)) {
        if(!state.matches.some(i=>i.path===item.path))state.matches.push({path:item.path,name:item.name,year:folderYear(item.path)});
        continue; // Its descendants are included by the photo preview, not searched twice.
      }
      if(task.depth>=maxDepth){state.deep=true;continue;}
      if(state.visited.has(item.path)||state.queue.some(q=>q.path===item.path))continue;
      if(state.queue.length>=maxQueue){state.truncated=true;continue;}
      state.queue.push({path:item.path,depth:task.depth+1,offset:0});
    }
    if(data.next!==null)state.queue.push({...task,offset:data.next});
    onProgress({folders:state.visited.size,pages:state.pages,matches:state.matches.length});
  }
  const matches=[...state.matches].sort((a,b)=>b.year.localeCompare(a.year)||a.path.localeCompare(b.path,'ko',{numeric:true}));
  return {matches,issues:state.issues,limited:!!state.queue.length||state.truncated||state.deep,canContinue:!!state.queue.length,cursor:state,folders:state.visited.size};
}
export async function previewNamedFolders(client,matches,{limit=12,current=()=>true}={}) {
  const items=[],seen=new Set();let issues=0,limited=false;
  const count=Math.min(matches.length||1,limit),base=Math.floor(limit/count),extra=limit%count;
  for(const [index,match] of matches.entries()) {
    const share=base+(index<extra?1:0);
    if(items.length>=limit){limited=true;break;}
    try {
      const part=await scanFolderPhotos(client,match.path,{limit:Math.min(share,limit-items.length),pageBudget:12,folderBudget:24,current});
      issues+=part.issues;limited=limited||part.limited;
      for(const item of part.items)if(!seen.has(item.path)){seen.add(item.path);items.push({...item,albumFolder:match.path,folderYear:match.year});}
    } catch(e){if(fatalListError(e))throw e;issues++;}
  }
  return {items,issues,limited};
}
