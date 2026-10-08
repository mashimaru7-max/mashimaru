import {defaultRounds,validateRounds,validateRound} from './rounds.js';
export function parseArtFiles(files){
 if(!Array.isArray(files))throw new Error('그림 목록이 올바르지 않아.');
 const art=new Map();
 for(const path of files){if(typeof path!=='string')continue;const match=/^images\/(0?[1-9]|1\d|20)라운드(?:[-_ ]?(보너스|bonus))?\.(jpg|jpeg|png|webp|gif|avif)$/i.exec(path.normalize('NFC'));if(!match)continue;const stage=Number(match[1]),key=match[2]?'bonus':'base',entry=art.get(stage)??{};if(entry[key])throw new Error(stage+'라운드 '+(key==='base'?'기본':'보너스')+' 그림이 중복이야. 파일 하나만 남겨줘.');entry[key]=path;art.set(stage,entry);}
 return art;
}
export function roundNumbers(art){return [...art.entries()].filter(([,images])=>images.base).map(([number])=>number).sort((a,b)=>a-b);}
export function catalogRounds(art,settings){settings=validateRounds(settings);const count=roundNumbers(art).length;if(!count)throw new Error('images 폴더에 기본 라운드 그림을 하나 이상 넣어줘.');return Array.from({length:count},(_,i)=>validateRound(settings[i]??{target:90,timeLimit:0,enemyCount:Math.min(12,2+Math.floor(i/2)),enemySpeed:1}));}
export class GitArtStore{
 constructor(){this.data=null;this.loading=null;}
 async load(force=false){if(force)this.data=null;if(this.data)return this.data;if(this.loading)return this.loading;
 this.loading=(async()=>{const responses=await Promise.all(['art-files.json','round-settings.json'].map(path=>fetch(path+'?v='+Date.now(),{cache:'no-store',signal:AbortSignal.timeout(15000)})));if(responses.some(r=>!r.ok))throw new Error('깃의 그림·설정 파일을 불러오지 못했어.');let files;const raw=await responses[0].text();if(raw.includes('{%')&&['localhost','127.0.0.1'].includes(globalThis.location?.hostname)){const local=await fetch('art-files.local.json',{cache:'no-store'});files=await local.json();}else files=JSON.parse(raw);const art=parseArtFiles(files),rounds=catalogRounds(art,await responses[1].json());this.data={art,rounds,order:roundNumbers(art),revision:Date.now()};return this.data;})();try{return await this.loading;}finally{this.loading=null;}
 }
 async rounds(force=false){return structuredClone((await this.load(force)).rounds);}
 async stage(stage){const data=await this.load();if(!Number.isInteger(stage)||stage<1||stage>data.rounds.length)throw new Error('라운드가 올바르지 않아.');const images=data.art.get(data.order[stage-1])??{},result={};for(const key of ['base','bonus'])if(images[key])result[key]=encodeURI(images[key])+'?v='+data.revision;return result;}
}
