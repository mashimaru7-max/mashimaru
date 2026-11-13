import {selectLoaded} from './nas-selection.mjs?v=20261114-purge1';
import {FAMILY_API,FAMILY_USERNAME} from './family-config.mjs?v=20261113-login1';
import {icon} from "./icons.js?v=20261113-albumlook2";
import { NasActions } from "./nas-actions.js?v=20261114-trash-all1";
import { NasClient } from "./nas-client.mjs?v=20261114-purge1";
import { ConnectionVault } from "./nas-vault.mjs?v=20261113-shared1";
const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const skeleton = '<div class="nas-skeleton" aria-hidden="true"></div>';
export class NasGallery {
  constructor({
    client,
    vault = new ConnectionVault(),
    onState = () => {},
    onConnected = () => {},
    notify = () => {},
    onHomePhoto = async () => {},
  } = {}) {
    this.vault = vault;
    this.features = {};
    this.selecting=false;this.selection=new Map();
    this.actions = new NasActions(this, onHomePhoto);
    this.observer = null;
    this.moreObserver = null;
    this.near = new Set();
    this.sizes = new Map();
    this.remembered = false;
    this.restoring = false;
    this.persistMessage = "";
    this.savedBase = FAMILY_API;
    this.savedMode = "login";
    this.onState = onState;
    this.onConnected = onConnected;
    this.notify = notify;
    this.client = client || new NasClient({ onExpire: () => this.expired() });
    this.host = null;
    this.path = "";
    this.items = [];
    this.next = null;
    this.total = 0;
    this.loading = false;
    this.error = "";
    this.loaded = false;
    this.version = 0;
    this.imageVersion = 0;
    this.urls = new Map();
    this.thumbErrors = new Set();
    this.requested = new Set();
    this.queue = [];
    this.active = 0;
    this.thumbnails = true;
    this.viewerURL = null;
    this.viewerVersion = 0;
    this.connectVersion = 0;
    this.connecting = false;
    this.dialog = document.createElement("dialog");
    this.dialog.className = "nas-dialog";
    this.dialog.setAttribute("aria-label", "NAS 사진 보관함");
    document.body.append(this.dialog);
    this.dialog.addEventListener("close", () => {
      this.viewerVersion++;
      this.actions.cancel();
      if (this.viewerURL) URL.revokeObjectURL(this.viewerURL);
      this.viewerURL = null;
      if (this.connecting) {
        this.connectVersion++;
        this.connecting = false;
        void this.disconnect();
      }
      this.dialog.replaceChildren();
    });
    this.dialog.addEventListener("click", (e) => {
      if (e.target.closest("[data-nas-close]")) this.dialog.close();
      if (e.target === this.dialog) {
        const r = this.dialog.getBoundingClientRect();
        if (
          e.clientX < r.left ||
          e.clientX > r.right ||
          e.clientY < r.top ||
          e.clientY > r.bottom
        )
          this.dialog.close();
      }
    });
    window.addEventListener("pagehide", () => {
      void this.disconnect({ forget: false, revoke: !this.remembered });
    });
    window.addEventListener("pageshow", (e) => {
      if (e.persisted) void this.restoreRemembered();
    });
  }
  get connected() {
    return this.client.connected;
  }
  async rememberCurrent(remember = true) {
    this.persistMessage = "";
    try {
      if (remember) {
        if (!(await this.client.remember(this.vault))) return false;
      } else await this.vault.clear();
      this.remembered = remember;
      this.savedBase = remember ? this.client.origin : "";
      this.savedMode = remember ? this.client.mode : "token";
      return true;
    } catch (error) {
      this.persistMessage = remember
        ? "연결은 되었지만 이 브라우저에 저장하지 못했어요. 저장 공간이나 시크릿 모드 설정을 확인해 주세요."
        : "저장 정보를 지우지 못했어요. 브라우저의 이 사이트 데이터 삭제 기능을 사용해 주세요.";
      this.remembered = await this.vault.has().catch(() => false);
      return false;
    }
  }
  async restoreRemembered({ base=FAMILY_API, navigate = false } = {}) {
    const attempt = ++this.connectVersion;
    this.restoring = true;
    this.error = "";
    this.onState();
    this.render();
    try {
      const listing = await this.client.restore(this.vault, { base });
      if (attempt !== this.connectVersion) return;
      this.remembered = !!listing;
      if (listing) {
        this.savedBase = this.client.origin;
        this.savedMode = this.client.mode;
        this.applyListing(listing);
        void this.refreshFeatures();
        this.loaded = true;
        if (base) await this.rememberCurrent(true);
        if (navigate) {
          if (this.dialog.open) this.dialog.close();
          this.onConnected();
        }
      }
    } catch (error) {
      if (attempt !== this.connectVersion) return;
      this.remembered = await this.vault.has().catch(() => false);
      this.savedBase = this.client.origin;
      this.savedMode = this.client.mode || "token";
      if (error.code !== "ABORT") this.error = error.message;
    } finally {
      if (attempt === this.connectVersion) {
        this.restoring = false;
        this.onState();
        this.render();
      }
    }
  }
  settings() {
    if (this.dialog.open) return;
    const connectedNote = this.remembered
      ? "이 기기에 연결 정보를 기억했어요. 새로고침하거나 다시 열면 자동으로 연결해요."
      : "현재 연결은 이번 화면에서만 사용해요.";
    const savedActions = this.remembered
      ? '<div class="nas-saved-actions"><button id="nas-restore-saved" type="button">저장된 연결로 다시 연결</button><button id="nas-forget" type="button">저장 정보 지우기</button></div>'
      : "";
    const savedToken = this.remembered && this.savedMode === "token";
    this.dialog.innerHTML = `<button class="close" data-nas-close aria-label="닫기">×</button><span class="eyebrow">OUR PRIVATE PHOTO SHELF</span><h2>우리 가족 로그인</h2>${this.connected ? `<p>${connectedNote}</p><div class="nas-saved-actions">${this.remembered ? '<button class="primary" id="nas-forget">로그아웃 · 이 기기에서 로그인 지우기</button>' : '<button class="primary" id="nas-remember-now">이 기기에 연결 기억</button>'}<button id="nas-pause">연결만 끊기</button></div><p class="fine">비밀번호는 저장하지 않고 로그인 연결 정보만 이 기기에 암호화해 보관해요.</p>${this.features.accountSetup?`<form id="nas-family-setup" class="form-grid"><h3 class="full">가족 공용 로그인 만들기</h3><p class="full">아이디: ${FAMILY_USERNAME} · 처음 한 번만 비밀번호를 설정해요.</p><label class="full">새 비밀번호<input name="newPassword" type="password" minlength="10" maxlength="128" required autocomplete="new-password"></label><label class="full">비밀번호 확인<input name="confirmPassword" type="password" minlength="10" maxlength="128" required autocomplete="new-password"></label><p class="fine full">10~128자로 설정해 주세요. DSM 비밀번호와 별도로 사용해요. 설정 후 기존 토큰 접속은 종료돼요.</p><p class="full" role="alert"></p><button class="primary full">공용 로그인 설정</button></form>`:""}` : `${savedActions}<p>${this.remembered ? "저장된 로그인으로 다시 연결하거나 가족 계정으로 로그인해 주세요." : "가족 공용 계정으로 로그인해 주세요."}</p><form id="nas-connect-form" class="form-grid" method="post" autocomplete="off"><details class="full"><summary>연결 관리 · 관리자용</summary><label class="full">사진 API 터널 주소<input name="base" type="url" required maxlength="250" value="${esc(this.savedBase)}" placeholder="https://…trycloudflare.com" autocomplete="off" spellcheck="false" autocapitalize="none"></label><label class="full">연결 방식<select name="mode" aria-label="연결 방식"><option value="token" ${this.savedMode === "token" ? "selected" : ""}>기존 사진 조회 토큰</option><option value="login" ${this.savedMode === "login" ? "selected" : ""}>가족 아이디·비밀번호</option></select></label></details><label class="full" id="nas-token-row">사진 조회 토큰<input name="token" type="password" maxlength="512" autocomplete="off" spellcheck="false" autocapitalize="none" ${savedToken ? 'placeholder="비워두면 저장된 토큰 사용"' : "required"}></label><label id="nas-user-row" hidden>아이디<input name="username" value="${FAMILY_USERNAME}" maxlength="80" autocomplete="username" spellcheck="false" autocapitalize="none"></label><label id="nas-password-row" hidden>비밀번호<input name="password" type="password" maxlength="128" autocomplete="current-password"></label><label class="full nas-remember"><input name="remember" type="checkbox" checked>로그인 유지</label><p class="fine full">비밀번호는 저장하지 않아요. 로그인 유지 시 연결 정보만 이 기기에 암호화해 보관해요.</p><p class="nas-message full" id="nas-connect-error" role="alert"></p><button class="primary full" type="submit">로그인</button></form>`}<p class="nas-message" id="nas-storage-message" role="alert">${esc(this.persistMessage)}</p>`;
    this.dialog.showModal();
    const forget = this.dialog.querySelector("#nas-forget");
    if (forget)
      forget.onclick = async () => {
        this.dialog.close();
        const removed = await this.disconnect();
        this.notify(
          removed
            ? "저장된 연결 정보를 지웠어요."
            : "저장 정보를 지우지 못했어요. 연결 설정을 확인해 주세요.",
        );
      };
    if (this.connected) {
      const setup=this.dialog.querySelector('#nas-family-setup');
      if(setup)setup.onsubmit=async e=>{
        e.preventDefault();
        const password=setup.elements.newPassword.value, confirmation=setup.elements.confirmPassword.value;
        const status=setup.querySelector('[role=alert]'), button=setup.querySelector('button');
        if(password!==confirmation){status.textContent='비밀번호가 서로 달라요.';return;}
        button.disabled=true;status.textContent='공용 로그인을 설정하는 중이에요…';
        const base=this.client.origin;let created=false;
        try {
          await this.client.createFamilyAccount(password);created=true;
          const listing=await this.client.connect({base,mode:'login',username:FAMILY_USERNAME,password});
          const saved=await this.rememberCurrent(true);
          this.applyListing(listing);await this.refreshFeatures();
          this.dialog.close();this.onState();this.onConnected();
          this.notify(saved?'공용 로그인을 만들었어요. 다른 기기에서도 오니둥이 계정으로 로그인하면 돼요.':'공용 로그인은 만들어졌지만 이 기기의 로그인 유지는 저장하지 못했어요.');
        } catch(error) {
          status.textContent=(created?'계정 생성은 완료됐어요. 설정 창을 닫고 가족 계정으로 다시 로그인해 주세요. ':'')+error.message;
          button.disabled=false;
        } finally {setup.elements.newPassword.value='';setup.elements.confirmPassword.value='';}
      };
      this.dialog.querySelector("#nas-pause").onclick = () => {
        this.dialog.close();
        void this.disconnect({ forget: false, revoke: !this.remembered });
        this.notify(
          this.remembered
            ? "연결만 끊었어요. 다음에 열면 자동 연결돼요."
            : "NAS 연결을 끊었어요.",
        );
      };
      const save = this.dialog.querySelector("#nas-remember-now");
      if (save)
        save.onclick = async () => {
          save.disabled = true;
          const saved = await this.rememberCurrent(true);
          if (saved) {
            this.dialog.close();
            this.render();
            this.notify("이 기기에 연결을 기억했어요.");
          } else {
            this.dialog.querySelector("#nas-storage-message").textContent =
              this.persistMessage;
            save.disabled = false;
          }
        };
      return;
    }
    const restore = this.dialog.querySelector("#nas-restore-saved");
    if (restore)
      restore.onclick = () => {
        this.dialog.close();
        void this.restoreRemembered({ navigate: true });
      };
    const form = this.dialog.querySelector("form"),
      mode = form.elements.mode;
    mode.onchange = () => {
      const login = mode.value === "login",
        canReuse = this.remembered && this.savedMode === mode.value;
      this.dialog.querySelector("#nas-token-row").hidden = login;
      this.dialog.querySelector("#nas-user-row").hidden = !login;
      this.dialog.querySelector("#nas-password-row").hidden = !login;
      form.elements.token.required = !login && !canReuse;
      form.elements.username.required = login && !canReuse;
      form.elements.password.required = login && !canReuse;
      form.elements.token.value = "";
      form.elements.password.value = "";
    };
    mode.onchange();
    form.onsubmit = async (e) => {
      e.preventDefault();
      if (this.connecting) return;
      const config = Object.fromEntries(new FormData(form)),
        remember = form.elements.remember.checked;
      const attempt = ++this.connectVersion,
        button = form.querySelector("button[type=submit]");
      this.connecting = true;
      this.restoring = false;
      button.disabled = true;
      button.textContent = "보관함 여는 중…";
      form.elements.token.value = "";
      form.elements.password.value = "";
      this.dialog.querySelector("#nas-connect-error").textContent = "";
      this.resetData();
      this.onState();
      try {
        const reuse =
          this.remembered &&
          this.savedMode === config.mode &&
          !config.token &&
          !config.password;
        const listing = reuse
          ? await this.client.restore(this.vault, { base: config.base })
          : await this.client.connect(config);
        if (attempt !== this.connectVersion) return;
        if (!listing)
          throw new Error("저장된 정보가 없어요. 토큰을 한 번 입력해 주세요.");
        await this.rememberCurrent(remember);
        if (attempt !== this.connectVersion) return;
        this.applyListing(listing);
        void this.refreshFeatures();
        this.loaded = true;
        this.connecting = false;
        this.dialog.close();
        this.onState();
        this.onConnected();
        this.render();
        this.notify(
          this.remembered
            ? "이 기기에 연결을 기억했어요. 다음부터 자동 연결돼요."
            : "NAS 사진 보관함에 연결했어요.",
        );
      } catch (error) {
        if (attempt !== this.connectVersion) return;
        this.connecting = false;
        this.remembered = await this.vault.has().catch(() => false);
        this.onState();
        if (this.dialog.open) {
          this.dialog.querySelector("#nas-connect-error").textContent =
            error.message;
          button.disabled = false;
          button.textContent = "다시 연결하기";
          form.elements[config.mode === "login" ? "password" : "token"].focus();
        }
      } finally {
        config.token = "";
        config.password = "";
      }
    };
  }
  resetImages() {
    this.observer?.disconnect();
    this.moreObserver?.disconnect();
    this.near.clear();
    this.sizes.clear();
    this.imageVersion++;
    this.client.abortImages();
    for (const url of this.urls.values()) URL.revokeObjectURL(url);
    this.urls.clear();
    this.queue = [];
    this.active = 0;
    this.requested.clear();
    this.thumbErrors.clear();
  }
  resetData() {
    this.selecting=false;this.selection.clear();
    this.features = {};
    this.version++;
    this.resetImages();
    this.path = "";
    this.items = [];
    this.next = null;
    this.total = 0;
    this.error = "";
    this.loaded = false;
    this.loading = false;
    this.thumbnails = true;
  }
  async disconnect({ forget = true, revoke = true } = {}) {
    if (forget) {
      const button = this.host?.querySelector('[data-nas-action="disconnect"]');
      if (button) {
        button.disabled = true;
        button.textContent = "저장 정보 지우는 중…";
      }
    }
    this.connectVersion++;
    this.connecting = false;
    this.restoring = false;
    this.actions.cancel();
    if (this.actions.dialog.open) this.actions.dialog.close();
    this.resetData();
    this.features = {};
    this.viewerVersion++;
    if (this.dialog.open) this.dialog.close();
    const revocation = this.client.disconnect({ revoke });
    let removed = true;
    if (forget) {
      this.remembered = false;
      this.savedBase = FAMILY_API;
      this.savedMode = "login";
      try {
        await this.vault.clear();
        this.persistMessage = "";
      } catch {
        removed = false;
        this.remembered = true;
        this.persistMessage =
          "저장 정보를 지우지 못했어요. 브라우저에서 이 사이트 데이터를 삭제해 주세요.";
      }
    }
    this.onState();
    this.render();
    await revocation;
    return removed;
  }
  expired() {
    this.actions.cancel();
    if (this.actions.dialog.open) this.actions.dialog.close();
    this.remembered = false;
    this.savedBase = FAMILY_API;
    this.savedMode = "login";
    void this.vault.clear().catch(() => {
      this.persistMessage =
        "저장된 인증 정보를 지우지 못했어요. 연결 설정에서 다시 지워 주세요.";
    });
    this.resetData();
    this.connecting = false;
    this.connectVersion++;
    if (this.dialog.open) this.dialog.close();
    this.error = "사진 보관함 인증이 만료되었어요. 다시 연결해 주세요.";
    this.onState();
    this.render();
  }
  mount(host) {
    this.host = host;
    host.onclick = (e) => {
      const checkbox=e.target.closest('[data-nas-select]');
      if(checkbox){const item=this.items[Number(checkbox.dataset.nasSelect)];if(item)this.setSelected(item,checkbox.checked);return;}
      const button = e.target.closest("[data-nas-action]");
      if (!button) return;
      const { nasAction: action, path, index } = button.dataset;
      if (action === "upload") this.actions.upload();
      if (action === "mkdir") this.actions.mkdir();
      if (action === "manage") this.actions.manage();
      if (action === "trash-list") void this.actions.trashList();
      if (action === "connect") this.settings();
      if (action === "disconnect") void this.disconnect();
      if (action === "restore") void this.restoreRemembered({ navigate: true });
      if (action === "folder") {if(this.selecting && index!==undefined)this.toggleSelected(this.items[Number(index)]);else void this.load(path);}
      if (action === "more" && this.next !== null)
        void this.load(this.path, this.next);
      if (action === "retry") void this.load(this.path, this.retryOffset || 0);
      if (action === "image") {if(this.selecting)this.toggleSelected(this.items[Number(index)]);else void this.openImage(this.items[Number(index)]);}
      if(action==='selection'){this.selecting=!this.selecting;if(!this.selecting)this.selection.clear();this.render();this.host?.querySelector('[data-nas-action="selection"]')?.focus({preventScroll:true});}
      if(action==='select-loaded'){selectLoaded(this.selection,this.items,{folders:!!this.features.folderTrash});this.updateSelection();}
      if(action==='clear-selection'){this.selection.clear();this.updateSelection();}
      if(action==='trash-selection')this.actions.trashMany([...this.selection.values()]);
      if (action === "thumbs") {
        this.thumbnails = !this.thumbnails;
        if (!this.thumbnails) this.resetImages();
        this.render();
      }
    };
    void this.refreshFeatures();
    this.render();
    if (this.connected && this.pendingAlbumPath !== undefined) {
      const path=this.pendingAlbumPath;delete this.pendingAlbumPath;void this.load(path);
    } else if (this.connected && !this.loaded && !this.loading) void this.load("");
  }
  unmount() {
    this.selecting=false;this.selection.clear();
    if (this.host) this.host.onclick = null;
    this.host = null;
    this.resetImages();
    this.actions.cancel();
    if (this.actions.dialog.open) this.actions.dialog.close();
    this.viewerVersion++;
    if (this.dialog.open && !this.connecting) this.dialog.close();
  }
  applyListing(data, append = false) {
    if(data.path!==this.path)this.selection.clear();
    this.path = data.path;
    this.total = data.total;
    this.next = data.next;
    this.items = append
      ? [
          ...this.items,
          ...data.items.filter(
            (i) => !this.items.some((old) => old.path === i.path),
          ),
        ]
      : data.items;
  }
  toggleSelected(item){if(item)this.setSelected(item,!this.selection.has(item.path));}
  setSelected(item,selected){
    if(item.dir&&!this.features.folderTrash){this.notify('폴더 선택은 NAS 코드를 업데이트한 뒤 사용할 수 있어요.');return;}
    if(selected)this.selection.set(item.path,{...item});else this.selection.delete(item.path);
    this.updateSelection();
  }
  updateSelection(){
    if(!this.host)return;
    this.host.querySelectorAll('[data-nas-select]').forEach(el=>{el.checked=this.selection.has(this.items[Number(el.dataset.nasSelect)]?.path);});
    this.host.querySelectorAll('.nas-entry[data-index]').forEach(el=>{const selected=this.selection.has(this.items[Number(el.dataset.index)]?.path);el.classList.toggle('is-selected',selected);if(this.selecting)el.setAttribute('aria-pressed',String(selected));});
    const count=this.host.querySelector('[data-selection-count]');if(count)count.textContent=this.selection.size+'개 선택';
    const button=this.host.querySelector('[data-nas-action="trash-selection"]');if(button)button.disabled=!this.selection.size;
  }
  async load(path, offset = 0) {
    if (!this.connected || (this.loading && offset)) return;
    if(path!==this.path)this.selection.clear();
    const version = ++this.version;
    if (!offset) {
      this.resetImages();
      this.items = [];
      this.path = path;
      this.next = null;
      this.total = 0;
      this.thumbnails = true;
    }
    this.loading = true;
    this.error = "";
    this.retryOffset = offset;
    this.render();
    try {
      const data = await this.client.list(path, offset);
      if (version !== this.version || !this.connected) return;
      this.applyListing(data, !!offset);
      this.loaded = true;
    } catch (error) {
      if (version !== this.version) return;
      if (error.code !== "ABORT") this.error = error.message;
    } finally {
      if (version === this.version) {
        this.loading = false;
        this.render();
      }
    }
  }
  async refreshFeatures() {
    if (!this.connected || this.checkingFeatures) return;
    const origin = this.client.origin;
    this.checkingFeatures = true;
    try {
      const features = await this.client.capabilities();
      if (this.connected && this.client.origin === origin) this.features = features;
    } catch { this.features = {}; }
    finally { this.checkingFeatures = false; this.onState(); this.render(); }
  }
  render() {
    this.observer?.disconnect();
    this.moreObserver?.disconnect();
    if (!this.host) return;
    if (!this.connected) {
      this.host.innerHTML = `<section class="nas-welcome">${this.restoring ? '<p role="status">저장된 보관함에 다시 연결하는 중…</p>' : ""}<span class="nas-large-icon">${icon("photo")}</span><span class="eyebrow">YOUR PHOTOS STAY YOURS</span><h2>우리 사진이 머무는 곳</h2><p>NAS에 보관한 사진을 이곳에서 꺼내 보세요.<br>연결한 API의 권한에 따라 사진을 조회하고 관리해요.</p>${this.remembered && !this.restoring ? '<button class="primary" data-nas-action="restore">저장된 보관함에 재연결</button> ' : ""}<button class="${this.remembered ? "" : "primary"}" data-nas-action="connect">${this.remembered ? "연결 설정 / 주소 변경" : "NAS 사진 보관함 연결"}</button>${this.error ? `<p role="alert" class="nas-message">${esc(this.error)}</p>` : ""}<p class="fine">사진 조회와 여행·성장 기록 저장은 별개예요.<br>사진은 GitHub에 업로드되지 않아요.</p></section>`;
      return;
    }
    let current = "";
    const crumbs = this.path
      .split("/")
      .filter(Boolean)
      .map((part) => {
        current += (current ? "/" : "") + part;
        return `<span aria-hidden="true">/</span><button data-nas-action="folder" data-path="${esc(current)}">${esc(part)}</button>`;
      })
      .join("");
    const top = this.path.split("/").slice(0, -1).join("/");
    const photoCount = this.items.filter((x) => !x.dir).length;
    this.host.innerHTML = `<div class="nas-status"><span><i></i> NAS 연결됨 · ${this.features.upload ? "사진 관리 가능" : "읽기 전용 API"} <small>${this.remembered ? "· 이 기기에 연결 기억됨" : ""}</small></span><button data-nas-action="disconnect">${this.remembered ? "저장 정보 지우기" : "연결 끊기"}</button></div>${this.persistMessage ? `<p class="nas-message" role="alert">${esc(this.persistMessage)}</p>` : ""}${this.features.fileOperationsBlocked?'<p class="nas-message" role="alert">이전 파일 작업의 복구 확인이 필요해요. 파일 위치를 확인하기 전에는 새 정리를 진행하지 마세요.</p>':''}<nav class="nas-crumbs" aria-label="사진 폴더 경로"><button data-nas-action="folder" data-path="${esc(top)}" ${this.path ? "" : "disabled"} aria-label="상위 폴더">상위 폴더</button><button data-nas-action="folder" data-path="">/photo</button>${crumbs}</nav><div class="nas-tools"><p role="status">${this.loading ? "사진 목록을 불러오는 중…" : `현재 폴더 ${this.total}개 항목 · ${this.items.length}개 표시`}</p>${photoCount ? `<button data-nas-action="thumbs" aria-pressed="${this.thumbnails}" ${this.loading ? "disabled" : ""}>${this.thumbnails ? "자동 미리보기 끄기" : "사진 미리보기 켜기"}</button>` : ""}</div><div class="nas-action-bar"><button data-nas-action="upload">＋ 사진 업로드</button><button data-nas-action="trash-list">사진·폴더 휴지통</button><button data-nas-action="mkdir">새 폴더</button><button data-nas-action="manage">사진·폴더 정리</button><button data-nas-action="selection" aria-pressed="${this.selecting}">${this.selecting?'선택 끝내기':'선택하기'}</button><span class="fine">${this.features.upload ? "삭제한 사진은 휴지통에서 복원할 수 있어요." : "사진 쓰기 설정을 활성화하면 업로드·휴지통·폴더 정리를 사용할 수 있어요."}</span></div>${this.selecting?`<div class="nas-selection-bar"><strong data-selection-count>${this.selection.size}개 선택</strong><button data-nas-action="select-loaded">불러온 항목 전체 선택</button><button data-nas-action="clear-selection">선택 해제</button><button class="nas-danger" data-nas-action="trash-selection" ${this.selection.size?'':'disabled'}>선택 항목 휴지통</button><small>${this.features.folderTrash?'폴더를 선택하면 하위 내용 전체가 함께 이동돼요.':'현재는 사진만 선택할 수 있어요. 폴더 선택은 NAS 업데이트 후 활성화돼요.'}</small></div>`:''}${photoCount ? '<p class="fine nas-preview-note">개수 제한 없이 스크롤에 맞춰 미리보기를 불러와요. 원본 API에서는 데이터 사용량이 클 수 있어요.</p>' : ""}${this.error ? `<div class="nas-message" role="alert"><p>${esc(this.error)}</p><button data-nas-action="retry">다시 불러오기</button></div>` : ""}<div class="nas-grid" aria-busy="${this.loading}">${this.items.map((item, index) => `<div class="nas-item-wrap">${this.selecting?`<label class="nas-selection-check"><input type="checkbox" data-nas-select="${index}" aria-label="${esc(item.name)} 선택" ${this.selection.has(item.path)?'checked':''} ${item.dir&&!this.features.folderTrash?'disabled':''}></label>`:''}<button class="nas-entry ${item.dir ? "nas-folder" : ""} ${this.selection.has(item.path)?'is-selected':''}" ${this.selecting?`aria-pressed="${this.selection.has(item.path)}"`:''} data-nas-action="${item.dir ? "folder" : "image"}" data-path="${esc(item.path)}" data-index="${index}"><span class="nas-thumb">${this.urls.has(item.path) ? `<img src="${this.urls.get(item.path)}" alt="" decoding="async">` : item.dir ? '<span class="nas-folder-glyph">▰</span>' : '<span class="nas-photo-glyph">' + icon("photo") + '</span>'}</span><strong>${esc(item.name)}</strong><small>${this.selecting?(item.dir?'폴더 · 하위 내용 전체':'사진 선택'):item.dir ? "폴더 열기" : this.thumbErrors.has(item.path) ? "눌러서 사진 확인" : "사진 크게 보기"}</small></button></div>`).join("")}${this.loading && !this.items.length ? skeleton.repeat(6) : ""}</div>${!this.loading && !this.error && !this.items.length ? '<div class="empty">이 폴더에는 표시할 사진이나 하위 폴더가 없어요.</div>' : ""}${this.next !== null ? `<button class="nas-more" data-nas-action="more" ${this.loading ? "disabled" : ""}>${this.loading ? "불러오는 중…" : "사진 더 불러오기"}</button>` : ""}`;
    if (this.thumbnails) this.startThumbnails();
    const more = this.host.querySelector(".nas-more");
    if (more && !this.loading && !this.error && "IntersectionObserver" in window) {
      this.moreObserver = new IntersectionObserver(entries => {
        if (entries.some(e => e.isIntersecting) && !this.loading && !this.error && this.next !== null) void this.load(this.path, this.next);
      }, {rootMargin:"300px"});
      this.moreObserver.observe(more);
    }
  }
  startThumbnails() {
    const enqueue = entry => {
      const path = entry.dataset.path;
      this.near.add(path);
      if (!this.urls.has(path) && !this.requested.has(path) && !this.thumbErrors.has(path)) {
        this.requested.add(path); this.queue.push(path);
      }
      this.pumpThumbnails();
    };
    const entries = this.host.querySelectorAll('.nas-entry:not(.nas-folder)');
    this.near.clear();
    if (!("IntersectionObserver" in window)) { entries.forEach(enqueue); return; }
    this.observer = new IntersectionObserver(changes => {
      for (const e of changes) {
        if (e.isIntersecting) enqueue(e.target);
        else this.near.delete(e.target.dataset.path);
      }
      this.trimCache();
    }, {rootMargin:"220px"});
    entries.forEach(e => this.observer.observe(e));
  }
  trimCache() {
    let bytes = [...this.sizes.values()].reduce((a,b) => a+b,0);
    for (const [path,url] of this.urls) {
      if (this.urls.size <= 48 && bytes <= 64*1024*1024) break;
      if (this.near.has(path)) continue;
      URL.revokeObjectURL(url); bytes -= this.sizes.get(path) || 0;
      this.urls.delete(path); this.sizes.delete(path); this.requested.delete(path);
      this.updateThumb(path);
    }
  }
  pumpThumbnails() {
    const version = this.imageVersion;
    while (
      this.active < 2 &&
      this.queue.length &&
      this.host &&
      this.thumbnails
    ) {
      const path = this.queue.shift();
      if (!this.near.has(path)) { this.requested.delete(path); continue; }
      this.active++;
      this.updateThumb(path, null, true);
      (this.features.thumbnails ? this.client.thumbnail(path) : this.client.image(path))
        .then((blob) => {
          if (version !== this.imageVersion || !this.host || !this.connected)
            return;
          const url = URL.createObjectURL(blob);
          this.urls.set(path, url);
          this.sizes.set(path, blob.size);
          this.trimCache();
          this.updateThumb(path, url);
        })
        .catch((error) => {
          if (version !== this.imageVersion) return;
          if (error.code !== "ABORT") this.thumbErrors.add(path);
          this.updateThumb(path);
        })
        .finally(() => {
          if (version === this.imageVersion) {
            this.active--;
            this.pumpThumbnails();
          }
        });
    }
  }
  updateThumb(path, url, loading = false) {
    const entry = [...(this.host?.querySelectorAll(".nas-entry") || [])].find(
      (el) => el.dataset.path === path,
    );
    const thumb = entry?.querySelector(".nas-thumb");
    if (!thumb) return;
    thumb.replaceChildren();
    if (url) {
      const img = document.createElement("img");
      img.src = url;
      img.alt = "";
      img.decoding = "async";
      img.onerror = () => {
        if (thumb.isConnected) thumb.textContent = "미리보기 불가";
      };
      thumb.append(img);
    } else if (loading) {
      const el = document.createElement("span");
      el.className = "nas-skeleton";
      thumb.append(el);
    } else thumb.innerHTML = icon("photo");
  }
  async openImage(item) {
    if (!item || item.dir || !this.connected) return;
    if (this.dialog.open) return;
    const version = ++this.viewerVersion;
    this.dialog.innerHTML = `<button class="close" data-nas-close aria-label="닫기">×</button><span class="eyebrow">A MOMENT FROM OUR PHOTO SHELF</span><h2 class="nas-file-title">${esc(item.name)}</h2><div class="nas-viewer" aria-busy="true">${skeleton}<p role="status">사진을 불러오는 중…</p></div><div class="nas-view-actions"><button data-photo-action="download">원본 다운로드</button><button data-photo-action="home">♡ 홈 대표 사진으로</button><button class="nas-danger" data-photo-action="trash">휴지통으로 이동</button></div><p class="fine">대표 사진 선택은 가족 공통 설정에 저장돼요. 사진 삭제는 휴지통으로 처리해요.</p>`;
    this.actions.bindViewer(item);
    this.dialog.showModal();
    try {
      const blob = await (this.features.thumbnails ? this.client.thumbnail(item.path,item.expectedRevision) : this.client.image(item.path,item.expectedRevision));
      if (
        version !== this.viewerVersion ||
        !this.dialog.open ||
        !this.connected
      )
        return;
      const url = URL.createObjectURL(blob);
      this.viewerURL = url;
      const box = this.dialog.querySelector(".nas-viewer"),
        img = document.createElement("img");
      img.alt = item.name;
      img.src = url;
      img.onerror = () => {
        if (version === this.viewerVersion && box.isConnected)
          box.textContent =
            "이 브라우저에서 표시할 수 없는 사진 형식이에요. HEIC/HEIF는 변환이 필요할 수 있어요.";
      };
      box.replaceChildren(img);
      box.setAttribute("aria-busy", "false");
    } catch (error) {
      if (version !== this.viewerVersion || !this.dialog.open) return;
      const box = this.dialog.querySelector(".nas-viewer");
      box.setAttribute("aria-busy", "false");
      box.textContent = error.message;
    }
  }
}
