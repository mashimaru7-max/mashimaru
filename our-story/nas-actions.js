import {trashSelection} from './nas-selection.mjs?v=20261114-thumb1';
const esc = s => String(s ?? "").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c]);
export class NasActions {
  constructor(gallery, onHomePhoto) {
    this.g = gallery;
    this.onHomePhoto = onHomePhoto;
    this.generation = 0;this.busy=false;
    this.dialog = document.createElement("dialog");
    this.dialog.className = "nas-dialog nas-management";
    this.dialog.setAttribute("aria-label", "NAS 사진 관리");
    document.body.append(this.dialog);
    this.dialog.addEventListener("close", () => {this.cancel();this.dialog.replaceChildren();});
    this.dialog.addEventListener("cancel",e=>{if(this.busy){e.preventDefault();this.message("파일 정리 중이에요. 완료될 때까지 기다려 주세요.");}});
    this.dialog.addEventListener("click", e => {
      if (e.target.closest("[data-manager-close]")){if(this.busy)this.message("파일 정리 중이에요. 완료될 때까지 기다려 주세요.");else this.dialog.close();}
    });
  }
  cancel() { this.generation++; this.g.client.cancelTransfers(); }
  show(title, body) {
    this.cancel();
    this.dialog.innerHTML = `<button class="close" data-manager-close aria-label="닫기">×</button><span class="eyebrow">OUR PRIVATE PHOTO SHELF</span><h2>${title}</h2>${body}<p class="nas-operation-status" role="status" aria-live="polite"></p>`;
    if (!this.dialog.open) this.dialog.showModal();
    return this.generation;
  }
  message(text) { const el=this.dialog.querySelector('[role="status"]'); if(el) el.textContent=text; }
  unavailable() {
    this.show("NAS 관리 기능 준비 중", `<p>현재 사진 관리 기능이 활성화되지 않았어요. 업로드와 휴지통 기능은 새 API의 사진 쓰기 설정과 NAS 폴더 권한을 활성화한 뒤 사용할 수 있어요.</p><p>기존 서버와 사진은 그대로 유지돼요. 설치 전에는 웹페이지에서 파일을 변경하지 않아요.</p><a href="downloads/our-story-nas-service.zip" download>관리 API 설치 파일 받기</a>`);
  }
  bindViewer(item) {
    this.g.dialog.querySelectorAll('[data-photo-action]').forEach(button => {
      button.onclick = async () => {
        if (button.dataset.photoAction === "trash") { this.trash(item); return; }
        button.disabled = true;
        const version = this.generation;
        try {
          if (button.dataset.photoAction === "home") {
            await this.onHomePhoto({origin:this.g.client.origin,path:item.path,name:item.name});
            this.g.notify("가족 공통 홈 대표 사진으로 저장했어요.");
          } else if(item.video) {
            await this.g.client.downloadVideo(item);this.g.notify('영상 다운로드를 요청했어요. 브라우저 다운로드 목록을 확인해 주세요.');
          } else {
            const blob = await this.g.client.download(item.path, !!this.g.features.download);
            if(version !== this.generation || !this.g.connected) return;
            const url=URL.createObjectURL(blob), a=document.createElement("a");
            a.href=url; a.download=item.name; document.body.append(a); a.click(); a.remove();
            setTimeout(()=>URL.revokeObjectURL(url),60000);
            this.g.notify("다운로드를 요청했어요. 브라우저 다운로드 목록을 확인해 주세요.");
          }
        } catch(e) { this.g.notify(e.message); }
        finally { button.disabled=false; }
      };
    });
  }
  mkdir() {
    if(!this.g.features.fileManagement){this.unavailable();return;}
    const parent=this.g.path,version=this.show('새 폴더 만들기',`<p>위치: ${esc(parent||'/photo')}</p><form class="form-grid"><label class="full">폴더 이름<input name="name" required maxlength="80" autocomplete="off" placeholder="예: 2026년 가족여행"></label><button class="primary full" type="submit">폴더 만들기</button></form>`);
    const form=this.dialog.querySelector('form');form.onsubmit=async e=>{e.preventDefault();if(this.busy)return;const name=form.elements.name.value.trim();if(!name){this.message('폴더 이름을 입력해 주세요.');return;}this.busy=true;form.elements.name.disabled=true;const button=form.querySelector('button');button.disabled=true;this.message('폴더를 만드는 중이에요…');
      try{await this.g.client.fileOperation({action:'mkdir',parent,name});if(version!==this.generation||!this.g.connected)return;this.busy=false;this.dialog.close();this.g.notify('새 폴더를 만들었어요.');void this.g.load(parent);}
      catch(error){if(version===this.generation){this.message(error.message);button.disabled=false;form.elements.name.disabled=false;}}
      finally{this.busy=false;}
    };
  }
  manage() {
    if(!this.g.features.fileManagement){this.unavailable();return;}
    this.show('사진·폴더 정리',`<p>현재 위치: ${esc(this.g.path||'/photo')}</p><p class="fine">정리할 항목을 선택해 주세요. 목록에 없으면 보관함에서 더 불러온 뒤 선택해요.</p><div class="nas-file-manager-items">${this.g.items.map((item,i)=>`<button data-manage-item="${i}">${item.dir?'폴더':item.video?'영상':'사진'} · ${esc(item.name)}</button>`).join('')||'<p>정리할 항목이 없어요.</p>'}</div>`);
    this.dialog.querySelector('.nas-file-manager-items').onclick=e=>{const b=e.target.closest('[data-manage-item]');if(b)void this.manageItem(this.g.items[Number(b.dataset.manageItem)]);};
  }
  manageItem(item) {
    if(!this.g.features.fileManagement||!item?.revision){this.unavailable();return;}
    const parent=item.path.split('/').slice(0,-1).join('/');let destination=parent,signature='',operationId='';
    const version=this.show(item.dir?'폴더 이름·위치 정리':'사진 이름·위치 정리',`<p>현재 항목: <strong>${esc(item.path)}</strong></p><form class="form-grid"><label class="full">이름<input name="name" value="${esc(item.name)}" required maxlength="255" autocomplete="off"></label><p class="fine full">사진의 확장자는 유지해 주세요. 이름만 바꾸려면 이동 위치를 그대로 두면 돼요.</p><div class="full"><p>이동 위치: <strong data-selected-destination>${esc(parent||'/photo')}</strong></p><details class="nas-destination-picker"><summary>다른 폴더 선택</summary><div data-destination-browser></div></details></div><p class="fine full">웹의 고정 앨범·대표사진·성장 기록 연결도 함께 갱신해요. 이름 규칙에 따른 앨범 포함 여부는 달라질 수 있어요. Synology Photos는 다시 색인할 수 있으니 NAS의 다른 앱에서 동시에 정리하지 마세요.</p><button class="primary full" type="submit">이름·위치 변경</button></form>`);
    const form=this.dialog.querySelector('form'),browser=this.dialog.querySelector('[data-destination-browser]');let request=0;
    const browse=async(path,offset=0)=>{
      const sequence=++request;browser.innerHTML='<p role="status">폴더를 불러오는 중이에요…</p>';
      try{const data=await this.g.client.list(path,offset);if(version!==this.generation||sequence!==request||!this.dialog.open)return;
        const invalid=item.dir&&(path===item.path||path.startsWith(item.path+'/'));
        browser.innerHTML=`<div class="nas-destination-nav"><button type="button" data-dest-up ${path?'':'disabled'}>상위 폴더</button><button type="button" data-dest-root>전체 폴더</button><span>${esc(path||'/photo')}</span></div><div class="nas-destination-folders">${data.items.filter(x=>x.dir).map(x=>`<button type="button" data-dest-folder="${esc(x.path)}" ${item.dir&&(x.path===item.path||x.path.startsWith(item.path+'/'))?'disabled':''}>${esc(x.name)}</button>`).join('')||'<p>이 목록에 하위 폴더가 없어요.</p>'}</div><div class="nas-destination-nav">${offset?'<button type="button" data-dest-prev>이전 목록</button>':''}${data.next!==null&&data.items.every(x=>x.dir)?'<button type="button" data-dest-next>다음 목록</button>':''}<button type="button" class="primary" data-dest-select ${invalid?'disabled':''}>이 폴더를 이동 위치로 선택</button></div>`;
        browser.onclick=e=>{const b=e.target.closest('button');if(!b||this.busy)return;if(b.hasAttribute('data-dest-up'))void browse(path.split('/').slice(0,-1).join('/'));if(b.hasAttribute('data-dest-root'))void browse('');if(b.dataset.destFolder!==undefined)void browse(b.dataset.destFolder);if(b.hasAttribute('data-dest-prev'))void browse(path,Math.max(0,offset-100));if(b.hasAttribute('data-dest-next'))void browse(path,data.next);if(b.hasAttribute('data-dest-select')){destination=path;this.dialog.querySelector('[data-selected-destination]').textContent=path||'/photo';this.dialog.querySelector('details').open=false;}};
      }catch(error){if(version===this.generation&&sequence===request)browser.innerHTML=`<p role="alert">${esc(error.message)}</p>`;}
    };
    this.dialog.querySelector('details').ontoggle=e=>{if(e.currentTarget.open&&!browser.children.length)void browse(parent);};
    form.onsubmit=async e=>{e.preventDefault();if(this.busy)return;const name=form.elements.name.value.trim();if(!name)return;
      const next=destination?destination+'/'+name:name;if(next===item.path){this.message('이름이나 이동 위치를 바꿔 주세요.');return;}
      if(item.dir&&next.startsWith(item.path+'/')){this.message('자기 하위 폴더로는 이동할 수 없어요.');return;}
      if(!window.confirm(`${item.path} 항목을 ${next} 위치로 변경할까요? 같은 이름은 덮어쓰지 않아요.`))return;
      const key=JSON.stringify([item.path,item.revision,destination,name]);if(key!==signature){signature=key;operationId=crypto.randomUUID().replaceAll('-','');}
      this.busy=true;const controls=[...form.querySelectorAll('input,button')].map(el=>[el,el.disabled]);controls.forEach(([el])=>{el.disabled=true;});this.message('파일과 연결된 기록을 정리하는 중이에요…');
      try{const result=await this.g.client.fileOperation({action:'move',path:item.path,revision:item.revision,destination,name,operationId});if(version!==this.generation||!this.g.connected)return;this.busy=false;if(this.g.dialog.open)this.g.dialog.close();this.dialog.close();this.g.notify(`이름·위치를 변경했어요.${result.linkedRecords?' 연결된 성장 기록 '+result.linkedRecords+'개도 갱신했어요.':''}`);void this.g.load(destination);}
      catch(error){if(version===this.generation){this.message(error.message+' 응답이 끊긴 경우 이미 완료됐을 수 있어요. 같은 정보로 다시 확인하거나 보관함의 위치를 확인해 주세요.');controls.forEach(([el,disabled])=>{el.disabled=disabled;});}}
      finally{this.busy=false;}
    };
  }
  upload() {
    if (!this.g.features.upload) { this.unavailable(); return; }
    const folder=this.g.path, version=this.show("우리 사진과 영상 더하기", `<p>저장 위치: <strong>${esc(folder || "/photo")}</strong></p><label class="nas-file-label">사진·영상 선택<input type="file" accept="image/jpeg,image/png,image/webp,image/gif,image/bmp,image/heic,image/heif,image/avif${this.g.features.videoUpload?',video/mp4,video/quicktime,video/webm,.m4v':''}" multiple></label><p class="fine">사진 최대 ${Math.floor(this.g.features.maxUpload/1048576)}MB${this.g.features.videoUpload?' · 영상 최대 4GB (MP4·M4V·MOV·WebM)':''} · 같은 이름은 덮어쓰지 않아요.<br>닫으면 전송을 멈춰요. 영상은 같은 계정 세션에서 같은 폴더·파일을 다시 선택하면 이어 올려요. 완료된 파일은 유지돼요.</p>`);
    this.dialog.querySelector('input').onchange=async e=>{
      const files=[...e.target.files]; e.target.disabled=true;
      let succeeded=0; const failed=[];
      for(let i=0;i<files.length;i++) {
        if(version!==this.generation || !this.g.connected) break;
        this.message(`${i+1}/${files.length} 전송 중 · ${files[i].name}`);
        try {
          if(/\.(mp4|m4v|mov|webm)$/i.test(files[i].name)){
            if(!this.g.features.videoUpload)throw new Error('영상 업로드는 NAS 업데이트 후 사용할 수 있어요.');
            await this.g.client.uploadVideo(folder,files[i],{active:()=>version===this.generation&&this.g.connected,progress:(sent,total,checking)=>{if(version===this.generation)this.message(`${i+1}/${files.length} · ${files[i].name} · ${checking?'이어 올리기 확인':'전송'} ${Math.floor(sent/total*100)}%`);}});
          }else{
            if(files[i].size>this.g.features.maxUpload)throw new Error('사진 업로드 크기 초과');
            await this.g.client.upload(folder,files[i]);
          }
          succeeded++;
        } catch(err) { if(version!==this.generation) break; failed.push(`${files[i].name}: ${err.message}`); }
      }
      if(version!==this.generation) { if(this.g.connected) void this.g.load(folder); return; }
      this.message(`완료 ${succeeded}개 / 실패·확인 필요 ${failed.length}개${failed.length ? " · "+failed.join(" / ") : ""}`);
      if(this.g.connected) void this.g.load(folder);
    };
  }
  trashMany(items){
    if(!items.length)return;
    if(!this.g.features.trash||items.some(item=>item.dir&&!this.g.features.folderTrash)){this.unavailable();return;}
    const folders=items.filter(item=>item.dir).length,photos=items.length-folders;
    const version=this.show('선택한 항목을 휴지통으로 옮길까요?',`<p><strong>사진·영상 ${photos}개 · 폴더 ${folders}개</strong></p>${folders?'<p>선택한 폴더는 하위 사진·영상 등 모든 내용을 함께 보관해요. 연결한 앨범과 성장 기록의 사진도 복원 전까지 보이지 않아요.</p>':''}<p>영구 삭제하지 않으며, 같은 이름이 생기면 덮어쓰지 않고 복원을 멈춰요.</p><div class="nas-batch-items">${items.slice(0,100).map(item=>`<p>${item.dir?'폴더':item.video?'영상':'사진'} · ${esc(item.name)}</p>`).join('')}${items.length>100?`<p>외 ${items.length-100}개</p>`:''}</div><button class="nas-danger" data-batch-confirm>선택 항목 휴지통으로 이동</button> <button data-batch-stop disabled>남은 작업 중지</button>`);
    const start=this.dialog.querySelector('[data-batch-confirm]'),stop=this.dialog.querySelector('[data-batch-stop]');let stopping=false;
    stop.onclick=()=>{stopping=true;stop.disabled=true;this.message('현재 항목을 마무리한 뒤 남은 작업을 중지해요. 완료된 항목은 휴지통에 보관돼요.');};
    start.onclick=async()=>{
      if(this.busy)return;this.busy=true;start.disabled=true;stop.disabled=false;let result;
      try{result=await trashSelection(this.g.client,items,{active:()=>version===this.generation&&this.g.connected,stop:()=>stopping,onProgress:p=>this.message(`${p.attempted}/${p.total} 처리 중 · ${p.item.name}`),onSuccess:item=>this.g.selection.delete(item.path)});}
      finally{this.busy=false;}
      if(version!==this.generation)return;
      stop.disabled=true;this.message(`휴지통 이동 ${result.completed}개 · 확인 필요 ${result.failed.length}개 · 미처리 ${result.unprocessed}개${result.failed.length?'\n'+result.failed.slice(0,8).map(f=>f.item.name+': '+f.message).join('\n'):''}`);
      if(this.g.connected&&this.g.host)void this.g.load(this.g.path);
    };
  }
  trash(item) {
    if(!this.g.features.trash || !item.revision || item.dir&&!this.g.features.folderTrash) { this.unavailable(); return; }
    const version=this.show(item.video?"영상을 휴지통으로 옮길까요?":"사진을 휴지통으로 옮길까요?", `<p><strong>${esc(item.name)}</strong></p><p>원래 폴더에서 숨겨지고 NAS 휴지통에 보관돼요. 휴지통에서 복원할 수 있어요.</p><button class="nas-danger" data-confirm-trash>휴지통으로 이동</button> <button data-manager-close>취소</button>`);
    this.dialog.querySelector('[data-confirm-trash]').onclick=async e=>{
      e.target.disabled=true;
      try {
        await this.g.client.trash(item);
        if(version!==this.generation) return;
        if(this.g.dialog.open) this.g.dialog.close();
        this.dialog.close(); this.g.notify("휴지통으로 옮겼어요. 휴지통에서 복원할 수 있어요.");
        await this.g.load(this.g.path);
      } catch(err) { if(version===this.generation) { this.message(err.message); e.target.disabled=false; } }
    };
  }
  async trashList() {
    if(!this.g.features.trash) { this.unavailable(); return; }
    const version=this.show('잠시 보관한 사진과 폴더', '<p>자동으로 영구삭제하지 않아요. 복원하거나 삭제할 항목을 선택해 주세요.</p><div class="nas-selection-bar" data-trash-selection hidden><button data-trash-all type="button">전체 선택</button><button data-trash-clear type="button">선택 해제</button><strong data-trash-count>0개 선택</strong><small data-trash-limit></small></div><div class="nas-trash-items">불러오는 중…</div><button class="nas-danger" data-purge-start disabled hidden>선택 항목 영구삭제</button>');
    try {
      const data=await this.g.client.trashList();
      if(version!==this.generation || !this.dialog.open) return;
      if(!Array.isArray(data.items) || data.items.length>1000) throw new Error('휴지통 목록을 확인할 수 없어요.');
      const list=this.dialog.querySelector('.nas-trash-items'),purge=this.dialog.querySelector('[data-purge-start]'),selected=new Map();
      const enabled=this.g.features.permanentTrash===true;purge.hidden=!enabled;
      const toolbar=this.dialog.querySelector('[data-trash-selection]');toolbar.hidden=!enabled||!data.items.length;
      const all=toolbar.querySelector('[data-trash-all]'),clear=toolbar.querySelector('[data-trash-clear]');
      if(data.items.length>50){all.textContent='앞의 50개 선택';toolbar.querySelector('[data-trash-limit]').textContent='현재 서버는 한 번에 최대 50개까지 영구삭제해요. 처리 후 남은 항목도 한 번에 선택할 수 있어요.';}
      const sync=()=>{list.querySelectorAll('[data-trash-index]').forEach(input=>{input.checked=selected.has(data.items[Number(input.dataset.trashIndex)].id);});purge.disabled=this.busy||!selected.size;purge.textContent=`선택 ${selected.size}개 영구삭제`;toolbar.querySelector('[data-trash-count]').textContent=`${selected.size}개 선택`;clear.disabled=this.busy||!selected.size;};
      all.onclick=()=>{if(this.busy)return;selected.clear();data.items.slice(0,50).forEach(item=>selected.set(item.id,item));sync();};
      clear.onclick=()=>{if(this.busy)return;selected.clear();sync();};
      list.innerHTML=data.items.length ? data.items.map((i,index)=>`<div class="nas-trash-row">${enabled?`<input type="checkbox" data-trash-index="${index}" aria-label="${esc(i.path)} 선택">`:''}<span>${i.kind==='folder'?'폴더 · ':/\.(mp4|m4v|mov|webm)$/i.test(i.path)?'영상 · ':'사진 · '}${esc(i.path)}${i.permanentPartial?'<small>영구삭제 중단 · 일부 파일이 삭제됐을 수 있어요.</small>':''}</span><button data-restore-id="${/^[a-f0-9]{32}$/.test(i.id)?i.id:''}">복원</button></div>`).join('') : '<p>휴지통이 비어 있어요.</p>';
      list.onchange=e=>{const input=e.target.closest('[data-trash-index]');if(!input)return;const item=data.items[Number(input.dataset.trashIndex)];if(input.checked&&selected.size>=50){input.checked=false;this.message('한 번에 최대 50개 항목을 선택해 주세요.');return;}if(this.busy){sync();return;}if(input.checked)selected.set(item.id,item);else selected.delete(item.id);sync();};
      sync();
      purge.onclick=()=>{if(!this.busy&&selected.size)this.permanentDelete([...selected.values()]);};
      list.onclick=async e=>{
        const b=e.target.closest('[data-restore-id]'); if(!b || !b.dataset.restoreId || this.busy) return;
        this.busy=true;b.disabled=true;purge.disabled=true;
        try { await this.g.client.restoreTrash(b.dataset.restoreId); if(version!==this.generation)return;this.busy=false;void this.g.load(this.g.path);void this.trashList(); }
        catch(err) {if(version===this.generation){this.message(err.message);b.disabled=false;purge.disabled=!selected.size;}}
        finally{this.busy=false;}
      };
    } catch(err) { if(version===this.generation) this.message(err.message); }
  }
  permanentDelete(items) {
    const version=this.show('영구삭제 전 비밀번호 확인',`<p>선택한 ${items.length}개 항목의 NAS 원본을 삭제해요. 폴더는 하위 사진·영상·파일을 모두 포함하며 웹에서 복원할 수 없어요.</p><ul class="nas-purge-list">${items.map(i=>`<li>${esc(i.path)}</li>`).join('')}</ul><form class="form-grid"><label class="full">가족 공용 비밀번호<input name="password" type="password" required autocomplete="current-password" maxlength="128"></label><button class="primary full" type="submit">삭제할 내용 확인</button></form>`);
    const form=this.dialog.querySelector('form');form.onsubmit=async e=>{
      e.preventDefault();if(this.busy)return;let password=form.elements.password.value;form.elements.password.value='';this.busy=true;form.querySelector('button').disabled=true;this.message('비밀번호와 삭제할 파일을 확인하고 있어요…');
      try{const prepared=await this.g.client.purgePrepare(items,password);if(version!==this.generation||!this.g.connected)return;this.busy=false;this.confirmPermanent(prepared);}
      catch(error){if(version===this.generation){this.message(error.message);form.querySelector('button').disabled=false;}}
      finally{password='';this.busy=false;}
    };
  }
  confirmPermanent(prepared) {
    const version=this.show('마지막으로 확인해 주세요',`<p>아래 항목을 NAS 휴지통에서 영구삭제해요. 백업·스냅샷은 별도로 남을 수 있어요.</p><ul class="nas-purge-list">${prepared.items.map(i=>`<li><strong>${esc(i.path)}</strong><small>파일 ${Number(i.counts.files)}개 · 폴더 ${Number(i.counts.folders)}개 · 바로가기 ${Number(i.counts.links)}개</small></li>`).join('')}</ul><label class="nas-purge-consent"><input type="checkbox" data-purge-consent>하위 파일을 포함해 삭제하며 웹에서 복원할 수 없음을 확인했어요.</label><button class="nas-danger" data-purge-confirm disabled>영구삭제 실행</button>`);
    const button=this.dialog.querySelector('[data-purge-confirm]');this.dialog.querySelector('[data-purge-consent]').onchange=e=>{button.disabled=!e.target.checked;};
    button.onclick=async()=>{
      if(this.busy)return;this.busy=true;button.disabled=true;this.dialog.querySelector('[data-purge-consent]').disabled=true;this.message('영구삭제 중이에요. 완료될 때까지 기다려 주세요.');
      try{
        const result=await this.g.client.purgeCommit(prepared.ticket);if(version!==this.generation||!this.g.connected)return;
        this.message(`영구삭제 완료 ${result.deleted.length}개 · 중단 ${result.incomplete.length}개 · 미처리 ${result.unprocessed.length}개.${result.incomplete.length?' 중단된 폴더는 일부 파일이 이미 삭제됐을 수 있어요.':''}`);
      }catch(error){if(version===this.generation)this.message(error.message+' 요청이 끊긴 경우 일부 또는 전체가 삭제됐을 수 있어요. 휴지통을 다시 확인해 주세요.');}
      finally{
        this.busy=false;if(version===this.generation&&this.dialog.open){const refresh=document.createElement('button');refresh.textContent='휴지통 다시 확인';refresh.onclick=()=>this.trashList();button.replaceWith(refresh);void this.g.load(this.g.path);}
      }
    };
  }
}
