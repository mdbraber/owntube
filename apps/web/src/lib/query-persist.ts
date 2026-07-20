import { dehydrate, hydrate, type QueryClient } from "@tanstack/react-query";

/**
 * Zero-dependency persistence for the react-query cache, backed by IndexedDB.
 *
 * Why hand-rolled instead of @tanstack/react-query-persist-client: it keeps the
 * frozen-lockfile Docker build free of three extra deps, and react-query's own
 * `dehydrate`/`hydrate` cover everything we need. IndexedDB (not localStorage)
 * because the dehydrated feed cache easily exceeds localStorage's ~5MB and
 * IndexedDB stores structured-clonable objects directly — Dates in query data
 * survive the round-trip without any superjson step.
 *
 * On load we hydrate the last snapshot so client-rendered pages (subscriptions,
 * search, channel tabs) paint from cache instead of a skeleton; combined with
 * the per-query staleTime, react-query still revalidates in the background.
 */

const DB_NAME = "owntube-rq";
const STORE = "cache";
const KEY = "queryState";
const MAX_AGE_MS = 24 * 60 * 60 * 1000; // ignore a snapshot older than a day
/** Bump to invalidate every persisted snapshot after a shape/transform change. */
const BUSTER = "v1";
const WRITE_THROTTLE_MS = 2_000;

type Snapshot = { savedAt: number; buster: string; state: unknown };

function openIdb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    if (typeof indexedDB === "undefined") {
      resolve(null);
      return;
    }
    let req: IDBOpenDBRequest;
    try {
      req = indexedDB.open(DB_NAME, 1);
    } catch {
      resolve(null);
      return;
    }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
    req.onblocked = () => resolve(null);
  });
}

function idbGet(db: IDBDatabase): Promise<Snapshot | null> {
  return new Promise((resolve) => {
    try {
      const req = db.transaction(STORE, "readonly").objectStore(STORE).get(KEY);
      req.onsuccess = () => resolve((req.result as Snapshot | undefined) ?? null);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

function idbPut(db: IDBDatabase, value: Snapshot): void {
  try {
    db.transaction(STORE, "readwrite").objectStore(STORE).put(value, KEY);
  } catch {
    /* quota / cloning error — drop this snapshot, try again next change */
  }
}

/** Hydrate the last snapshot into the client. Safe to call once, after mount. */
export async function restoreQueryCache(qc: QueryClient): Promise<void> {
  const db = await openIdb();
  if (!db) return;
  const snap = await idbGet(db);
  if (!snap || snap.buster !== BUSTER) return;
  if (Date.now() - snap.savedAt > MAX_AGE_MS) return;
  try {
    hydrate(qc, snap.state);
  } catch {
    /* malformed snapshot — ignore, it'll be overwritten */
  }
}

/**
 * Persist successful queries to IndexedDB on cache changes (throttled).
 * Returns an unsubscribe function.
 */
export function startQueryCachePersist(qc: QueryClient): () => void {
  let dbPromise: Promise<IDBDatabase | null> | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const flush = () => {
    timer = null;
    if (!dbPromise) dbPromise = openIdb();
    void dbPromise.then((db) => {
      if (!db) return;
      let state: unknown;
      try {
        state = dehydrate(qc, {
          // Only cache resolved data — never persist pending/errored queries.
          shouldDehydrateQuery: (q) =>
            q.state.status === "success" && q.state.data !== undefined,
        });
      } catch {
        return;
      }
      idbPut(db, { savedAt: Date.now(), buster: BUSTER, state });
    });
  };

  const schedule = () => {
    if (timer) return;
    timer = setTimeout(flush, WRITE_THROTTLE_MS);
  };

  const unsubscribe = qc.getQueryCache().subscribe(schedule);
  return () => {
    unsubscribe();
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  };
}
