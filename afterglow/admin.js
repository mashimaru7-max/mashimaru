import {validateRounds} from './rounds.js?v=10';
import {ArtStore} from './admin-storage.js?v=10';
export const artStore=new ArtStore();
export function setupAdmin({onOpen}){
 const $=s=>document.querySelector(s),dialog=$('#admin-dialog');let stage=1,rounds=[],session=0,selection=0;
 const status=text=>{$('#admin-status').textContent=text;};
 function fields(){for(const key of ['target','timeLimit','enemyCount','enemySpeed'])$('#round-'+key).value=rounds[stage-1][key];}
 function readFields(){const changed=Object.fromEntries(['target','timeLimit','enemyCount','enemySpeed'].map(key=>[key,Number($('#round-'+key).value)]));const next=structuredClone(rounds);next[stage-1]=changed;rounds=validateRounds(next);}
 async function showStage(){const token=++selection;fields();const images=await artStore.stage(stage);if(token!==selection)return;for(const key of ['base','bonus']){$('#preview-'+key).src=images[key]??(key==='base'?'pool.jpg':'bonus.jpg');$('#label-'+key).textContent=images[key]?'깃 그림':'기본 그림';}}
 $('#admin-open').addEventListener('click',()=>{session++;artStore.lock();onOpen();$('#admin-editor').hidden=true;$('#admin-auth').hidden=false;$('#admin-password').value='';status('');dialog.showModal();$('#admin-password').focus();});
 $('#admin-close').addEventListener('click',()=>dialog.close());dialog.addEventListener('close',()=>{session++;selection++;artStore.lock();$('#admin-password').value='';});
 $('#admin-auth').addEventListener('submit',async event=>{event.preventDefault();const token=session;$('#admin-submit').disabled=true;try{await artStore.login($('#admin-password').value);rounds=await artStore.rounds(true);if(token!==session||!dialog.open){artStore.lock();return;}stage=Math.min(stage,rounds.length);$('#admin-password').value='';$('#admin-stage').replaceChildren(...rounds.map((_,i)=>{const option=document.createElement('option');option.value=i+1;option.textContent=(i+1)+'라운드';return option;}));$('#admin-stage').value=stage;await showStage();$('#admin-auth').hidden=true;$('#admin-editor').hidden=false;status('설정을 바꾼 뒤 다운로드해서 깃에 올려줘.');}catch(error){status(error.message);}finally{$('#admin-submit').disabled=false;}});
 $('#admin-stage').addEventListener('change',async()=>{try{readFields();stage=Number($('#admin-stage').value);await showStage();}catch(error){$('#admin-stage').value=stage;status(error.message);}});
 $('#save-art').addEventListener('click',()=>{try{if(!artStore.unlocked)throw new Error('먼저 로그인해줘.');readFields();const url=URL.createObjectURL(new Blob([JSON.stringify(rounds,null,2)+'\n'],{type:'application/json'})),link=document.createElement('a');link.href=url;link.download='round-settings.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),10000);status('다운로드한 round-settings.json을 afterglow 폴더에 덮어 올려줘.');}catch(error){status(error.message);}});
}
