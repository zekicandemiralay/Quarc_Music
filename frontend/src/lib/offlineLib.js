const DB_NAME = 'quarc-offline';
const DB_VERSION = 1;
const STORE = 'audio';

let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      e.target.result.createObjectStore(STORE, { keyPath: 'songId' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => { dbPromise = null; reject(req.error); };
  });
  return dbPromise;
}

// The song's details are stored alongside its audio, not just the blob.
//
// Without them, anything listing downloaded songs has to look each id up in
// the cached library — so when that cache is missing or stale, songs that
// are sitting right there on the device can't even be named. Keeping a copy
// here makes offline playback self-sufficient: the audio and everything
// needed to display it travel together.
//
// No DB_VERSION bump needed — this adds a field to the stored records, not
// an index or a store. Records written before this simply have no meta, and
// callers fall back to the library cache for those.
export async function saveAudio(songId, blob, meta = null) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put({ songId, blob, meta, savedAt: Date.now() });
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

// Everything downloaded, without pulling the audio blobs into memory —
// reads the records, keeps the small parts, lets the blobs go.
export async function getAllCachedSongs() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE).objectStore(STORE).getAll();
    req.onsuccess = () => resolve((req.result || []).map((r) => ({
      songId: r.songId,
      meta: r.meta || null,
      savedAt: r.savedAt || 0,
      bytes: r.blob?.size || 0,
    })));
    req.onerror = () => reject(req.error);
  });
}

// Fill in details for a song downloaded before meta was stored, once the
// library is reachable again.
export async function setCachedMeta(songId, meta) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    const req = store.get(songId);
    req.onsuccess = () => {
      const rec = req.result;
      if (rec) store.put({ ...rec, meta });
    };
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

export async function getAudioBlob(songId) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE).objectStore(STORE).get(songId);
    req.onsuccess = () => resolve(req.result?.blob ?? null);
    req.onerror = () => reject(req.error);
  });
}

export async function removeAudio(songId) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(songId);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

export async function getAllCachedIds() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE).objectStore(STORE).getAllKeys();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function getStorageEstimate() {
  if ('storage' in navigator && 'estimate' in navigator.storage) {
    return navigator.storage.estimate();
  }
  return null;
}
