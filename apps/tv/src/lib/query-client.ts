import { createAsyncStoragePersister } from "@tanstack/query-async-storage-persister";
import { QueryClient } from "@tanstack/react-query";
import type {
  PersistedClient,
  Persister,
} from "@tanstack/react-query-persist-client";
import { isTransientNetworkError } from "@web/lib/query-retry";
import * as FileSystem from "expo-file-system/legacy";

/**
 * The same query configuration the web app uses (see apps/web/src/app/
 * providers.tsx) — identical staleTime and retry rules, sharing the
 * `isTransientNetworkError` predicate rather than restating it.
 *
 * The difference is persistence: the web persists to IndexedDB, which React
 * Native doesn't have. Here the cache is written to a file via
 * expo-file-system, which already ships with Expo — AsyncStorage would be a new
 * dependency and SecureStore caps values near 2KB, far below a feed page.
 */

/** Bump to discard a persisted cache whose shape no longer matches. */
export const CACHE_BUSTER = "v1";
/** A snapshot on disk older than this is discarded at launch. */
export const PERSIST_MAX_AGE_MS = 24 * 60 * 60 * 1000;
/**
 * How long data no screen is using stays in memory. It used to be the full
 * day of the disk snapshot, so a session kept everything it ever loaded (a
 * page per channel focused in Subscriptions, every video opened) and memory
 * only grew. Screens still showing their data keep it however long.
 */
const IN_MEMORY_MS = 30 * 60 * 1000;
const FILE = `${FileSystem.cacheDirectory ?? ""}owntube-query-cache.json`;

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      gcTime: IN_MEMORY_MS,
      retry: (failureCount, error) =>
        isTransientNetworkError(error) && failureCount < 3,
      // A TV app has no window focus, and remounting a screen shouldn't refetch
      // what is still fresh — the staleTime governs that instead.
      refetchOnWindowFocus: false,
    },
    mutations: {
      retry: (failureCount, error) =>
        isTransientNetworkError(error) && failureCount < 2,
      retryDelay: (attempt) => Math.min(500 * 2 ** attempt, 3000),
    },
  },
});

/**
 * File-backed storage in the shape the persister expects. Every call is guarded:
 * storage can be unavailable or the file corrupt, and neither should stop the
 * app — it just runs without a persisted cache.
 */
const fileStorage = {
  getItem: async (_key: string): Promise<string | null> => {
    try {
      const info = await FileSystem.getInfoAsync(FILE);
      if (!info.exists) return null;
      return await FileSystem.readAsStringAsync(FILE);
    } catch {
      return null;
    }
  },
  setItem: async (_key: string, value: string): Promise<void> => {
    try {
      await FileSystem.writeAsStringAsync(FILE, value);
    } catch {
      // Persistence is an optimisation; the in-memory cache still works.
    }
  },
  removeItem: async (_key: string): Promise<void> => {
    try {
      await FileSystem.deleteAsync(FILE, { idempotent: true });
    } catch {}
  },
};

export const persister: Persister = createAsyncStoragePersister({
  storage: fileStorage,
  key: "owntube-query-cache",
  // Saved only when the app goes to the background (see trpc-react), so there
  // is nothing to space out.
  throttleTime: 0,
  serialize: (client: PersistedClient) => JSON.stringify(trimFeeds(client)),
  deserialize: (cached: string) => JSON.parse(cached) as PersistedClient,
});

/**
 * Persists only the first page of each infinite feed. A relaunch only needs
 * the first screenful to paint instantly; every extra page scrolled through
 * made each write, and the restore on launch, slower.
 */
function trimFeeds(client: PersistedClient): PersistedClient {
  return {
    ...client,
    clientState: {
      ...client.clientState,
      queries: client.clientState.queries.map((query) => {
        const data = query.state.data as
          | { pages?: unknown[]; pageParams?: unknown[] }
          | undefined;
        if (!Array.isArray(data?.pages) || data.pages.length <= 1) return query;
        return {
          ...query,
          state: {
            ...query.state,
            data: {
              pages: data.pages.slice(0, 1),
              pageParams: (data.pageParams ?? []).slice(0, 1),
            },
          },
        };
      }),
    },
  };
}
