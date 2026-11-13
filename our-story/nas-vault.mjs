// Device-local connection memory. No plaintext credential or photo records.
// This does not isolate credentials from other scripts on the same web origin.
const LABEL = new TextEncoder().encode("our-story/nas-connection/v1");
export class VaultError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "VaultError";
    this.code = code;
  }
}
const unavailable = () =>
  new VaultError(
    "STORAGE",
    "이 브라우저에서 연결 정보를 저장하지 못했어요. 일반 브라우저에서 다시 시도해 주세요.",
  );
export async function encryptConnection(
  payload,
  cryptoImpl = globalThis.crypto,
) {
  if (!cryptoImpl?.subtle) throw unavailable();
  const key = await cryptoImpl.subtle.generateKey(
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
  const iv = cryptoImpl.getRandomValues(new Uint8Array(12));
  const ciphertext = await cryptoImpl.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: LABEL },
    key,
    new TextEncoder().encode(JSON.stringify(payload)),
  );
  return { version: 1, key, iv, ciphertext };
}
export async function decryptConnection(
  record,
  cryptoImpl = globalThis.crypto,
) {
  if (
    !record ||
    record.version !== 1 ||
    record.key?.type !== "secret" ||
    record.key.extractable ||
    !(record.iv instanceof Uint8Array) ||
    record.iv.length !== 12 ||
    !(record.ciphertext instanceof ArrayBuffer) ||
    record.ciphertext.byteLength > 8192
  )
    throw new Error("Invalid saved connection");
  const raw = await cryptoImpl.subtle.decrypt(
    { name: "AES-GCM", iv: record.iv, additionalData: LABEL },
    record.key,
    record.ciphertext,
  );
  return JSON.parse(new TextDecoder().decode(raw));
}
export function indexedConnectionStore(
  indexedDBImpl = globalThis.indexedDB,
  databaseName = "our-story-nas-connection-v1",
) {
  async function open() {
    if (!indexedDBImpl) throw unavailable();
    return new Promise((resolve, reject) => {
      const request = indexedDBImpl.open(databaseName, 1);
      request.onupgradeneeded = () => {
        request.result.createObjectStore("connection");
      };
      request.onerror = request.onblocked = () => reject(unavailable());
      request.onsuccess = () => {
        request.result.onversionchange = () => request.result.close();
        resolve(request.result);
      };
    });
  }
  async function run(mode, action) {
    const db = await open();
    try {
      return await new Promise((resolve, reject) => {
        const tx = db.transaction("connection", mode),
          store = tx.objectStore("connection");
        let result;
        const req = action(store);
        req.onsuccess = () => {
          result = req.result;
        };
        tx.oncomplete = () => resolve(result);
        tx.onabort = tx.onerror = () => reject(unavailable());
      });
    } catch {
      throw unavailable();
    } finally {
      db.close();
    }
  }
  return {
    read: () => run("readonly", (store) => store.get("saved")),
    write: (record) => run("readwrite", (store) => store.put(record, "saved")),
    clear: () => run("readwrite", (store) => store.delete("saved")),
  };
}
export class ConnectionVault {
  #store;
  #crypto;
  #queue = Promise.resolve();
  #generation = 0;
  constructor({
    store = indexedConnectionStore(),
    cryptoImpl = globalThis.crypto,
  } = {}) {
    this.#store = store;
    this.#crypto = cryptoImpl;
  }
  #run(fn) {
    const next = this.#queue.then(fn);
    this.#queue = next.catch(() => {});
    return next;
  }
  async has() {
    return this.#run(async () => !!(await this.#store.read()));
  }
  async load() {
    return this.#run(async () => {
      let record;
      try {
        record = await this.#store.read();
      } catch {
        throw unavailable();
      }
      if (!record) return null;
      try {
        return await decryptConnection(record, this.#crypto);
      } catch {
        await this.#store.clear();
        throw new VaultError(
          "CORRUPT",
          "저장된 연결 정보를 읽지 못해 지웠어요. 한 번 다시 연결해 주세요.",
        );
      }
    });
  }
  save(payload) {
    const generation = ++this.#generation;
    // Copy before enqueue; later changes to a form object cannot change the saved secret.
    const snapshot = structuredClone(payload);
    return this.#run(async () => {
      try {
        const record = await encryptConnection(snapshot, this.#crypto);
        if (generation !== this.#generation) return false;
        await this.#store.write(record);
        return true;
      } catch {
        throw unavailable();
      }
    });
  }
  clear() {
    ++this.#generation;
    return this.#run(async () => {
      try {
        await this.#store.clear();
      } catch {
        throw unavailable();
      }
    });
  }
}
