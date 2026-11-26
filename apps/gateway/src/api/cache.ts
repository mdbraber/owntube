/**
 * A small in-memory cache for catalogue answers: fresh entries are served,
 * concurrent misses share one upstream request, and when YouTube fails a
 * stale entry (up to `staleMs` old) is served instead of the error.
 */
export class TtlCache {
  readonly #entries = new Map<string, { value: unknown; at: number }>();
  readonly #inFlight = new Map<string, Promise<unknown>>();
  readonly #max: number;
  readonly #now: () => number;

  constructor(options: { max?: number; now?: () => number } = {}) {
    this.#max = options.max ?? 5_000;
    this.#now = options.now ?? Date.now;
  }

  async get<T>(
    key: string,
    ttlMs: number,
    staleMs: number,
    load: () => Promise<T>,
  ): Promise<T> {
    const entry = this.#entries.get(key);
    const age = entry ? this.#now() - entry.at : Number.POSITIVE_INFINITY;
    if (entry && age < ttlMs) return entry.value as T;
    let pending = this.#inFlight.get(key) as Promise<T> | undefined;
    if (!pending) {
      pending = load()
        .then((value) => {
          this.#set(key, value);
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

  #set(key: string, value: unknown): void {
    this.#entries.delete(key);
    this.#entries.set(key, { value, at: this.#now() });
    for (const oldest of this.#entries.keys()) {
      if (this.#entries.size <= this.#max) break;
      this.#entries.delete(oldest);
    }
  }
}
