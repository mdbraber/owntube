import type { CacheStore } from "./store.ts";

/**
 * How a request may use the cache: `normal` serves a fresh entry or loads;
 * `only` never reaches YouTube (any entry young enough to stand in, else
 * `NotCached`), for pages that must not wait on it; `refresh` loads even over
 * a fresh entry, for an explicit refresh.
 */
export type CacheMode = "normal" | "only" | "refresh";

export class NotCached extends Error {
  constructor(key: string) {
    super(`not cached: ${key}`);
  }
}

/**
 * A cache for catalogue answers: fresh entries are served, concurrent misses
 * share one upstream request, and when YouTube fails a stale entry (up to
 * `staleMs` old) is served instead of the error. Hot entries live in memory;
 * with a `store` every answer is also kept on disk, so a restart does not
 * send every first request to YouTube again.
 */
export class TtlCache {
  readonly #entries = new Map<string, { value: unknown; at: number }>();
  readonly #inFlight = new Map<string, Promise<unknown>>();
  readonly #max: number;
  readonly #now: () => number;
  readonly #store: CacheStore | undefined;

  constructor(
    options: { max?: number; now?: () => number; store?: CacheStore } = {},
  ) {
    this.#max = options.max ?? 5_000;
    this.#now = options.now ?? Date.now;
    this.#store = options.store;
  }

  /** `ttlMs` may depend on the answer (a live video goes stale sooner). */
  async get<T>(
    key: string,
    ttlMs: number | ((value: T) => number),
    staleMs: number,
    load: () => Promise<T>,
    mode: CacheMode = "normal",
  ): Promise<T> {
    const entry = this.#entries.get(key) ?? this.#fromStore(key);
    const age = entry ? this.#now() - entry.at : Number.POSITIVE_INFINITY;
    if (mode === "only") {
      if (entry && age < staleMs) return entry.value as T;
      throw new NotCached(key);
    }
    const ttl =
      entry && typeof ttlMs === "function" ? ttlMs(entry.value as T) : ttlMs;
    if (entry && mode === "normal" && age < (ttl as number))
      return entry.value as T;
    let pending = this.#inFlight.get(key) as Promise<T> | undefined;
    if (!pending) {
      pending = load()
        .then((value) => {
          this.#set(key, value);
          this.#store?.set(key, value, this.#now(), this.#now() + staleMs);
          return value;
        })
        .finally(() => this.#inFlight.delete(key));
      this.#inFlight.set(key, pending);
    }
    try {
      return await pending;
    } catch (error) {
      if (entry && age < staleMs) return entry.value as T;
      throw error;
    }
  }

  #fromStore(key: string): { value: unknown; at: number } | undefined {
    const stored = this.#store?.get(key);
    if (stored) this.#remember(key, stored);
    return stored;
  }

  #set(key: string, value: unknown): void {
    this.#remember(key, { value, at: this.#now() });
  }

  #remember(key: string, entry: { value: unknown; at: number }): void {
    this.#entries.delete(key);
    this.#entries.set(key, entry);
    for (const oldest of this.#entries.keys()) {
      if (this.#entries.size <= this.#max) break;
      this.#entries.delete(oldest);
    }
  }
}
