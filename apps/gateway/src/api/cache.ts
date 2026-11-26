import type { CacheStore } from "./store.ts";

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

  async get<T>(
    key: string,
    ttlMs: number,
    staleMs: number,
    load: () => Promise<T>,
  ): Promise<T> {
    const entry = this.#entries.get(key) ?? this.#fromStore(key);
    const age = entry ? this.#now() - entry.at : Number.POSITIVE_INFINITY;
    if (entry && age < ttlMs) return entry.value as T;
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
