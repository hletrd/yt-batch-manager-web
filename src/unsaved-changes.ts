// Changes left unsaved when a save was cut short by the YouTube API quota (or
// YouTube's thumbnail-upload limit), kept in IndexedDB so they survive closing
// the tab until the quota resets. localStorage is too small for this: the
// records carry full descriptions and the thumbnails are image blobs.
//
// One object store, key → value:
//   'snapshot'      UnsavedSnapshot (backup-format records, see backup.ts)
//   'thumb:<id>'    Blob of a pending thumbnail
// No DOM, no app state. Every function degrades to a no-op/empty result when
// IndexedDB is unavailable (e.g. some private-browsing modes).

const DB_NAME = 'yt-batch-manager';
const STORE = 'unsaved-changes';
const SNAPSHOT_KEY = 'snapshot';
const thumbnailKey = (videoId: string) => `thumb:${videoId}`;

export type InterruptionReason = 'quota' | 'thumbnailLimit';

export interface UnsavedSnapshot {
  savedAt: number;
  reason: InterruptionReason;
  // Backup-format records (filterVideoDataForBackup) of the desired state.
  records: Record<string, unknown>[];
  // Videos whose pending thumbnail is stored under thumbnailKey(id).
  thumbnailIds: string[];
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

// Run `work` in one transaction and resolve once it has committed.
async function transact<T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => Promise<T> | T): Promise<T> {
  const db = await openDb();
  try {
    const tx = db.transaction(STORE, mode);
    const done = new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
    // Observed below; this only stops an early throw in `work` from also
    // surfacing as an unhandled rejection.
    done.catch(() => undefined);
    const result = await work(tx.objectStore(STORE));
    await done;
    return result;
  } finally {
    db.close();
  }
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

// Replace any previous snapshot with this one.
export async function saveUnsavedChanges(records: Record<string, unknown>[], thumbnails: ReadonlyMap<string, Blob>, reason: InterruptionReason): Promise<boolean> {
  try {
    await transact('readwrite', store => {
      store.clear();
      const snapshot: UnsavedSnapshot = { savedAt: Date.now(), reason, records, thumbnailIds: [...thumbnails.keys()] };
      store.put(snapshot, SNAPSHOT_KEY);
      for (const [videoId, blob] of thumbnails) {
        store.put(blob, thumbnailKey(videoId));
      }
    });
    return true;
  } catch (error) {
    console.warn('Failed to keep unsaved changes:', error);
    return false;
  }
}

export async function loadUnsavedChanges(): Promise<{ snapshot: UnsavedSnapshot; thumbnails: Map<string, Blob> } | null> {
  try {
    return await transact('readonly', async store => {
      const snapshot = await requestResult(store.get(SNAPSHOT_KEY)) as UnsavedSnapshot | undefined;
      if (!snapshot || !Array.isArray(snapshot.records)) {
        return null;
      }
      const thumbnails = new Map<string, Blob>();
      for (const videoId of snapshot.thumbnailIds || []) {
        const blob = await requestResult(store.get(thumbnailKey(videoId)));
        if (blob instanceof Blob) {
          thumbnails.set(videoId, blob);
        }
      }
      return { snapshot, thumbnails };
    });
  } catch (error) {
    console.warn('Failed to read unsaved changes:', error);
    return null;
  }
}

// Drop the given videos (now saved) from the snapshot; clears it when empty.
export async function forgetUnsavedChanges(videoIds: Iterable<string>): Promise<void> {
  const ids = new Set(videoIds);
  if (ids.size === 0) return;
  try {
    await transact('readwrite', async store => {
      const snapshot = await requestResult(store.get(SNAPSHOT_KEY)) as UnsavedSnapshot | undefined;
      if (!snapshot) return;
      const records = snapshot.records.filter(record => !ids.has(record.id as string));
      const thumbnailIds = (snapshot.thumbnailIds || []).filter(id => !ids.has(id));
      if (records.length === 0 && thumbnailIds.length === 0) {
        store.clear();
        return;
      }
      for (const id of ids) {
        store.delete(thumbnailKey(id));
      }
      store.put({ ...snapshot, records, thumbnailIds }, SNAPSHOT_KEY);
    });
  } catch (error) {
    console.warn('Failed to update unsaved changes:', error);
  }
}

export async function clearUnsavedChanges(): Promise<void> {
  try {
    await transact('readwrite', store => {
      store.clear();
    });
  } catch (error) {
    console.warn('Failed to clear unsaved changes:', error);
  }
}
