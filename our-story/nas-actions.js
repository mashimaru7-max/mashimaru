const esc = s => String(s ?? "").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c]);
export class NasActions {
  constructor(gallery, onHomePhoto) {
    this.g = gallery;
    this.onHomePhoto = onHomePhoto;
    this.generation = 0;
    this.dialog = document.createElement("dialog");
    this.dialog.className = "nas-dialog nas-management";
    this.dialog.setAttribute("aria-label", "NAS 사진 관리");
    document.body.append(this.dialog);
    this.dialog.addEventListener("close", () => this.cancel());
    this.dialog.addEventListener("click", e => {
      if (e.target.closest("[data-manager-close]")) this.dialog.close();
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
    this.show("NAS 관리 기능 준비 중", `<p>현재 연결된 사진 API는 읽기 전용이에요. 업로드와 휴지통 기능은 별도 관리 API를 NAS에 설치한 뒤 활성화돼요.</p><p>기존 서버와 사진은 그대로 유지돼요. 설치 전에는 웹페이지에서 파일을 변경하지 않아요.</p><a href="downloads/our-story-nas-service.zip" download>관리 API 설치 파일 받기 ↓</a>`);
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
            this.g.notify("이 기기의 홈 대표 사진으로 저장했어요.");
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
  upload() {
    if (!this.g.features.upload) { this.unavailable(); return; }
    const folder=this.g.path, version=this.show("우리 사진 더하기", `<p>저장 위치: <strong>${esc(folder || "/photo")}</strong></p><label class="nas-file-label">사진 선택<input type="file" accept="image/jpeg,image/png,image/webp,image/gif,image/bmp,image/heic,image/heif,image/avif" multiple></label><p class="fine">파일당 최대 ${Math.floor(this.g.features.maxUpload/1048576)}MB · 같은 이름은 덮어쓰지 않아요.<br>닫으면 진행 중인 전송을 취소해요. 완료된 사진은 유지돼요.</p>`);
    this.dialog.querySelector('input').onchange=async e=>{
      const files=[...e.target.files]; e.target.disabled=true;
      let succeeded=0; const failed=[];
      for(let i=0;i<files.length;i++) {
        if(version!==this.generation || !this.g.connected) break;
        this.message(`${i+1}/${files.length} 전송 중 · ${files[i].name}`);
        try {
          if(files[i].size>this.g.features.maxUpload) throw new Error("업로드 크기 초과");
          await this.g.client.upload(folder,files[i]); succeeded++;
        } catch(err) { if(version!==this.generation) break; failed.push(`${files[i].name}: ${err.message}`); }
      }
      if(version!==this.generation) { if(this.g.connected) void this.g.load(folder); return; }
      this.message(`완료 ${succeeded}개 / 실패 ${failed.length}개${failed.length ? " · "+failed.join(" / ") : ""}`);
      if(this.g.connected) void this.g.load(folder);
    };
  }
  trash(item) {
    if(!this.g.features.trash || !item.revision) { this.unavailable(); return; }
    const version=this.show("사진을 휴지통으로 옮길까요?", `<p><strong>${esc(item.name)}</strong></p><p>원래 폴더에서 숨겨지고 NAS 휴지통에 보관돼요. 휴지통에서 복원할 수 있어요.</p><button class="nas-danger" data-confirm-trash>휴지통으로 이동</button> <button data-manager-close>취소</button>`);
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
    const version=this.show("잠시 보관한 사진", '<p>사진은 자동으로 영구 삭제되지 않아요.</p><div class="nas-trash-items">불러오는 중…</div>');
    try {
      const data=await this.g.client.trashList();
      if(version!==this.generation || !this.dialog.open) return;
      if(!Array.isArray(data.items) || data.items.length>1000) throw new Error("휴지통 목록을 확인할 수 없어요.");
      const list=this.dialog.querySelector('.nas-trash-items');
      list.innerHTML=data.items.length ? data.items.map(i=>`<div class="nas-trash-row"><span>${esc(i.path)}</span><button data-restore-id="${/^[a-f0-9]{32}$/.test(i.id) ? i.id : ""}">복원</button></div>`).join("") : '<p>휴지통이 비어 있어요.</p>';
      list.onclick=async e=>{
        const b=e.target.closest('[data-restore-id]'); if(!b || !b.dataset.restoreId) return;
        b.disabled=true;
        try { await this.g.client.restoreTrash(b.dataset.restoreId); if(version!==this.generation) return; b.closest('.nas-trash-row').remove(); this.message("원래 폴더로 복원했어요."); void this.g.load(this.g.path); }
        catch(err) { if(version===this.generation) {this.message(err.message); b.disabled=false;} }
      };
    } catch(err) { if(version===this.generation) this.message(err.message); }
  }
}
