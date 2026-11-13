import {ConnectionVault,indexedConnectionStore} from './nas-vault.mjs?v=20261113-media2';
import {safeBase,safePath} from './nas-client.mjs?v=20261113-media2';
export class NasHome {
  constructor(gallery, notify, {vault} = {}) {
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
    image.src='assets/lake.jpg';
    hero.querySelector('.photo-note').textContent='풍경 사진 · 디자인 예시';
    hero.querySelector('.nas-home-clear')?.remove();
    await this.ready;
    if(version!==this.version || !this.g.connected || !this.choice || this.choice.origin!==this.g.client.origin) return;
    const choice=this.choice;
    try {
      const blob=await (this.g.features.thumbnails ? this.g.client.thumbnail(choice.path) : this.g.client.image(choice.path));
      if(version!==this.version || !hero.isConnected || !this.g.connected) return;
      this.url=URL.createObjectURL(blob); image.src=this.url; image.alt='직접 고른 우리 가족의 대표 사진';
      hero.querySelector('.photo-note').textContent='NAS에서 고른 우리 사진 · 이 기기에만 적용';
      const b=document.createElement('button'); b.className='nas-home-clear'; b.textContent='대표 사진 해제'; b.onclick=()=>void this.clear(); hero.append(b);
    } catch { if(version===this.version) this.notify('홈 대표 사진을 불러오지 못했어요. NAS 갤러리에서 다시 골라 주세요.'); }
  }
  release() { this.version++; if(this.url) URL.revokeObjectURL(this.url); this.url=null; }
}
