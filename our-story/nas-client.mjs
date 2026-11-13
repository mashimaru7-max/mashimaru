// Authenticated NAS client; legacy servers stay read-only. Credentials never enter request URLs.
// Remembered credentials use the separate encrypted device vault.
export class NasError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "NasError";
    this.code = code;
  }
}
const fail = (code, message) => new NasError(code, message);
export function safeBase(value) {
  let u;
  try {
    u = new URL(value.trim());
  } catch {
    throw fail("URL", "올바른 HTTPS 터널 주소를 입력해 주세요.");
  }
  if (
    u.protocol !== "https:" ||
    u.username ||
    u.password ||
    u.search ||
    u.hash ||
    !["/", "/api/list", "/api/list/"].includes(u.pathname) ||
    u.port ||
    !/^[a-z0-9-]+\.trycloudflare\.com$/i.test(u.hostname)
  )
    throw fail(
      "URL",
      "기존 사진 API의 https://…trycloudflare.com 주소만 사용할 수 있어요.",
    );
  return u.origin;
}
export function safePath(value) {
  if (
    typeof value !== "string" ||
    value.length > 4096 ||
    /[\\\x00-\x1f\x7f]/.test(value) ||
    value.startsWith("/") ||
    value.endsWith("/") ||
    (value && value.split("/").some((x) => !x || x === "." || x === ".."))
  )
    throw fail("PATH", "안전하지 않은 사진 경로는 열 수 없어요.");
  // The existing server decodes once after query parsing. Reject escaped traversal too.
  try {
    if (decodeURIComponent(value) !== value) throw new Error();
  } catch {
    throw fail(
      "PATH",
      "이름에 URL 이스케이프 문자가 포함된 항목은 지원하지 않아요.",
    );
  }
  return value;
}
export function validateListing(data, path, offset) {
  if (
    !data ||
    data.path !== path ||
    !Array.isArray(data.items) ||
    data.items.length > 100 ||
    !Number.isSafeInteger(data.total) ||
    data.total < 0 ||
    !(
      data.next === null ||
      (Number.isSafeInteger(data.next) &&
        data.next > offset &&
        data.next <= 1000000)
    )
  )
    throw fail("FORMAT", "사진 목록 응답 형식을 확인할 수 없어요.");
  const prefix = path ? path + "/" : "";
  const seen = new Set();
  const items = data.items
    .map((item) => {
      if (
        !item ||
        typeof item.name !== "string" ||
        !item.name ||
        item.name.length > 1024 ||
        /[\/\\\x00-\x1f]/.test(item.name) ||
        typeof item.dir !== "boolean" ||
        safePath(item.path) !== prefix + item.name ||
        seen.has(item.path)
      )
        throw fail("FORMAT", "사진 목록에 올바르지 않은 항목이 있어요.");
      seen.add(item.path);
      return { name: item.name, path: item.path, dir: item.dir, ...(typeof item.revision === "string" && /^[a-f0-9]{64}$/.test(item.revision) ? {revision:item.revision} : {}) };
    })
    .filter(
      (item) =>
        !item.name.startsWith(".") &&
        !item.name.toLowerCase().startsWith("@eadir") &&
        (item.dir ||
          /\.(jpe?g|png|webp|gif|bmp|heic|heif|avif)$/i.test(item.name)),
    );
  return { path, total: data.total, next: data.next, items };
}
const messages = {
  401: "인증되지 않았어요. 토큰 또는 로그인 방식을 확인하고 다시 연결해 주세요.",
  409: "같은 이름의 사진이 있거나 파일이 변경되었어요. 새로고침 후 확인해 주세요.",
  413: "파일이 서버의 업로드 크기 제한을 넘었어요.",
  415: "지원하지 않는 사진 형식이에요.",
  403: "이 페이지에서 접근할 수 없어요. 사진 API의 허용 주소 설정을 확인해야 해요.",
  404: "폴더·사진이 없거나, 이 서버가 선택한 기능을 지원하지 않아요.",
  409: "사진 API의 로그인 설정이 완료되지 않았어요. 기존 토큰 방식을 확인해 주세요.",
  413: "15MB를 넘는 사진은 현재 미리보기에서 지원하지 않아요.",
};
export function validateSharedAlbum(data) {
  const invalid=()=>{throw fail('FORMAT','가족 공통 사진 목록을 확인할 수 없어요.');};
  if(!data || data.shared!==true || !Array.isArray(data.items) || data.items.length>12)invalid();
  if(data.unbound===true && data.items.length===0)return {items:[],unbound:true,shared:true};
  if(!Number.isSafeInteger(data.total) || data.total<0 || typeof data.indexing!=='boolean' || !Number.isSafeInteger(data.issues) || data.issues<0 ||
      !(data.snapshot===null || Number.isSafeInteger(data.snapshot)&&data.snapshot>0) ||
      !Array.isArray(data.matchedFolders) || data.matchedFolders.length>5000 ||
      !['', 'other'].includes(data.selectedYear) && !/^(19|20)[0-9]{2}$/.test(data.selectedYear))invalid();
  safePath(data.path);
  if(data.rule!==null && (!data.rule || data.rule.type!=='name' || typeof data.rule.text!=='string' || !['numbered','exact','contains'].includes(data.rule.mode)))invalid();
  const seen=new Set();
  for(const item of data.items) {
    if(!item || typeof item.name!=='string' || safePath(item.path).split('/').at(-1)!==item.name ||
       !/\.(jpe?g|png|webp|gif|bmp|heic|heif|avif)$/i.test(item.path) || !/^[a-f0-9]{64}$/.test(item.revision) ||
       !/^(?:(?:19|20)[0-9]{2})?$/.test(item.folderYear) || seen.has(item.path))invalid();
    seen.add(item.path);safePath(item.albumFolder);
  }
  for(const f of data.matchedFolders) {
    if(!f || typeof f.name!=='string' || !/^(?:(?:19|20)[0-9]{2})?$/.test(f.year))invalid();
    safePath(f.path);
  }
  return {...data,search:{limited:false,canContinue:false,folders:data.matchedFolders.length}};
}

export function validateJournalItem(item) {
  const r=item?.record;
  if(!item || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(item.id) || !Number.isSafeInteger(item.revision) || item.revision<1 || typeof item.deleted!=='boolean' || typeof item.createdAt!=='string' || typeof item.updatedAt!=='string' || !r || !['다온','라온','함께'].includes(r.target) || !['diary','words','letter','measure'].includes(r.kind) || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(r.date) || !['엄마','아빠','엄마와 아빠','가족'].includes(r.author) || !Array.isArray(r.attachments) || r.attachments.length>6)throw fail('FORMAT','성장 기록 응답을 확인할 수 없어요.');
  for(const ref of r.attachments){safePath(ref.path);if(!/^[a-f0-9]{64}$/.test(ref.revision))throw fail('FORMAT','첨부 사진 정보를 확인할 수 없어요.');}
  return item;
}

export class NasClient {
  #fetch;
  #timeout;
  #base = "";
  #secret = "";
  #mode = "";
  #ready = false;
  #expiry = Infinity;
  #epoch = 0;
  #requests = new Map();
  #thumbActive = 0;
  #thumbQueue = [];
  #onExpire;
  constructor({
    fetchImpl = globalThis.fetch.bind(globalThis),
    timeoutMs = 20000,
    onExpire = () => {},
  } = {}) {
    this.#fetch = fetchImpl;
    this.#timeout = timeoutMs;
    this.#onExpire = onExpire;
  }
  get connected() {
    return this.#ready && !!this.#secret && Date.now() < this.#expiry;
  }
  get mode() {
    return this.#mode;
  }
  get origin() {
    return this.#base;
  }
  async remember(vault) {
    if (!this.connected)
      throw fail("AUTH", "연결된 보관함만 저장할 수 있어요.");
    return vault.save({
      version: 1,
      base: this.#base,
      mode: this.#mode,
      secret: this.#secret,
      expiresAt: Number.isFinite(this.#expiry) ? this.#expiry : null,
    });
  }
  async restore(vault, { base: override } = {}) {
    const closing = this.disconnect({ revoke: false });
    const epoch = this.#epoch;
    await closing;
    const saved = await vault.load();
    if (epoch !== this.#epoch) throw fail("ABORT", "재연결을 취소했어요.");
    if (!saved) return null;
    let origin;
    try {
      if (
        saved.version !== 1 ||
        !["token", "login"].includes(saved.mode) ||
        !/^[\x21-\x7e]{16,512}$/.test(saved.secret || "") ||
        (saved.mode === "token" &&
          (saved.secret.length < 32 || saved.expiresAt !== null)) ||
        (saved.mode === "login" &&
          (!Number.isFinite(saved.expiresAt) || saved.expiresAt <= Date.now()))
      )
        throw fail(
          "EXPIRED",
          "저장된 인증 정보가 만료되었어요. 다시 연결해 주세요.",
        );
      origin = safeBase(override || saved.base);
      this.#base = origin;
      this.#secret = saved.secret;
      this.#mode = saved.mode;
      this.#expiry = saved.expiresAt === null ? Infinity : saved.expiresAt;
      const listing = await this.#list("", 0);
      if (epoch !== this.#epoch) throw fail("ABORT", "재연결을 취소했어요.");
      this.#ready = true;
      return listing;
    } catch (error) {
      if (
        ["EXPIRED", "HTTP_401", "PATH", "MODE"].includes(error.code) ||
        (error.code === "URL" && !override)
      )
        await vault.clear();
      if (epoch === this.#epoch) this.#clear();
      // A temporary tunnel/network failure must not erase the remembered token.
      // Keep only a non-secret hint so the address can be corrected without retyping it.
      if (
        origin &&
        error.code !== "ABORT" &&
        !["EXPIRED", "HTTP_401"].includes(error.code)
      ) {
        this.#base = origin;
        this.#mode = saved.mode;
      }
      throw error;
    } finally {
      saved.secret = "";
    }
  }
  #clear() {
    for(const task of this.#thumbQueue)task.reject(fail("ABORT","요청을 취소했어요."));
    this.#thumbQueue=[];
    this.#epoch++;
    this.#ready = false;
    this.#secret = "";
    this.#base = "";
    this.#mode = "";
    this.#expiry = Infinity;
    for (const ctrl of this.#requests.keys()) ctrl.abort();
    this.#requests.clear();
  }
  abortImages() {
    for(const task of this.#thumbQueue)task.reject(fail("ABORT","요청을 취소했어요."));
    this.#thumbQueue=[];
    for (const [ctrl, route] of this.#requests)
      if (["/api/image", "/api/thumbnail"].includes(route)) ctrl.abort();
  }
  async disconnect({ revoke = true } = {}) {
    // Capture only for best-effort revocation; clear local state immediately.
    const base = this.#base,
      secret = this.#secret,
      mode = this.#mode;
    this.#clear();
    if (revoke && base && secret && mode === "login") {
      const ctrl = new AbortController(),
        timer = setTimeout(() => ctrl.abort(), 3000);
      try {
        await this.#fetch(base + "/api/logout", {
          method: "POST",
          body: "{}",
          headers: {
            Authorization: "Bearer " + secret,
            "Content-Type": "application/json",
          },
          mode: "cors",
          credentials: "omit",
          cache: "no-store",
          redirect: "error",
          referrerPolicy: "no-referrer",
          signal: ctrl.signal,
        });
      } catch {
        /* Local disconnect still succeeds. */
      } finally {
        clearTimeout(timer);
      }
    }
  }
  async connect({
    base,
    mode = "token",
    token = "",
    username = "",
    password = "",
  }) {
    const closing = this.disconnect();
    const epoch = this.#epoch;
    await closing;
    if (epoch !== this.#epoch) throw fail("ABORT", "연결을 취소했어요.");
    this.#base = safeBase(base);
    try {
      if (mode === "token") {
        if (!/^[\x21-\x7e]{32,512}$/.test(token.trim()))
          throw fail(
            "TOKEN",
            "기존 사진 조회 토큰을 입력해 주세요 (32자 이상).",
          );
        this.#mode = mode;
        this.#secret = token.trim();
      } else if (mode === "login") {
        if (
          !username.trim() ||
          username.length > 80 ||
          !password ||
          password.length > 128
        )
          throw fail("LOGIN", "사진 API의 아이디와 비밀번호를 입력해 주세요.");
        this.#mode = mode;
        const data = await this.#request("/api/login", {
          body: { username: username.trim(), password },
          auth: false,
        });
        if (
          !/^[\x21-\x7e]{16,512}$/.test(data?.session || "") ||
          !Number.isFinite(data.expiresIn) ||
          data.expiresIn <= 0 ||
          data.expiresIn > 31 * 86400
        )
          throw fail("FORMAT", "로그인 응답 형식이 올바르지 않아요.");
        this.#secret = data.session;
        this.#expiry = Date.now() + data.expiresIn * 1000;
      } else throw fail("MODE", "지원하지 않는 연결 방식이에요.");
      const listing = await this.#list("", 0);
      if (epoch !== this.#epoch) throw fail("ABORT", "연결을 취소했어요.");
      this.#ready = true;
      return listing;
    } catch (error) {
      if (epoch === this.#epoch) await this.disconnect();
      throw error;
    }
  }
  #assertAuth() {
    if (Date.now() >= this.#expiry) {
      this.#clear();
      this.#onExpire();
    }
    if (!this.#secret)
      throw fail("AUTH", "먼저 NAS 사진 보관함에 연결해 주세요.");
  }
  async #list(path, offset) {
    safePath(path);
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > 1000000)
      throw fail("OFFSET", "목록 위치가 올바르지 않아요.");
    return validateListing(
      await this.#request("/api/list", { params: { path, offset } }),
      path,
      offset,
    );
  }
  async list(path = "", offset = 0) {
    this.#assertAuth();
    return this.#list(path, offset);
  }
  async image(path, expectedRevision='') {
    this.#assertAuth();
    safePath(path);
    if (!/\.(jpe?g|png|webp|gif|bmp|heic|heif|avif)$/i.test(path))
      throw fail("IMAGE", "지원하는 사진 파일만 열 수 있어요.");
    return this.#request("/api/image", { params: { path,...(expectedRevision?{revision:expectedRevision}:{}) }, image: true });
  }
  async fileOperation(data) {
    this.#assertAuth();
    if(data.action==='mkdir'){safePath(data.parent);if(!data.name||safePath(data.name).includes('/'))throw fail('PATH','폴더 이름을 확인해 주세요.');}
    else{safePath(data.path);safePath(data.destination);if(!data.name||safePath(data.name).includes('/'))throw fail('PATH','이름을 확인해 주세요.');}
    try{
      const result=await this.#request('/api/files',{body:data,timeoutMs:120000});
      if(!result||result.ok!==true||typeof result.path!=='string'||!result.path)throw fail('FORMAT','파일 작업 결과를 확인할 수 없어요.');safePath(result.path);return result;
    }catch(error){
      if(error.code==='HTTP_409')throw fail(error.code,'같은 이름의 항목이 있거나 원본이 변경됐어요. 덮어쓰지 않았으니 목록을 확인해 주세요.');
      if(error.code==='HTTP_403')throw fail(error.code,'새 API의 사진 쓰기 설정과 해당 NAS 폴더의 쓰기 권한을 확인해 주세요.');
      if(error.code==='HTTP_413')throw fail(error.code,'연결된 기록이 많아 한 번에 처리할 수 없어요. 더 작은 폴더 단위로 정리해 주세요.');
      if(error.code==='HTTP_400')throw fail(error.code,'이름과 이동 위치를 확인해 주세요. 자기 하위 폴더나 확장자 변경은 허용하지 않아요.');
      if(error.code==='HTTP_501')throw fail(error.code,'이 NAS 환경에서 덮어쓰기 없는 안전한 이동을 지원하지 않아 작업하지 않았어요.');
      if(error.code==='HTTP_503')throw fail(error.code,'이전 파일 작업의 복구 확인이 필요해요. 파일 위치를 확인하기 전에는 새 정리를 진행하지 마세요.');
      throw error;
    }
  }
  async journalList({target,kind='',year='',q='',trash=false,offset=0}) {
    this.#assertAuth();
    const data=await this.#request('/api/journal',{params:{target,kind,year,q,trash:trash?'1':'0',offset}});
    if(!data || !Array.isArray(data.items) || data.items.length>10 || !Number.isSafeInteger(data.total) || data.total<0 || !(data.next===null || Number.isSafeInteger(data.next)&&data.next>offset) || !Array.isArray(data.years))throw fail('FORMAT','기록 목록 응답을 확인할 수 없어요.');
    data.items.forEach(validateJournalItem);return data;
  }
  async journalGet(id) {
    this.#assertAuth();return validateJournalItem(await this.#request('/api/journal',{params:{id}}));
  }
  async journalWrite(data) {
    this.#assertAuth();
    try{return validateJournalItem(await this.#request('/api/journal',{body:data,timeoutMs:30000}));}
    catch(e){
      if(e.code==='HTTP_409')throw fail(e.code,'기록이나 첨부 사진이 변경됐어요. 입력 내용은 유지했으니 최신 기록을 확인해 주세요.');
      if(e.code==='HTTP_403')throw fail(e.code,'NAS 기록 저장 폴더의 쓰기 권한을 확인해 주세요.');
      if(e.code==='HTTP_400')throw fail(e.code,'입력값이나 첨부 사진 정보를 확인해 주세요.');
      if(e.code==='HTTP_404')throw fail(e.code,'기록 또는 연결할 사진을 찾지 못했어요. 최신 목록을 확인해 주세요.');
      throw e;
    }
  }
  async journalBackup() {
    this.#assertAuth();return this.#request('/api/journal-backup',{binary:true,maxBytes:64*1024*1024,timeoutMs:120000});
  }
  async createFamilyAccount(password) {
    this.#assertAuth();
    return this.#request('/api/account',{body:{username:'오니둥이',password},timeoutMs:30000});
  }
  async sharedSettings(patch) {
    this.#assertAuth();
    try { return await this.#request("/api/settings", patch === undefined ? {} : {body: patch}); }
    catch(e) {if(e.code==="HTTP_409")throw fail(e.code,"가족 설정이 다른 기기에서 변경됐어요. 다시 시도해 주세요.");throw e;}
  }
  async sharedAlbum(key, year='', refresh=false, seed='') {
    this.#assertAuth();
    return validateSharedAlbum(await this.#request('/api/album-index',{body:{key,year,refresh,...(seed?{seed}:{})},timeoutMs:30000}));
  }
  async capabilities() {
    this.#assertAuth();
    try {
      const d = await this.#request("/api/capabilities");
      if (d?.version !== 2) return {};
      return { ...(d.sharedArchive===true?{sharedArchive:true}:{}), ...(d.randomAlbums===true?{randomAlbums:true}:{}), ...(d.familyLogin===true?{familyLogin:true,accountSetup:d.accountSetup===true}:{}), ...(d.journalRecords===true?{journalRecords:true}:{}), ...(d.fileManagement===true?{fileManagement:true}:{}), ...(d.fileOperationsBlocked===true?{fileOperationsBlocked:true}:{}), ...(typeof d.safeMoves==='boolean'?{safeMoves:d.safeMoves}:{}), thumbnails: d.thumbnails === true, upload: d.upload === true,
        trash: d.trash === true, download: d.download === true,
        maxUpload: Math.min(64 * 1024 * 1024, Number(d.maxUpload) || 0) };
    } catch (e) {
      if (["HTTP_404", "HTTP_405"].includes(e.code)) return {};
      throw e;
    }
  }
  async thumbnail(path, expectedRevision='') {
    this.#assertAuth();safePath(path);
    return new Promise((resolve,reject)=>{
      this.#thumbQueue.push({path,expectedRevision,resolve,reject,epoch:this.#epoch});this.#drainThumbnails();
    });
  }
  #drainThumbnails() {
    while(this.#thumbActive<2 && this.#thumbQueue.length) {
      const task=this.#thumbQueue.shift();
      if(task.epoch!==this.#epoch){task.reject(fail("ABORT","요청을 취소했어요."));continue;}
      this.#thumbActive++;
      this.#request("/api/thumbnail",{params:{path:task.path,...(task.expectedRevision?{revision:task.expectedRevision}:{})},image:true})
        .then(task.resolve,task.reject).finally(()=>{this.#thumbActive--;this.#drainThumbnails();});
    }
  }
  async download(path, modern = false) {
    safePath(path);
    return modern ? this.#request("/api/download", {params:{path}, image:true, maxBytes:128*1024*1024, timeoutMs:120000}) : this.image(path);
  }
  async upload(folder, file) {
    safePath(folder); safePath(file.name);
    if (file.name.includes("/") || !/\.(jpe?g|png|webp|gif|bmp|heic|heif|avif)$/i.test(file.name) || !file.size || file.size > 64*1024*1024)
      throw fail("UPLOAD", "사진 파일만 업로드할 수 있어요. 파일당 최대 64MB예요.");
    return this.#request("/api/upload", {params:{path:folder,name:file.name}, raw:file, timeoutMs:120000});
  }
  trash(item) {
    safePath(item.path);
    if (!/^[a-f0-9]{64}$/.test(item.revision || "")) throw fail("REVISION", "목록을 새로 불러온 뒤 다시 시도해 주세요.");
    return this.#request("/api/trash", {body:{path:item.path,revision:item.revision}});
  }
  trashList() { return this.#request("/api/trash"); }
  restoreTrash(id) {
    if (!/^[a-f0-9]{32}$/.test(id)) throw fail("TRASH", "휴지통 항목이 올바르지 않아요.");
    return this.#request("/api/restore", {body:{id}}).catch(error=>{if(error.code==="HTTP_409")throw fail(error.code,"원래 위치에 같은 이름이 있어 복원하지 않았어요. 덮어쓰지 않고 보관 중이에요.");if(error.code==="HTTP_501")throw fail(error.code,"이 NAS에서 안전한 복원을 지원하지 않아 작업하지 않았어요.");throw error;});
  }
  cancelTransfers() {
    for (const [ctrl,route] of this.#requests)
      if (["/api/upload", "/api/download"].includes(route)) ctrl.abort();
  }
  async #request(
    route,
    { body, raw, params = {}, image = false, binary = false, auth = true, maxBytes, timeoutMs } = {},
  ) {
    if (auth) this.#assertAuth();
    const epoch = this.#epoch,
      url = new URL(this.#base + route);
    Object.entries(params).forEach(([k, v]) =>
      url.searchParams.set(k, String(v)),
    );
    const ctrl = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      ctrl.abort();
    }, timeoutMs || this.#timeout);
    this.#requests.set(ctrl, route);
    try {
      const headers = auth ? { Authorization: "Bearer " + this.#secret } : {};
      if (body) headers["Content-Type"] = "application/json";
      if (raw) headers["Content-Type"] = "application/octet-stream";
      const res = await this.#fetch(url.href, {
        method: body || raw ? "POST" : "GET",
        headers,
        body: raw || (body ? JSON.stringify(body) : undefined),
        signal: ctrl.signal,
        mode: "cors",
        credentials: "omit",
        cache: "no-store",
        redirect: "error",
        referrerPolicy: "no-referrer",
      });
      if (epoch !== this.#epoch) throw fail("ABORT", "연결을 취소했어요.");
      if (!res.ok) {
        if(res.status===409 && route==="/api/upload")throw fail("HTTP_409","같은 이름의 사진이 이미 있어요. 기존 사진은 덮어쓰지 않았어요.");
        if(res.status===409 && route==="/api/trash")throw fail("HTTP_409","사진이 이미 변경됐어요. 목록을 새로 불러온 뒤 다시 확인해 주세요.");
        if(res.status===403 && ["/api/upload","/api/trash","/api/restore"].includes(route))throw fail("HTTP_403","새 API의 사진 쓰기 설정과 해당 NAS 폴더의 쓰기 권한을 확인해 주세요.");
        if(res.status===413 && route==="/api/upload")throw fail("HTTP_413","사진 업로드는 파일당 최대 64MB까지 가능해요.");
        if(res.status===413 && route==="/api/download")throw fail("HTTP_413","원본 다운로드는 파일당 최대 128MB까지 가능해요.");
        if(res.status===409 && ["/api/image","/api/thumbnail"].includes(route))throw fail("HTTP_409","기록에 연결한 사진이 변경됐어요. 사진 연결을 다시 확인해 주세요.");
        if (res.status === 401 && auth) {
          const wasConnected = this.#ready;
          this.#clear();
          if (wasConnected) this.#onExpire();
        }
        throw fail(
          "HTTP_" + res.status,
          messages[res.status] ||
            "사진 API에 연결할 수 없어요. 잠시 후 다시 시도해 주세요.",
        );
      }
      const limit = maxBytes || (image ? 15 * 1024 * 1024 : 2 * 1024 * 1024);
      const payload = await readBounded(res, limit);
      if (epoch !== this.#epoch) throw fail("ABORT", "연결을 취소했어요.");
      if(binary)return new Blob([payload],{type:'application/octet-stream'});
      if (image) {
        const type = (res.headers.get("content-type") || "")
          .split(";")[0]
          .trim()
          .toLowerCase();
        if (!/^image\/(jpeg|png|webp|gif|bmp|avif|heic|heif)$/.test(type))
          throw fail("IMAGE", "이 파일의 사진 형식을 확인할 수 없어요.");
        return new Blob([payload], { type });
      }
      try {
        return JSON.parse(new TextDecoder().decode(payload));
      } catch {
        throw fail(
          "FORMAT",
          "사진 API 응답이 아니에요. 터널 주소가 유효한지 확인해 주세요.",
        );
      }
    } catch (error) {
      if (timedOut)
        throw fail(
          "TIMEOUT",
          "응답 시간이 길어지고 있어요. NAS와 터널 연결을 확인해 주세요.",
        );
      if (error instanceof NasError) throw error;
      if (ctrl.signal.aborted) throw fail("ABORT", "요청을 취소했어요.");
      throw fail(
        "NETWORK",
        "NAS에 닿지 못했어요. 터널 주소·NAS 실행 상태·접근 허용 설정을 확인해 주세요.",
      );
    } finally {
      clearTimeout(timer);
      this.#requests.delete(ctrl);
    }
  }
}
async function readBounded(response, maxBytes) {
  if (Number(response.headers.get("content-length")) > maxBytes) {
    await response.body?.cancel();
    throw fail("SIZE", "파일이 미리보기 크기 제한을 넘었어요.");
  }
  const reader = response.body?.getReader();
  if (!reader) throw fail("FORMAT", "비어 있는 응답을 받았어요.");
  const parts = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw fail("SIZE", "파일이 미리보기 크기 제한을 넘었어요.");
      }
      parts.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const result = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.byteLength;
  }
  return result;
}
