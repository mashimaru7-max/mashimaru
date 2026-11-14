import {ConnectionVault,indexedConnectionStore} from './nas-vault.mjs?v=20261113-shared1';
import {safePath} from './nas-client.mjs?v=20261114-travel1';
import {ALBUM_KEYS,validateAlbumBindings} from './nas-album-model.mjs?v=20261114-travel1';

export function validateSettings(data,origin) {
  if(!data || !Number.isSafeInteger(data.revision) || data.revision<0 || !data.albums || Array.isArray(data.albums) || typeof data.albums!=='object' || Object.keys(data.albums).some(k=>!ALBUM_KEYS.includes(k)))throw new Error('가족 설정 응답을 확인할 수 없어요.');
  const albums=validateAlbumBindings({kind:'album-folders',origins:{[origin]:data.albums}})[origin];
  if(!albums || Object.keys(albums).length!==Object.keys(data.albums).length || Object.entries(data.albums).some(([k,v])=>typeof v==='string'?albums[k]!==v:!v || !albums[k] || ['type','text','mode','root'].some(f=>albums[k][f]!==v[f])))throw new Error('가족 앨범 설정을 확인할 수 없어요.');
  const home=data.home;
  if(home!==null && (!home || typeof home.name!=='string' || home.name.length>1024 || !/\.(jpe?g|png|webp|gif|bmp|heic|heif|avif)$/i.test(safePath(home.path))))throw new Error('가족 대표 사진 설정을 확인할 수 없어요.');
  return {revision:data.revision,albums,home:home===null?null:{path:home.path,name:home.name}};
}
const updateMessage='가족 공통 저장을 쓰려면 NAS 서버를 업데이트해야 해요. 설정은 아직 가족에게 공유되지 않았어요.';
export class FamilySettings {
  constructor(gallery,{notify=()=>{},onChange=()=>{},albumVault,homeVault}={}) {
    this.g=gallery;this.notify=notify;this.onChange=onChange;this.origin='';this.data=null;this.pending=null;this.unsupported=false;
    this.localAlbums=albumVault||new ConnectionVault({store:indexedConnectionStore(globalThis.indexedDB,'our-story-album-folders-v1')});
    this.localHome=homeVault||new ConnectionVault({store:indexedConnectionStore(globalThis.indexedDB,'our-story-home-photo-v1')});
    this.albumVault={load:()=>this.albumLoad(),save:d=>this.albumSave(d),saveKey:(key,value)=>this.update({albums:{[key]:value}})};
    this.homeVault={load:()=>this.homeLoad(),save:d=>this.homeSave(d),clear:()=>this.homeSave(null)};
  }
  sync() {
    const origin=this.g.connected?this.g.client.origin:'';
    if(origin===this.origin)return;
    this.origin=origin;this.data=null;this.pending=null;this.unsupported=false;
    if(origin)void this.ensure().then(()=>{if(this.origin===origin)this.onChange();}).catch(e=>this.notify(e.message));
  }
  async ensure({refresh=false}={}) {
    const origin=this.g.connected?this.g.client.origin:'';
    if(!origin)return null;
    if(this.origin!==origin){this.origin=origin;this.data=null;this.pending=null;this.unsupported=false;}
    if(this.unsupported)return null;
    if(this.pending)return this.pending;
    if(this.data && !refresh)return this.data;
    const current=()=>this.g.connected && this.g.client.origin===origin && this.origin===origin;
    const work=(async()=>{
      let data;
      try {data=validateSettings(await this.g.client.sharedSettings(),origin);}
      catch(e) {
        if(['HTTP_404','HTTP_405'].includes(e.code) && current()){this.unsupported=true;this.notify(updateMessage);return null;}
        throw e;
      }
      if(!current())throw new Error('NAS 연결이 변경됐어요. 다시 시도해 주세요.');
      // Migrate only into a never-configured NAS. A new device must never replace family settings.
      if(data.revision===0) {
        const [a,h]=await Promise.all([this.localAlbums.load().catch(()=>null),this.localHome.load().catch(()=>null)]);
        if(!current())throw new Error('NAS 연결이 변경됐어요.');
        const albums=validateAlbumBindings(a)[origin]||{};
        const home=h?.kind==='home-photo' && h.origin===origin?{path:h.path,name:h.name}:null;
        if(Object.keys(albums).length || home) {
          try {data=validateSettings(await this.g.client.sharedSettings({revision:0,albums,home}),origin);}
          catch(e) {if(e.code!=='HTTP_409')throw e;data=validateSettings(await this.g.client.sharedSettings(),origin);}
        }
      }
      if(!current())throw new Error('NAS 연결이 변경됐어요.');
      this.data=data;return data;
    })().finally(()=>{if(this.pending===work)this.pending=null;});
    this.pending=work;return work;
  }
  async update(patch) {
    const origin=this.g.client.origin;
    for(let attempt=0;attempt<3;attempt++) {
      const data=await this.ensure({refresh:true});
      if(!data)throw new Error(updateMessage);
      if(!this.g.connected || this.origin!==origin || this.g.client.origin!==origin)throw new Error('NAS 연결이 변경됐어요.');
      try {
        const next=validateSettings(await this.g.client.sharedSettings({...patch,revision:data.revision}),origin);
        if(this.origin!==origin || !this.g.connected || this.g.client.origin!==origin)throw new Error('NAS 연결이 변경됐어요.');
        this.data=next;return true;
      } catch(e) {if(e.code!=='HTTP_409' || attempt===2)throw e;}
    }
  }
  async albumLoad() {
    const d=await this.ensure();
    return d?{kind:'album-folders',origins:{[this.origin]:d.albums}}:this.localAlbums.load();
  }
  async albumSave(d) {
    const origin=this.g.client.origin,values=validateAlbumBindings(d)[origin]||{};
    const current=await this.ensure();
    if(!current)throw new Error(updateMessage);
    // Send only changed keys, preserving edits made on other devices.
    const albums=Object.fromEntries(Object.entries(values).filter(([k,v])=>JSON.stringify(v)!==JSON.stringify(current.albums[k])));
    return this.update({albums});
  }
  async homeLoad() {
    const d=await this.ensure();
    return d?(d.home?{kind:'home-photo',origin:this.origin,...d.home}:null):this.localHome.load();
  }
  async homeSave(c) {return this.update({home:c?{path:c.path,name:c.name}:null});}
  async refresh() {
    const old=this.data,origin=this.origin;
    await this.ensure({refresh:true});
    if(this.origin===origin && old?.revision!==this.data?.revision)this.onChange();
  }
}
