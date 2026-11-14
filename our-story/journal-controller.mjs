import {journalForm,journalDetails,journalRow,JOURNAL_KINDS} from './growth-journal.mjs?v=20261114-downloadfix1';
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
export function recordFromFields(target,kind,fields,attachments){
 const record={target,kind,date:fields.date,author:fields.author,attachments:attachments.map(r=>({path:r.path,revision:r.revision}))};
 const keys={diary:['title','topic','body','feeling'],words:['quote','listener','context'],letter:['body','readOn'],measure:['height','weight','note']}[kind];
 if(!keys)throw Error('기록 종류를 확인해 주세요.');
 for(const key of keys)record[key]=kind==='measure'&&['height','weight'].includes(key)?(fields[key]===''||fields[key]==null?null:Number(fields[key])):String(fields[key]??'');
 if(kind==='measure' && (record.height===null&&record.weight===null || ['height','weight'].some(k=>record[k]!==null&&!Number.isFinite(record[k]))))throw Error('키 또는 몸무게를 하나 이상 올바르게 입력해 주세요.');
 return record;
}
export class JournalController {
 constructor(gallery,{dialog,modal,notify}){
  this.g=gallery;this.dialog=dialog;this.modal=modal;this.notify=notify;this.host=null;this.version=0;this.items=new Map();this.urls=[];this.form=null;this.dirty=false;this.busy=false;
  this.filters={kind:'',year:'',q:'',trash:false};
  dialog.addEventListener('close',()=>{this.form=null;this.dirty=false;this.busy=false;this.browserLoadedFor=null;this.browserRequest=null;this.attachments=[];if(dialog.querySelector('#family-journal-form,[data-journal-edit],[data-journal-restore]'))dialog.querySelector('#dialog-content')?.replaceChildren();this.revoke();});
  dialog.addEventListener('cancel',e=>{if(!this.canClose())e.preventDefault();});
  dialog.addEventListener('click',e=>{
   const box=dialog.getBoundingClientRect(),outside=e.target===dialog&&(e.clientX<box.left||e.clientX>box.right||e.clientY<box.top||e.clientY>box.bottom);
   if((outside||e.target.closest('[data-action="close"]'))&&!this.canClose()){e.preventDefault();e.stopImmediatePropagation();}
  },true);
  window.addEventListener('beforeunload',e=>{if(this.dirty){e.preventDefault();e.returnValue='';}});
  setInterval(()=>{if(this.host?.isConnected&&this.g.connected&&document.visibilityState==='visible'&&!dialog.open&&!this.loading&&!this.host.contains(document.activeElement))void this.load(false);},30000);
  window.addEventListener('focus',()=>{if(this.host?.isConnected&&this.g.connected&&!dialog.open&&!this.loading&&!this.host.contains(document.activeElement))void this.load(false);});
 }
 canClose(){if(this.busy){this.notify('저장하는 중이에요. 잠시만 기다려 주세요.');return false;}return !this.dirty||window.confirm('저장하지 않은 내용이 있어요. 닫을까요?');}
 revoke(){for(const url of this.urls)URL.revokeObjectURL(url);this.urls=[];}
 release(){this.version++;this.detailVersion=(this.detailVersion||0)+1;this.host=null;this.items.clear();if(!this.g.connected){const owned=this.form?.isConnected||this.dialog.querySelector('#family-journal-form,[data-journal-edit],[data-journal-restore]');this.dirty=false;this.browserLoadedFor=null;this.browserRequest=null;this.attachments=[];if(owned){this.dialog.close();this.dialog.querySelector('#dialog-content')?.replaceChildren();this.form=null;}this.revoke();}}
 mount(host,target){this.release();this.host=host;this.target=target;this.offset=0;this.filters={kind:'',year:'',q:'',trash:false};void this.load(true);}
 async load(reset=true,more=false){
  const host=this.host,target=this.target,version=++this.version;if(!host)return;
  if(!this.g.connected){host.innerHTML='<div class="nas-album-empty"><h2>로그인하고 기록을 남겨 주세요.</h2><button data-action="nas-settings">가족 로그인</button></div>';return;}
  this.loading=true;
  if(reset)host.innerHTML='<p role="status">NAS에서 기록을 불러오는 중이에요…</p>';
  try{
   const offset=more?this.next:0,data=await this.g.client.journalList({target,...this.filters,offset});
   if(version!==this.version||host!==this.host||!host.isConnected||!this.g.connected)return;
   if(!more)this.items.clear();for(const item of data.items)this.items.set(item.id,item);this.next=data.next;
   this.paintList(data,host);
  }catch(error){
   if(version!==this.version||host!==this.host||!host.isConnected)return;
   const message=['HTTP_404','HTTP_409'].includes(error.code)?'NAS에 성장 기록 저장 코드를 적용한 뒤 사용할 수 있어요.':error.message;
   if(reset||!host.querySelector('.journal-list-controls')){host.innerHTML=`<div class="nas-album-empty" role="alert"><p>${esc(message)}</p><button data-journal-retry>다시 불러오기</button></div>`;host.querySelector('button').onclick=()=>void this.load(true);}
   else{const status=host.querySelector('[data-journal-status]');if(status)status.textContent='갱신하지 못했어요: '+message;}
  }finally{if(version===this.version)this.loading=false;}
 }
 paintList(data,host){
  const f=this.filters;
  host.innerHTML=`<div class="section-head"><div><span class="eyebrow">ONE DAY AT A TIME</span><h2>${f.trash?'기록 휴지통':'시간을 따라 쌓이는 이야기'}</h2></div><div class="nas-album-controls"><button data-journal-trash-toggle>${f.trash?'기록장으로':'기록 휴지통'}</button><button data-journal-backup title="두 아이의 기록과 휴지통을 모두 포함해 내려받아요">기록 DB 백업</button></div></div><form class="journal-list-controls"><label><span class="sr-only">기록 검색</span><input name="q" type="search" maxlength="100" value="${esc(f.q)}" placeholder="기록 내용 검색"></label><label><span class="sr-only">기록 종류</span><select name="kind"><option value="">모든 기록</option>${Object.entries(JOURNAL_KINDS).map(([k,v])=>`<option value="${k}" ${f.kind===k?'selected':''}>${v}</option>`).join('')}</select></label><label><span class="sr-only">기록 연도</span><select name="year"><option value="">모든 연도</option>${data.years.map(y=>`<option ${f.year===y?'selected':''}>${esc(y)}</option>`).join('')}</select></label><button type="submit">찾기</button></form><p class="fine" data-journal-status role="status">${data.total}개 기록 · ${this.items.size}개 표시${f.trash?' · 원본 사진은 삭제되지 않아요.':''}</p><div class="journal-saved-list">${[...this.items.values()].map(journalRow).join('')||`<div class="nas-album-empty"><p>${f.trash?'휴지통이 비어 있어요.':f.kind||f.year||f.q?'조건에 맞는 기록이 없어요.':'아직 남긴 기록이 없어요. 위에서 오늘의 이야기를 남겨 주세요.'}</p></div>`}</div>${data.next!==null?'<button class="journal-load-more" data-journal-more>기록 더 보기</button>':''}`;
  host.querySelector('form').onsubmit=e=>{e.preventDefault();const fields=new FormData(e.currentTarget);this.filters={...this.filters,kind:fields.get('kind'),year:fields.get('year'),q:fields.get('q').trim()};void this.load(true);};
  host.onclick=e=>{const button=e.target.closest('button');if(!button)return;if(button.dataset.journalOpen)void this.detail(button.dataset.journalOpen);if(button.hasAttribute('data-journal-more')&&!this.loading)void this.load(false,true);if(button.hasAttribute('data-journal-trash-toggle')){this.filters.trash=!this.filters.trash;void this.load(true);}if(button.hasAttribute('data-journal-backup'))void this.backup(button);};
 }
 async open(kind='diary',item=null){
  if(!this.canClose())return;
  if(!this.g.connected){this.notify('먼저 가족 계정으로 로그인해 주세요.');this.g.settings();return;}
  try{const features=await this.g.client.capabilities();this.g.features={...this.g.features,...features};if(!features.journalRecords){this.notify(features.accountSetup?'먼저 가족 공용 로그인을 설정해 주세요.':'NAS에 성장 기록 저장 코드를 먼저 적용해 주세요.');return;}}catch(error){this.notify(error.message);return;}
  this.revoke();this.dirty=false;
  const target=item?.record.target||this.target;
  if(!['다온','라온'].includes(target))return;
  this.modal(journalForm(target,kind,item));this.form=this.dialog.querySelector('#family-journal-form');
  const form=this.form,id=item?.id||crypto.randomUUID(),revision=item?.revision||0;
  this.attachments=(item?.record.attachments||[]).map(ref=>({...ref}));this.browserPath='';
  form.addEventListener('input',()=>{this.dirty=true;});form.addEventListener('change',()=>{this.dirty=true;});
  form.onsubmit=async e=>{
   e.preventDefault();if(this.busy)return;
   const error=form.querySelector('#journal-form-error');error.textContent='';let record;
   try{record=recordFromFields(target,kind,Object.fromEntries(new FormData(form)),this.attachments);}catch(err){error.textContent=err.message;return;}
   this.busy=true;const controls=[...form.querySelectorAll('input,textarea,select,button')].map(el=>[el,el.disabled]);controls.forEach(([el])=>{el.disabled=true;});
   error.textContent='NAS에 저장하는 중이에요…';
   try{
    const saved=await this.g.client.journalWrite({action:'save',id,revision,record});
    if(form!==this.form||!this.g.connected)return;
    this.busy=false;this.dirty=false;this.dialog.close();this.notify(revision?'기록을 수정했어요.':'NAS에 기록을 저장했어요.');
    this.filters={kind:'',year:'',q:'',trash:false};void this.load(true);
   }catch(err){if(form===this.form){error.textContent=err.message+' 입력 내용은 지우지 않았어요.';controls.forEach(([el,disabled])=>{el.disabled=disabled;});}}
   finally{this.busy=false;}
  };
  const picker=form.querySelector('.journal-attach-picker');picker.ontoggle=()=>{if(picker.open&&!this.browserLoadedFor?.isSameNode(form)){this.browserLoadedFor=form;void this.browse('',0);}};
  await this.paintSelected();
 }
 async paintSelected(){
  const form=this.form;if(!form)return;const selectedVersion=this.selectedVersion=(this.selectedVersion||0)+1;const host=form.querySelector('#journal-selected-photos');this.revoke();
  host.innerHTML=this.attachments.map((ref,i)=>`<div class="journal-selected-photo"><span data-journal-thumb="${i}"></span><span>${esc(ref.path.split('/').at(-1))}</span><button type="button" data-remove-photo="${i}">연결 해제</button></div>`).join('');
  host.onclick=e=>{const b=e.target.closest('[data-remove-photo]');if(b&&!this.busy){this.attachments.splice(Number(b.dataset.removePhoto),1);this.dirty=true;void this.paintSelected();}};
  const refs=[...this.attachments];let next=0;
  const worker=async()=>{while(next<refs.length&&this.form===form&&this.g.connected){const index=next++,ref=refs[index];try{const blob=await this.g.client.thumbnail(ref.path,ref.revision);if(this.form!==form||selectedVersion!==this.selectedVersion||this.attachments[index]?.path!==ref.path||!form.isConnected)return;const url=URL.createObjectURL(blob);this.urls.push(url);const image=document.createElement('img');image.src=url;image.alt=ref.path.split('/').at(-1);host.querySelector(`[data-journal-thumb="${index}"]`)?.replaceChildren(image);}catch{const slot=host.querySelector(`[data-journal-thumb="${index}"]`);if(slot)slot.textContent='미리보기 없음';}}};
  await Promise.all([worker(),worker()]);
 }
 async browse(path='',offset=0){
  const form=this.form;if(!form||this.busy)return;const host=form.querySelector('#journal-photo-browser'),request=Symbol();this.browserRequest=request;
  host.innerHTML='<p role="status">사진 폴더를 불러오는 중이에요…</p>';
  try{
   const data=await this.g.client.list(path,offset);if(this.form!==form||this.browserRequest!==request||!form.isConnected)return;this.browserPath=path;
   host.innerHTML=`<div class="journal-browser-nav"><button type="button" data-photo-up ${path?'':'disabled'}>상위 폴더</button><span>${esc(path||'/photo')}</span></div><div class="journal-browser-list">${data.items.map((item,i)=>item.dir?`<button type="button" data-photo-folder="${i}">폴더 · ${esc(item.name)}</button>`:`<div><button type="button" data-photo-pick="${i}">사진 연결 · ${esc(item.name)}</button><button type="button" data-photo-view="${i}">보기</button></div>`).join('')||'<p>이 폴더에 표시할 사진이 없어요.</p>'}</div><div class="journal-browser-nav">${offset?'<button type="button" data-photo-prev>이전 목록</button>':''}${data.next!==null?'<button type="button" data-photo-next>다음 목록</button>':''}</div>`;
   host.onclick=e=>{const b=e.target.closest('button');if(!b||this.busy)return;if(b.hasAttribute('data-photo-up'))void this.browse(path.split('/').slice(0,-1).join('/'));if(b.hasAttribute('data-photo-prev'))void this.browse(path,Math.max(0,offset-100));if(b.hasAttribute('data-photo-next'))void this.browse(path,data.next);if(b.dataset.photoFolder!==undefined)void this.browse(data.items[Number(b.dataset.photoFolder)].path);if(b.dataset.photoView!==undefined)void this.g.openImage(data.items[Number(b.dataset.photoView)]);if(b.dataset.photoPick!==undefined){const item=data.items[Number(b.dataset.photoPick)];if(this.attachments.some(r=>r.path===item.path)){this.notify('이미 연결한 사진이에요.');return;}if(this.attachments.length>=6){this.notify('사진은 최대 6장까지 연결할 수 있어요.');return;}if(item.path.length>1024){this.notify('경로가 너무 긴 사진은 아직 연결할 수 없어요.');return;}if(!item.revision){this.notify('이 사진의 파일 정보를 확인할 수 없어요.');return;}this.attachments.push({path:item.path,revision:item.revision});this.dirty=true;void this.paintSelected();}};
  }catch(err){if(this.form===form&&this.browserRequest===request)host.innerHTML=`<p role="alert">${esc(err.message)}</p>`;}
 }
 async detail(id){
  if(!this.canClose())return;
  const detailVersion=this.detailVersion=(this.detailVersion||0)+1;
  try{
   const item=await this.g.client.journalGet(id);if(!this.g.connected||detailVersion!==this.detailVersion)return;this.revoke();this.modal(journalDetails(item));this.dirty=false;
   const content=this.dialog.querySelector('#dialog-content');
   content.querySelector('[data-journal-edit]')?.addEventListener('click',()=>void this.open(item.record.kind,item));
   for(const [selector,action] of [['[data-journal-trash]','trash'],['[data-journal-restore]','restore']])content.querySelector(selector)?.addEventListener('click',async e=>{
    if(this.busy||action==='trash'&&!window.confirm('이 기록을 휴지통으로 옮길까요? 연결한 원본 사진은 그대로 유지돼요.'))return;
    const button=e.currentTarget;this.busy=true;button.disabled=true;
    try{await this.g.client.journalWrite({action,id:item.id,revision:item.revision});this.busy=false;this.dialog.close();this.notify(action==='trash'?'기록을 휴지통으로 옮겼어요.':'기록을 복원했어요.');void this.load(true);}catch(err){const error=this.dialog.querySelector('#journal-detail-error');if(error)error.textContent=err.message;else this.notify(err.message);button.disabled=false;}finally{this.busy=false;}
   });
   const host=content.querySelector('#journal-detail-photos');host.innerHTML=item.record.attachments.map((ref,i)=>`<button class="journal-attached-photo" data-attached="${i}"><span>사진 불러오는 중</span><small>${esc(ref.path.split('/').at(-1))}</small></button>`).join('');
   host.onclick=e=>{const b=e.target.closest('[data-attached]');if(b){const ref=item.record.attachments[Number(b.dataset.attached)];void this.g.openImage({path:ref.path,name:ref.path.split('/').at(-1),dir:false,expectedRevision:ref.revision});}};
   let next=0;const worker=async()=>{while(next<item.record.attachments.length&&host.isConnected&&this.g.connected){const index=next++,ref=item.record.attachments[index];try{const blob=await this.g.client.thumbnail(ref.path,ref.revision);if(!host.isConnected||!this.g.connected)return;const url=URL.createObjectURL(blob);this.urls.push(url);const image=document.createElement('img');image.src=url;image.alt=ref.path.split('/').at(-1);host.querySelector(`[data-attached="${index}"]>span`)?.replaceChildren(image);}catch{const slot=host.querySelector(`[data-attached="${index}"]>span`);if(slot)slot.textContent='원본이 이동·변경됐거나 미리보기를 읽지 못했어요.';}}};void Promise.all([worker(),worker()]);
  }catch(err){this.notify(err.message);}
 }
 async backup(button){
  button.disabled=true;
  try{const blob=await this.g.client.journalBackup();if(!this.g.connected)return;const url=URL.createObjectURL(blob);this.urls.push(url);const a=document.createElement('a');a.href=url;a.download='가족성장기록-'+new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul'}).format(new Date())+'.sqlite3';document.body.append(a);a.click();a.remove();setTimeout(()=>{URL.revokeObjectURL(url);this.urls=this.urls.filter(u=>u!==url);},30000);this.notify('두 아이와 휴지통을 포함한 전체 기록 DB를 내려받아요. 비공개로 보관해 주세요.');}catch(err){this.notify(err.message);}finally{button.disabled=false;}
 }
}
