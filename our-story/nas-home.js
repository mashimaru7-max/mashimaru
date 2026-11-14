import {ConnectionVault,indexedConnectionStore} from './nas-vault.mjs?v=20261113-shared1';
import {safeBase,safePath} from './nas-client.mjs?v=20261114-friendly1';
export class NasHome {
  constructor(gallery, notify, {vault,automatic=async()=>({items:[]})} = {}) {
    this.automatic=automatic;
    this.g=gallery; this.notify=notify; this.choice=null; this.version=0; this.url=null;
    this.vault=vault || new ConnectionVault({store:indexedConnectionStore(globalThis.indexedDB,'our-story-home-photo-v1')});
    this.ready=this.vault.load().then(c=>{
      if(c?.kind==='home-photo' && safeBase(c.origin)===c.origin && safePath(c.path) && typeof c.name==='string') this.choice=c;
    }).catch(()=>{});
  }
  async select(c) {
    safeBase(c.origin); safePath(c.path);
    const choice={kind:'home-photo',origin:c.origin,path:c.path,name:c.name};
    if(!await this.vault.save(choice)) throw new Error('대표 사진 선택을 저장하지 못했어요. 다시 시도해 주세요.');
    this.choice=choice; this.paint();
  }
  async clear() {
    try { await this.vault.clear(); this.choice=null; this.paint(); this.notify('홈 대표 사진 선택을 해제했어요.'); }
    catch(e) {this.notify(e.message);}
  }
  async paint() {
    const version=++this.version;
    if(this.url) URL.revokeObjectURL(this.url); this.url=null;
    const hero=document.querySelector('.hero'), image=hero?.querySelector('img');
    if(!hero || !image) return;
    image.hidden=this.g.connected;
    if(!this.g.connected)image.src='assets/lake.jpg';
    hero.querySelector('.photo-note').textContent=this.g.connected?'우리 사진을 자동으로 불러오는 중':'풍경 사진 · 디자인 예시';
    hero.querySelector('.nas-home-clear')?.remove();
    await this.ready;
    try { this.choice=await this.vault.load(); } catch(e) { if(version===this.version)this.notify(e.message);return; }
    if(version!==this.version || !this.g.connected) return;
    try {
      const manual=this.choice?.origin===this.g.client.origin;
      const automatic=manual?null:await this.automatic();
      const choice=manual?this.choice:automatic.items[0];
      if(!choice || version!==this.version || !this.g.connected){if(version===this.version)hero.querySelector('.photo-note').textContent=automatic?.indexing?'가족 공통 사진 목록을 준비하는 중이에요':'표시할 사진이 없어요 · 홈 사진 폴더를 연결해 주세요';return;}
      const blob=await (this.g.features.thumbnails ? this.g.client.thumbnail(choice.path) : this.g.client.image(choice.path));
      if(version!==this.version || !hero.isConnected || !this.g.connected) return;
      this.url=URL.createObjectURL(blob); image.src=this.url; image.hidden=false; image.alt=manual?'직접 고른 우리 가족의 대표 사진':'NAS에서 자동으로 고른 우리 사진';
      hero.querySelector('.photo-note').textContent=manual?'직접 고른 NAS 대표 사진':'NAS에서 자동으로 불러온 사진';
      if(manual){const b=document.createElement('button'); b.className='nas-home-clear'; b.textContent='자동 대표 사진 사용'; b.onclick=()=>void this.clear(); (hero.querySelector('.hero-copy')||hero).append(b);}
    } catch { if(version===this.version) this.notify('홈 사진을 불러오지 못했어요. 사진 폴더와 NAS 연결을 확인해 주세요.'); }
  }
  release() { this.version++; if(this.url) URL.revokeObjectURL(this.url); this.url=null; }
}
