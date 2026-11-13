import {icon} from "./icons.js?v=20261113-albumlook2";
import {ConnectionVault,indexedConnectionStore} from './nas-vault.mjs?v=20261113-shared1';
import {scanFolderPhotos,validateAlbumBindings,ALBUM_KEYS,validateNameRule,findNamedFolders,previewNamedFolders} from './nas-album-model.mjs?v=20261114-records1';
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
const labels={'home':'홈','travel':'여행','growth:다온':'다온','growth:라온':'라온','growth:함께':'함께'};
export class NasAlbums {
  constructor(gallery,{notify=()=>{},onChange=()=>{},onBrowse=()=>{},vault}={}) {
    this.g=gallery;this.notify=notify;this.onChange=onChange;this.onBrowse=onBrowse;
    this.vault=vault||new ConnectionVault({store:indexedConnectionStore(indexedDB,'our-story-album-folders-v1')});
    this.searches=new Map();this.searchPending=new Map();this.years=new Map();this.bindings={};this.cache=new Map();this.pending=new Map();this.version=0;this.host=null;this.urls=[];this.origin='';this.key='home';this.settingVersion=0;this.refreshKeys=new Set();this.pollTime=0;this.visitSeed=crypto.randomUUID().replaceAll('-','');this.visitPage=null;
    this.ready=this.vault.load().then(d=>{this.bindings=validateAlbumBindings(d);}).catch(()=>this.notify('앨범 폴더 설정을 읽지 못했어요. 다시 연결해 주세요.'));
    this.dialog=document.createElement('dialog');this.dialog.className='nas-dialog nas-folder-picker';this.dialog.setAttribute('aria-label','앨범 사진 폴더 선택');document.body.append(this.dialog);
    this.dialog.addEventListener('close',()=>{this.settingVersion++;this.dialog.replaceChildren();});
    this.timer=setInterval(()=>{if(document.visibilityState==='visible')void this.poll();},5000);
    window.addEventListener('pagehide',()=>this.release());
  }
  sync() {
    const origin=this.g.connected?this.g.client.origin:'';
    if(origin!==this.origin){this.origin=origin;this.cache.clear();this.pending.clear();this.searches.clear();this.searchPending.clear();this.release();}
    if(!origin && this.dialog.open)this.dialog.close();
    if(origin && this.host?.querySelector('.nas-album-loading'))void this.paint();
  }
  folder(key) {return this.bindings[this.g.client.origin]?.[key];}
  async nameIndex(rule,{rescan=false,more=false,onProgress=()=>{}}={}) {
    const origin=this.g.client.origin,key=origin+'\n'+JSON.stringify(rule);
    const cached=this.searches.get(key);
    if(!rescan && !more && cached && Date.now()-cached.time<300000)return cached.data;
    if(this.searchPending.has(key))return this.searchPending.get(key);
    const work=findNamedFolders(this.g.client,rule,{cursor:more?cached?.data.cursor:undefined,current:()=>this.g.connected&&this.g.client.origin===origin,onProgress}).then(data=>{
      if(this.g.connected&&this.g.client.origin===origin)this.searches.set(key,{time:Date.now(),data});
      return data;
    }).finally(()=>{if(this.searchPending.get(key)===work)this.searchPending.delete(key);});
    this.searchPending.set(key,work);return work;
  }
  async collection(key,{refresh=false,onProgress=()=>{}}={}) {
    await this.ready;
    if(!this.g.connected)return {items:[],unconnected:true};
    this.bindings=validateAlbumBindings(await this.vault.load());
    const origin=this.g.client.origin,binding=this.folder(key),year=this.years.get(key)||'';
    if(key!=='home' && binding===undefined)return {items:[],unbound:true};
    const path=typeof binding==='string'?binding:'',cacheKey=origin+'\n'+key+'\n'+JSON.stringify(binding??'')+'\n'+year+'\n'+(this.visitSeed||'');
    const cached=this.cache.get(cacheKey);
    if(!refresh && cached && !cached.data.indexing && !(this.g.features.sharedArchive && !cached.data.shared) && !(this.g.features.randomAlbums && !cached.data.randomized) && Date.now()-cached.time<60000 && !this.refreshKeys.has(key))return cached.data;
    if(this.pending.has(cacheKey))return this.pending.get(cacheKey);
    const current=()=>this.g.connected&&this.g.client.origin===origin;
    const work=(async()=>{
      if(this.g.features.sharedArchive) {
        const force=this.refreshKeys.delete(key);
        const data=await this.g.client.sharedAlbum(key,year,force,this.g.features.randomAlbums?this.visitSeed:'');
        return {...data,origin};
      }
      if(binding?.type==='name') {
        const search=await this.nameIndex(binding,{onProgress});
        const matched=search.matches.filter(f=>!year || (year==='other'?!f.year:f.year===year));
        const preview=await previewNamedFolders(this.g.client,matched,{current,limit:12});
        return {...preview,origin,rule:binding,matchedFolders:search.matches,selectedYear:year,search:{limited:search.limited,canContinue:search.canContinue,folders:search.folders},issues:preview.issues+search.issues,limited:preview.limited||search.limited};
      }
      return {...await scanFolderPhotos(this.g.client,path,{limit:12,current}),path,origin};
    })().then(result=>{if(current())this.cache.set(cacheKey,{time:Date.now(),data:result});return result;}).finally(()=>{if(this.pending.get(cacheKey)===work)this.pending.delete(cacheKey);});
    this.pending.set(cacheKey,work);return work;
  }
  signature(data) {return JSON.stringify({items:data.items.map(i=>[i.path,i.revision||'']),shared:data.shared,indexing:data.indexing,snapshot:data.snapshot,limited:data.limited,issues:data.issues,matches:data.matchedFolders?.map(f=>f.path),search:data.search});}
  async poll() {
    const host=this.host,key=this.key,version=this.version;if(!host || !this.g.connected)return;
    const building=[...this.cache.values()].some(c=>c.data.indexing);
    if(!building && Date.now()-this.pollTime<60000)return;this.pollTime=Date.now();
    try {
      const data=await this.collection(key,{refresh:true});
      if(host!==this.host || version!==this.version || !this.g.connected)return;
      host.querySelector('[data-album-poll-error]')?.remove();
      const status=host.querySelector('[data-index-status]');if(status)status.textContent=this.indexStatus(data);
      if(this.signature(data)!==this.lastSignature){void this.paint();this.onChange(false);}
    } catch(e) {
      if(host!==this.host || !host.isConnected || !this.g.connected)return;
      let status=host.querySelector('[data-album-poll-error]');
      if(!status){status=document.createElement('p');status.dataset.albumPollError='';status.setAttribute('role','status');status.className='fine';host.prepend(status);}
      status.textContent='공통 목록 갱신을 완료하지 못했어요: '+(e.message||'NAS 응답 오류')+' · 자동으로 다시 시도해요.';
    }
  }
  indexStatus(data) {
    if(!data.indexing)return `가족 공통 목록 · ${data.total??0}장 · ${data.randomized?'방문할 때마다 새로운 사진을 골라 보여줘요.':'고정 순서 · 방문마다 랜덤 표시하려면 NAS 코드를 업데이트해 주세요.'}`;
    const p=data.progress;
    return '가족 공통 목록을 모으는 중이에요. '+(p?`${p.scanned}개 목록 확인 · 사진 ${p.found}장 발견 · 남은 목록 ${p.pending}개. `:'')+'찾은 사진부터 표시하고, 기존 완료 목록은 유지해요.';
  }
  beginVisit(page) {
    if(this.visitPage===page)return;
    this.visitPage=page;this.visitSeed=crypto.randomUUID().replaceAll('-','');
    this.cache.clear();this.pending.clear();
  }
  release() {this.lastSignature=null;this.version++;for(const url of this.urls)URL.revokeObjectURL(url);this.urls=[];this.host=null;}
  mount(host,key='home') {this.release();this.host=host;this.key=key;void this.paint();}
  async paint() {
    const host=this.host,key=this.key;if(!host)return;
    const version=++this.version;
    for(const url of this.urls)URL.revokeObjectURL(url);this.urls=[];
    host.innerHTML='<p class="nas-album-loading" role="status">우리 사진을 자동으로 불러오는 중…</p><div class="nas-album-grid">'+ '<div class="nas-skeleton"></div>'.repeat(4)+'</div>';
    try {
      const data=await this.collection(key,{onProgress:p=>{if(version===this.version && host.isConnected){const el=host.querySelector('.nas-album-loading');if(el)el.textContent=`폴더 이름을 찾는 중 · ${p.folders}개 폴더 확인 · ${p.matches}개 일치`;}}});
      if(version!==this.version || !host.isConnected || !this.g.connected)return;
      this.lastSignature=this.signature(data);
      const path=this.folder(key),title=key==='home'?'NAS에서 꺼낸 우리 순간들':`${labels[key]} 사진앨범`;
      const named=!!data.rule,source=named?`${data.rule.text}${data.rule.mode==='numbered'?' + 숫자(없어도 포함)':data.rule.mode==='exact'?' · 이름 일치':' · 이름 포함'} · ${data.matchedFolders.length}개 폴더`:(path===undefined?'/photo 전체':path||'/photo');
      const years=named?[...new Set(data.matchedFolders.map(f=>f.year))].sort().reverse():[];
      const yearSelect=named?`<label class="nas-rule-year">폴더 연도<select data-album-year aria-label="폴더 연도"><option value="">모든 연도</option>${years.map(y=>`<option value="${y||'other'}" ${data.selectedYear===(y||'other')?'selected':''}>${y||'연도 없는 폴더'}</option>`).join('')}</select></label>`:'';
      host.innerHTML=`<div class="section-head nas-album-heading"><div><span class="eyebrow">AUTOMATIC PHOTO ALBUM</span><h2>${title}</h2></div><div class="nas-album-controls"><button data-album-picker>사진 폴더 ${path===undefined && key!=='home'?'연결':'변경'}</button><button data-album-refresh>새로 불러오기</button></div></div>${data.unbound?'<div class="nas-album-empty"><h3>사진마다 고르지 않아도 괜찮아요.</h3><p>사진이 있는 폴더를 한 번 연결하면 하위 폴더의 사진까지 자동으로 보여드려요.</p><button class="primary" data-album-picker>사진 폴더 연결</button></div>':`<p class="fine nas-album-source">${named?'모으는 기준':'연결 폴더'}: ${esc(source)} · 하위 사진 포함</p>${yearSelect}${data.shared?`<p class="fine" data-index-status role="status">${esc(this.indexStatus(data))}</p>`:'<p class="fine">이 서버는 기기별 탐색 모드예요. 가족 공통 목록을 사용하려면 NAS 서버를 업데이트해 주세요.</p>'}${data.search?.limited?`<div class="nas-search-note" role="status">일부 범위까지 검색했어요. ${data.search.canContinue?'<button data-name-more>남은 폴더 이어서 찾기</button>':'검색 범위를 더 가까운 폴더로 좁혀 주세요.'}</div>`:''}${data.items.length?`<div class="${key==='home'?'nas-album-grid':'nas-album-spread'}">${data.items.slice(0,key==='home'?8:12).map((item,i)=>`<button class="nas-album-photo ${i===0?'nas-album-lead':''}" data-album-photo="${i}"><span class="nas-auto-image">${'<span class="nas-skeleton"></span>'}</span><span>${esc(item.folderYear?item.folderYear+' · '+item.name:item.name)}</span></button>`).join('')}</div>`:'<div class="nas-album-empty"><p>이 범위에서 표시할 사진을 찾지 못했어요. 공통 목록 준비 중이면 잠시 기다려 주세요. 폴더 이름과 검색 범위도 확인해 주세요.</p></div>'}<div class="nas-album-foot"><p class="fine">${data.limited?'미리보기 일부를 골라 표시했어요. 전체 사진은 보관함에서 볼 수 있어요.':'사진 파일과 여행·성장 이야기는 따로 보관돼요.'}${data.issues?' 읽지 못한 하위 폴더가 있어요.':''}</p><button data-album-all>${named?'모은 폴더 전체 보기':'이 폴더의 전체 사진 보기'}</button></div>`}`;
      host.onclick=e=>{
        if(e.target.closest('[data-album-picker]'))void this.pick(key);
        if(e.target.closest('[data-album-refresh]')){this.visitSeed=crypto.randomUUID().replaceAll('-','');this.refreshKeys.add(key);this.cache.clear();this.pending.clear();if(named)this.searches.clear();void this.paint();this.onChange(false);}
        if(e.target.closest('[data-album-all]')){if(named)this.showMatches(data);else this.onBrowse(data.path??'');}
        if(e.target.closest('[data-name-more]')){const v=this.version;host.querySelector('[data-name-more]').disabled=true;void this.nameIndex(data.rule,{more:true}).then(()=>{if(v===this.version){this.cache.clear();void this.paint();}}).catch(err=>this.notify(err.message));}
        const photo=e.target.closest('[data-album-photo]');if(photo)void this.g.openImage(data.items[Number(photo.dataset.albumPhoto)]);
      };
      const yearControl=host.querySelector('[data-album-year]');if(yearControl)yearControl.onchange=()=>{this.years.set(key,yearControl.value);void this.paint();};
      const entries=[...host.querySelectorAll('[data-album-photo]')];
      let next=0;
      const worker=async()=>{
        while(next<entries.length && version===this.version && this.g.connected) {
          const entry=entries[next++],item=data.items[Number(entry.dataset.albumPhoto)];
          try {
            const blob=await (this.g.features.thumbnails?this.g.client.thumbnail(item.path):this.g.client.image(item.path));
            if(version!==this.version || !entry.isConnected || !this.g.connected)return;
            const url=URL.createObjectURL(blob);this.urls.push(url);
            const image=document.createElement('img');image.src=url;image.alt=item.name;image.decoding='async';
            image.onerror=()=>{if(entry.isConnected)entry.querySelector('.nas-auto-image').textContent='눌러서 원본 확인';};
            entry.querySelector('.nas-auto-image').replaceChildren(image);
          } catch {if(version===this.version && entry.isConnected)entry.querySelector('.nas-auto-image').textContent='눌러서 원본 확인';}
        }
      };
      await Promise.all([worker(),worker()]);
      if(key==='home' && version===this.version)void this.paintCovers();
    } catch(e) {
      if(version!==this.version || !host.isConnected)return;
      host.innerHTML=`<div class="nas-album-empty" role="alert"><p>${esc(e.message||'사진을 불러오지 못했어요.')}</p><button>다시 불러오기</button><button data-error-picker>사진 폴더 변경</button></div>`;
      host.querySelector('button').onclick=()=>{this.cache.clear();void this.paint();};
      host.querySelector('[data-error-picker]').onclick=()=>void this.pick(key);
    }
  }
  async apply(key,path) {
    await this.ready;
    this.bindings=validateAlbumBindings(await this.vault.load());
    if(path?.type==='name')path=validateNameRule(path);
    if(!ALBUM_KEYS.includes(key) || !this.g.connected)throw new Error('연결된 앨범을 확인해 주세요.');
    const origin=this.g.client.origin;
    const updated={...this.bindings,[origin]:{...this.bindings[origin],[key]:path}};
    const checked=validateAlbumBindings({kind:'album-folders',origins:updated});
    if(JSON.stringify(checked[origin]?.[key])!==JSON.stringify(path))throw new Error('폴더 경로를 확인해 주세요.');
    if(!await (this.vault.saveKey?this.vault.saveKey(key,path):this.vault.save({kind:'album-folders',origins:checked})))throw new Error('사진 폴더 설정을 저장하지 못했어요.');
    if(!this.g.connected || this.g.client.origin!==origin)return;
    this.bindings=checked;this.years.delete(key);this.cache.clear();this.pending.clear();
    if(this.dialog.open)this.dialog.close();
    this.notify(path?.type==='name'?`${labels[key]} 이름 규칙을 가족 공통으로 저장했어요. 일치하는 폴더를 찾을게요.`:`${labels[key]} 사진 폴더를 가족 공통으로 연결했어요.`);this.onChange(true);
  }
  async pick(key,path='',offset=0,existing=[]) {
    await this.ready;if(!this.g.connected){this.g.settings();return;}
    if(!ALBUM_KEYS.includes(key))return;
    const version=++this.settingVersion,origin=this.g.client.origin;
    this.dialog.innerHTML='<p role="status">사진 폴더를 불러오는 중…</p>';
    if(!this.dialog.open)this.dialog.showModal();
    try {
      const listing=await this.g.client.list(path,offset);
      if(version!==this.settingVersion || !this.dialog.open || !this.g.connected || this.g.client.origin!==origin)return;
      const folders=[...existing,...listing.items.filter(i=>i.dir)];
      this.dialog.innerHTML=`<button class="close" data-picker-close aria-label="닫기">×</button><span class="eyebrow">CONNECT ONCE, KEEP THE MOMENTS</span><h2>${labels[key]} 사진 폴더 연결</h2><p>한 번 연결하면 같은 NAS에 접속한 가족에게도 같은 앨범이 표시돼요. 사진은 이동하지 않아요.</p><div class="nas-picker-modes"><button disabled>폴더 선택</button><button data-picker-name>이름으로 모으기</button></div><p class="nas-picker-path">${esc(path||'/photo')}</p><div class="nas-picker-nav"><button data-picker-up ${path?'':'disabled'}>상위 폴더</button><button data-picker-root>전체 폴더</button></div><div class="nas-picker-folders">${folders.map((f,i)=>`<button data-picker-folder="${i}"><span>${icon("folder")}</span> ${esc(f.name)}</button>`).join('')||'<p class="fine">현재 목록에 하위 폴더가 없어요.</p>'}</div>${listing.next!==null?'<button data-picker-more>폴더 목록 더 보기</button>':''}<p class="fine">국가·도시·아이·나이를 사진에서 추정해 분류하지 않아요.</p><button class="primary" data-picker-use>이 폴더 연결</button><p role="alert" class="nas-picker-error"></p>`;
      this.dialog.onclick=e=>{
        if(e.target.closest('[data-picker-close]'))this.dialog.close();
        if(e.target.closest('[data-picker-name]'))void this.pickName(key,path);
        if(e.target.closest('[data-picker-up]'))void this.pick(key,path.split('/').slice(0,-1).join('/'));
        if(e.target.closest('[data-picker-root]'))void this.pick(key,'');
        const folder=e.target.closest('[data-picker-folder]');if(folder)void this.pick(key,folders[Number(folder.dataset.pickerFolder)].path);
        if(e.target.closest('[data-picker-more]'))void this.pick(key,path,listing.next,folders);
        const use=e.target.closest('[data-picker-use]');if(use){use.disabled=true;void this.apply(key,path).catch(err=>{if(version===this.settingVersion){this.dialog.querySelector('[role=alert]').textContent=err.message;use.disabled=false;}});}
      };
    } catch(e) {if(version===this.settingVersion){this.dialog.innerHTML=`<button class="close" aria-label="닫기">×</button><p role="alert">${esc(e.message)}</p>`;this.dialog.querySelector('button').onclick=()=>this.dialog.close();}}
  }
  async pickName(key,root='') {
    await this.ready;if(!this.g.connected){this.g.settings();return;}
    const saved=this.folder(key),rule=saved?.type==='name'?saved:null;
    this.settingVersion++;
    this.dialog.innerHTML=`<button class="close" data-picker-close aria-label="닫기">×</button><span class="eyebrow">ONE NAME, EVERY YEAR</span><h2>${labels[key]} 사진을 이름으로 모으기</h2><div class="nas-picker-modes"><button data-back-folder>폴더 선택</button><button disabled>이름으로 모으기</button></div><p>연도별로 흩어진 폴더도 한 번에 연결해요. 기본 이름 뒤에 숫자가 없거나 1, 2, 3 등이 붙은 폴더를 함께 찾을 수 있어요.</p><p class="nas-picker-path">검색 범위: ${esc(root||'/photo 전체')}</p><form class="nas-name-form"><label>기본 폴더 이름<input name="text" maxlength="80" required autocomplete="off" placeholder="예: 남매사진" value="${esc(rule?.text||'')}"></label><label>이름 조건<select name="mode"><option value="numbered" ${!rule||rule.mode==='numbered'?'selected':''}>기본 이름 + 숫자 (숫자 없어도 포함)</option><option value="exact" ${rule?.mode==='exact'?'selected':''}>이름이 정확히 같음</option><option value="contains" ${rule?.mode==='contains'?'selected':''}>이름에 포함됨</option></select></label><p class="fine">숫자를 대신하는 # 기호는 입력하지 마세요.<br>폴더 이름만 비교하며 사진 파일명이나 얼굴로 분류하지 않아요.</p><button class="primary" type="submit">이 이름으로 연결</button><p role="alert"></p></form>`;
    if(!this.dialog.open)this.dialog.showModal();
    this.dialog.onclick=e=>{if(e.target.closest('[data-picker-close]'))this.dialog.close();if(e.target.closest('[data-back-folder]'))void this.pick(key,root);};
    const form=this.dialog.querySelector('form');
    form.onsubmit=e=>{e.preventDefault();const button=form.querySelector('[type=submit]');button.disabled=true;void(async()=>{try{const value=validateNameRule({type:'name',text:form.elements.text.value,mode:form.elements.mode.value,root});await this.apply(key,value);}catch(err){if(form.isConnected){form.querySelector('[role=alert]').textContent=err.message;button.disabled=false;}}})();};
  }
  showMatches(data) {
    this.settingVersion++;
    this.dialog.innerHTML=`<button class="close" aria-label="닫기">×</button><span class="eyebrow">COLLECTED ACROSS THE YEARS</span><h2>이름으로 모은 ${data.matchedFolders.length}개 폴더</h2><p>각 폴더를 누르면 NAS 보관함에서 그 안의 사진을 모두 볼 수 있어요. 연도는 상위 폴더 이름 기준이에요.</p><div class="nas-picker-folders">${data.matchedFolders.map((f,i)=>`<button data-match="${i}">${esc(f.path)}</button>`).join('')||'<p>아직 일치하는 폴더가 없어요.</p>'}</div>`;
    if(!this.dialog.open)this.dialog.showModal();
    this.dialog.onclick=e=>{if(e.target.closest('.close'))this.dialog.close();const b=e.target.closest('[data-match]');if(b){this.dialog.close();this.onBrowse(data.matchedFolders[Number(b.dataset.match)].path);}};
  }
  async paintCovers() {
    const version=this.version,origin=this.g.client.origin;
    await this.ready;
    const growthKey='growth:함께';
    for(const [key,selector] of [['travel','[data-album-cover=travel]'],[growthKey,'[data-album-cover=growth]']]) {
      const host=document.querySelector(selector);if(!host)continue;
      try {
        const data=await this.collection(key),item=data.items[0];
        if(!item || !host.isConnected || version!==this.version || !this.g.connected || origin!==this.g.client.origin)continue;
        const blob=await (this.g.features.thumbnails?this.g.client.thumbnail(item.path):this.g.client.image(item.path));
        if(!host.isConnected || version!==this.version || !this.g.connected)continue;
        const url=URL.createObjectURL(blob);this.urls.push(url);const img=document.createElement('img');img.src=url;img.alt=`${labels[key]} 앨범에서 자동으로 고른 사진`;host.replaceChildren(img);
      } catch { /* Unavailable covers keep their explicit folder-connection placeholder. */ }
    }
  }
}
