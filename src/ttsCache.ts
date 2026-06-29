// Persistent (IndexedDB) cache for synthesized TTS audio.
//
// Stores audio Blobs keyed by a SHA-256 of (language, text) so replays across
// reloads and return visits don't re-call the TTS endpoint. Best-effort: any
// failure (private mode, disabled storage, quota) degrades silently to a cache
// miss, so the caller just falls through to the network.

const DB_NAME = "tts-cache";
const STORE = "audio";
const VERSION = 1;
const MAX_ENTRIES = 50; // keep the newest N clips; oldest are pruned

interface CacheRecord {
  key: string;
  blob: Blob;
  createdAt: number;
}

let dbPromise: Promise<IDBDatabase> | null = null;
let persistRequested = false;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: "key" });
        store.createIndex("createdAt", "createdAt");
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  // If the connection closes unexpectedly, allow a fresh open next time.
  dbPromise.then(
    (db) => {
      db.onclose = () => {
        dbPromise = null;
      };
    },
    () => {
      dbPromise = null;
    },
  );
  return dbPromise;
}

async function keyFor(text: string, lang: string): Promise<string> {
  const data = new TextEncoder().encode(`${lang}\n${text}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Ask the browser to keep this origin's storage from being evicted. Best-effort, once. */
async function requestPersist(): Promise<void> {
  if (persistRequested) return;
  persistRequested = true;
  try {
    if (navigator.storage?.persist && !(await navigator.storage.persisted())) {
      await navigator.storage.persist();
    }
  } catch {
    /* best effort — ignore */
  }
}

/** Return a cached audio Blob for this text, or null on miss / any error. */
export async function getCachedTts(text: string, lang: string): Promise<Blob | null> {
  try {
    const db = await openDb();
    const key = await keyFor(text, lang);
    return await new Promise<Blob | null>((resolve, reject) => {
      const req = db.transaction(STORE, "readonly").objectStore(STORE).get(key);
      req.onsuccess = () => {
        const rec = req.result as CacheRecord | undefined;
        resolve(rec ? rec.blob : null);
      };
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
}

/** Persist an audio Blob for this text. Silent on failure. */
export async function putCachedTts(text: string, lang: string, blob: Blob): Promise<void> {
  try {
    await requestPersist();
    const db = await openDb();
    const key = await keyFor(text, lang);
    const record: CacheRecord = { key, blob, createdAt: Date.now() };
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(record);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
    await prune(db);
  } catch {
    /* ignore cache write failures */
  }
}

/** Keep only the newest MAX_ENTRIES records, deleting the oldest by createdAt. */
async function prune(db: IDBDatabase): Promise<void> {
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      const store = tx.objectStore(STORE);
      const countReq = store.count();
      countReq.onsuccess = () => {
        let excess = countReq.result - MAX_ENTRIES;
        if (excess <= 0) return;
        const cursorReq = store.index("createdAt").openCursor(); // ascending = oldest first
        cursorReq.onsuccess = () => {
          const cursor = cursorReq.result;
          if (cursor && excess > 0) {
            cursor.delete();
            excess--;
            cursor.continue();
          }
        };
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } catch {
    /* ignore prune failures */
  }
}
