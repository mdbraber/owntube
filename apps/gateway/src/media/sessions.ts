import { randomBytes } from "node:crypto";
import {
  buildProgressive,
  type ProgressiveFile,
  type ProgressiveSource,
} from "@owntube/playback/mp4";
import {
  moofSize,
  parseFragment,
  parseInit,
} from "@owntube/playback/mp4/fragmented";
import { parseSidx, type Segment } from "@owntube/playback/sidx";
import type { AudioTrack, VideoTrack } from "@owntube/playback/tracks";
import type { Unplayable } from "@owntube/youtube/playability";
import {
  type PresentationSources,
  toPresentation,
} from "@owntube/youtube/presentation";
import {
  type SabrEndpoint,
  SabrTrack,
  sabrEndpoint,
  sabrOpener,
} from "@owntube/youtube/sabr";
import type { YouTubeSession } from "@owntube/youtube/session";
import type { YouTube } from "@owntube/youtube/youtube";
import {
  type LiveState,
  PLAYLIST_TTL_MS,
  rewriteMaster,
  rewriteMedia,
} from "./live.ts";
import type { ByteSpan, UpstreamSource } from "./upstream.ts";

export class Unavailable extends Error {
  readonly unplayable: Unplayable;
  constructor(unplayable: Unplayable) {
    super(unplayable.reason);
    this.unplayable = unplayable;
  }
}

/**
 * One viewer's playback of one video: the YouTube session (and so the address)
 * the stream URLs are bound to, and the tracks they map to. Every URL in a
 * manifest is relative to it, so segments never need to be looked up by video.
 */
export interface PlaybackSession {
  id: string;
  videoId: string;
  youtube: YouTubeSession;
  userAgent: string;
  sources: PresentationSources;
  /**
   * How track bytes are read: byte ranges of the stream URLs, or SABR when
   * there are none or YouTube refuses a fresh URL set (see `source`).
   */
  transport: "byte-range" | "sabr";
  sabr: SabrEndpoint | undefined;
  sabrTracks: Map<string, SabrTrack>;
  /** Set for live streams and post-live DVR, which are served from YouTube's own HLS. */
  live: LiveState | undefined;
  createdAt: number;
  lastUsed: number;
  /** Track id → its segments, read once from the track's index. */
  segments: Map<string, Promise<Segment[]>>;
  /** "videoTrack+audioTrack" → the progressive MP4 built from them. */
  progressive: Map<string, Promise<ProgressiveFile>>;
  refreshing: Promise<void> | undefined;
}

/** Keeps built progressive MP4 layouts; they depend on the file, not on its URLs. */
export interface ProgressiveStore {
  get(key: string): Promise<ProgressiveFile | undefined>;
  put(key: string, file: ProgressiveFile): Promise<void>;
}

export interface PlaybackSessionsOptions {
  youtube: YouTube;
  /** Start sessions on SABR instead of byte ranges. */
  preferSabr?: boolean;
  progressiveStore?: ProgressiveStore;
  /** Sessions end this long after creation (YouTube's stream URLs last ~6 h). */
  maxAgeMs?: number;
  /** …or after this long unused. */
  idleMs?: number;
  max?: number;
  now?: () => number;
}

export class PlaybackSessions {
  readonly #youtube: YouTube;
  readonly #store: ProgressiveStore | undefined;
  readonly #preferSabr: boolean;
  readonly #maxAgeMs: number;
  readonly #idleMs: number;
  readonly #max: number;
  readonly #now: () => number;
  readonly #sessions = new Map<string, PlaybackSession>();
  /** videoId → the session shared by whole-file requests (podcast apps ask again and again). */
  readonly #shared = new Map<string, Promise<PlaybackSession>>();

  constructor(options: PlaybackSessionsOptions) {
    this.#youtube = options.youtube;
    this.#store = options.progressiveStore;
    this.#preferSabr = options.preferSabr ?? false;
    this.#maxAgeMs = options.maxAgeMs ?? 5 * 60 * 60_000;
    this.#idleMs = options.idleMs ?? 60 * 60_000;
    this.#max = options.max ?? 500;
    this.#now = options.now ?? Date.now;
  }

  async create(videoId: string): Promise<PlaybackSession> {
    const { youtube, userAgent, sources, masterUrl, sabr } =
      await this.#resolve(videoId);
    this.#sweep();
    const now = this.#now();
    const session: PlaybackSession = {
      id: randomBytes(16).toString("base64url"),
      videoId,
      youtube,
      userAgent,
      sources,
      live: masterUrl ? { masterUrl, renditions: new Map() } : undefined,
      // SABR when asked to, or when the response has no stream URLs at all.
      transport:
        sabr &&
        (this.#preferSabr || ![...sources.media.values()].some((m) => m.url))
          ? "sabr"
          : "byte-range",
      sabr,
      sabrTracks: new Map(),
      createdAt: now,
      lastUsed: now,
      segments: new Map(),
      progressive: new Map(),
      refreshing: undefined,
    };
    this.#sessions.set(session.id, session);
    return session;
  }

  /** A session for whole-file requests, reused while it lives so repeated ranges do not ask YouTube again. */
  async shared(videoId: string): Promise<PlaybackSession> {
    const existing = this.#shared.get(videoId);
    if (existing) {
      const session = await existing.catch(() => undefined);
      if (session && this.get(session.id)) return session;
      this.#shared.delete(videoId);
    }
    const created = this.create(videoId);
    this.#shared.set(videoId, created);
    created.catch(() => this.#shared.delete(videoId));
    return created;
  }

  get(id: string): PlaybackSession | undefined {
    const session = this.#sessions.get(id);
    if (!session) return undefined;
    const now = this.#now();
    if (
      now - session.createdAt >= this.#maxAgeMs ||
      now - session.lastUsed >= this.#idleMs
    ) {
      this.#end(session);
      return undefined;
    }
    session.lastUsed = now;
    return session;
  }

  get size(): number {
    return this.#sessions.size;
  }

  /** A track's segments, from its sidx (fMP4 only; WebM players read Cues themselves). */
  segments(session: PlaybackSession, trackId: string): Promise<Segment[]> {
    let segments = session.segments.get(trackId);
    if (!segments) {
      segments = this.#readSegments(session, trackId);
      session.segments.set(trackId, segments);
      segments.catch(() => session.segments.delete(trackId));
    }
    return segments;
  }

  /** A regular MP4 of one video and one audio track; built once per session. */
  progressiveFile(
    session: PlaybackSession,
    videoId: string,
    audioId: string,
  ): Promise<ProgressiveFile> {
    const key = `${videoId}+${audioId}`;
    let file = session.progressive.get(key);
    if (!file) {
      file = this.#loadProgressive(session, videoId, audioId);
      session.progressive.set(key, file);
      file.catch(() => session.progressive.delete(key));
    }
    return file;
  }

  async #loadProgressive(
    session: PlaybackSession,
    videoId: string,
    audioId: string,
  ): Promise<ProgressiveFile> {
    const sizes = [videoId, audioId]
      .map((id) => findTrack(session, id)?.contentLength ?? 0)
      .join("+");
    const storeKey = `${session.videoId}/${videoId}+${audioId}/${sizes}`;
    const stored = await this.#store?.get(storeKey).catch(() => undefined);
    if (stored) return stored;
    const file = buildProgressive([
      await this.#progressiveSource(session, videoId),
      await this.#progressiveSource(session, audioId),
    ]);
    await this.#store?.put(storeKey, file).catch(() => {});
    return file;
  }

  /** A track's init and every fragment's samples, read from the fragments' moof boxes. */
  async #progressiveSource(
    session: PlaybackSession,
    trackId: string,
  ): Promise<ProgressiveSource> {
    const track = findTrack(session, trackId);
    if (!track || !track.mimeType.endsWith("mp4"))
      throw new Error(`no MP4 track ${trackId}`);
    const init = parseInit(await this.#bytes(session, trackId, track.init));
    const segments = await this.segments(session, trackId);
    // One at a time: YouTube revokes a URL after ~100 requests in a quick burst
    // (measured 2026-11-26: 288 sequential reads pass, 8 or 3 in parallel die at 100).
    const fragments = [];
    for (const segment of segments) {
      // A moof is small; read a little more than most need, and again if it is bigger.
      const head = {
        start: segment.range.start,
        end: Math.min(segment.range.end, segment.range.start + 16_383),
      };
      let bytes = await this.#bytes(session, trackId, head);
      const size = moofSize(bytes);
      if (size > bytes.byteLength)
        bytes = await this.#bytes(session, trackId, {
          start: head.start,
          end: head.start + size - 1,
        });
      fragments.push(parseFragment(bytes, segment.range.start, init));
    }
    return { source: trackId, init, fragments };
  }

  async #bytes(
    session: PlaybackSession,
    trackId: string,
    range: ByteSpan,
  ): Promise<Uint8Array> {
    const stream = await this.source(session, trackId).fetchPiece(
      range,
      AbortSignal.timeout(15_000),
    );
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  /** Reads bytes of a track, replacing the session's stream URLs once if YouTube has revoked them. */
  source(session: PlaybackSession, trackId: string): UpstreamSource {
    return {
      fetchPiece: async (piece, signal) => {
        if (session.transport === "sabr")
          return this.#sabrPiece(session, trackId, piece);
        let response = await this.#fetchRange(session, trackId, piece, signal);
        // 403 or 401: YouTube has revoked this URL set; get a new one once.
        if (response.status === 403 || response.status === 401) {
          await response.body?.cancel();
          await this.#refresh(session);
          response = await this.#fetchRange(session, trackId, piece, signal);
          // Refused again: YouTube has closed byte ranges for this client; step down to SABR.
          if (
            (response.status === 403 || response.status === 401) &&
            this.#canUseSabr(session, trackId)
          ) {
            await response.body?.cancel();
            session.transport = "sabr";
            return this.#sabrPiece(session, trackId, piece);
          }
        }
        const expected = piece.end - piece.start + 1;
        if (
          !response.ok ||
          !response.body ||
          Number(response.headers.get("content-length") ?? expected) !==
            expected
        ) {
          await response.body?.cancel();
          throw new Error(
            `upstream ${response.status} for ${trackId} ${piece.start}-${piece.end}`,
          );
        }
        return response.body;
      },
    };
  }

  /** SABR serves fMP4 tracks (WebM over SABR is not built). */
  #canUseSabr(session: PlaybackSession, trackId: string): boolean {
    return (
      Boolean(session.sabr) &&
      Boolean(findTrack(session, trackId)?.mimeType.endsWith("mp4"))
    );
  }

  async #sabrPiece(
    session: PlaybackSession,
    trackId: string,
    piece: ByteSpan,
  ): Promise<ReadableStream<Uint8Array>> {
    if (!this.#canUseSabr(session, trackId))
      throw new Error(`no SABR for ${trackId}`);
    let track = session.sabrTracks.get(trackId);
    if (!track) {
      const t = findTrack(session, trackId);
      const media = session.sources.media.get(trackId);
      const original = session.sources.presentation.audio
        .filter((a) => a.isOriginal && a.mimeType === "audio/mp4")
        .sort((a, b) => b.bitrate - a.bitrate)[0];
      const companion = original
        ? session.sources.media.get(original.id)
        : undefined;
      if (!t || !media || !companion)
        throw new Error(`no SABR source for ${trackId}`);
      const options = {
        kind: t.kind,
        itag: media.itag,
        ...(media.audioTrackId ? { audioTrackId: media.audioTrackId } : {}),
        companionAudioItag: companion.itag,
        segments: () => this.segments(session, trackId),
        indexEnd: t.index.end,
      };
      track = new SabrTrack(
        options,
        sabrOpener(() => session.sabr as SabrEndpoint, options),
      );
      session.sabrTracks.set(trackId, track);
    }
    const bytes = await track.read(piece);
    return new Response(bytes).body as ReadableStream<Uint8Array>;
  }

  async #resolve(videoId: string, reloadToken?: string) {
    const result = await this.#youtube.player(
      videoId,
      undefined,
      reloadToken ? { reloadToken } : {},
    );
    if (result.unplayable) throw new Unavailable(result.unplayable);
    const details = result.raw.videoDetails;
    const isLive = Boolean(details?.isLive || details?.isPostLiveDvr);
    const masterUrl = isLive
      ? result.raw.streamingData?.hlsManifestUrl
      : undefined;
    if (isLive && !masterUrl)
      throw new Error(`${videoId}: live without an HLS manifest`);
    const sabr = sabrEndpoint(
      videoId,
      result.raw,
      result.identity,
      result.session.fetch,
    );
    if (sabr) {
      // The SABR server can demand a new player response mid-stream.
      sabr.reload = async (token) => {
        const fresh = await this.#resolve(videoId, token);
        if (!fresh.sabr) throw new Error(`${videoId}: no SABR after reload`);
        return {
          streamingUrl: fresh.sabr.streamingUrl,
          ustreamerConfig: fresh.sabr.ustreamerConfig,
        };
      };
    }
    return {
      youtube: result.session,
      userAgent: result.identity.userAgent,
      sources: toPresentation(result),
      masterUrl,
      sabr,
    };
  }

  /** The live master playlist, every rendition pointing into the session. */
  async liveMaster(session: PlaybackSession, base: string): Promise<string> {
    const live = requireLive(session);
    const text = await this.#fetchText(session, () => live.masterUrl);
    return rewriteMaster(text, live, base);
  }

  /** A live rendition's media playlist, re-read upstream at most every `PLAYLIST_TTL_MS`. */
  async liveMedia(
    session: PlaybackSession,
    itag: string,
    base: string,
  ): Promise<string | null> {
    const live = requireLive(session);
    const rendition = live.renditions.get(itag);
    if (!rendition) return null;
    const now = this.#now();
    if (!rendition.cached || now - rendition.cached.at >= PLAYLIST_TTL_MS) {
      const text = this.#fetchText(session, () => rendition.url);
      rendition.cached = { at: now, text };
      text.catch(() => {
        if (rendition.cached?.text === text) rendition.cached = undefined;
      });
    }
    return rewriteMedia(await rendition.cached.text, itag, rendition, base);
  }

  /** A live segment (or `init`) listed in an earlier media playlist. */
  async liveSegment(
    session: PlaybackSession,
    itag: string,
    segment: string,
    signal: AbortSignal,
  ): Promise<Response | null> {
    const rendition = requireLive(session).renditions.get(itag);
    const url =
      segment === "init"
        ? rendition?.initUrl
        : rendition?.segments.get(Number(segment));
    if (!url) return null;
    return session.youtube.fetch(url, {
      headers: { "user-agent": session.userAgent },
      signal,
    });
  }

  /** GET a playlist through the session; on a 403 the session's URLs are replaced once. */
  async #fetchText(
    session: PlaybackSession,
    url: () => string,
  ): Promise<string> {
    let response = await session.youtube.fetch(url(), {
      headers: { "user-agent": session.userAgent },
    });
    if (response.status === 403) {
      await response.body?.cancel();
      await this.#refresh(session);
      if (session.live) {
        // The rendition URLs come from the master: re-read it to pick up the new ones.
        const master = await session.youtube.fetch(session.live.masterUrl, {
          headers: { "user-agent": session.userAgent },
        });
        rewriteMaster(await master.text(), session.live, "");
      }
      response = await session.youtube.fetch(url(), {
        headers: { "user-agent": session.userAgent },
      });
    }
    if (!response.ok) throw new Error(`upstream playlist ${response.status}`);
    return response.text();
  }

  #fetchRange(
    session: PlaybackSession,
    trackId: string,
    piece: ByteSpan,
    signal: AbortSignal,
  ): Promise<Response> {
    const media = session.sources.media.get(trackId);
    if (!media) throw new Error(`no track ${trackId}`);
    return session.youtube.fetch(
      `${media.url}&range=${piece.start}-${piece.end}`,
      {
        headers: { "user-agent": session.userAgent },
        signal,
      },
    );
  }

  async #readSegments(
    session: PlaybackSession,
    trackId: string,
  ): Promise<Segment[]> {
    const track = findTrack(session, trackId);
    if (!track) throw new Error(`no track ${trackId}`);
    return parseSidx(
      await this.#bytes(session, trackId, track.index),
      track.index.start,
    );
  }

  /** New stream URLs for the same video; track ids stay stable across player responses. */
  #refresh(session: PlaybackSession): Promise<void> {
    session.refreshing ??= this.#resolve(session.videoId)
      .then(({ youtube, sources, masterUrl, sabr }) => {
        session.youtube = youtube;
        if (sabr) session.sabr = sabr;
        if (session.live && masterUrl) session.live.masterUrl = masterUrl;
        session.sources = {
          ...session.sources,
          media: sources.media,
          captions: sources.captions,
        };
      })
      .finally(() => {
        session.refreshing = undefined;
      });
    return session.refreshing;
  }

  #sweep(): void {
    const now = this.#now();
    for (const s of this.#sessions.values()) {
      if (
        now - s.createdAt >= this.#maxAgeMs ||
        now - s.lastUsed >= this.#idleMs
      )
        this.#end(s);
    }
    // Over capacity: drop the least recently used.
    const excess = this.#sessions.size - this.#max + 1;
    if (excess > 0) {
      const oldest = [...this.#sessions.values()]
        .sort((a, b) => a.lastUsed - b.lastUsed)
        .slice(0, excess);
      for (const s of oldest) this.#end(s);
    }
  }

  /** Forgets a session and stops its SABR pulls. */
  #end(session: PlaybackSession): void {
    this.#sessions.delete(session.id);
    for (const track of session.sabrTracks.values()) void track.close();
  }
}

function requireLive(session: PlaybackSession): LiveState {
  if (!session.live) throw new Error(`${session.videoId} is not live`);
  return session.live;
}

export function findTrack(
  session: PlaybackSession,
  id: string,
): VideoTrack | AudioTrack | undefined {
  const { video, audio } = session.sources.presentation;
  return video.find((t) => t.id === id) ?? audio.find((t) => t.id === id);
}
