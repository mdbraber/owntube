import { randomUUID } from "node:crypto";
import { Innertube, type Player } from "youtubei.js";
import { loadPlayer } from "./decipher.ts";
import type { Egress } from "./egress.ts";
import type { Unplayable } from "./playability.ts";

/**
 * One coherent identity towards YouTube: visitor data and the source address
 * it was created from. Everything a session sends leaves from that address,
 * because YouTube judges a visitor and its address together.
 */
export interface YouTubeSession {
  id: string;
  visitorData: string;
  /** Source address, or undefined for the default route. */
  localAddress: string | undefined;
  fetch: typeof globalThis.fetch;
  createdAt: number;
}

/** Chooses source addresses and hears how YouTube treated them. */
export interface AddressPolicy {
  next(): string | undefined;
  /** Called when a session on `address` got a bot check. */
  flag(address: string | undefined): void;
}

/** Everything leaves from the host's default route. */
export const defaultRoute: AddressPolicy = {
  next: () => undefined,
  flag: () => {},
};

export interface SessionPoolOptions {
  egress: Egress;
  addresses?: AddressPolicy;
  /** A session is replaced after this long (default 1 h). */
  maxAgeMs?: number;
  /** Bot checks in a row before a session is replaced (default 3). */
  maxStrikes?: number;
  /** The player JS is reloaded after this long (default 6 h). */
  playerMaxAgeMs?: number;
  /** Creates visitor data through a session's fetch; injectable for tests. */
  createVisitorData?: (fetch: typeof globalThis.fetch) => Promise<string>;
  loadPlayer?: (fetch: typeof globalThis.fetch) => Promise<Player>;
  now?: () => number;
}

/** youtubei.js's session bootstrap (`sw.js_data`), used only for its visitor data. */
async function bootstrapVisitorData(
  fetch: typeof globalThis.fetch,
): Promise<string> {
  const yt = await Innertube.create({
    fetch,
    retrieve_player: false,
    enable_session_cache: false,
  });
  const visitorData = yt.session.context.client.visitorData;
  if (!visitorData) throw new Error("YouTube returned no visitor data");
  return visitorData;
}

/**
 * Hands out the current YouTube session and replaces it when it is too old or
 * YouTube keeps asking it to prove it is not a bot. Creation is single-flight:
 * concurrent callers share one bootstrap.
 */
export class SessionPool {
  readonly #egress: Egress;
  readonly #addresses: AddressPolicy;
  readonly #maxAgeMs: number;
  readonly #maxStrikes: number;
  readonly #playerMaxAgeMs: number;
  readonly #createVisitorData: (
    fetch: typeof globalThis.fetch,
  ) => Promise<string>;
  readonly #loadPlayer: (fetch: typeof globalThis.fetch) => Promise<Player>;
  readonly #now: () => number;
  #current: Promise<YouTubeSession> | undefined;
  #currentId: string | undefined;
  #strikes = 0;
  #player: { loadedAt: number; player: Promise<Player> } | undefined;

  constructor(options: SessionPoolOptions) {
    this.#egress = options.egress;
    this.#addresses = options.addresses ?? defaultRoute;
    this.#maxAgeMs = options.maxAgeMs ?? 60 * 60_000;
    this.#maxStrikes = options.maxStrikes ?? 3;
    this.#playerMaxAgeMs = options.playerMaxAgeMs ?? 6 * 60 * 60_000;
    this.#createVisitorData = options.createVisitorData ?? bootstrapVisitorData;
    this.#loadPlayer = options.loadPlayer ?? loadPlayer;
    this.#now = options.now ?? Date.now;
  }

  async session(): Promise<YouTubeSession> {
    if (this.#current) {
      try {
        const session = await this.#current;
        if (this.#now() - session.createdAt < this.#maxAgeMs) return session;
      } catch {
        // the last bootstrap failed; make a new one below
      }
      this.#current = undefined;
    }
    this.#current ??= this.#create();
    return this.#current;
  }

  /** YouTube's player JS (signature timestamp, decipher functions), shared by all sessions. */
  async player(): Promise<Player> {
    if (
      !this.#player ||
      this.#now() - this.#player.loadedAt >= this.#playerMaxAgeMs
    ) {
      const player = this.#loadPlayer(this.#egress.fetch());
      this.#player = { loadedAt: this.#now(), player };
      player.catch(() => {
        if (this.#player?.player === player) this.#player = undefined;
      });
    }
    return this.#player.player;
  }

  /**
   * Replaces `session` now and flags its address: YouTube has made clear it
   * no longer trusts this identity (a rejected SABR attestation).
   */
  retire(session: YouTubeSession): void {
    if (session.id !== this.#currentId) return;
    this.#addresses.flag(session.localAddress);
    this.#strikes = 0;
    this.#current = undefined;
    this.#currentId = undefined;
  }

  /** Tells the pool how YouTube answered a request made with `session`. */
  report(session: YouTubeSession, unplayable: Unplayable | null): void {
    if (session.id !== this.#currentId) return; // already replaced
    if (unplayable?.kind !== "bot-check") {
      this.#strikes = 0;
      return;
    }
    this.#strikes++;
    if (this.#strikes < this.#maxStrikes) return;
    this.#addresses.flag(session.localAddress);
    this.#strikes = 0;
    this.#current = undefined;
    this.#currentId = undefined;
  }

  async #create(): Promise<YouTubeSession> {
    const localAddress = this.#addresses.next();
    const fetch = this.#egress.fetch(localAddress);
    const visitorData = await this.#createVisitorData(fetch);
    const session = {
      id: randomUUID(),
      visitorData,
      localAddress,
      fetch,
      createdAt: this.#now(),
    };
    this.#currentId = session.id;
    this.#strikes = 0;
    return session;
  }
}
