import {ConnectionVault,indexedConnectionStore} from './nas-vault.mjs?v=20261113-autoalbums2';
import {scanFolderPhotos,validateAlbumBindings,ALBUM_KEYS} from './nas-album-model.mjs?v=20261113-autoalbums2';
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
const labels={'home':'홈','travel':'여행','growth:다온':'다온','growth:라온':'라온','growth:함께':'함께'};
export class NasAlbums {
  constructor(gallery,{notify=()=>{},onChange=()=>{},onBrowse=()=>{},vault}={}) {
    this.g=gallery;this.notify=notify;this.onChange=onChange;this.onBrowse=onBrowse;
    this.vault=vault||new ConnectionVault({store:indexedConnectionStore(indexedDB,'our-story-album-folders-v1')});
    this.bindings={};this.cache=new Map();this.pending=new Map();this.version=0;this.host=null;this.urls=[];this.origin='';this.key='home';this.settingVersion=0;
    this.ready=this.vault.load().then(d=>{this.bindings=validateAlbumBindings(d);}).catch(()=>this.notify('앨범 폴더 설정을 읽지 못했어요. 다시 연결해 주세요.'));
    this.dialog=document.createElement('dialog');this.dialog.className='nas-dialog nas-folder-picker';this.dialog.setAttribute('aria-label','앨범 사진 폴더 선택');document.body.append(this.dialog);
    this.dialog.addEventListener('close',()=>{this.settingVersion++;this.dialog.replaceChildren();});
    this.timer=setInterval(()=>{if(this.host && this.g.connected && document.visibilityState==='visible') {this.cache.clear();this.pending.clear();void this.paint();this.onChange(false);}},60000);
    window.addEventListener('pagehide',()=>this.release());
  }
  sync() {
    const origin=this.g.connected?this.g.client.origin:'';
    if(origin!==this.origin){this.origin=origin;this.cache.clear();this.pending.clear();this.release();}
    if(!origin && this.dialog.open)this.dialog.close();
    if(origin && this.host?.querySelector('.nas-album-loading'))void this.paint();
  }
  folder(key) {return this.bindings[this.g.client.origin]?.[key];}
  async collection(key,{refresh=false}={}) {
    await this.ready;
    if(!this.g.connected)return {items:[],unconnected:true};
    const origin=this.g.client.origin,folder=this.folder(key);
    if(key!=='home' && folder===undefined)return {items:[],unbound:true};
    const path=folder??'',cacheKey=origin+'\n'+path;
    if(refresh)this.cache.delete(cacheKey);
    const cached=this.cache.get(cacheKey);
    if(cached && Date.now()-cached.time<60000)return cached.data;
    if(this.pending.has(cacheKey))return this.pending.get(cacheKey);
    const promise=scanFolderPhotos(this.g.client,path,{limit:12,current:()=>this.g.connected && this.g.client.origin===origin}).then(data=>{
      const result={...data,path,origin};
      if(this.g.connected && this.g.client.origin===origin)this.cache.set(cacheKey,{time:Date.now(),data:result});
      return result;
    }).finally(()=>{if(this.pending.get(cacheKey)===promise)this.pending.delete(cacheKey);});
    this.pending.set(cacheKey,promise);return promise;
  }
  release() {this.version++;for(const url of this.urls)URL.revokeObjectURL(url);this.urls=[];this.host=null;}
  mount(host,key='home') {this.release();this.host=host;this.key=key;void this.paint();}
  async paint() {
    const host=this.host,key=this.key;if(!host)return;
    const version=++this.version;
    for(const url of this.urls)URL.revokeObjectURL(url);this.urls=[];
    host.innerHTML='<p class="nas-album-loading" role="status">우리 사진을 자동으로 불러오는 중…</p><div class="nas-album-grid">'+ '<div class="nas-skeleton"></div>'.repeat(4)+'</div>';
    try {
      const data=await this.collection(key);
      if(version!==this.version || !host.isConnected || !this.g.connected)return;
      const path=this.folder(key),title=key==='home'?'NAS에서 꺼낸 우리 순간들':`${labels[key]} 사진앨범`;
      host.innerHTML=`<div class="section-head nas-album-heading"><div><span class="eyebrow">AUTOMATIC PHOTO ALBUM</span><h2>${title}</h2></div><div class="nas-album-controls"><button data-album-picker>사진 폴더 ${path===undefined && key!=='home'?'연결':'변경'}</button><button data-album-refresh>새로 불러오기</button></div></div>${data.unbound?'<div class="nas-album-empty"><h3>사진마다 고르지 않아도 괜찮아요.</h3><p>사진이 있는 폴더를 한 번 연결하면 하위 폴더의 사진까지 자동으로 보여드려요.</p><button class="primary" data-album-picker>사진 폴더 연결</button></div>':`<p class="fine nas-album-source">연결 폴더: ${esc(path===undefined?'/photo 전체':path||'/photo')} · 하위 폴더 포함 · 파일 목록 순서</p>${data.items.length?`<div class="${key==='home'?'nas-album-grid':'nas-album-spread'}">${data.items.slice(0,key==='home'?8:12).map((item,i)=>`<button class="nas-album-photo ${i===0?'nas-album-lead':''}" data-album-photo="${i}"><span class="nas-auto-image">${'<span class="nas-skeleton"></span>'}</span><span>${esc(item.name)}</span></button>`).join('')}</div>`:'<div class="nas-album-empty"><p>이 범위에서 표시할 사진을 찾지 못했어요. 사진이 있는 하위 폴더를 직접 연결해 보세요.</p></div>'}<div class="nas-album-foot"><p class="fine">${data.limited?'미리보기 일부를 골라 표시했어요. 전체 사진은 보관함에서 볼 수 있어요.':'사진 파일과 여행·성장 이야기는 따로 보관돼요.'}${data.issues?' 읽지 못한 하위 폴더가 있어요.':''}</p><button data-album-all>이 폴더의 전체 사진 보기</button></div>`}`;
      host.onclick=e=>{
        if(e.target.closest('[data-album-picker]'))void this.pick(key);
        if(e.target.closest('[data-album-refresh]')){this.cache.clear();this.pending.clear();void this.paint();this.onChange(false);}
        if(e.target.closest('[data-album-all]'))this.onBrowse(data.path??'');
        const photo=e.target.closest('[data-album-photo]');if(photo)void this.g.openImage(data.items[Number(photo.dataset.albumPhoto)]);
      };
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
      host.innerHTML=`<div class="nas-album-empty" role="alert"><p>${esc(e.message||'사진을 불러오지 못했어요.')}</p><button>다시 불러오기</button></div>`;
      host.querySelector('button').onclick=()=>{this.cache.clear();void this.paint();};
    }
  }
  async apply(key,path) {
    if(!ALBUM_KEYS.includes(key) || !this.g.connected)throw new Error('연결된 앨범을 확인해 주세요.');
    const origin=this.g.client.origin;
    const updated={...this.bindings,[origin]:{...this.bindings[origin],[key]:path}};
    const checked=validateAlbumBindings({kind:'album-folders',origins:updated});
    if(checked[origin]?.[key]!==path)throw new Error('폴더 경로를 확인해 주세요.');
    if(!await this.vault.save({kind:'album-folders',origins:checked}))throw new Error('사진 폴더 설정을 저장하지 못했어요.');
    if(!this.g.connected || this.g.client.origin!==origin)return;
    this.bindings=checked;this.cache.clear();this.pending.clear();
    if(this.dialog.open)this.dialog.close();
    this.notify(`${labels[key]} 사진 폴더를 연결했어요. 사진은 자동으로 표시돼요.`);this.onChange(true);
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
      this.dialog.innerHTML=`<button class="close" data-picker-close aria-label="닫기">×</button><span class="eyebrow">CONNECT ONCE, KEEP THE MOMENTS</span><h2>${labels[key]} 사진 폴더 연결</h2><p>이 기기에서 한 번만 선택하면, 이 폴더와 하위 폴더의 사진이 자동으로 표시돼요. 사진은 이동하지 않아요.</p><p class="nas-picker-path">${esc(path||'/photo')}</p><div class="nas-picker-nav"><button data-picker-up ${path?'':'disabled'}>상위 폴더</button><button data-picker-root>전체 폴더</button></div><div class="nas-picker-folders">${folders.map((f,i)=>`<button data-picker-folder="${i}"><span>▰</span> ${esc(f.name)}</button>`).join('')||'<p class="fine">현재 목록에 하위 폴더가 없어요.</p>'}</div>${listing.next!==null?'<button data-picker-more>폴더 목록 더 보기</button>':''}<p class="fine">국가·도시·아이·나이를 사진에서 추정해 분류하지 않아요.</p><button class="primary" data-picker-use>이 폴더 연결</button><p role="alert" class="nas-picker-error"></p>`;
      this.dialog.onclick=e=>{
        if(e.target.closest('[data-picker-close]'))this.dialog.close();
        if(e.target.closest('[data-picker-up]'))void this.pick(key,path.split('/').slice(0,-1).join('/'));
        if(e.target.closest('[data-picker-root]'))void this.pick(key,'');
        const folder=e.target.closest('[data-picker-folder]');if(folder)void this.pick(key,folders[Number(folder.dataset.pickerFolder)].path);
        if(e.target.closest('[data-picker-more]'))void this.pick(key,path,listing.next,folders);
        const use=e.target.closest('[data-picker-use]');if(use){use.disabled=true;void this.apply(key,path).catch(err=>{if(version===this.settingVersion){this.dialog.querySelector('[role=alert]').textContent=err.message;use.disabled=false;}});}
      };
    } catch(e) {if(version===this.settingVersion){this.dialog.innerHTML=`<button class="close" aria-label="닫기">×</button><p role="alert">${esc(e.message)}</p>`;this.dialog.querySelector('button').onclick=()=>this.dialog.close();}}
  }
  async paintCovers() {
    const version=this.version,origin=this.g.client.origin;
    await this.ready;
    const growthKey=['growth:함께','growth:다온','growth:라온'].find(k=>this.folder(k)!==undefined)||'growth:함께';
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
