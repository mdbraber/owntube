import { Innertube } from "youtubei.js";
import { type ClientIdentity, VISIONOS, WEB } from "./clients.ts";
import { type PlayerResult, requestPlayer } from "./player.ts";
import type { SessionPool, YouTubeSession } from "./session.ts";

/**
 * OwnTube's entry point to YouTube's player API. Requests go out on the pool's
 * current session, and every answer is reported back so the pool can replace
 * a session YouTube has started to distrust.
 */
export class YouTube {
  readonly #pool: SessionPool;
  #innertube: { sessionId: string; yt: Promise<Innertube> } | undefined;

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

  /**
   * A video's player response from the first client that will play it:
   * VISIONOS, then WEB. VISIONOS (like ANDROID_VR) refuses some videos
   * outright, "made for kids" ones among them ("This video is not available",
   * seen 2026-11-26), which WEB plays; its VOD formats are SABR-only, so a
   * session on WEB streams over SABR. Members-only, age and bot answers are
   * the same for every client and end the search.
   */
  async playable(
    videoId: string,
    options: { reloadToken?: string } = {},
  ): Promise<PlayerResult & { session: YouTubeSession }> {
    const first = await this.player(videoId, VISIONOS, options);
    if (
      first.unplayable?.kind !== "unplayable" &&
      first.unplayable?.kind !== "unavailable"
    )
      return first;
    const fallback = await this.player(videoId, WEB, options);
    return fallback.unplayable ? first : fallback;
  }

  /**
   * youtubei.js on the current YouTube session (its address and visitor
   * data), for the catalogue; replaced when the pool replaces the session.
   */
  async innertube(): Promise<Innertube> {
    const session = await this.#pool.session();
    if (this.#innertube?.sessionId !== session.id) {
      const yt = Innertube.create({
        fetch: session.fetch,
        visitor_data: session.visitorData,
        retrieve_player: false,
        enable_session_cache: false,
        lang: "en",
      });
      this.#innertube = { sessionId: session.id, yt };
      yt.catch(() => {
        if (this.#innertube?.yt === yt) this.#innertube = undefined;
      });
    }
    return this.#innertube.yt;
  }

  /** Gives up on a YouTube session (see `SessionPool.retire`). */
  retire(session: YouTubeSession): void {
    this.#pool.retire(session);
  }
}
