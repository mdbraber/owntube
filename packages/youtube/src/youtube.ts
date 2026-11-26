import { type ClientIdentity, VISIONOS } from "./clients.ts";
import { type PlayerResult, requestPlayer } from "./player.ts";
import type { SessionPool, YouTubeSession } from "./session.ts";

/**
 * OwnTube's entry point to YouTube's player API. Requests go out on the pool's
 * current session, and every answer is reported back so the pool can replace
 * a session YouTube has started to distrust.
 */
export class YouTube {
  readonly #pool: SessionPool;

  constructor(pool: SessionPool) {
    this.#pool = pool;
  }

  /**
   * A video's player response as `identity`. VISIONOS is the default: on
   * 2026-11-26 it was the one client that, without a PO token, gave the full
   * ladder with every dubbed track, captions and live HLS, and whose
   * byte-range URLs were not revoked during playback.
   */
  async player(
    videoId: string,
    identity: ClientIdentity = VISIONOS,
    options: { reloadToken?: string } = {},
  ): Promise<PlayerResult & { session: YouTubeSession }> {
    const session = await this.#pool.session();
    const player = identity.deciphers ? await this.#pool.player() : undefined;
    const result = await requestPlayer(
      {
        videoId,
        identity,
        visitorData: session.visitorData,
        player,
        ...options,
      },
      session.fetch,
    );
    this.#pool.report(session, result.unplayable);
    // Stream URLs are bound to the session's address: fetch them with `session.fetch`.
    return { ...result, session };
  }

  /** Gives up on a YouTube session (see `SessionPool.retire`). */
  retire(session: YouTubeSession): void {
    this.#pool.retire(session);
  }
}
