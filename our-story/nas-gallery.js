import { NasClient } from "./nas-client.mjs?v=20261113-memory1";
import { ConnectionVault } from "./nas-vault.mjs?v=20261113-memory1";
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
  } = {}) {
    this.vault = vault;
    this.remembered = false;
    this.restoring = false;
    this.persistMessage = "";
    this.savedBase = "";
    this.savedMode = "token";
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
    this.thumbnails = false;
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
      this.client.abortImages();
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
  async restoreRemembered({ base, navigate = false } = {}) {
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
    this.dialog.innerHTML = `<button class="close" data-nas-close aria-label="닫기">×</button><span class="eyebrow">OUR PRIVATE PHOTO SHELF</span><h2>NAS 사진 보관함</h2>${this.connected ? `<p>${connectedNote}</p><div class="nas-saved-actions">${this.remembered ? '<button class="primary" id="nas-forget">저장 정보 지우고 연결 해제</button>' : '<button class="primary" id="nas-remember-now">이 기기에 연결 기억</button>'}<button id="nas-pause">연결만 끊기</button></div><p class="fine">사진 원본은 읽기 전용이에요. 연결 정보는 이 브라우저에 암호화해서 보관해요.</p>` : `${savedActions}<p>${this.remembered ? "터널 주소가 바뀌었으면 주소만 수정해 주세요. 토큰 칸을 비우면 저장된 정보를 사용해요." : "기존 사진 테스트에서 사용했던 주소와 연결 정보를 입력해 주세요."}</p><form id="nas-connect-form" class="form-grid" method="post" autocomplete="off"><label class="full">사진 API 터널 주소<input name="base" type="url" required maxlength="250" value="${esc(this.savedBase)}" placeholder="https://…trycloudflare.com" autocomplete="off" spellcheck="false" autocapitalize="none"></label><label class="full">연결 방식<select name="mode" aria-label="연결 방식"><option value="token" ${this.savedMode === "token" ? "selected" : ""}>기존 사진 조회 토큰</option><option value="login" ${this.savedMode === "login" ? "selected" : ""}>사진 API 로그인 (설정한 경우)</option></select></label><label class="full" id="nas-token-row">사진 조회 토큰<input name="token" type="password" maxlength="512" autocomplete="off" spellcheck="false" autocapitalize="none" ${savedToken ? 'placeholder="비워두면 저장된 토큰 사용"' : "required"}></label><label id="nas-user-row" hidden>사진 API 아이디<input name="username" maxlength="80" autocomplete="off" spellcheck="false" autocapitalize="none"></label><label id="nas-password-row" hidden>사진 API 비밀번호<input name="password" type="password" maxlength="128" autocomplete="off"></label><label class="full nas-remember"><input name="remember" type="checkbox" checked>이 기기에서 연결 기억</label><p class="fine full">주소와 토큰은 이 브라우저에 암호화해 보관해요. DSM 비밀번호는 입력하지 마세요. 사진과 기록은 여기에 저장하지 않아요.</p><p class="nas-message full" id="nas-connect-error" role="alert"></p><button class="primary full" type="submit">사진 보관함 연결</button></form>`}<p class="nas-message" id="nas-storage-message" role="alert">${esc(this.persistMessage)}</p>`;
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
    this.version++;
    this.resetImages();
    this.path = "";
    this.items = [];
    this.next = null;
    this.total = 0;
    this.error = "";
    this.loaded = false;
    this.loading = false;
    this.thumbnails = false;
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
    this.resetData();
    this.viewerVersion++;
    if (this.dialog.open) this.dialog.close();
    const revocation = this.client.disconnect({ revoke });
    let removed = true;
    if (forget) {
      this.remembered = false;
      this.savedBase = "";
      this.savedMode = "token";
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
    this.remembered = false;
    this.savedBase = "";
    this.savedMode = "token";
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
      const button = e.target.closest("[data-nas-action]");
      if (!button) return;
      const { nasAction: action, path, index } = button.dataset;
      if (action === "connect") this.settings();
      if (action === "disconnect") void this.disconnect();
      if (action === "restore") void this.restoreRemembered({ navigate: true });
      if (action === "folder") void this.load(path);
      if (action === "more" && this.next !== null)
        void this.load(this.path, this.next);
      if (action === "retry") void this.load(this.path, this.retryOffset || 0);
      if (action === "image") void this.openImage(this.items[Number(index)]);
      if (action === "thumbs") {
        this.thumbnails = !this.thumbnails;
        if (!this.thumbnails) this.resetImages();
        this.render();
      }
    };
    this.render();
    if (this.connected && !this.loaded && !this.loading) void this.load("");
  }
  unmount() {
    if (this.host) this.host.onclick = null;
    this.host = null;
    this.resetImages();
    this.viewerVersion++;
    if (this.dialog.open && !this.connecting) this.dialog.close();
  }
  applyListing(data, append = false) {
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
  async load(path, offset = 0) {
    if (!this.connected || (this.loading && offset)) return;
    const version = ++this.version;
    if (!offset) {
      this.resetImages();
      this.items = [];
      this.path = path;
      this.next = null;
      this.total = 0;
      this.thumbnails = false;
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
  render() {
    if (!this.host) return;
    if (!this.connected) {
      this.host.innerHTML = `<section class="nas-welcome">${this.restoring ? '<p role="status">저장된 보관함에 다시 연결하는 중…</p>' : ""}<span class="nas-large-icon">▧</span><span class="eyebrow">YOUR PHOTOS STAY YOURS</span><h2>우리 사진이 머무는 곳</h2><p>NAS에 보관한 사진을 이곳에서 꺼내 보세요.<br>원본을 옮기거나 수정하지 않고 읽기만 해요.</p>${this.remembered && !this.restoring ? '<button class="primary" data-nas-action="restore">저장된 보관함에 재연결</button> ' : ""}<button class="${this.remembered ? "" : "primary"}" data-nas-action="connect">${this.remembered ? "연결 설정 / 주소 변경" : "NAS 사진 보관함 연결"}</button>${this.error ? `<p role="alert" class="nas-message">${esc(this.error)}</p>` : ""}<p class="fine">사진 조회와 여행·성장 기록 저장은 별개예요.<br>사진은 GitHub에 업로드되지 않아요.</p></section>`;
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
    this.host.innerHTML = `<div class="nas-status"><span><i></i> NAS 연결됨 · 원본 읽기 전용 <small>${this.remembered ? "· 이 기기에 연결 기억됨" : ""}</small></span><button data-nas-action="disconnect">${this.remembered ? "저장 정보 지우기" : "연결 끊기"}</button></div>${this.persistMessage ? `<p class="nas-message" role="alert">${esc(this.persistMessage)}</p>` : ""}<nav class="nas-crumbs" aria-label="사진 폴더 경로"><button data-nas-action="folder" data-path="${esc(top)}" ${this.path ? "" : "disabled"} aria-label="상위 폴더">←</button><button data-nas-action="folder" data-path="">/photo</button>${crumbs}</nav><div class="nas-tools"><p role="status">${this.loading ? "사진 목록을 불러오는 중…" : `현재 폴더 ${this.total}개 항목 · ${this.items.length}개 표시`}</p>${photoCount ? `<button data-nas-action="thumbs" aria-pressed="${this.thumbnails}" ${this.loading ? "disabled" : ""}>${this.thumbnails ? "자동 미리보기 끄기" : "사진 미리보기 켜기"}</button>` : ""}</div>${photoCount ? '<p class="fine nas-preview-note">자동 미리보기를 켜면 처음 12장의 원본 사진을 다운로드해 작게 표시해요. 사진을 누르면 크게 볼 수 있어요.</p>' : ""}${this.error ? `<div class="nas-message" role="alert"><p>${esc(this.error)}</p><button data-nas-action="retry">다시 불러오기</button></div>` : ""}<div class="nas-grid" aria-busy="${this.loading}">${this.items.map((item, index) => `<button class="nas-entry ${item.dir ? "nas-folder" : ""}" data-nas-action="${item.dir ? "folder" : "image"}" data-path="${esc(item.path)}" data-index="${index}"><span class="nas-thumb">${this.urls.has(item.path) ? `<img src="${this.urls.get(item.path)}" alt="" decoding="async">` : item.dir ? '<span class="nas-folder-glyph">▰</span>' : '<span class="nas-photo-glyph">▧</span>'}</span><strong>${esc(item.name)}</strong><small>${item.dir ? "폴더 열기 ↗" : this.thumbErrors.has(item.path) ? "눌러서 사진 확인" : "사진 크게 보기 ↗"}</small></button>`).join("")}${this.loading && !this.items.length ? skeleton.repeat(6) : ""}</div>${!this.loading && !this.error && !this.items.length ? '<div class="empty">이 폴더에는 표시할 사진이나 하위 폴더가 없어요.</div>' : ""}${this.next !== null ? `<button class="nas-more" data-nas-action="more" ${this.loading ? "disabled" : ""}>${this.loading ? "불러오는 중…" : "사진 더 불러오기"}</button>` : ""}`;
    if (this.thumbnails) this.startThumbnails();
  }
  startThumbnails() {
    for (const item of this.items.filter((i) => !i.dir).slice(0, 12)) {
      if (!this.urls.has(item.path) && !this.requested.has(item.path)) {
        this.requested.add(item.path);
        this.queue.push(item.path);
      }
    }
    this.pumpThumbnails();
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
      this.active++;
      this.updateThumb(path, null, true);
      this.client
        .image(path)
        .then((blob) => {
          if (version !== this.imageVersion || !this.host || !this.connected)
            return;
          const url = URL.createObjectURL(blob);
          this.urls.set(path, url);
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
    } else thumb.textContent = "▧";
  }
  async openImage(item) {
    if (!item || item.dir || !this.connected) return;
    if (this.dialog.open) this.dialog.close();
    const version = ++this.viewerVersion;
    this.dialog.innerHTML = `<button class="close" data-nas-close aria-label="닫기">×</button><span class="eyebrow">A MOMENT FROM OUR PHOTO SHELF</span><h2 class="nas-file-title">${esc(item.name)}</h2><div class="nas-viewer" aria-busy="true">${skeleton}<p role="status">사진을 불러오는 중…</p></div><p class="fine">원본 읽기 전용 · 연결을 끊으면 이 기기의 미리보기를 지워요.</p>`;
    this.dialog.showModal();
    try {
      const blob = await this.client.image(item.path);
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
