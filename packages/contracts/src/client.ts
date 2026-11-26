import { z } from "zod";
import {
  type ChannelTab,
  channelPageSchema,
  commentPageSchema,
  playlistPageSchema,
  searchResultSchema,
  type UploadDate,
  videoDetailSchema,
  videoSummarySchema,
} from "./model.ts";

/** The gateway answered with an error (or not at all). */
export class GatewayError extends Error {
  readonly status: number;
  readonly body: unknown;
  constructor(status: number, body: unknown, message: string) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

export interface GatewayClientOptions {
  /** e.g. `http://gateway:8080` (internal; the catalogue API is not public). */
  baseUrl: string;
  /** The shared key, sent as a bearer token. */
  apiKey: string;
  fetch?: typeof globalThis.fetch;
  timeoutMs?: number;
}

/** The web app's view of the gateway's catalogue API, every answer checked against the model. */
export function createGatewayClient(options: GatewayClientOptions) {
  const base = options.baseUrl.replace(/\/+$/, "");
  const fetch = options.fetch ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? 20_000;

  async function get<T>(
    path: string,
    schema: z.ZodType<T>,
    query: Record<string, string | undefined> = {},
  ): Promise<T> {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(query))
      if (v !== undefined) params.set(k, v);
    const url = `${base}${path}${params.size ? `?${params}` : ""}`;
    const res = await fetch(url, {
      headers: {
        authorization: `Bearer ${options.apiKey}`,
        accept: "application/json",
      },
      signal: AbortSignal.timeout(timeoutMs),
    });
    const body: unknown = await res.json().catch(() => undefined);
    if (!res.ok) {
      const reason =
        (body as { reason?: string; error?: string } | undefined)?.reason ??
        (body as { error?: string } | undefined)?.error;
      throw new GatewayError(
        res.status,
        body,
        `gateway ${path}: ${res.status}${reason ? ` ${reason}` : ""}`,
      );
    }
    return schema.parse(body);
  }

  const id = encodeURIComponent;
  return {
    video: (videoId: string, o: CacheOption = {}) =>
      get(`/api/video/${id(videoId)}`, videoDetailSchema, { cache: o.cache }),
    /** List-row summaries for these ids (at most 100); ids YouTube will not describe are absent. */
    videos: async (videoIds: readonly string[], o: CacheOption = {}) =>
      (
        await get(
          "/api/videos",
          z.object({ videos: z.array(videoSummarySchema) }),
          { ids: videoIds.join(","), cache: o.cache },
        )
      ).videos,
    comments: (
      videoId: string,
      o: { sort?: "top" | "new"; continuation?: string } & CacheOption = {},
    ) =>
      get(`/api/video/${id(videoId)}/comments`, commentPageSchema, {
        sort: o.sort ?? "top",
        continuation: o.continuation,
        cache: o.cache,
      }),
    channel: (
      channelId: string,
      o: { tab?: ChannelTab; continuation?: string } & CacheOption = {},
    ) =>
      get(`/api/channel/${id(channelId)}`, channelPageSchema, {
        tab: o.tab ?? "videos",
        continuation: o.continuation,
        cache: o.cache,
      }),
    search: (
      q: string,
      o: { uploadDate?: UploadDate; continuation?: string } = {},
    ) =>
      get("/api/search", searchResultSchema, {
        q,
        date: o.uploadDate,
        continuation: o.continuation,
      }),
    suggestions: (q: string) =>
      get("/api/suggestions", z.array(z.string()), { q }),
    playlist: (playlistId: string, o: { continuation?: string } = {}) =>
      get(`/api/playlist/${id(playlistId)}`, playlistPageSchema, {
        continuation: o.continuation,
      }),
    live: (o: CacheOption = {}) =>
      get("/api/live", z.object({ videos: z.array(videoSummarySchema) }), {
        cache: o.cache,
      }),
    resolveChannel: async (urlOrHandle: string) =>
      (
        await get(
          "/api/resolve",
          z.object({ channelId: z.string().nullable() }),
          { url: urlOrHandle },
        )
      ).channelId,
  };
}

/**
 * `only`: answer from the gateway's cache (fresh or stale) or fail with
 * `isNotCached`, never waiting on YouTube; `refresh`: ask YouTube even over a
 * fresh entry.
 */
export type CacheOption = { cache?: "only" | "refresh" };

/** The gateway had nothing cached for a `cache: "only"` request. */
export function isNotCached(error: unknown): boolean {
  return error instanceof GatewayError && error.status === 404;
}

export type GatewayClient = ReturnType<typeof createGatewayClient>;
