import { createHash } from "node:crypto";
import { and, desc, eq, gt } from "drizzle-orm";
import { pickChannelSubscriberCount } from "@/lib/channel-subscriber-count";
import {
  stripRestrictedListVideos,
  titleSuggestsMembersOnlyOrSubscriberOnly,
} from "@/lib/feed-exclude-restricted";
import { invidiousPortCollidesWithNextApp } from "@/lib/invidious-port-collision";
import {
  mergeActiveLiveVideosFirst,
  normalizeDurationForLive,
  pickLiveFlagsFromUpstream,
} from "@/lib/live-video";
import { logger } from "@/lib/logger";
import { normalizePipedDescription } from "@/lib/normalize-video-description";
import { pipedRelatedListItems } from "@/lib/piped-related-items";
import {
  coercePublishedSecondsFromUpstream,
  parseRelativePublishedToUnix,
  sortVideosNewestFirst,
} from "@/lib/published-sort-key";
import {
  filterShortsFeedVideos,
  invidiousItemIsDiscoveryShort,
  invidiousItemIsStrictShort,
  isDiscoveryShortVideo,
  isStrictShortVideo,
  pipedItemIsDiscoveryShort,
  pipedItemIsStrictShort,
} from "@/lib/short-video";
import {
  SHORTS_DISCOVERY_FALLBACK_QUERIES,
  shortsSearchQueriesForRegion,
} from "@/lib/shorts-discovery-queries";
import {
  isUpstreamDisabled,
  normalizeUpstreamBaseUrl,
} from "@/lib/upstream-base-url";
import {
  pickLivePlaybackDetail,
  pickRicherPlaybackDetail,
  playbackCatalogMaxHeightPx,
  shouldPreferInvidiousOverPiped,
} from "@/lib/upstream-playback-catalog";
import { preferHighResVideoThumbnailUrl } from "@/lib/video-thumbnail-url";
import type { AppDb } from "@/server/db/client";
import { videoCache } from "@/server/db/schema";
import { RateLimitExceededError } from "@/server/errors/rate-limit-exceeded";
import { parseInvidiousUpcomingFromFetchMessage } from "@/server/errors/upstream-live-upcoming";
import { UpstreamUnavailableError } from "@/server/errors/upstream-unavailable";
import {
  type ChannelPageInput,
  type ChannelPageResult,
  cachedChannelPayloadSchema,
  cachedSearchPayloadSchema,
  cachedShortsFeedPayloadSchema,
  cachedTrendingPayloadSchema,
  channelPageResultSchema,
  type RelatedVideosResult,
  relatedVideosResultSchema,
  type SearchVideosInput,
  type SearchVideosResult,
  type ShortsFeedInput,
  type ShortsFeedResult,
  searchVideosResultSchema,
  shortsFeedResultSchema,
  type TrendingInput,
  type TrendingVideosResult,
  trendingVideosResultSchema,
  type UnifiedChannel,
  type UnifiedComment,
  type UnifiedVideo,
  unifiedCommentSchema,
  unifiedVideoSchema,
  type VideoCommentsInput,
  type VideoCommentsResult,
  type VideoDetail,
  type VideoDetailInput,
  type VideoStoryboard,
  videoCommentsResultSchema,
  videoDetailSchema,
} from "@/server/services/proxy.types";
import { acquireUpstreamSlot } from "@/server/services/rate-limiter";
import { upstreamGetText } from "@/server/services/upstream-get";

const CACHE_TTL_SEC = 6 * 60 * 60;
/** Channel “videos” lists change often; long TTL hid fresh uploads from recommendations. */
const CHANNEL_PAGE_CACHE_TTL_SEC = 10 * 60;
/** Home Shorts shelf discovery — fresher than the default 6h shorts cache. */
const SHORTS_SHELF_CACHE_TTL_SEC = 10 * 60;
/** Invidious/Piped HLS and DASH URLs expire quickly; long TTL serves dead 404 manifests. */
const STREAMS_DETAIL_CACHE_TTL_SEC = 3 * 60;
const FETCH_TIMEOUT_MS = 20_000;
const inFlightTrending = new Map<string, Promise<TrendingVideosResult>>();
const inFlightShortsFeed = new Map<string, Promise<ShortsFeedResult>>();
const inFlightChannel = new Map<string, Promise<ChannelPageResult>>();

export function clearProxyCaches(db: AppDb): { clearedRows: number } {
  inFlightTrending.clear();
  inFlightShortsFeed.clear();
  inFlightChannel.clear();
  const res = db.delete(videoCache).run();
  return { clearedRows: Number(res.changes ?? 0) };
}

export type ProxySourceOverrides = {
  pipedBaseUrl?: string | null;
  invidiousBaseUrl?: string | null;
};

/** Cache rows store the real upstream name (`piped` / `invidious`), never `"cache"`. */
function liveUpstreamSource(
  label: "piped" | "invidious" | "cache",
): "piped" | "invidious" {
  if (label === "cache") {
    throw new Error("proxy: write path received cache source label");
  }
  return label;
}

function normalizeBaseUrl(url: string): string {
  return url.replace(/\/+$/, "");
}

const UPSTREAM_RATE_LIMIT_NOTE = "rate limit";

/** Record a primary/fallback failure; never abort before the sibling upstream is tried. */
function recordUpstreamFailure(
  e: unknown,
  label: "piped" | "invidious",
  errors: string[],
): void {
  if (e instanceof RateLimitExceededError) {
    errors.push(`${label}:${UPSTREAM_RATE_LIMIT_NOTE}`);
    return;
  }
  const msg = e instanceof Error ? e.message : String(e);
  errors.push(`${label}:${msg}`);
}

function rethrowIfInvidiousUpcoming(error: unknown, videoId: string): void {
  if (!(error instanceof Error)) return;
  const upcoming = parseInvidiousUpcomingFromFetchMessage(
    error.message,
    videoId,
  );
  if (upcoming) throw upcoming;
}

export { UpstreamLiveUpcomingError } from "@/server/errors/upstream-live-upcoming";

function throwIfUpstreamFailed(
  errors: string[],
  fallbackMessage: string,
): never {
  if (
    errors.length > 0 &&
    errors.every((entry) => entry.endsWith(`:${UPSTREAM_RATE_LIMIT_NOTE}`))
  ) {
    throw new RateLimitExceededError();
  }
  throw new UpstreamUnavailableError(
    errors.length > 0 ? errors.join("; ") : fallbackMessage,
  );
}

/** Invidious often returns paths like `/api/v1/manifest/...` — resolve against the instance base. */
function resolveInvidiousAbsoluteMediaUrl(
  pathOrUrl: string | undefined,
  baseUrl: string,
): string | undefined {
  if (typeof pathOrUrl !== "string") return undefined;
  const t = pathOrUrl.trim();
  if (!t) return undefined;
  if (t.startsWith("http://") || t.startsWith("https://")) {
    try {
      // Keep valid absolute URLs as-is.
      return new URL(t).toString();
    } catch {
      // Some Invidious builds emit malformed host-less absolute URLs:
      // `http://:3210/path`. Recover by reusing base hostname/protocol.
      const broken = t.match(/^https?:\/\/:(\d+)(\/.*)?$/i);
      if (broken) {
        try {
          const base = new URL(baseUrl);
          const u = new URL(base.toString());
          u.port = broken[1] ?? "";
          const rawTail = broken[2] ?? "/";
          const qIdx = rawTail.indexOf("?");
          if (qIdx >= 0) {
            u.pathname = rawTail.slice(0, qIdx) || "/";
            u.search = rawTail.slice(qIdx);
          } else {
            u.pathname = rawTail;
            u.search = "";
          }
          return u.toString();
        } catch {
          return undefined;
        }
      }
      return undefined;
    }
  }
  if (t.startsWith("//")) return `https:${t}`;
  const base = normalizeBaseUrl(baseUrl);
  if (t.startsWith("/")) return `${base}${t}`;
  return undefined;
}

/**
 * Docker often publishes `127.0.0.1:port` only; Node may resolve `localhost` to `::1` and fail.
 * Use IPv4 loopback for outbound fetches and for absolute URLs sent to the browser in dev.
 */
function normalizeInvidiousOutboundBase(base: string): string {
  try {
    const u = new URL(base);
    if (u.hostname === "localhost") {
      u.hostname = "127.0.0.1";
    }
    return normalizeBaseUrl(u.toString());
  } catch {
    return normalizeBaseUrl(base);
  }
}

function invidiousBaseFromEnv(): string {
  const raw = normalizeUpstreamBaseUrl(process.env.INVIDIOUS_BASE_URL);
  if (!raw) return "";
  return normalizeInvidiousOutboundBase(normalizeBaseUrl(raw));
}

export type UpstreamAvailability = {
  pipedConfigured: boolean;
  invidiousConfigured: boolean;
  anyConfigured: boolean;
};

export function describeUpstreamAvailability(
  overrides?: ProxySourceOverrides,
): UpstreamAvailability {
  const { pipedBase, invidiousBase } = resolveProxyBases(overrides);
  return {
    pipedConfigured: Boolean(pipedBase),
    invidiousConfigured: Boolean(invidiousBase),
    anyConfigured: Boolean(pipedBase || invidiousBase),
  };
}

/** Resolved Piped/Invidious bases (env + per-user overrides). */
export function resolveEffectiveProxyBases(overrides?: ProxySourceOverrides): {
  pipedBase: string;
  invidiousBase: string;
} {
  return resolveProxyBases(overrides);
}

export type InstanceSourceRow = {
  /** Raw `PIPED_BASE_URL` / `INVIDIOUS_BASE_URL` value from the server environment. */
  envRaw: string | null;
  envUrl: string | null;
  envDisabled: boolean;
  /** Per-account URL saved in Settings (empty = not overriding). */
  profileOverride: string | null;
  /** URL OwnTube actually uses for this upstream. */
  effectiveUrl: string | null;
};

export type InstanceSourceInfo = {
  piped: InstanceSourceRow;
  invidious: InstanceSourceRow;
};

function readEnvPipedRaw(): string | null {
  const raw = process.env.PIPED_BASE_URL?.trim();
  return raw || null;
}

function readEnvInvidiousRaw(): string | null {
  const raw = process.env.INVIDIOUS_BASE_URL?.trim();
  return raw || null;
}

function readEnvPipedUrl(): string | null {
  const raw = readEnvPipedRaw();
  if (!raw || isUpstreamDisabled(raw)) return null;
  return normalizeBaseUrl(raw);
}

function readEnvInvidiousUrl(): string | null {
  const base = invidiousBaseFromEnv();
  return base || null;
}

/** Server env + optional profile overrides — for Settings display. */
export function getInstanceSourceInfo(profile?: {
  pipedBaseUrl?: string;
  invidiousBaseUrl?: string;
}): InstanceSourceInfo {
  const profilePiped = profile?.pipedBaseUrl?.trim() || null;
  const profileInv = profile?.invidiousBaseUrl?.trim() || null;
  const overrides =
    profilePiped || profileInv
      ? {
          pipedBaseUrl: profile?.pipedBaseUrl,
          invidiousBaseUrl: profile?.invidiousBaseUrl,
        }
      : undefined;
  const { pipedBase, invidiousBase } = resolveProxyBases(overrides);

  const pipedEnvRaw = readEnvPipedRaw();
  const invEnvRaw = readEnvInvidiousRaw();

  return {
    piped: {
      envRaw: pipedEnvRaw,
      envUrl:
        pipedEnvRaw && !isUpstreamDisabled(pipedEnvRaw)
          ? readEnvPipedUrl()
          : null,
      envDisabled: Boolean(pipedEnvRaw && isUpstreamDisabled(pipedEnvRaw)),
      profileOverride: profilePiped,
      effectiveUrl: pipedBase || null,
    },
    invidious: {
      envRaw: invEnvRaw,
      envUrl:
        invEnvRaw && !isUpstreamDisabled(invEnvRaw)
          ? readEnvInvidiousUrl()
          : null,
      envDisabled: Boolean(invEnvRaw && isUpstreamDisabled(invEnvRaw)),
      profileOverride: profileInv,
      effectiveUrl: invidiousBase || null,
    },
  };
}

export function resolveProxyBases(overrides?: ProxySourceOverrides): {
  pipedBase: string;
  invidiousBase: string;
} {
  const pipedCandidate = overrides?.pipedBaseUrl?.trim();
  const pipedRaw =
    pipedCandidate !== undefined
      ? pipedCandidate
      : process.env.PIPED_BASE_URL?.trim();
  const pipedBase =
    pipedRaw && !isUpstreamDisabled(pipedRaw) ? normalizeBaseUrl(pipedRaw) : "";

  const invidiousCandidate = overrides?.invidiousBaseUrl?.trim();
  const invidiousBase =
    invidiousCandidate !== undefined
      ? invidiousCandidate
        ? normalizeInvidiousOutboundBase(normalizeBaseUrl(invidiousCandidate))
        : ""
      : invidiousBaseFromEnv();

  return { pipedBase, invidiousBase };
}

function nowUnix(): number {
  return Math.floor(Date.now() / 1000);
}

function searchCacheKey(input: SearchVideosInput): string {
  const h = createHash("sha256")
    .update(
      JSON.stringify({
        v: 3,
        kind: "search",
        q: input.q,
        limit: input.limit ?? 20,
        c: input.continuation ?? null,
      }),
    )
    .digest("hex");
  return `search:v3:${h}`;
}

function detailCacheKey(input: VideoDetailInput): string {
  const h = createHash("sha256")
    .update(JSON.stringify({ v: 4, kind: "streams", videoId: input.videoId }))
    .digest("hex");
  return `streams:v4:${h}`;
}

function relatedCacheKey(input: VideoDetailInput): string {
  const h = createHash("sha256")
    .update(JSON.stringify({ v: 4, kind: "related", videoId: input.videoId }))
    .digest("hex");
  return `related:v4:${h}`;
}

function shortsFeedCacheKey(input: ShortsFeedInput): string {
  const h = createHash("sha256")
    .update(
      JSON.stringify({
        v: 2,
        kind: "shorts",
        region: input.region,
        limit: input.limit ?? 20,
        purpose: input.purpose ?? "feed",
        c: input.continuation ?? null,
        dq: input.discoveryQueries ?? null,
      }),
    )
    .digest("hex");
  return `shorts:v2:${h}`;
}

function resolveShortsDiscoveryQueries(
  input: ShortsFeedInput,
  region: string,
): string[] {
  if (input.discoveryQueries && input.discoveryQueries.length > 0) {
    return [...input.discoveryQueries];
  }
  const regional = shortsSearchQueriesForRegion(region);
  return [
    ...regional,
    ...SHORTS_DISCOVERY_FALLBACK_QUERIES.filter((q) => !regional.includes(q)),
  ];
}

function trendingCacheKey(input: TrendingInput): string {
  const h = createHash("sha256")
    .update(
      JSON.stringify({
        v: 3,
        kind: "trending",
        region: input.region.toUpperCase(),
        limit: input.limit ?? 40,
        category: input.category ?? null,
      }),
    )
    .digest("hex");
  return `trending:v3:${h}`;
}

function channelCacheKey(input: ChannelPageInput): string {
  const h = createHash("sha256")
    .update(
      JSON.stringify({
        v: 4,
        kind: "channel",
        channelId: input.channelId,
        tab: input.tab ?? "videos",
        c: input.continuation ?? null,
      }),
    )
    .digest("hex");
  return `channel:v4:${h}`;
}

function extractVideoIdFromUrl(url: string): string | undefined {
  const m = url.match(/[?&]v=([a-zA-Z0-9_-]{11})/);
  if (m) return m[1];
  const m2 = url.match(
    /(?:youtu\.be\/|youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/,
  );
  if (m2) return m2[1];
  return undefined;
}

function channelIdFromPath(
  uploaderUrl: string | undefined,
): string | undefined {
  if (!uploaderUrl) return undefined;
  const m = uploaderUrl.match(/\/channel\/([^/?#]+)/);
  if (m) return decodeURIComponent(m[1]);
  return undefined;
}

function pipedRootItems(data: unknown): unknown[] {
  if (Array.isArray(data)) return data;
  if (data && typeof data === "object") {
    const o = data as Record<string, unknown>;
    if (Array.isArray(o.items)) return o.items;
    if (Array.isArray(o.results)) return o.results;
  }
  return [];
}

function pipedNextPage(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  const o = data as Record<string, unknown>;
  const n = o.nextpage;
  if (typeof n === "string" && n.length > 0) return n;
  return null;
}

/** Piped / Invidious sometimes send counts as strings, alternate keys, or localized numbers. */
function parseViewCountValue(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return Math.floor(value);
  }
  if (typeof value === "string") {
    const t = value.replace(/\u202f|\s/g, "").trim();
    if (!t) return undefined;
    const compact = /^([\d,.]+)\s*([kKmMbB])?$/;
    const m = compact.exec(t);
    if (m) {
      const base = Number(m[1].replace(/,/g, ""));
      if (!Number.isFinite(base) || base < 0) return undefined;
      const suf = (m[2] ?? "").toLowerCase();
      const mult =
        suf === "k" ? 1e3 : suf === "m" ? 1e6 : suf === "b" ? 1e9 : 1;
      return Math.floor(base * mult);
    }
    const n = Number(t.replace(/,/g, ""));
    return Number.isFinite(n) && n >= 0 ? Math.floor(n) : undefined;
  }
  return undefined;
}

function pickViewCount(o: Record<string, unknown>): number | undefined {
  const keys = ["views", "viewCount", "view_count"] as const;
  let zeroish: number | undefined;
  for (const k of keys) {
    const n = parseViewCountValue(o[k]);
    if (n !== undefined && n > 0) return n;
    if (n === 0 && zeroish === undefined) zeroish = 0;
  }
  return zeroish;
}

/** Piped list items (search, trending, related) often include uploader avatar on each item. */
function pickPipedUploaderAvatar(
  o: Record<string, unknown>,
  pipedBase: string,
): string | undefined {
  const stringKeys = [
    "uploaderAvatar",
    "uploader_avatar",
    "channelAvatarUrl",
  ] as const;
  for (const key of stringKeys) {
    const raw = o[key];
    if (typeof raw !== "string") continue;
    const u = resolveInvidiousAbsoluteMediaUrl(raw, pipedBase);
    if (u?.startsWith("http")) return u;
  }
  for (const key of ["uploaderAvatars", "avatars"] as const) {
    const u = resolveInvidiousThumbnail(o[key], pipedBase);
    if (u?.startsWith("http")) return u;
  }
  return undefined;
}

function reconcilePublishedAtWithText(
  publishedAt: number | undefined,
  publishedText: string | undefined,
): number | undefined {
  if (!publishedText?.trim()) return publishedAt;
  const now = Math.floor(Date.now() / 1000);
  const fromText = parseRelativePublishedToUnix(publishedText, now);
  if (fromText === undefined) return publishedAt;
  if (publishedAt === undefined) return fromText;
  // Some instances return a mismatched numeric timestamp (often "too recent").
  // If delta is large, trust relative text for consistency in feed ordering/labels.
  if (Math.abs(publishedAt - fromText) > 2 * 3600) return fromText;
  return publishedAt;
}

function upstreamBadgesOrLabelsRestricted(o: Record<string, unknown>): boolean {
  const lists = [o.badges, o.videoBadges, o.ownerBadges];
  for (const raw of lists) {
    if (!Array.isArray(raw)) continue;
    for (const item of raw) {
      if (typeof item === "string") {
        if (/member|membre|subscriber\s+only|subs?\s+only/i.test(item)) {
          return true;
        }
      } else if (item && typeof item === "object") {
        const r = item as Record<string, unknown>;
        for (const c of [
          r.label,
          r.text,
          r.type,
          r.tooltip,
          r.style,
          r.title,
        ]) {
          if (
            typeof c === "string" &&
            /member|membre|subscriber\s+only|subs?\s+only/i.test(c)
          ) {
            return true;
          }
        }
      }
    }
  }
  const err = o.error;
  if (typeof err === "string" && err.trim().length > 0) {
    if (/\b(members?\s+only|subscriber|private)\b/i.test(err)) return true;
  }
  return false;
}

/**
 * Invidious/Piped list payloads may mark items that need channel membership,
 * payment, or Premium — exclude them from feeds and unified lists.
 */
function isUpstreamMembersOrPaidOnly(o: Record<string, unknown>): boolean {
  const on = (v: unknown) => v === true || v === 1 || v === "1" || v === "true";
  if (on(o.premium)) return true;
  if (on(o.paid)) return true;
  if (upstreamBadgesOrLabelsRestricted(o)) return true;
  for (const key of [
    "isMembersOnly",
    "membersOnly",
    "is_members_only",
    "members_only",
    "uploaderMember",
    "subscribersOnly",
    "requiresSubscription",
  ] as const) {
    if (on(o[key])) return true;
  }
  return false;
}

function mapPipedItem(raw: unknown, pipedBase = ""): UnifiedVideo | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const t = typeof o.type === "string" ? o.type.toLowerCase() : "";
  if (t && t !== "stream" && t !== "video" && t !== "livestream") return null;
  const { isLive, isUpcoming } = pickLiveFlagsFromUpstream(o);
  const url = typeof o.url === "string" ? o.url : "";
  const title = typeof o.title === "string" ? o.title : "";
  const videoId = extractVideoIdFromUrl(url);
  if (!videoId || !title) return null;
  if (isUpstreamMembersOrPaidOnly(o)) return null;
  if (titleSuggestsMembersOnlyOrSubscriberOnly(title)) return null;
  const thumbnail =
    typeof o.thumbnail === "string"
      ? o.thumbnail
      : pickVideoThumbnail(o.thumbnails, videoId, {
          preferPortrait: pipedItemIsShort(o),
        });
  const rawDuration =
    typeof o.duration === "number" &&
    Number.isFinite(o.duration) &&
    o.duration > 0
      ? o.duration
      : undefined;
  const durationSeconds = normalizeDurationForLive(rawDuration, isLive);
  const viewCount = pickViewCount(o);
  const publishedText =
    typeof o.uploadedDate === "string" ? o.uploadedDate : undefined;
  const publishedAt =
    coercePublishedSecondsFromUpstream(o.uploaded) ??
    coercePublishedSecondsFromUpstream(o.time) ??
    coercePublishedSecondsFromUpstream(o.timestamp) ??
    coercePublishedSecondsFromUpstream(o.published);
  const reconciledPublishedAt = reconcilePublishedAtWithText(
    publishedAt,
    publishedText,
  );
  const channelName =
    typeof o.uploaderName === "string"
      ? o.uploaderName
      : typeof o.uploader === "string"
        ? o.uploader
        : undefined;
  const uploaderUrl =
    typeof o.uploaderUrl === "string" ? o.uploaderUrl : undefined;
  const channelId = channelIdFromPath(uploaderUrl);
  const channelAvatarUrl = pickPipedUploaderAvatar(o, pipedBase);
  const parsed = unifiedVideoSchema.safeParse({
    videoId,
    title,
    channelId,
    channelName,
    channelAvatarUrl,
    thumbnailUrl: preferHighResVideoThumbnailUrl(thumbnail, videoId),
    durationSeconds,
    viewCount,
    publishedText,
    publishedAt: reconciledPublishedAt,
    isLive: isLive || undefined,
    isUpcoming: isUpcoming || undefined,
  });
  if (!parsed.success) return null;
  return parsed.data;
}

function pickPipedChannelAvatar(
  o: Record<string, unknown>,
  pipedBase: string,
): string | undefined {
  const fromUploader = pickPipedUploaderAvatar(o, pipedBase);
  if (fromUploader) return fromUploader;
  const thumb = o.thumbnail;
  if (typeof thumb === "string") {
    const u = resolveInvidiousAbsoluteMediaUrl(thumb, pipedBase);
    if (u?.startsWith("http")) return u;
  }
  return undefined;
}

function mapPipedChannelItem(
  raw: unknown,
  pipedBase = "",
): UnifiedChannel | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const t = typeof o.type === "string" ? o.type.toLowerCase() : "";
  if (t !== "channel") return null;
  const channelId =
    channelIdFromPath(typeof o.url === "string" ? o.url : undefined) ??
    channelIdFromPath(
      typeof o.uploaderUrl === "string" ? o.uploaderUrl : undefined,
    ) ??
    (typeof o.id === "string" ? o.id : undefined);
  const name =
    typeof o.name === "string"
      ? o.name
      : typeof o.title === "string"
        ? o.title
        : typeof o.uploaderName === "string"
          ? o.uploaderName
          : typeof o.uploader === "string"
            ? o.uploader
            : "";
  if (!channelId || !name) return null;
  return {
    channelId,
    name,
    avatarUrl: pickPipedChannelAvatar(o, pipedBase),
    subscriberCount: pickChannelSubscriberCount(o),
    description: typeof o.description === "string" ? o.description : undefined,
  };
}

function resolveInvidiousThumbnail(
  thumbs: unknown,
  baseUrl: string,
  opts?: { preferPortrait?: boolean },
): string | undefined {
  if (!Array.isArray(thumbs)) return undefined;
  const portraitPreferred = ["oar2", "oardefault", "oar1", "oar3"];
  const preferred = [
    "maxresdefault",
    "sddefault",
    "high",
    "medium",
    "default",
    "low",
    "maxres",
    "hq720",
    "hqdefault",
    "mqdefault",
  ];
  const candidates = new Map<string, string>();
  let bestByWidth: { w: number; url: string } | undefined;
  let bestPortrait: { score: number; url: string } | undefined;
  const base = normalizeBaseUrl(baseUrl);
  for (const thumb of thumbs) {
    if (!thumb || typeof thumb !== "object") continue;
    const t = thumb as Record<string, unknown>;
    const u = typeof t.url === "string" ? t.url : "";
    const q = typeof t.quality === "string" ? t.quality.toLowerCase() : "";
    const wRaw = t.width;
    const hRaw = t.height;
    const w =
      typeof wRaw === "number" && Number.isFinite(wRaw) && wRaw > 0 ? wRaw : 0;
    const h =
      typeof hRaw === "number" && Number.isFinite(hRaw) && hRaw > 0 ? hRaw : 0;
    if (!u) continue;
    const resolved = resolveInvidiousAbsoluteMediaUrl(u, base);
    if (!resolved?.startsWith("http")) continue;
    if (q) candidates.set(q, resolved);
    if (w > 0 && (!bestByWidth || w > bestByWidth.w)) {
      bestByWidth = { w, url: resolved };
    }
    if (opts?.preferPortrait && h > w && h > 0) {
      const score = h * w;
      if (!bestPortrait || score > bestPortrait.score) {
        bestPortrait = { score, url: resolved };
      }
    }
  }
  if (opts?.preferPortrait) {
    for (const q of portraitPreferred) {
      const hit = candidates.get(q);
      if (hit) return hit;
    }
    if (bestPortrait) return bestPortrait.url;
  }
  if (bestByWidth && bestByWidth.w >= 48) return bestByWidth.url;
  for (const q of preferred) {
    if (candidates.has(q)) return candidates.get(q);
  }
  return bestByWidth?.url ?? candidates.values().next().value;
}

function pickInvidiousStoryboard(
  o: Record<string, unknown>,
  baseUrl: string,
): VideoStoryboard | undefined {
  const boards = o.storyboards;
  if (!Array.isArray(boards) || boards.length === 0) return undefined;
  let best: VideoStoryboard | undefined;
  let bestScore = -1;
  for (const item of boards) {
    if (!item || typeof item !== "object") continue;
    const b = item as Record<string, unknown>;
    const templateRaw =
      typeof b.templateUrl === "string" ? b.templateUrl : undefined;
    const templateUrl = templateRaw
      ? resolveInvidiousAbsoluteMediaUrl(templateRaw, baseUrl)
      : undefined;
    if (!templateUrl) continue;
    const thumbWidth =
      typeof b.width === "number" && b.width > 0 ? Math.floor(b.width) : 0;
    const thumbHeight =
      typeof b.height === "number" && b.height > 0 ? Math.floor(b.height) : 0;
    const count =
      typeof b.count === "number" && b.count > 0 ? Math.floor(b.count) : 0;
    let intervalMs =
      typeof b.interval === "number" && b.interval > 0
        ? Math.floor(b.interval)
        : 0;
    if (intervalMs > 0 && intervalMs < 100) intervalMs *= 1000;
    const columns =
      typeof b.storyboardWidth === "number" && b.storyboardWidth > 0
        ? Math.floor(b.storyboardWidth)
        : 1;
    const rows =
      typeof b.storyboardHeight === "number" && b.storyboardHeight > 0
        ? Math.floor(b.storyboardHeight)
        : 1;
    const storyboardCount =
      typeof b.storyboardCount === "number" && b.storyboardCount > 0
        ? Math.floor(b.storyboardCount)
        : 1;
    if (thumbWidth <= 0 || thumbHeight <= 0 || count <= 0 || intervalMs <= 0) {
      continue;
    }
    const candidate: VideoStoryboard = {
      templateUrl,
      thumbWidth,
      thumbHeight,
      count,
      intervalMs,
      columns,
      rows,
      storyboardCount,
    };
    const score = thumbWidth * thumbHeight;
    if (score > bestScore) {
      best = candidate;
      bestScore = score;
    }
  }
  return best;
}

async function tryFetchInvidiousStoryboard(
  videoId: string,
  invidiousBase: string,
): Promise<VideoStoryboard | undefined> {
  try {
    acquireUpstreamSlot();
    const json = await fetchJson(
      buildInvidiousVideosUrl(invidiousBase, videoId),
    );
    if (!json || typeof json !== "object") return undefined;
    return pickInvidiousStoryboard(
      json as Record<string, unknown>,
      invidiousBase,
    );
  } catch {
    return undefined;
  }
}

function mapInvidiousItem(raw: unknown, baseUrl = ""): UnifiedVideo | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const itemType = typeof o.type === "string" ? o.type : "";
  if (
    itemType !== "video" &&
    itemType !== "shortVideo" &&
    itemType !== "livestream"
  ) {
    return null;
  }
  const { isLive, isUpcoming } = pickLiveFlagsFromUpstream(o);
  const videoId = typeof o.videoId === "string" ? o.videoId : "";
  const title = typeof o.title === "string" ? o.title : "";
  if (!videoId || !title) return null;
  if (isUpstreamMembersOrPaidOnly(o)) return null;
  if (titleSuggestsMembersOnlyOrSubscriberOnly(title)) return null;
  const isShortItem = itemType === "shortVideo";
  const thumbnailUrl = preferHighResVideoThumbnailUrl(
    resolveInvidiousThumbnail(o.videoThumbnails, baseUrl, {
      preferPortrait: isShortItem,
    }),
    videoId,
  );
  const rawDuration =
    typeof o.lengthSeconds === "number" && Number.isFinite(o.lengthSeconds)
      ? o.lengthSeconds
      : undefined;
  const durationSeconds = normalizeDurationForLive(rawDuration, isLive);
  const viewCount = pickViewCount(o);
  const publishedText =
    typeof o.publishedText === "string" ? o.publishedText : undefined;
  const publishedAt =
    coercePublishedSecondsFromUpstream(o.published) ??
    coercePublishedSecondsFromUpstream(o.publishedAt) ??
    coercePublishedSecondsFromUpstream(o.timestamp) ??
    coercePublishedSecondsFromUpstream(o.premiereTimestamp);
  const reconciledPublishedAt = reconcilePublishedAtWithText(
    publishedAt,
    publishedText,
  );
  const channelName = typeof o.author === "string" ? o.author : undefined;
  const channelId = typeof o.authorId === "string" ? o.authorId : undefined;
  const channelAvatarUrl = resolveInvidiousThumbnail(
    o.authorThumbnails,
    baseUrl,
  );
  const parsed = unifiedVideoSchema.safeParse({
    videoId,
    title,
    channelId,
    channelName,
    channelAvatarUrl,
    thumbnailUrl,
    durationSeconds,
    viewCount,
    publishedText,
    publishedAt: reconciledPublishedAt,
    isLive: isLive || undefined,
    isUpcoming: isUpcoming || undefined,
  });
  if (!parsed.success) return null;
  return parsed.data;
}

function mapInvidiousChannelItem(
  raw: unknown,
  baseUrl = "",
): UnifiedChannel | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (o.type !== "channel") return null;
  const channelId =
    typeof o.authorId === "string"
      ? o.authorId
      : typeof o.channelId === "string"
        ? o.channelId
        : "";
  const name =
    typeof o.author === "string"
      ? o.author
      : typeof o.name === "string"
        ? o.name
        : "";
  if (!channelId || !name) return null;
  const avatarUrl =
    resolveInvidiousThumbnail(o.authorThumbnails, baseUrl) ??
    resolveInvidiousThumbnail(o.channelThumbnails, baseUrl);
  return {
    channelId,
    name,
    avatarUrl,
    subscriberCount: pickChannelSubscriberCount(o),
    description: typeof o.description === "string" ? o.description : undefined,
  };
}

type FetchJsonOptions = {
  /**
   * Some upstreams (notably Invidious `/api/v1/videos/{id}/related`) return 2xx with a
   * completely empty body instead of `[]` when there are no related items.
   */
  emptyBodyAs?: unknown;
};

async function fetchJson(
  url: string,
  options?: FetchJsonOptions,
): Promise<unknown> {
  const { status, ok, text } = await upstreamGetText(url, FETCH_TIMEOUT_MS);
  const trimmed = text.trim();
  if (!ok) {
    const hint = trimmed.slice(0, 240);
    throw new Error(
      hint ? `HTTP ${status}: ${hint}` : `HTTP ${status} (empty body)`,
    );
  }
  if (!trimmed) {
    if (options?.emptyBodyAs !== undefined) {
      return options.emptyBodyAs;
    }
    throw new Error(
      `HTTP ${status} with empty body (expected JSON from upstream)`,
    );
  }
  try {
    return JSON.parse(trimmed) as unknown;
  } catch (e) {
    const isHtml = trimmed.startsWith("<");
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(
      isHtml
        ? `Invalid JSON (upstream returned HTML — base URL may be the web UI, not the API; use the Piped backend URL or set PIPED_BASE_URL=disabled): ${msg}; start: ${trimmed.slice(0, 120)}`
        : `Invalid JSON: ${msg}; start: ${trimmed.slice(0, 120)}`,
    );
  }
}

function toUnixText(seconds: unknown): string | undefined {
  if (typeof seconds === "number" && Number.isFinite(seconds)) {
    return `${Math.floor(seconds)}s`;
  }
  return undefined;
}

function buildPipedSearchUrl(
  base: string,
  input: SearchVideosInput,
  filter: "all" | "channels" = "all",
): string {
  const u = new URL("/search", `${base}/`);
  u.searchParams.set("q", input.q);
  u.searchParams.set("filter", filter);
  if (input.region) {
    u.searchParams.set("region", input.region.toUpperCase());
  }
  if (input.continuation) {
    u.searchParams.set("nextpage", input.continuation);
  }
  return u.toString();
}

function buildInvidiousSearchUrl(
  base: string,
  input: SearchVideosInput,
  type: "all" | "channel" | "video" = "all",
): string {
  const u = new URL("/api/v1/search", `${base}/`);
  u.searchParams.set("q", input.q);
  u.searchParams.set("type", type);
  if (input.region) {
    u.searchParams.set("region", input.region.toUpperCase());
  }
  const page =
    input.continuation && /^\d+$/.test(input.continuation)
      ? input.continuation
      : "1";
  u.searchParams.set("page", page);
  return u.toString();
}

function readFreshCacheRow(db: AppDb, key: string) {
  return db
    .select()
    .from(videoCache)
    .where(
      and(eq(videoCache.cacheKey, key), gt(videoCache.expiresAt, nowUnix())),
    )
    .limit(1)
    .all()[0];
}

function readLatestCacheRow(db: AppDb, key: string) {
  return db
    .select()
    .from(videoCache)
    .where(eq(videoCache.cacheKey, key))
    .orderBy(desc(videoCache.fetchedAt))
    .limit(1)
    .all()[0];
}

function readFreshSearchCache(
  db: AppDb,
  key: string,
): SearchVideosResult | null {
  const row = readFreshCacheRow(db, key);
  if (!row) return null;
  const raw = JSON.parse(row.payloadJson) as unknown;
  const parsed = cachedSearchPayloadSchema.safeParse(raw);
  if (!parsed.success) return null;
  logger.info("video_cache.hit", { cacheKey: key, kind: row.kind });
  return {
    videos: parsed.data.videos,
    channels: parsed.data.channels,
    continuation: parsed.data.continuation,
    sourceUsed: "cache",
    stale: false,
  };
}

function readStaleSearchCache(
  db: AppDb,
  key: string,
): SearchVideosResult | null {
  const row = readLatestCacheRow(db, key);
  if (!row) return null;
  const raw = JSON.parse(row.payloadJson) as unknown;
  const parsed = cachedSearchPayloadSchema.safeParse(raw);
  if (!parsed.success) return null;
  logger.warn("video_cache.stale_hit", { cacheKey: key, kind: row.kind });
  return {
    videos: parsed.data.videos,
    channels: parsed.data.channels,
    continuation: parsed.data.continuation,
    sourceUsed: "cache",
    stale: true,
    warning: "Upstream unavailable, serving stale cache.",
  };
}

function cacheTtlSecForKind(
  kind: "search" | "streams" | "related" | "trending" | "shorts" | "channel",
  options?: { shortsPurpose?: "feed" | "shelf" },
): number {
  if (kind === "streams") return STREAMS_DETAIL_CACHE_TTL_SEC;
  if (kind === "channel") return CHANNEL_PAGE_CACHE_TTL_SEC;
  if (kind === "shorts" && options?.shortsPurpose === "shelf") {
    return SHORTS_SHELF_CACHE_TTL_SEC;
  }
  return CACHE_TTL_SEC;
}

/** Persists a live upstream response. `payload` is JSON-serialized as stored (never a stale `sourceUsed: "cache"` row). */
function writeCache(
  db: AppDb,
  key: string,
  source: "piped" | "invidious",
  payload: unknown,
  kind: "search" | "streams" | "related" | "trending" | "shorts" | "channel",
  options?: { shortsPurpose?: "feed" | "shelf" },
): void {
  const t = nowUnix();
  const ttl = cacheTtlSecForKind(kind, options);
  const row = {
    cacheKey: key,
    source,
    kind,
    payloadJson: JSON.stringify(payload),
    fetchedAt: t,
    expiresAt: t + ttl,
  };
  db.insert(videoCache)
    .values(row)
    .onConflictDoUpdate({
      target: videoCache.cacheKey,
      set: {
        payloadJson: row.payloadJson,
        source: row.source,
        kind: row.kind,
        fetchedAt: row.fetchedAt,
        expiresAt: row.expiresAt,
      },
    })
    .run();
  logger.info("video_cache.write", {
    cacheKey: key,
    kind,
    source,
    ttlSec: ttl,
  });
}

const SEARCH_CHANNEL_LIMIT = 12;

function parsePipedSearch(
  data: unknown,
  limit: number,
  pipedBase: string,
): {
  videos: UnifiedVideo[];
  channels: UnifiedChannel[];
  continuation: string | null;
} {
  const items = pipedRootItems(data);
  const videos: UnifiedVideo[] = [];
  const channels: UnifiedChannel[] = [];
  const seenChannelIds = new Set<string>();
  for (const item of items) {
    if (videos.length < limit) {
      const v = mapPipedItem(item, pipedBase);
      if (v) videos.push(v);
    }
    if (channels.length < SEARCH_CHANNEL_LIMIT) {
      const c = mapPipedChannelItem(item, pipedBase);
      if (c && !seenChannelIds.has(c.channelId)) {
        seenChannelIds.add(c.channelId);
        channels.push(c);
      }
    }
  }
  return { videos, channels, continuation: pipedNextPage(data) };
}

function parseInvidiousSearch(
  data: unknown,
  limit: number,
  page: number,
  baseUrl: string,
): {
  videos: UnifiedVideo[];
  channels: UnifiedChannel[];
  continuation: string | null;
} {
  if (!Array.isArray(data))
    return { videos: [], channels: [], continuation: null };
  const videos: UnifiedVideo[] = [];
  const channels: UnifiedChannel[] = [];
  const seenChannelIds = new Set<string>();
  for (const item of data) {
    if (videos.length < limit) {
      const v = mapInvidiousItem(item, baseUrl);
      if (v) videos.push(v);
    }
    if (channels.length < SEARCH_CHANNEL_LIMIT) {
      const c = mapInvidiousChannelItem(item, baseUrl);
      if (c && !seenChannelIds.has(c.channelId)) {
        seenChannelIds.add(c.channelId);
        channels.push(c);
      }
    }
  }
  const continuation = videos.length >= limit ? String(page + 1) : null;
  return { videos, channels, continuation };
}

export async function searchVideos(
  db: AppDb,
  input: SearchVideosInput,
  overrides?: ProxySourceOverrides,
): Promise<SearchVideosResult> {
  const parsedInput = input;
  const limit = parsedInput.limit ?? 20;
  const key = searchCacheKey(parsedInput);

  const cached = readFreshSearchCache(db, key);
  if (cached) return cached;

  const { pipedBase, invidiousBase } = resolveProxyBases(overrides);

  const errors: string[] = [];

  const tryPiped = async (): Promise<SearchVideosResult | null> => {
    if (!pipedBase) return null;
    try {
      acquireUpstreamSlot();
      const url = buildPipedSearchUrl(pipedBase, parsedInput);
      logger.info("proxy.piped.request", {
        url: url.replace(parsedInput.q, "[q]"),
      });
      const json = await fetchJson(url);
      let { videos, channels, continuation } = parsePipedSearch(
        json,
        limit,
        pipedBase,
      );
      if (channels.length === 0 && !parsedInput.continuation) {
        try {
          acquireUpstreamSlot();
          const channelUrl = buildPipedSearchUrl(
            pipedBase,
            parsedInput,
            "channels",
          );
          const channelJson = await fetchJson(channelUrl);
          const channelOnly = parsePipedSearch(channelJson, limit, pipedBase);
          if (channelOnly.channels.length > 0) {
            channels = channelOnly.channels;
          }
        } catch {
          // optional channel-only pass
        }
      }
      const result: SearchVideosResult = {
        videos,
        channels,
        continuation,
        sourceUsed: "piped",
      };
      const safe = searchVideosResultSchema.parse(result);
      return safe;
    } catch (e) {
      recordUpstreamFailure(e, "piped", errors);
      logger.warn("proxy.piped.failed", {
        message: e instanceof Error ? e.message : String(e),
      });
      return null;
    }
  };

  const tryInvidious = async (): Promise<SearchVideosResult | null> => {
    if (!invidiousBase) return null;
    if (invidiousPortCollidesWithNextApp(invidiousBase)) {
      errors.push(
        "invidious:INVIDIOUS_BASE_URL uses the same loopback port as this Next.js server (PORT). Server fetch would hit OwnTube itself (404 on /api/v1/...). Run Invidious on another port (e.g. 3001 in docker-compose) or start Next on a different port (e.g. pnpm dev -- -p 3000).",
      );
      return null;
    }
    try {
      acquireUpstreamSlot();
      const page =
        parsedInput.continuation && /^\d+$/.test(parsedInput.continuation)
          ? Number.parseInt(parsedInput.continuation, 10)
          : 1;
      const url = buildInvidiousSearchUrl(invidiousBase, {
        ...parsedInput,
        continuation: String(page),
      });
      logger.info("proxy.invidious.request", {
        url: url.replace(parsedInput.q, "[q]"),
      });
      const json = await fetchJson(url);
      let { videos, channels, continuation } = parseInvidiousSearch(
        json,
        limit,
        page,
        invidiousBase,
      );
      if (channels.length === 0 && page === 1) {
        try {
          acquireUpstreamSlot();
          const channelUrl = buildInvidiousSearchUrl(
            invidiousBase,
            { ...parsedInput, continuation: "1" },
            "channel",
          );
          const channelJson = await fetchJson(channelUrl);
          const channelOnly = parseInvidiousSearch(
            channelJson,
            limit,
            page,
            invidiousBase,
          );
          if (channelOnly.channels.length > 0) {
            channels = channelOnly.channels;
          }
        } catch {
          // optional channel-only pass
        }
      }
      const result: SearchVideosResult = {
        videos,
        channels,
        continuation,
        sourceUsed: "invidious",
      };
      return searchVideosResultSchema.parse(result);
    } catch (e) {
      recordUpstreamFailure(e, "invidious", errors);
      logger.warn("proxy.invidious.failed", {
        message: e instanceof Error ? e.message : String(e),
      });
      return null;
    }
  };

  let resolved = await tryPiped();
  if (
    !resolved ||
    (resolved.videos.length === 0 && (resolved.channels?.length ?? 0) === 0)
  ) {
    const fromInv = await tryInvidious();
    if (fromInv) {
      resolved = fromInv;
    }
  }

  if (
    !resolved ||
    (resolved.videos.length === 0 && (resolved.channels?.length ?? 0) === 0)
  ) {
    const stale = readStaleSearchCache(db, key);
    if (stale) return stale;
    throwIfUpstreamFailed(errors, "no results");
  }
  writeCache(
    db,
    key,
    liveUpstreamSource(resolved.sourceUsed),
    resolved,
    "search",
  );
  return resolved;
}

function pickVideoThumbnail(
  thumbnails: unknown,
  videoId?: string,
  opts?: { preferPortrait?: boolean },
): string | undefined {
  if (!Array.isArray(thumbnails)) return undefined;
  const portraitPreferred = ["oar2", "oardefault", "oar1", "oar3"];
  const preferred = [
    "maxresdefault",
    "maxres",
    "hq720",
    "hqdefault",
    "sddefault",
    "mqdefault",
    "default",
  ];
  const byQuality = new Map<string, string>();
  let bestByWidth: { w: number; url: string } | undefined;
  let bestPortrait: { score: number; url: string } | undefined;
  for (const item of thumbnails) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const url = typeof row.url === "string" ? row.url : "";
    if (!url.startsWith("http")) continue;
    const q = typeof row.quality === "string" ? row.quality.toLowerCase() : "";
    if (q) byQuality.set(q, url);
    const wRaw = row.width;
    const hRaw = row.height;
    const w =
      typeof wRaw === "number" && Number.isFinite(wRaw) && wRaw > 0 ? wRaw : 0;
    const h =
      typeof hRaw === "number" && Number.isFinite(hRaw) && hRaw > 0 ? hRaw : 0;
    if (w > 0 && (!bestByWidth || w > bestByWidth.w)) {
      bestByWidth = { w, url };
    }
    if (opts?.preferPortrait && h > w && h > 0) {
      const score = h * w;
      if (!bestPortrait || score > bestPortrait.score) {
        bestPortrait = { score, url };
      }
    }
  }
  if (opts?.preferPortrait) {
    for (const q of portraitPreferred) {
      const hit = byQuality.get(q);
      if (hit) return preferHighResVideoThumbnailUrl(hit, videoId);
    }
    if (bestPortrait) return bestPortrait.url;
  }
  if (bestByWidth && bestByWidth.w >= 480) {
    return preferHighResVideoThumbnailUrl(bestByWidth.url, videoId);
  }
  for (const q of preferred) {
    const hit = byQuality.get(q);
    if (hit) return preferHighResVideoThumbnailUrl(hit, videoId);
  }
  for (const item of thumbnails) {
    if (!item || typeof item !== "object") continue;
    const maybe = (item as { url?: unknown }).url;
    if (typeof maybe === "string" && maybe.startsWith("http")) {
      return preferHighResVideoThumbnailUrl(maybe, videoId);
    }
  }
  return undefined;
}

function readPositiveNumberField(
  o: Record<string, unknown>,
  keys: readonly string[],
): number | undefined {
  for (const key of keys) {
    const v = o[key];
    if (typeof v === "number" && Number.isFinite(v) && v > 0) return v;
    if (typeof v === "string") {
      const n = Number.parseFloat(v);
      if (Number.isFinite(n) && n > 0) return n;
    }
  }
  return undefined;
}

/** Invidious/Piped `height` / Invidious `size` ("1280x720"); includes 0 if API sends it. */
function readStreamHeightPx(
  stream: Record<string, unknown>,
): number | undefined {
  const h = stream.height;
  if (typeof h === "number" && Number.isFinite(h) && h >= 0)
    return Math.round(h);
  if (typeof h === "string") {
    const n = Number.parseInt(h.trim(), 10);
    if (Number.isFinite(n) && n >= 0) return n;
  }
  const sz = stream.size;
  if (typeof sz === "string") {
    const m = sz.trim().match(/^(\d+)\s*[x×]\s*(\d+)$/i);
    if (m) {
      const px = Number.parseInt(m[2] ?? "", 10);
      if (Number.isFinite(px) && px > 0) return px;
    }
  }
  return undefined;
}

function mimeVideoTypeWithoutAudioCodecs(mime: string | undefined): boolean {
  if (!mime?.trim()) return false;
  if (!mime.toLowerCase().startsWith("video/")) return false;
  const m = mime.match(/codecs\s*=\s*"([^"]+)"/i);
  if (!m?.[1]) return false;
  const c = m[1].toLowerCase().replace(/\s/g, "");
  const hasVideo = /avc1|avc3|av01|vp8|vp9|vp09|hev1|hvc1|dvh1|theora/.test(c);
  const hasAudio = /mp4a|opus|vorbis|flac|ac-3|ec-3/.test(c);
  return hasVideo && !hasAudio;
}

/** Piped exposes `codec` separately; merge into mime for playback heuristics. */
function pipedStreamMimeType(
  stream: Record<string, unknown>,
): string | undefined {
  const base =
    typeof stream.mimeType === "string" ? stream.mimeType.trim() : "";
  const codec = typeof stream.codec === "string" ? stream.codec.trim() : "";
  if (!base) return codec ? `video/mp4; codecs="${codec}"` : undefined;
  if (!codec || base.includes("codecs=")) return base;
  return `${base}; codecs="${codec}"`;
}

function mapPipedStream(
  data: unknown,
  pipedBase: string,
  knownVideoId?: string,
): VideoDetail | null {
  if (!data || typeof data !== "object") return null;
  const o = data as Record<string, unknown>;
  const fromPayload =
    typeof o.videoId === "string" && o.videoId.length > 0
      ? o.videoId
      : extractVideoIdFromUrl(String(o.url ?? ""));
  const videoId = fromPayload || knownVideoId?.trim() || "";
  const title = typeof o.title === "string" ? o.title : "";
  if (!videoId || !title) return null;
  const uploaderUrl =
    typeof o.uploaderUrl === "string" ? o.uploaderUrl : undefined;

  const audioStreams = Array.isArray(o.audioStreams) ? o.audioStreams : [];
  const videoStreams = Array.isArray(o.videoStreams) ? o.videoStreams : [];
  const audioSources = audioStreams
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const stream = item as Record<string, unknown>;
      const url = typeof stream.url === "string" ? stream.url : "";
      if (!url.startsWith("http")) return null;
      const bitrate = readPositiveNumberField(stream, [
        "bitrate",
        "averageBitrate",
      ]);
      const fps = readPositiveNumberField(stream, ["fps", "frameRate"]);
      return {
        url,
        mimeType: pipedStreamMimeType(stream),
        quality:
          typeof stream.quality === "string" ? stream.quality : undefined,
        bitrate,
        fps,
        language:
          typeof stream.language === "string"
            ? stream.language
            : typeof stream.lang === "string"
              ? stream.lang
              : typeof stream.audioLanguage === "string"
                ? stream.audioLanguage
                : undefined,
        audioTrackDisplayName:
          typeof stream.audioTrackName === "string"
            ? stream.audioTrackName
            : typeof stream.audioTrackDisplayName === "string"
              ? stream.audioTrackDisplayName
              : undefined,
      };
    })
    .filter((value): value is NonNullable<typeof value> => Boolean(value));
  const videoSources = videoStreams
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const stream = item as Record<string, unknown>;
      const url = typeof stream.url === "string" ? stream.url : "";
      if (!url.startsWith("http")) return null;
      const bitrate = readPositiveNumberField(stream, [
        "bitrate",
        "averageBitrate",
      ]);
      const fps = readPositiveNumberField(stream, ["fps", "frameRate"]);
      const height = readStreamHeightPx(stream);
      return {
        url,
        mimeType: pipedStreamMimeType(stream),
        quality:
          typeof stream.quality === "string" ? stream.quality : undefined,
        bitrate,
        fps,
        height,
        videoOnly:
          stream.videoOnly === true ||
          mimeVideoTypeWithoutAudioCodecs(pipedStreamMimeType(stream)),
      };
    })
    .filter((value): value is NonNullable<typeof value> => Boolean(value));

  const publishedAt =
    coercePublishedSecondsFromUpstream(o.uploadDate) ??
    coercePublishedSecondsFromUpstream(o.uploaded);
  const publishedText =
    publishedAt !== undefined
      ? undefined
      : typeof o.uploadDate === "string"
        ? o.uploadDate
        : toUnixText(o.uploaded);

  const { isLive, isUpcoming } = pickLiveFlagsFromUpstream(o);
  const rawDurationSeconds =
    typeof o.duration === "number" && Number.isFinite(o.duration)
      ? Math.floor(o.duration)
      : undefined;
  const durationSeconds = normalizeDurationForLive(rawDurationSeconds, isLive);

  const detail = {
    videoId,
    title,
    description:
      typeof o.description === "string"
        ? normalizePipedDescription(o.description)
        : undefined,
    channelId:
      typeof o.uploaderId === "string" && o.uploaderId.length > 0
        ? o.uploaderId
        : channelIdFromPath(uploaderUrl),
    channelName: typeof o.uploader === "string" ? o.uploader : undefined,
    channelAvatarUrl: pickPipedUploaderAvatar(o, pipedBase),
    channelSubscriberCount: pickChannelSubscriberCount(o),
    relatedVideos: (() => {
      const out: UnifiedVideo[] = [];
      for (const item of pipedListItemsFromPayload(o)) {
        const mapped = mapPipedItem(item, pipedBase);
        if (!mapped || mapped.videoId === videoId) continue;
        out.push(mapped);
        if (out.length >= 24) break;
      }
      return out.length > 0 ? out : undefined;
    })(),
    thumbnailUrl: preferHighResVideoThumbnailUrl(
      typeof o.thumbnailUrl === "string"
        ? o.thumbnailUrl
        : pickVideoThumbnail(o.thumbnails, videoId),
      videoId,
    ),
    durationSeconds,
    viewCount: pickViewCount(o),
    publishedText,
    publishedAt,
    isLive: isLive || undefined,
    isUpcoming: isUpcoming || undefined,
    hlsUrl:
      typeof o.hls === "string" && o.hls.trim().length > 0 ? o.hls : undefined,
    dashUrl:
      typeof o.dash === "string" && o.dash.trim().length > 0
        ? o.dash
        : undefined,
    audioSources,
    videoSources,
    sourceUsed: "piped" as const,
    mediaProxyBase:
      typeof o.proxyUrl === "string"
        ? o.proxyUrl.trim().replace(/\/+$/, "")
        : undefined,
  };
  const parsed = videoDetailSchema.safeParse(detail);
  if (!parsed.success) return null;
  return parsed.data;
}

function invidiousAdaptiveMimeIsAudio(mime: string | undefined): boolean {
  if (!mime) return false;
  return mime.toLowerCase().trim().startsWith("audio/");
}

function readInvidiousAdaptiveAudioMeta(st: Record<string, unknown>): {
  language?: string;
  displayName?: string;
} {
  const at = st.audioTrack;
  if (at && typeof at === "object") {
    const t = at as Record<string, unknown>;
    const displayName =
      typeof t.displayName === "string" ? t.displayName : undefined;
    let language: string | undefined;
    if (typeof t.id === "string" && t.id.length > 0) {
      language = t.id.replace(/^\./, "").split(".")[0];
    } else if (typeof t.languageCode === "string") {
      language = t.languageCode;
    } else if (typeof t.language === "string") {
      language = t.language;
    }
    return { displayName, language };
  }
  if (typeof st.audioTrackId === "string" && st.audioTrackId.length > 0) {
    return {
      language: st.audioTrackId.replace(/^\./, "").split(/[.]/)[0],
    };
  }

  const lang =
    typeof st.language === "string"
      ? st.language
      : typeof st.lang === "string"
        ? st.lang
        : typeof st.audioLanguage === "string"
          ? st.audioLanguage
          : undefined;
  const displayName =
    typeof st.audioTrackDisplayName === "string"
      ? st.audioTrackDisplayName
      : typeof st.name === "string"
        ? st.name
        : undefined;
  if (lang || displayName) return { language: lang, displayName };

  const ql = typeof st.qualityLabel === "string" ? st.qualityLabel.trim() : "";
  if (
    ql &&
    !/^(tiny|low|light|medium|high|small|144p|240p|360p|480p|720p|1080p)/i.test(
      ql,
    )
  ) {
    return { displayName: ql };
  }

  return {};
}

type InvidiousStream = {
  url: string;
  mimeType: string | undefined;
  quality: string | undefined;
  videoOnly: boolean;
  bitrate?: number;
  fps?: number;
  height?: number;
};

function mapInvidiousStreamItem(
  item: unknown,
  baseUrl: string,
  videoOnly: boolean,
): InvidiousStream | null {
  if (!item || typeof item !== "object") return null;
  const stream = item as Record<string, unknown>;
  const rawUrl = typeof stream.url === "string" ? stream.url : "";
  const url = resolveInvidiousAbsoluteMediaUrl(rawUrl, baseUrl);
  if (!url) return null;
  const type = typeof stream.type === "string" ? stream.type : undefined;
  const quality =
    typeof stream.qualityLabel === "string"
      ? stream.qualityLabel
      : typeof stream.quality === "string"
        ? stream.quality
        : undefined;
  const bitrate = readPositiveNumberField(stream, [
    "bitrate",
    "averageBitrate",
  ]);
  const fps = readPositiveNumberField(stream, ["fps", "frameRate"]);
  const height = readStreamHeightPx(stream);
  return { url, mimeType: type, quality, videoOnly, bitrate, fps, height };
}

function mapInvidiousVideo(data: unknown, baseUrl = ""): VideoDetail | null {
  if (!data || typeof data !== "object") return null;
  const o = data as Record<string, unknown>;
  const videoId = typeof o.videoId === "string" ? o.videoId : "";
  const title = typeof o.title === "string" ? o.title : "";
  if (!videoId || !title) return null;
  const formatStreams = Array.isArray(o.formatStreams) ? o.formatStreams : [];
  const adaptiveFormats = Array.isArray(o.adaptiveFormats)
    ? o.adaptiveFormats
    : [];
  const fromFormat = formatStreams
    .map((item) => mapInvidiousStreamItem(item, baseUrl, false))
    .filter((value): value is InvidiousStream => Boolean(value));

  const fromAdaptiveVideo: InvidiousStream[] = [];
  const audioFromAdaptive: {
    url: string;
    mimeType: string | undefined;
    quality: string | undefined;
    bitrate?: number;
    fps?: number;
    language?: string;
    audioTrackDisplayName?: string;
  }[] = [];
  for (const item of adaptiveFormats) {
    if (!item || typeof item !== "object") continue;
    const st = item as Record<string, unknown>;
    const mime = typeof st.type === "string" ? st.type : undefined;
    if (invidiousAdaptiveMimeIsAudio(mime)) {
      const m = mapInvidiousStreamItem(item, baseUrl, false);
      if (m) {
        const meta = readInvidiousAdaptiveAudioMeta(st);
        audioFromAdaptive.push({
          url: m.url,
          mimeType: m.mimeType,
          quality: m.quality,
          bitrate: m.bitrate,
          fps: m.fps,
          language: meta.language,
          audioTrackDisplayName: meta.displayName,
        });
      }
    } else {
      const m = mapInvidiousStreamItem(item, baseUrl, true);
      if (m) fromAdaptiveVideo.push(m);
    }
  }

  const videoSources: InvidiousStream[] = [...fromFormat, ...fromAdaptiveVideo];

  const hlsResolved = resolveInvidiousAbsoluteMediaUrl(
    typeof o.hlsUrl === "string" ? o.hlsUrl : undefined,
    baseUrl,
  );
  const dashResolved = resolveInvidiousAbsoluteMediaUrl(
    typeof o.dashUrl === "string" ? o.dashUrl : undefined,
    baseUrl,
  );

  const publishedText =
    typeof o.publishedText === "string"
      ? o.publishedText
      : toUnixText(o.published);
  const publishedAt =
    coercePublishedSecondsFromUpstream(o.published) ??
    coercePublishedSecondsFromUpstream(o.publishedAt) ??
    coercePublishedSecondsFromUpstream(o.timestamp) ??
    coercePublishedSecondsFromUpstream(o.premiereTimestamp);
  const reconciledPublishedAt = reconcilePublishedAtWithText(
    publishedAt,
    publishedText,
  );

  const { isLive, isUpcoming } = pickLiveFlagsFromUpstream(o);
  const rawDurationSeconds =
    typeof o.lengthSeconds === "number" && Number.isFinite(o.lengthSeconds)
      ? Math.floor(o.lengthSeconds)
      : undefined;
  const durationSeconds = normalizeDurationForLive(rawDurationSeconds, isLive);

  const detail = {
    videoId,
    title,
    description: typeof o.description === "string" ? o.description : undefined,
    channelId: typeof o.authorId === "string" ? o.authorId : undefined,
    channelName: typeof o.author === "string" ? o.author : undefined,
    channelAvatarUrl: resolveInvidiousThumbnail(o.authorThumbnails, baseUrl),
    channelSubscriberCount: pickChannelSubscriberCount(o),
    storyboard: pickInvidiousStoryboard(o, baseUrl),
    thumbnailUrl: resolveInvidiousThumbnail(o.videoThumbnails, baseUrl),
    durationSeconds,
    viewCount: pickViewCount(o),
    publishedText,
    publishedAt: reconciledPublishedAt,
    isLive: isLive || undefined,
    isUpcoming: isUpcoming || undefined,
    hlsUrl: hlsResolved,
    dashUrl: dashResolved,
    audioSources: audioFromAdaptive,
    videoSources,
    sourceUsed: "invidious" as const,
  };
  const parsed = videoDetailSchema.safeParse(detail);
  if (!parsed.success) return null;
  return parsed.data;
}

function inferMediaProxyBase(detail: VideoDetail): string | undefined {
  if (detail.mediaProxyBase) return detail.mediaProxyBase;
  for (const s of detail.videoSources) {
    if (!s.url) continue;
    try {
      const u = new URL(s.url);
      const p = u.pathname.toLowerCase();
      if (p === "/videoplayback" || p.startsWith("/vi/")) {
        return u.origin;
      }
    } catch {
      /* skip */
    }
  }
  return undefined;
}

function enrichDetailForPlayback(detail: VideoDetail): VideoDetail {
  const mediaProxyBase = inferMediaProxyBase(detail);
  if (!mediaProxyBase || mediaProxyBase === detail.mediaProxyBase) {
    return detail;
  }
  return { ...detail, mediaProxyBase };
}

function readFreshDetailCache(db: AppDb, key: string): VideoDetail | null {
  const row = readFreshCacheRow(db, key);
  if (!row) return null;
  const parsed = videoDetailSchema.safeParse(
    JSON.parse(row.payloadJson) as unknown,
  );
  if (!parsed.success) return null;
  logger.info("video_cache.hit", { cacheKey: key, kind: row.kind });
  return enrichDetailForPlayback({
    ...parsed.data,
    sourceUsed: "cache",
    stale: false,
  });
}

function readStaleDetailCache(db: AppDb, key: string): VideoDetail | null {
  const row = readLatestCacheRow(db, key);
  if (!row) return null;
  const parsed = videoDetailSchema.safeParse(
    JSON.parse(row.payloadJson) as unknown,
  );
  if (!parsed.success) return null;
  logger.warn("video_cache.stale_hit", { cacheKey: key, kind: row.kind });
  return {
    ...parsed.data,
    sourceUsed: "cache",
    stale: true,
    warning: "Upstream unavailable, serving stale cache.",
  };
}

function readFreshRelatedCache(
  db: AppDb,
  key: string,
): RelatedVideosResult | null {
  const row = readFreshCacheRow(db, key);
  if (!row) return null;
  const parsed = relatedVideosResultSchema.safeParse(
    JSON.parse(row.payloadJson) as unknown,
  );
  if (!parsed.success) return null;
  logger.info("video_cache.hit", { cacheKey: key, kind: row.kind });
  return { ...parsed.data, sourceUsed: "cache", stale: false };
}

function readStaleRelatedCache(
  db: AppDb,
  key: string,
): RelatedVideosResult | null {
  const row = readLatestCacheRow(db, key);
  if (!row) return null;
  const parsed = relatedVideosResultSchema.safeParse(
    JSON.parse(row.payloadJson) as unknown,
  );
  if (!parsed.success) return null;
  logger.warn("video_cache.stale_hit", { cacheKey: key, kind: row.kind });
  return {
    ...parsed.data,
    sourceUsed: "cache",
    stale: true,
    warning: "Upstream unavailable, serving stale cache.",
  };
}

function buildPipedStreamsUrl(base: string, videoId: string): string {
  return new URL(
    `/streams/${encodeURIComponent(videoId)}`,
    `${base}/`,
  ).toString();
}

function buildInvidiousVideosUrl(base: string, videoId: string): string {
  return new URL(
    `/api/v1/videos/${encodeURIComponent(videoId)}`,
    `${base}/`,
  ).toString();
}

function buildPipedRelatedUrl(base: string, videoId: string): string {
  return new URL(
    `/streams/${encodeURIComponent(videoId)}/related`,
    `${base}/`,
  ).toString();
}

function buildInvidiousRelatedUrl(base: string, videoId: string): string {
  return new URL(
    `/api/v1/videos/${encodeURIComponent(videoId)}/related`,
    `${base}/`,
  ).toString();
}

export type FetchVideoDetailOptions = {
  /**
   * When true, skip the SQLite “fresh” row for this video so Invidious/Piped
   * return a new `hlsUrl` and adaptive URLs (signed links go 404 quickly).
   */
  bypassDetailCache?: boolean;
  /** Prefer this upstream for live HLS when both Piped and Invidious are set. */
  preferUpstream?: VideoDetailInput["preferUpstream"];
};

export type FetchChannelPageOptions = {
  /** Force a live upstream read instead of using the fresh channel cache row. */
  bypassChannelCache?: boolean;
};

export async function fetchVideoDetail(
  db: AppDb,
  input: VideoDetailInput,
  overrides?: ProxySourceOverrides,
  opts?: FetchVideoDetailOptions,
): Promise<VideoDetail> {
  const key = detailCacheKey(input);
  if (!opts?.bypassDetailCache) {
    const cached = readFreshDetailCache(db, key);
    if (cached) return cached;
  }

  const { pipedBase, invidiousBase } = resolveProxyBases(overrides);
  const errors: string[] = [];

  let resolved: VideoDetail | null = null;
  let pipedResolved: VideoDetail | null = null;
  let invidiousResolved: VideoDetail | null = null;
  const preferUpstream = opts?.preferUpstream ?? input.preferUpstream;

  const fetchInvidiousDetail = async (): Promise<VideoDetail | null> => {
    if (!invidiousBase) return null;
    if (invidiousPortCollidesWithNextApp(invidiousBase)) {
      errors.push(
        "invidious:INVIDIOUS_BASE_URL port conflicts with Next.js PORT (server would call itself).",
      );
      return null;
    }
    try {
      acquireUpstreamSlot();
      const json = await fetchJson(
        buildInvidiousVideosUrl(invidiousBase, input.videoId),
      );
      return mapInvidiousVideo(json, invidiousBase);
    } catch (error) {
      rethrowIfInvidiousUpcoming(error, input.videoId);
      recordUpstreamFailure(error, "invidious", errors);
      return null;
    }
  };

  if (pipedBase) {
    try {
      acquireUpstreamSlot();
      const json = await fetchJson(
        buildPipedStreamsUrl(pipedBase, input.videoId),
      );
      pipedResolved = mapPipedStream(json, pipedBase, input.videoId);
      resolved = pipedResolved;
    } catch (error) {
      recordUpstreamFailure(error, "piped", errors);
    }
  }

  const liveFromPiped = pipedResolved?.isLive === true;
  const shouldConsultInvidiousForLive =
    liveFromPiped || preferUpstream === "invidious";

  if (!resolved && invidiousBase) {
    invidiousResolved = await fetchInvidiousDetail();
    resolved = invidiousResolved;
  } else if (shouldConsultInvidiousForLive && invidiousBase) {
    invidiousResolved = await fetchInvidiousDetail();
    if (pipedResolved?.isLive || invidiousResolved?.isLive) {
      resolved = pickLivePlaybackDetail(
        pipedResolved,
        invidiousResolved,
        preferUpstream,
      );
    }
  } else if (
    pipedResolved &&
    invidiousBase &&
    shouldPreferInvidiousOverPiped(pipedResolved)
  ) {
    invidiousResolved = await fetchInvidiousDetail();
    if (invidiousResolved) {
      const picked = pickRicherPlaybackDetail(
        pipedResolved,
        invidiousResolved,
      );
      if (picked.sourceUsed === "invidious") {
        logger.info("upstream.prefer_invidious_over_piped", {
          videoId: input.videoId,
          pipedMaxHeight: playbackCatalogMaxHeightPx(pipedResolved),
          invidiousMaxHeight: playbackCatalogMaxHeightPx(invidiousResolved),
        });
      }
      resolved = picked;
    }
  }

  if (!resolved) {
    const stale = readStaleDetailCache(db, key);
    if (stale) return stale;
    throwIfUpstreamFailed(errors, "video detail unavailable");
  }

  let enriched = enrichDetailForPlayback(resolved);
  if (invidiousBase && !enriched.storyboard) {
    const storyboard = await tryFetchInvidiousStoryboard(
      input.videoId,
      invidiousBase,
    );
    if (storyboard) enriched = { ...enriched, storyboard };
  }
  writeCache(
    db,
    key,
    liveUpstreamSource(enriched.sourceUsed),
    enriched,
    "streams",
  );
  return enriched;
}

function parseRelatedFromPiped(
  data: unknown,
  limit: number,
  pipedBase: string,
): UnifiedVideo[] {
  const items = pipedRelatedListItems(data);
  const videos: UnifiedVideo[] = [];
  for (const item of items) {
    const mapped = mapPipedItem(item, pipedBase);
    if (mapped) videos.push(mapped);
    if (videos.length >= limit) break;
  }
  return videos;
}

function parseRelatedFromInvidious(
  data: unknown,
  limit: number,
  baseUrl: string,
): UnifiedVideo[] {
  if (!Array.isArray(data)) return [];
  const videos: UnifiedVideo[] = [];
  for (const item of data) {
    const mapped = mapInvidiousItem(item, baseUrl);
    if (mapped) videos.push(mapped);
    if (videos.length >= limit) break;
  }
  return videos;
}

async function relatedVideosFromSameUploader(
  db: AppDb,
  input: VideoDetailInput,
  limit: number,
  overrides?: ProxySourceOverrides,
): Promise<UnifiedVideo[] | null> {
  try {
    const detail = await fetchVideoDetail(db, input, overrides);
    const channelId = detail.channelId;
    if (!channelId) return null;
    const page = await fetchChannelPage(db, { channelId }, overrides);
    const list = page.videos.filter((v) => v.videoId !== input.videoId);
    if (list.length === 0) return null;
    return list.slice(0, limit);
  } catch {
    return null;
  }
}

function tokenizeRelatedText(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .filter((part) => part.length >= 3);
}

function scoreRelatedCandidate(
  seed: VideoDetail,
  candidate: UnifiedVideo,
): number {
  const seedTokens = new Set(tokenizeRelatedText(seed.title));
  const candidateTokens = new Set(tokenizeRelatedText(candidate.title));
  let overlap = 0;
  for (const t of candidateTokens) {
    if (seedTokens.has(t)) overlap += 1;
  }
  const candidateTokenCount = candidateTokens.size || 1;
  const overlapRatio = overlap / candidateTokenCount;
  const sameChannel =
    Boolean(seed.channelId) && Boolean(candidate.channelId)
      ? seed.channelId === candidate.channelId
      : false;
  const viewScore = Math.log10(
    Math.max(1, Math.floor(candidate.viewCount ?? 0)),
  );
  return (
    overlapRatio * 100 +
    overlap * 8 +
    (sameChannel ? -6 : 6) +
    Math.min(6, viewScore)
  );
}

function mergeAndRankRelatedVideos(
  seed: VideoDetail,
  inputVideoId: string,
  limit: number,
  preferred: UnifiedVideo[],
  extras: UnifiedVideo[],
): UnifiedVideo[] {
  const unique = new Map<string, UnifiedVideo>();
  for (const item of [...preferred, ...extras]) {
    if (item.videoId === inputVideoId) continue;
    if (unique.has(item.videoId)) continue;
    unique.set(item.videoId, item);
  }
  const ranked = [...unique.values()];
  ranked.sort(
    (a, b) => scoreRelatedCandidate(seed, b) - scoreRelatedCandidate(seed, a),
  );
  return ranked.slice(0, limit);
}

export async function fetchRelatedVideos(
  db: AppDb,
  input: VideoDetailInput,
  limit = 20,
  overrides?: ProxySourceOverrides,
): Promise<RelatedVideosResult> {
  const key = relatedCacheKey(input);
  const cached = readFreshRelatedCache(db, key);
  if (cached) return cached;

  const { pipedBase, invidiousBase } = resolveProxyBases(overrides);
  const errors: string[] = [];

  let resolved: RelatedVideosResult | null = null;
  if (pipedBase) {
    try {
      acquireUpstreamSlot();
      const json = await fetchJson(
        buildPipedStreamsUrl(pipedBase, input.videoId),
      );
      const fromStreams = parseRelatedFromPiped(json, limit, pipedBase);
      if (fromStreams.length > 0) {
        resolved = relatedVideosResultSchema.parse({
          videos: fromStreams,
          sourceUsed: "piped",
        });
      }
    } catch (error) {
      recordUpstreamFailure(error, "piped", errors);
    }
    if (!resolved || resolved.videos.length === 0) {
      try {
        acquireUpstreamSlot();
        const json = await fetchJson(
          buildPipedRelatedUrl(pipedBase, input.videoId),
          { emptyBodyAs: [] },
        );
        const fromRelatedRoute = parseRelatedFromPiped(json, limit, pipedBase);
        if (fromRelatedRoute.length > 0) {
          resolved = relatedVideosResultSchema.parse({
            videos: fromRelatedRoute,
            sourceUsed: "piped",
          });
        }
      } catch (error) {
        recordUpstreamFailure(error, "piped", errors);
      }
    }
  }

  if ((!resolved || resolved.videos.length === 0) && invidiousBase) {
    if (invidiousPortCollidesWithNextApp(invidiousBase)) {
      errors.push(
        "invidious:INVIDIOUS_BASE_URL port conflicts with Next.js PORT (server would call itself).",
      );
    } else {
      try {
        acquireUpstreamSlot();
        const json = await fetchJson(
          buildInvidiousRelatedUrl(invidiousBase, input.videoId),
          { emptyBodyAs: [] },
        );
        resolved = relatedVideosResultSchema.parse({
          videos: parseRelatedFromInvidious(json, limit, invidiousBase),
          sourceUsed: "invidious",
        });
      } catch (error) {
        recordUpstreamFailure(error, "invidious", errors);
      }
    }
  }

  if (!resolved) {
    const stale = readStaleRelatedCache(db, key);
    if (stale) return stale;
    throwIfUpstreamFailed(errors, "related videos unavailable");
  }

  let warning = resolved.warning;
  const seed = await fetchVideoDetail(db, input, overrides).catch(() => null);
  if (seed) {
    const current = resolved.videos.filter((v) => v.videoId !== input.videoId);
    const crossChannelCount = current.filter(
      (v) => v.channelId && seed.channelId && v.channelId !== seed.channelId,
    ).length;
    const needsBroaderPool =
      current.length < limit || (current.length > 0 && crossChannelCount === 0);
    let extraPool: UnifiedVideo[] = [];
    if (needsBroaderPool) {
      const fromSearch = await searchVideos(
        db,
        { q: seed.title, limit: Math.min(50, Math.max(limit * 3, 24)) },
        overrides,
      ).catch(() => null);
      if (fromSearch?.videos?.length) {
        extraPool = fromSearch.videos;
        warning =
          warning ??
          "Related feed lacked diversity; mixed in title-matched videos from search.";
      }
    }
    const ranked = mergeAndRankRelatedVideos(
      seed,
      input.videoId,
      limit,
      current,
      extraPool,
    );
    if (ranked.length > 0) {
      resolved = {
        ...resolved,
        videos: ranked,
        warning,
      };
    }
  }

  if (resolved.videos.length === 0) {
    const fallback = await relatedVideosFromSameUploader(
      db,
      input,
      limit,
      overrides,
    );
    if (fallback && fallback.length > 0) {
      resolved = {
        videos: fallback,
        sourceUsed: resolved.sourceUsed,
        warning:
          "No related list available; showing recent uploads from the same channel.",
      };
    }
  }

  if (resolved.videos.length > 0) {
    writeCache(
      db,
      key,
      liveUpstreamSource(resolved.sourceUsed),
      resolved,
      "related",
    );
  }
  return resolved;
}

/* -------------------------------------------------------------------------- */
/* Comments                                                                   */
/* -------------------------------------------------------------------------- */

function buildPipedCommentsUrl(base: string, videoId: string): string {
  return new URL(
    `/comments/${encodeURIComponent(videoId)}`,
    `${normalizeBaseUrl(base)}/`,
  ).toString();
}

function buildPipedCommentsNextUrl(
  base: string,
  videoId: string,
  nextpage: string,
): string {
  const u = new URL(
    `/nextpage/comments/${encodeURIComponent(videoId)}`,
    `${normalizeBaseUrl(base)}/`,
  );
  u.searchParams.set("nextpage", nextpage);
  return u.toString();
}

function buildInvidiousCommentsUrl(
  base: string,
  videoId: string,
  sortBy: "top" | "new",
  continuation?: string,
): string {
  const u = new URL(
    `/api/v1/comments/${encodeURIComponent(videoId)}`,
    `${normalizeBaseUrl(base)}/`,
  );
  u.searchParams.set("sort_by", sortBy);
  u.searchParams.set("source", "youtube");
  if (continuation) u.searchParams.set("continuation", continuation);
  return u.toString();
}

function mapPipedComment(
  raw: unknown,
  pipedBase: string,
): UnifiedComment | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const commentId = typeof o.commentId === "string" ? o.commentId.trim() : "";
  const author = typeof o.author === "string" ? o.author.trim() : "";
  const text = typeof o.commentText === "string" ? o.commentText.trim() : "";
  if (!commentId || !author || !text) return null;
  const commentorUrl =
    typeof o.commentorUrl === "string" ? o.commentorUrl : undefined;
  const thumb = typeof o.thumbnail === "string" ? o.thumbnail : undefined;
  const likeCount =
    typeof o.likeCount === "number" && Number.isFinite(o.likeCount)
      ? Math.max(0, Math.floor(o.likeCount))
      : undefined;
  const parsed = unifiedCommentSchema.safeParse({
    commentId,
    author,
    authorId: channelIdFromPath(commentorUrl),
    text,
    publishedText:
      typeof o.commentedTime === "string" ? o.commentedTime : undefined,
    authorAvatarUrl: resolveInvidiousAbsoluteMediaUrl(thumb, pipedBase),
    likeCount,
    isPinned: o.pinned === true,
    isHearted: o.hearted === true,
    isVerified: o.verified === true,
  });
  if (!parsed.success) return null;
  return parsed.data;
}

function mapPipedComments(
  data: unknown,
  pipedBase: string,
  videoId: string,
): VideoCommentsResult | null {
  if (!data || typeof data !== "object") return null;
  const o = data as Record<string, unknown>;
  const comments: UnifiedComment[] = [];
  if (Array.isArray(o.comments)) {
    for (const raw of o.comments) {
      const mapped = mapPipedComment(raw, pipedBase);
      if (mapped) comments.push(mapped);
    }
  }
  const nextpage =
    typeof o.nextpage === "string" && o.nextpage.trim().length > 0
      ? o.nextpage.trim()
      : null;
  const parsed = videoCommentsResultSchema.safeParse({
    videoId,
    comments,
    disabled: o.disabled === true,
    continuation: nextpage,
    sourceUsed: "piped",
  });
  if (!parsed.success) return null;
  return parsed.data;
}

function mapInvidiousComment(
  raw: unknown,
  invidiousBase: string,
): UnifiedComment | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const commentId = typeof o.commentId === "string" ? o.commentId.trim() : "";
  const author = typeof o.author === "string" ? o.author.trim() : "";
  const contentHtml =
    typeof o.contentHtml === "string" ? o.contentHtml.trim() : "";
  const content = typeof o.content === "string" ? o.content.trim() : "";
  const text = contentHtml || content;
  if (!commentId || !author || !text) return null;
  const authorId =
    typeof o.authorId === "string" && o.authorId.trim().length > 0
      ? o.authorId.trim()
      : channelIdFromPath(
          typeof o.authorUrl === "string" ? o.authorUrl : undefined,
        );
  const likeCount =
    typeof o.likeCount === "number" && Number.isFinite(o.likeCount)
      ? Math.max(0, Math.floor(o.likeCount))
      : undefined;
  const replies =
    o.replies && typeof o.replies === "object"
      ? (o.replies as Record<string, unknown>)
      : undefined;
  const replyCount =
    replies &&
    typeof replies.replyCount === "number" &&
    Number.isFinite(replies.replyCount)
      ? Math.max(0, Math.floor(replies.replyCount))
      : undefined;
  const parsed = unifiedCommentSchema.safeParse({
    commentId,
    author,
    authorId,
    text,
    publishedText:
      typeof o.publishedText === "string" ? o.publishedText : undefined,
    authorAvatarUrl: resolveInvidiousThumbnail(
      o.authorThumbnails,
      invidiousBase,
    ),
    likeCount,
    isPinned: o.isPinned === true,
    isHearted: Boolean(o.creatorHeart),
    replyCount,
  });
  if (!parsed.success) return null;
  return parsed.data;
}

function mapInvidiousComments(
  data: unknown,
  invidiousBase: string,
  videoId: string,
): VideoCommentsResult | null {
  if (!data || typeof data !== "object") return null;
  const o = data as Record<string, unknown>;
  const comments: UnifiedComment[] = [];
  if (Array.isArray(o.comments)) {
    for (const raw of o.comments) {
      const mapped = mapInvidiousComment(raw, invidiousBase);
      if (mapped) comments.push(mapped);
    }
  }
  const continuation =
    typeof o.continuation === "string" && o.continuation.trim().length > 0
      ? o.continuation.trim()
      : null;
  const commentCount =
    typeof o.commentCount === "number" && Number.isFinite(o.commentCount)
      ? Math.max(0, Math.floor(o.commentCount))
      : undefined;
  const parsed = videoCommentsResultSchema.safeParse({
    videoId:
      typeof o.videoId === "string" && o.videoId.trim().length > 0
        ? o.videoId.trim()
        : videoId,
    comments,
    continuation,
    commentCount,
    sourceUsed: "invidious",
  });
  if (!parsed.success) return null;
  return parsed.data;
}

export async function fetchVideoComments(
  _db: AppDb,
  input: VideoCommentsInput,
  overrides?: ProxySourceOverrides,
): Promise<VideoCommentsResult> {
  const { pipedBase, invidiousBase } = resolveProxyBases(overrides);
  const errors: string[] = [];
  const continuation = input.continuation?.trim() || undefined;

  let resolved: VideoCommentsResult | null = null;
  if (pipedBase && input.sortBy === "top") {
    try {
      acquireUpstreamSlot();
      const url = continuation
        ? buildPipedCommentsNextUrl(pipedBase, input.videoId, continuation)
        : buildPipedCommentsUrl(pipedBase, input.videoId);
      const json = await fetchJson(url);
      resolved = mapPipedComments(json, pipedBase, input.videoId);
    } catch (error) {
      recordUpstreamFailure(error, "piped", errors);
    }
  }
  if (!resolved && invidiousBase) {
    if (invidiousPortCollidesWithNextApp(invidiousBase)) {
      errors.push(
        "invidious:INVIDIOUS_BASE_URL port conflicts with Next.js PORT (server would call itself).",
      );
    } else {
      try {
        acquireUpstreamSlot();
        const json = await fetchJson(
          buildInvidiousCommentsUrl(
            invidiousBase,
            input.videoId,
            input.sortBy,
            continuation,
          ),
        );
        resolved = mapInvidiousComments(json, invidiousBase, input.videoId);
      } catch (error) {
        recordUpstreamFailure(error, "invidious", errors);
      }
    }
  }

  if (!resolved) {
    throwIfUpstreamFailed(errors, "comments unavailable");
  }
  return resolved;
}

/* -------------------------------------------------------------------------- */
/* Trending                                                                   */
/* -------------------------------------------------------------------------- */

function readFreshTrendingCache(
  db: AppDb,
  key: string,
): TrendingVideosResult | null {
  const row = readFreshCacheRow(db, key);
  if (!row) return null;
  const raw = JSON.parse(row.payloadJson) as unknown;
  const parsed = cachedTrendingPayloadSchema.safeParse(raw);
  if (!parsed.success) return null;
  logger.info("video_cache.hit", { cacheKey: key, kind: row.kind });
  return {
    videos: stripRestrictedListVideos(parsed.data.videos),
    sourceUsed: "cache",
    stale: false,
  };
}

function readFreshShortsFeedCache(
  db: AppDb,
  key: string,
): ShortsFeedResult | null {
  const row = readFreshCacheRow(db, key);
  if (!row) return null;
  const raw = JSON.parse(row.payloadJson) as unknown;
  const parsed = cachedShortsFeedPayloadSchema.safeParse(raw);
  if (!parsed.success) return null;
  logger.info("video_cache.hit", { cacheKey: key, kind: row.kind });
  return {
    videos: parsed.data.videos,
    continuation: parsed.data.continuation,
    sourceUsed: "cache",
    stale: false,
  };
}

function readStaleShortsFeedCache(
  db: AppDb,
  key: string,
): ShortsFeedResult | null {
  const row = readLatestCacheRow(db, key);
  if (!row) return null;
  const raw = JSON.parse(row.payloadJson) as unknown;
  const parsed = cachedShortsFeedPayloadSchema.safeParse(raw);
  if (!parsed.success) return null;
  logger.warn("video_cache.stale_hit", { cacheKey: key, kind: row.kind });
  return {
    videos: parsed.data.videos,
    continuation: parsed.data.continuation,
    sourceUsed: "cache",
    stale: true,
    warning: "Upstream unavailable, serving stale cache.",
  };
}

function readStaleTrendingCache(
  db: AppDb,
  key: string,
): TrendingVideosResult | null {
  const row = readLatestCacheRow(db, key);
  if (!row) return null;
  const raw = JSON.parse(row.payloadJson) as unknown;
  const parsed = cachedTrendingPayloadSchema.safeParse(raw);
  if (!parsed.success) return null;
  logger.warn("video_cache.stale_hit", { cacheKey: key, kind: row.kind });
  return {
    videos: stripRestrictedListVideos(parsed.data.videos),
    sourceUsed: "cache",
    stale: true,
    warning: "Upstream unavailable, serving stale cache.",
  };
}

function buildPipedTrendingUrl(
  base: string,
  region: string,
  category?: string,
): string {
  const u = new URL("/trending", `${normalizeBaseUrl(base)}/`);
  u.searchParams.set("region", region.toUpperCase());
  if (category) u.searchParams.set("type", category);
  return u.toString();
}

function buildInvidiousTrendingUrl(
  base: string,
  region: string,
  category?: string,
): string {
  const u = new URL("/api/v1/trending", `${normalizeBaseUrl(base)}/`);
  u.searchParams.set("region", region.toUpperCase());
  if (category) u.searchParams.set("type", category);
  return u.toString();
}

function parsePipedTrending(
  data: unknown,
  limit: number,
  pipedBase: string,
): UnifiedVideo[] {
  const items = Array.isArray(data) ? data : pipedRootItems(data);
  const videos: UnifiedVideo[] = [];
  for (const item of items) {
    const m = mapPipedItem(item, pipedBase);
    if (m) videos.push(m);
    if (videos.length >= limit) break;
  }
  return videos;
}

function parseInvidiousTrending(
  data: unknown,
  limit: number,
  invidiousBase: string,
): UnifiedVideo[] {
  if (!Array.isArray(data)) return [];
  const videos: UnifiedVideo[] = [];
  for (const item of data) {
    const m = mapInvidiousItem(item, invidiousBase);
    if (m) videos.push(m);
    if (videos.length >= limit) break;
  }
  return videos;
}

export async function fetchTrendingVideos(
  db: AppDb,
  input: TrendingInput,
  overrides?: ProxySourceOverrides,
): Promise<TrendingVideosResult> {
  const region = input.region.toUpperCase();
  const limit = Math.min(200, input.limit ?? 40);
  const key = trendingCacheKey({ region, limit, category: input.category });
  const fresh = readFreshTrendingCache(db, key);
  if (fresh) return fresh;
  const inFlight = inFlightTrending.get(key);
  if (inFlight) return inFlight;

  const task = (async (): Promise<TrendingVideosResult> => {
    const { pipedBase, invidiousBase } = resolveProxyBases(overrides);
    const errors: string[] = [];

    let resolved: TrendingVideosResult | null = null;

    if (pipedBase) {
      try {
        acquireUpstreamSlot();
        const json = await fetchJson(
          buildPipedTrendingUrl(pipedBase, region, input.category),
          {
            emptyBodyAs: [],
          },
        );
        const videos = parsePipedTrending(json, limit, pipedBase);
        if (videos.length > 0) {
          resolved = trendingVideosResultSchema.parse({
            videos,
            sourceUsed: "piped",
          });
        }
      } catch (e) {
        recordUpstreamFailure(e, "piped", errors);
      }
    }

    if ((!resolved || resolved.videos.length === 0) && invidiousBase) {
      if (invidiousPortCollidesWithNextApp(invidiousBase)) {
        errors.push("invidious:port collision with Next.js");
      } else {
        try {
          acquireUpstreamSlot();
          const json = await fetchJson(
            buildInvidiousTrendingUrl(invidiousBase, region, input.category),
            { emptyBodyAs: [] },
          );
          const videos = parseInvidiousTrending(json, limit, invidiousBase);
          if (videos.length > 0) {
            resolved = trendingVideosResultSchema.parse({
              videos,
              sourceUsed: "invidious",
            });
          }
        } catch (e) {
          recordUpstreamFailure(e, "invidious", errors);
        }
      }
    }

    if (!resolved || resolved.videos.length === 0) {
      const stale = readStaleTrendingCache(db, key);
      if (stale) return stale;
      throwIfUpstreamFailed(errors, "trending unavailable");
    }

    const cleaned = stripRestrictedListVideos(resolved.videos);
    const out: TrendingVideosResult = {
      ...resolved,
      videos: cleaned,
    };
    const store = {
      videos: out.videos,
      sourceUsed: liveUpstreamSource(out.sourceUsed),
    };
    writeCache(db, key, store.sourceUsed, store, "trending");
    return out;
  })();
  inFlightTrending.set(key, task);
  try {
    return await task;
  } finally {
    inFlightTrending.delete(key);
  }
}

/** Piped search queries are regionalized via {@link shortsSearchQueriesForRegion}. */
const INVIDIOUS_SHORTS_SEARCH_QUERY = "#shorts";

const SHORTS_FEED_EMPTY_WARNING =
  "No shorts found for your region right now. Try again later or change trending region in Settings.";

function parseInvidiousShortsList(
  data: unknown,
  limit: number,
  invidiousBase: string,
): UnifiedVideo[] {
  if (!Array.isArray(data)) return [];
  const videos: UnifiedVideo[] = [];
  for (const item of data) {
    const m = mapInvidiousItem(item, invidiousBase);
    if (!m) continue;
    const rawType =
      item && typeof item === "object"
        ? (item as Record<string, unknown>).type
        : undefined;
    if (
      rawType === "shortVideo" ||
      invidiousItemIsDiscoveryShort(item) ||
      isDiscoveryShortVideo(m)
    ) {
      videos.push(m);
      if (videos.length >= limit) break;
    }
  }
  return videos;
}

function parsePipedShortsSearch(
  data: unknown,
  limit: number,
  pipedBase: string,
): { videos: UnifiedVideo[]; continuation: string | null } {
  const items = pipedRootItems(data);
  const videos: UnifiedVideo[] = [];
  for (const item of items) {
    const v = mapPipedItem(item, pipedBase);
    if (!v) continue;
    if (pipedItemIsDiscoveryShort(item) || isDiscoveryShortVideo(v)) {
      videos.push(v);
      if (videos.length >= limit) break;
    }
  }
  return { videos, continuation: pipedNextPage(data) };
}

function mergeDiscoveryShortVideos(
  limit: number,
  seen: Set<string>,
  out: UnifiedVideo[],
  incoming: UnifiedVideo[],
): boolean {
  for (const v of incoming) {
    if (seen.has(v.videoId)) continue;
    seen.add(v.videoId);
    out.push(v);
    if (out.length >= limit) return true;
  }
  return out.length >= limit;
}

function parsePipedTrendingShorts(
  data: unknown,
  limit: number,
  pipedBase: string,
): UnifiedVideo[] {
  const items = Array.isArray(data) ? data : pipedRootItems(data);
  const videos: UnifiedVideo[] = [];
  for (const item of items) {
    const v = mapPipedItem(item, pipedBase);
    if (!v) continue;
    if (pipedItemIsDiscoveryShort(item) || isDiscoveryShortVideo(v)) {
      videos.push(v);
      if (videos.length >= limit) break;
    }
  }
  return videos;
}

function invidiousShortsSearchPage(continuation: string | undefined): number {
  if (!continuation?.startsWith("inv:page:")) return 1;
  const n = Number.parseInt(continuation.slice("inv:page:".length), 10);
  return Number.isFinite(n) && n >= 1 ? n : 1;
}

function nextInvidiousShortsContinuation(
  page: number,
  got: number,
  limit: number,
): string | null {
  return got >= limit ? `inv:page:${page + 1}` : null;
}

export async function fetchShortsFeed(
  db: AppDb,
  input: ShortsFeedInput,
  overrides?: ProxySourceOverrides,
): Promise<ShortsFeedResult> {
  const region = input.region.toUpperCase();
  const limit = Math.min(40, input.limit ?? 20);
  const key = shortsFeedCacheKey({ ...input, region, limit });
  const fresh = readFreshShortsFeedCache(db, key);
  // Shelf needs ~14 items; a thin cached page (e.g. from warm-cache) must not block refetch.
  if (
    fresh &&
    (input.purpose !== "shelf" || fresh.videos.length >= limit)
  ) {
    return fresh;
  }

  const inFlight = inFlightShortsFeed.get(key);
  if (inFlight) return inFlight;

  const task = (async (): Promise<ShortsFeedResult> => {
    const { pipedBase, invidiousBase } = resolveProxyBases(overrides);
    const errors: string[] = [];
    let resolved: ShortsFeedResult | null = null;

    const tryInvidious = async (): Promise<ShortsFeedResult | null> => {
      if (!invidiousBase) return null;
      if (invidiousPortCollidesWithNextApp(invidiousBase)) {
        errors.push("invidious:port collision with Next.js");
        return null;
      }
      try {
        const page = invidiousShortsSearchPage(input.continuation);
        if (!input.continuation) {
          const seen = new Set<string>();
          const videos: UnifiedVideo[] = [];
          const invidiousDiscoveryQueries = resolveShortsDiscoveryQueries(
            input,
            region,
          );
          const tasteDiscovery = (input.discoveryQueries?.length ?? 0) > 0;
          if (!tasteDiscovery) {
            try {
              acquireUpstreamSlot();
              const trendingUrl = buildInvidiousTrendingUrl(
                invidiousBase,
                region,
              );
              const trendingJson = await fetchJson(trendingUrl, {
                emptyBodyAs: [],
              });
              mergeDiscoveryShortVideos(
                limit,
                seen,
                videos,
                parseInvidiousShortsList(trendingJson, limit, invidiousBase),
              );
            } catch (e) {
              recordUpstreamFailure(e, "invidious", errors);
            }
          }
          for (const q of invidiousDiscoveryQueries) {
            if (videos.length >= limit) break;
            try {
              acquireUpstreamSlot();
              const searchUrl = buildInvidiousSearchUrl(
                invidiousBase,
                { q, continuation: "1", region },
                "video",
              );
              const json = await fetchJson(searchUrl, { emptyBodyAs: [] });
              const found = parseInvidiousShortsList(
                json,
                limit,
                invidiousBase,
              );
              if (mergeDiscoveryShortVideos(limit, seen, videos, found)) break;
            } catch (e) {
              recordUpstreamFailure(e, "invidious", errors);
            }
          }
          if (videos.length > 0) {
            return shortsFeedResultSchema.parse({
              videos: videos.slice(0, limit),
              continuation: nextInvidiousShortsContinuation(
                1,
                videos.length,
                limit,
              ),
              sourceUsed: "invidious",
            });
          }
        }
        acquireUpstreamSlot();
        const searchUrl = buildInvidiousSearchUrl(
          invidiousBase,
          {
            q: INVIDIOUS_SHORTS_SEARCH_QUERY,
            continuation: String(page),
            region,
          },
          "video",
        );
        const json = await fetchJson(searchUrl, { emptyBodyAs: [] });
        const videos = parseInvidiousShortsList(json, limit, invidiousBase);
        if (videos.length === 0) return null;
        return shortsFeedResultSchema.parse({
          videos,
          continuation: nextInvidiousShortsContinuation(
            page,
            videos.length,
            limit,
          ),
          sourceUsed: "invidious",
        });
      } catch (e) {
        recordUpstreamFailure(e, "invidious", errors);
        return null;
      }
    };

    const tryPiped = async (): Promise<ShortsFeedResult | null> => {
      if (!pipedBase) return null;
      const discoveryQueries = resolveShortsDiscoveryQueries(input, region);
      const tasteDiscovery = (input.discoveryQueries?.length ?? 0) > 0;

      const fetchPipedSearchShorts = async (
        q: string,
        continuation?: string,
      ): Promise<UnifiedVideo[]> => {
        try {
          acquireUpstreamSlot();
          const searchUrl = buildPipedSearchUrl(
            pipedBase,
            {
              q,
              limit: Math.min(40, limit * 3),
              continuation,
              region,
            },
            "all",
          );
          const json = await fetchJson(searchUrl);
          return parsePipedShortsSearch(json, limit, pipedBase).videos;
        } catch (e) {
          recordUpstreamFailure(e, "piped", errors);
          return [];
        }
      };

      if (!input.continuation) {
        const seen = new Set<string>();
        const videos: UnifiedVideo[] = [];

        if (!tasteDiscovery) {
          try {
            acquireUpstreamSlot();
            const trendingJson = await fetchJson(
              buildPipedTrendingUrl(pipedBase, region),
              { emptyBodyAs: [] },
            );
            mergeDiscoveryShortVideos(
              limit,
              seen,
              videos,
              parsePipedTrendingShorts(trendingJson, limit, pipedBase),
            );
          } catch (e) {
            recordUpstreamFailure(e, "piped", errors);
          }
        }

        for (const q of discoveryQueries) {
          if (videos.length >= limit) break;
          const found = await fetchPipedSearchShorts(q);
          if (mergeDiscoveryShortVideos(limit, seen, videos, found)) break;
        }

        if (videos.length > 0) {
          return shortsFeedResultSchema.parse({
            videos: videos.slice(0, limit),
            continuation: "piped:search",
            sourceUsed: "piped",
          });
        }
      }

      const pipedContinuation =
        input.continuation === "piped:search"
          ? undefined
          : input.continuation?.startsWith("piped:")
            ? input.continuation.slice("piped:".length)
            : input.continuation;

      for (const q of discoveryQueries) {
        try {
          acquireUpstreamSlot();
          const searchUrl = buildPipedSearchUrl(
            pipedBase,
            {
              q,
              limit: Math.min(40, limit * 3),
              continuation: pipedContinuation,
              region,
            },
            "all",
          );
          const json = await fetchJson(searchUrl);
          const { videos, continuation } = parsePipedShortsSearch(
            json,
            limit,
            pipedBase,
          );
          if (videos.length === 0) continue;
          const next =
            continuation && continuation.length > 0
              ? `piped:${continuation}`
              : null;
          return shortsFeedResultSchema.parse({
            videos,
            continuation: next,
            sourceUsed: "piped",
          });
        } catch (e) {
          recordUpstreamFailure(e, "piped", errors);
        }
      }
      return null;
    };

    const continuation = input.continuation ?? "";
    const pipedContinuation =
      continuation === "piped:search" || continuation.startsWith("piped:");
    const invidiousContinuation =
      continuation.startsWith("inv:page:") || continuation === "";

    if (invidiousContinuation) {
      resolved = await tryInvidious();
    }
    if (
      (!resolved || resolved.videos.length === 0) &&
      (pipedContinuation || !continuation)
    ) {
      const fromPiped = await tryPiped();
      if (fromPiped && fromPiped.videos.length > 0) {
        resolved = fromPiped;
      }
    }

    if (!resolved || resolved.videos.length === 0) {
      const stale = readStaleShortsFeedCache(db, key);
      if (stale && stale.videos.length > 0) return stale;
      if (errors.length > 0) {
        throwIfUpstreamFailed(errors, "shorts feed unavailable");
      }
      const fallbackSource = pipedBase
        ? "piped"
        : invidiousBase
          ? "invidious"
          : "piped";
      return shortsFeedResultSchema.parse({
        videos: [],
        continuation: null,
        sourceUsed: liveUpstreamSource(fallbackSource),
        warning: SHORTS_FEED_EMPTY_WARNING,
      });
    }

    const parsed = shortsFeedResultSchema.parse(resolved);
    const videos = filterShortsFeedVideos(parsed.videos);
    const out = { ...parsed, videos };
    if (out.videos.length === 0 && parsed.videos.length > 0) {
      const stale = readStaleShortsFeedCache(db, key);
      if (stale && stale.videos.length > 0) return stale;
    }
    if (out.videos.length > 0) {
      writeCache(
        db,
        key,
        liveUpstreamSource(out.sourceUsed),
        {
          videos: out.videos,
          continuation: out.continuation,
          sourceUsed: liveUpstreamSource(out.sourceUsed),
        },
        "shorts",
        { shortsPurpose: input.purpose ?? "feed" },
      );
    }
    return out;
  })();

  inFlightShortsFeed.set(key, task);
  try {
    return await task;
  } finally {
    inFlightShortsFeed.delete(key);
  }
}

/* -------------------------------------------------------------------------- */
/* Channel                                                                    */
/* -------------------------------------------------------------------------- */

function readFreshChannelCache(
  db: AppDb,
  key: string,
): ChannelPageResult | null {
  const row = readFreshCacheRow(db, key);
  if (!row) return null;
  const raw = JSON.parse(row.payloadJson) as unknown;
  const parsed = cachedChannelPayloadSchema.safeParse(raw);
  if (!parsed.success) return null;
  logger.info("video_cache.hit", { cacheKey: key, kind: row.kind });
  return {
    ...parsed.data,
    sourceUsed: "cache",
    stale: false,
  };
}

function readStaleChannelCache(
  db: AppDb,
  key: string,
): ChannelPageResult | null {
  const row = readLatestCacheRow(db, key);
  if (!row) return null;
  const raw = JSON.parse(row.payloadJson) as unknown;
  const parsed = cachedChannelPayloadSchema.safeParse(raw);
  if (!parsed.success) return null;
  logger.warn("video_cache.stale_hit", { cacheKey: key, kind: row.kind });
  return {
    ...parsed.data,
    sourceUsed: "cache",
    stale: true,
    warning: "Upstream unavailable, serving stale cache.",
  };
}

function buildPipedChannelUrl(base: string, channelId: string): string {
  return new URL(
    `/channel/${encodeURIComponent(channelId)}`,
    `${normalizeBaseUrl(base)}/`,
  ).toString();
}

function buildPipedChannelNextUrl(
  base: string,
  channelId: string,
  continuation: string,
): string {
  const u = new URL(
    `/nextpage/channel/${encodeURIComponent(channelId)}`,
    `${normalizeBaseUrl(base)}/`,
  );
  u.searchParams.set("nextpage", continuation);
  return u.toString();
}

function buildInvidiousChannelMetaUrl(base: string, channelId: string): string {
  return new URL(
    `/api/v1/channels/${encodeURIComponent(channelId)}`,
    `${normalizeBaseUrl(base)}/`,
  ).toString();
}

function buildInvidiousChannelVideosUrl(
  base: string,
  channelId: string,
  continuation?: string,
): string {
  const u = new URL(
    `/api/v1/channels/${encodeURIComponent(channelId)}/videos`,
    `${normalizeBaseUrl(base)}/`,
  );
  if (continuation) u.searchParams.set("continuation", continuation);
  return u.toString();
}

function buildInvidiousChannelShortsUrl(
  base: string,
  channelId: string,
  continuation?: string,
): string {
  const u = new URL(
    `/api/v1/channels/${encodeURIComponent(channelId)}/shorts`,
    `${normalizeBaseUrl(base)}/`,
  );
  if (continuation) u.searchParams.set("continuation", continuation);
  return u.toString();
}

function buildInvidiousChannelStreamsUrl(
  base: string,
  channelId: string,
): string {
  const u = new URL(
    `/api/v1/channels/${encodeURIComponent(channelId)}/streams`,
    `${normalizeBaseUrl(base)}/`,
  );
  u.searchParams.set("sort_by", "newest");
  return u.toString();
}

const PIPED_CHANNEL_LIVE_TAB_NAMES = new Set([
  "live",
  "streams",
  "livestreams",
  "live streams",
]);

async function fetchPipedChannelLiveTabVideos(
  pipedBase: string,
  channelId: string,
  channelPayload: unknown,
): Promise<UnifiedVideo[]> {
  if (!channelPayload || typeof channelPayload !== "object") return [];
  const tabs = (channelPayload as Record<string, unknown>).tabs;
  if (!Array.isArray(tabs)) return [];
  const out: UnifiedVideo[] = [];
  for (const tab of tabs) {
    if (!tab || typeof tab !== "object") continue;
    const t = tab as Record<string, unknown>;
    const tabName = typeof t.name === "string" ? t.name.toLowerCase() : "";
    if (!PIPED_CHANNEL_LIVE_TAB_NAMES.has(tabName)) continue;
    const data = typeof t.data === "string" ? t.data : null;
    if (!data) continue;
    try {
      acquireUpstreamSlot();
      const json = await fetchJson(buildPipedChannelTabsUrl(pipedBase, data));
      out.push(
        ...videosFromPipedListItems(
          pipedListItemsFromPayload(json),
          pipedBase,
          channelId,
          { excludeShorts: true },
        ),
      );
    } catch (e) {
      logger.warn("proxy.piped.channel_live_tab_failed", {
        channelId,
        tab: tabName,
        message: e instanceof Error ? e.message : String(e),
      });
    }
  }
  return out;
}

async function fetchInvidiousChannelLiveStreams(
  invidiousBase: string,
  channelId: string,
): Promise<UnifiedVideo[]> {
  try {
    acquireUpstreamSlot();
    const json = await fetchJson(
      buildInvidiousChannelStreamsUrl(invidiousBase, channelId),
    );
    const parsed = parseInvidiousChannelVideosContinuation(
      json,
      channelId,
      invidiousBase,
    );
    return parsed?.videos ?? [];
  } catch (e) {
    logger.warn("proxy.invidious.channel_streams_failed", {
      channelId,
      message: e instanceof Error ? e.message : String(e),
    });
    return [];
  }
}

async function enrichChannelVideosWithLiveStreams(
  videos: UnifiedVideo[],
  channelId: string,
  opts: {
    pipedBase?: string;
    invidiousBase?: string;
    sourceUsed: ChannelPageResult["sourceUsed"];
    pipedChannelPayload?: unknown;
  },
): Promise<UnifiedVideo[]> {
  const { pipedBase, invidiousBase, sourceUsed, pipedChannelPayload } = opts;
  if (sourceUsed === "cache") return videos;
  let liveCandidates: UnifiedVideo[] = [];
  if (sourceUsed === "piped" && pipedBase) {
    try {
      let payload = pipedChannelPayload;
      if (!payload) {
        acquireUpstreamSlot();
        payload = await fetchJson(buildPipedChannelUrl(pipedBase, channelId));
      }
      liveCandidates = await fetchPipedChannelLiveTabVideos(
        pipedBase,
        channelId,
        payload,
      );
    } catch (e) {
      logger.warn("proxy.piped.channel_live_enrich_failed", {
        channelId,
        message: e instanceof Error ? e.message : String(e),
      });
    }
  } else if (sourceUsed === "invidious" && invidiousBase) {
    liveCandidates = await fetchInvidiousChannelLiveStreams(
      invidiousBase,
      channelId,
    );
  }
  return mergeActiveLiveVideosFirst(videos, liveCandidates);
}

function buildPipedChannelVideosSearchUrl(base: string, query: string): string {
  const u = new URL("/search", `${normalizeBaseUrl(base)}/`);
  u.searchParams.set("q", query);
  u.searchParams.set("filter", "videos");
  return u.toString();
}

function buildPipedChannelTabsUrl(base: string, tabData: string): string {
  const u = new URL("/channels/tabs", `${normalizeBaseUrl(base)}/`);
  u.searchParams.set("data", tabData);
  return u.toString();
}

function buildInvidiousChannelRssUrl(base: string, channelId: string): string {
  return new URL(
    `/feed/channel/${encodeURIComponent(channelId)}`,
    `${normalizeBaseUrl(base)}/`,
  ).toString();
}

function buildInvidiousChannelVideosSearchUrl(
  base: string,
  query: string,
): string {
  const u = new URL("/api/v1/search", `${normalizeBaseUrl(base)}/`);
  u.searchParams.set("q", query);
  u.searchParams.set("type", "video");
  u.searchParams.set("sort_by", "upload_date");
  return u.toString();
}

function filterVideosForChannel(
  videos: UnifiedVideo[],
  channelId: string,
): UnifiedVideo[] {
  return videos.filter((v) => !v.channelId || v.channelId === channelId);
}

function pipedListItemsFromPayload(data: unknown): unknown[] {
  if (!data || typeof data !== "object") return [];
  const o = data as Record<string, unknown>;
  if (Array.isArray(o.relatedStreams) && o.relatedStreams.length > 0) {
    return o.relatedStreams;
  }
  if (Array.isArray(o.content) && o.content.length > 0) {
    return o.content;
  }
  return [];
}

const pipedItemIsShort = pipedItemIsStrictShort;
const unifiedVideoIsLikelyShort = isStrictShortVideo;
const invidiousItemIsShort = invidiousItemIsStrictShort;

function videosFromPipedListItems(
  items: unknown[],
  pipedBase: string,
  channelId: string,
  opts?: { excludeShorts?: boolean; shortsOnly?: boolean },
): UnifiedVideo[] {
  const videos: UnifiedVideo[] = [];
  for (const item of items) {
    const isShort = pipedItemIsShort(item);
    if (opts?.excludeShorts && isShort) continue;
    if (opts?.shortsOnly && !isShort) continue;
    const v = mapPipedItem(item, pipedBase);
    if (!v) continue;
    if (v.channelId && v.channelId !== channelId) continue;
    if (opts?.excludeShorts && unifiedVideoIsLikelyShort(v)) continue;
    if (opts?.shortsOnly && !unifiedVideoIsLikelyShort(v)) continue;
    videos.push(v);
  }
  return videos;
}

function extractXmlTagContent(
  block: string,
  tagName: string,
): string | undefined {
  const re = new RegExp(
    `<${tagName}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tagName}>`,
    "i",
  );
  const m = re.exec(block);
  if (!m) return undefined;
  return m[1]!
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .trim();
}

function extractXmlAttr(
  block: string,
  tagName: string,
  attr: string,
): string | undefined {
  const re = new RegExp(`<${tagName}[^>]*\\s${attr}=["']([^"']+)["']`, "i");
  return re.exec(block)?.[1];
}

/** Invidious `/feed/channel/…` when `/videos` returns parse-error placeholders. */
function parseInvidiousChannelRssFeed(
  xml: string,
  channelId: string,
  invidiousBase: string,
  channelName?: string,
): UnifiedVideo[] {
  const videos: UnifiedVideo[] = [];
  const entryRe = /<entry>([\s\S]*?)<\/entry>/gi;
  let match: RegExpExecArray | null = entryRe.exec(xml);
  while (match !== null) {
    const block = match[1] ?? "";
    const videoId =
      extractXmlTagContent(block, "yt:videoId") ??
      extractXmlTagContent(block, "videoId");
    const title = extractXmlTagContent(block, "title");
    if (!videoId || !title) {
      match = entryRe.exec(xml);
      continue;
    }
    const publishedRaw = extractXmlTagContent(block, "published");
    let publishedAt: number | undefined;
    if (publishedRaw) {
      const ms = Date.parse(publishedRaw);
      if (Number.isFinite(ms)) publishedAt = Math.floor(ms / 1000);
    }
    const thumbRaw =
      extractXmlAttr(block, "media:thumbnail", "url") ??
      extractXmlAttr(block, "media\\:thumbnail", "url");
    const thumbnailUrl = thumbRaw
      ? preferHighResVideoThumbnailUrl(
          resolveInvidiousAbsoluteMediaUrl(thumbRaw, invidiousBase),
          videoId,
        )
      : undefined;
    const name =
      extractXmlTagContent(block, "name") ?? channelName ?? undefined;
    const parsed = unifiedVideoSchema.safeParse({
      videoId,
      title,
      channelId,
      channelName: name,
      thumbnailUrl,
      publishedAt,
    });
    if (parsed.success) videos.push(parsed.data);
    match = entryRe.exec(xml);
  }
  return videos;
}

async function tryPipedChannelVideoFallbacks(
  pipedBase: string,
  channelId: string,
  initialPayload: unknown,
  channelName: string,
): Promise<UnifiedVideo[]> {
  const seen = new Set<string>();
  const out: UnifiedVideo[] = [];
  const push = (list: UnifiedVideo[]) => {
    for (const v of list) {
      if (seen.has(v.videoId)) continue;
      seen.add(v.videoId);
      out.push(v);
      if (out.length >= 60) return;
    }
  };

  const nextpage = pipedChannelNextContinuation(initialPayload);
  if (nextpage) {
    try {
      acquireUpstreamSlot();
      const json = await fetchJson(
        buildPipedChannelNextUrl(pipedBase, channelId, nextpage),
      );
      push(
        videosFromPipedListItems(
          pipedListItemsFromPayload(json),
          pipedBase,
          channelId,
        ),
      );
    } catch (e) {
      logger.warn("proxy.piped.channel_nextpage_failed", {
        channelId,
        message: e instanceof Error ? e.message : String(e),
      });
    }
  }
  if (out.length >= 12) return out;

  const query = channelName.trim();
  if (query.length >= 2) {
    try {
      acquireUpstreamSlot();
      const json = await fetchJson(
        buildPipedChannelVideosSearchUrl(pipedBase, query),
      );
      push(
        filterVideosForChannel(
          videosFromPipedListItems(pipedRootItems(json), pipedBase, channelId),
          channelId,
        ),
      );
    } catch (e) {
      logger.warn("proxy.piped.channel_search_failed", {
        channelId,
        message: e instanceof Error ? e.message : String(e),
      });
    }
  }
  if (out.length >= 12) return out;

  if (initialPayload && typeof initialPayload === "object") {
    const tabs = (initialPayload as Record<string, unknown>).tabs;
    if (Array.isArray(tabs)) {
      for (const tab of tabs) {
        if (out.length >= 60) break;
        if (!tab || typeof tab !== "object") continue;
        const t = tab as Record<string, unknown>;
        const tabName = typeof t.name === "string" ? t.name.toLowerCase() : "";
        if (tabName === "shorts" || tabName === "playlists") continue;
        const data = typeof t.data === "string" ? t.data : null;
        if (!data) continue;
        try {
          acquireUpstreamSlot();
          const json = await fetchJson(
            buildPipedChannelTabsUrl(pipedBase, data),
          );
          push(
            videosFromPipedListItems(
              pipedListItemsFromPayload(json),
              pipedBase,
              channelId,
              { excludeShorts: true },
            ),
          );
        } catch (e) {
          logger.warn("proxy.piped.channel_tab_failed", {
            channelId,
            tab: tabName,
            message: e instanceof Error ? e.message : String(e),
          });
        }
      }
    }
  }
  return out;
}

async function tryInvidiousChannelVideoFallbacks(
  invidiousBase: string,
  channelId: string,
  channelName: string,
): Promise<UnifiedVideo[]> {
  const seen = new Set<string>();
  const out: UnifiedVideo[] = [];
  const push = (list: UnifiedVideo[]) => {
    for (const v of list) {
      if (seen.has(v.videoId)) continue;
      seen.add(v.videoId);
      out.push(v);
      if (out.length >= 60) return;
    }
  };

  try {
    acquireUpstreamSlot();
    const { ok, text } = await upstreamGetText(
      buildInvidiousChannelRssUrl(invidiousBase, channelId),
      FETCH_TIMEOUT_MS,
    );
    if (ok && text.trim()) {
      push(
        parseInvidiousChannelRssFeed(
          text,
          channelId,
          invidiousBase,
          channelName,
        ),
      );
    }
  } catch (e) {
    logger.warn("proxy.invidious.channel_rss_failed", {
      channelId,
      message: e instanceof Error ? e.message : String(e),
    });
  }
  if (out.length >= 12) return out;

  const query = channelName.trim();
  if (query.length >= 2) {
    try {
      acquireUpstreamSlot();
      const json = await fetchJson(
        buildInvidiousChannelVideosSearchUrl(invidiousBase, query),
      );
      if (Array.isArray(json)) {
        for (const item of json) {
          const v = mapInvidiousItem(item, invidiousBase);
          if (!v) continue;
          if (v.channelId && v.channelId !== channelId) continue;
          push([v]);
          if (out.length >= 60) break;
        }
      }
    } catch (e) {
      logger.warn("proxy.invidious.channel_search_failed", {
        channelId,
        message: e instanceof Error ? e.message : String(e),
      });
    }
  }
  return out;
}

function pipedChannelNextContinuation(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  const n = (data as Record<string, unknown>).nextpage;
  if (typeof n === "string" && n.length > 0) return n;
  return null;
}

/** Piped `/channel/{id}` payloads vary by instance; avatar may be missing on the root but present on items. */
function pickPipedChannelAvatarUrl(
  o: Record<string, unknown>,
  pipedBase: string,
): string | undefined {
  const stringCandidates = [
    o.avatarUrl,
    o.avatar,
    o.uploaderAvatar,
    o.thumbnailUrl,
  ];
  for (const raw of stringCandidates) {
    if (typeof raw !== "string") continue;
    const u = resolveInvidiousAbsoluteMediaUrl(raw, pipedBase);
    if (u?.startsWith("http")) return u;
  }
  for (const key of ["avatars", "authorThumbnails", "thumbnails"] as const) {
    const u = resolveInvidiousThumbnail(o[key], pipedBase);
    if (u?.startsWith("http")) return u;
  }
  const streams = Array.isArray(o.relatedStreams) ? o.relatedStreams : [];
  for (const item of streams) {
    if (!item || typeof item !== "object") continue;
    const s = item as Record<string, unknown>;
    const ua = s.uploaderAvatar;
    if (typeof ua === "string") {
      const u = resolveInvidiousAbsoluteMediaUrl(ua, pipedBase);
      if (u?.startsWith("http")) return u;
    }
  }
  return undefined;
}

function pickPipedChannelBannerUrl(
  o: Record<string, unknown>,
  pipedBase: string,
): string | undefined {
  const stringCandidates = [o.bannerUrl, o.banner, o.authorBanner];
  for (const raw of stringCandidates) {
    if (typeof raw !== "string") continue;
    const u = resolveInvidiousAbsoluteMediaUrl(raw, pipedBase);
    if (u?.startsWith("http")) return u;
  }
  const u = resolveInvidiousThumbnail(o.banners ?? o.authorBanners, pipedBase);
  if (u?.startsWith("http")) return u;
  return undefined;
}

function parsePipedChannelPage(
  data: unknown,
  channelId: string,
  pipedBase: string,
): ChannelPageResult | null {
  if (!data || typeof data !== "object") return null;
  const o = data as Record<string, unknown>;
  const name = typeof o.name === "string" ? o.name : "";
  const id = typeof o.id === "string" && o.id.length > 0 ? o.id : channelId;
  const description =
    typeof o.description === "string" ? o.description : undefined;
  const avatarUrl = pickPipedChannelAvatarUrl(o, pipedBase);
  const bannerUrl = pickPipedChannelBannerUrl(o, pipedBase);
  const subscriberCount =
    typeof o.subscriberCount === "number" && Number.isFinite(o.subscriberCount)
      ? Math.round(o.subscriberCount)
      : undefined;
  const streams = Array.isArray(o.relatedStreams) ? o.relatedStreams : [];
  const videos: UnifiedVideo[] = [];
  for (const item of streams) {
    if (pipedItemIsShort(item)) continue;
    const m = mapPipedItem(item, pipedBase);
    if (m && !unifiedVideoIsLikelyShort(m)) videos.push(m);
  }
  if (!name && videos.length === 0) return null;
  const continuation = pipedChannelNextContinuation(data);
  return channelPageResultSchema.parse({
    channelId: id,
    name: name || "Channel",
    description,
    avatarUrl,
    bannerUrl,
    subscriberCount,
    videos,
    continuation,
    sourceUsed: "piped",
  });
}

function parsePipedChannelContinuation(
  data: unknown,
  channelId: string,
  pipedBase: string,
  opts?: { shortsOnly?: boolean },
): ChannelPageResult | null {
  if (!data || typeof data !== "object") return null;
  const o = data as Record<string, unknown>;
  const streams = Array.isArray(o.relatedStreams) ? o.relatedStreams : [];
  const videos: UnifiedVideo[] = [];
  for (const item of streams) {
    const isShort = pipedItemIsShort(item);
    if (opts?.shortsOnly) {
      if (!isShort) continue;
    } else if (isShort) {
      continue;
    }
    const m = mapPipedItem(item, pipedBase);
    if (!m) continue;
    if (opts?.shortsOnly && !unifiedVideoIsLikelyShort(m)) continue;
    if (!opts?.shortsOnly && unifiedVideoIsLikelyShort(m)) continue;
    videos.push(m);
  }
  const continuation = pipedChannelNextContinuation(data);
  return channelPageResultSchema.parse({
    channelId,
    videos,
    continuation,
    sourceUsed: "piped",
  });
}

function parseInvidiousChannelCombined(
  meta: unknown,
  videosPayload: unknown,
  channelId: string,
  invidiousBase: string,
): ChannelPageResult | null {
  if (!meta || typeof meta !== "object") return null;
  const m = meta as Record<string, unknown>;
  const name =
    typeof m.author === "string"
      ? m.author
      : typeof m.title === "string"
        ? m.title
        : "";
  const description =
    typeof m.description === "string" ? m.description : undefined;
  const avatarUrl = resolveInvidiousThumbnail(
    m.authorThumbnails,
    invidiousBase,
  );
  const bannerUrl = resolveInvidiousThumbnail(m.authorBanners, invidiousBase);
  let subscriberCount: number | undefined;
  if (typeof m.subCount === "number" && Number.isFinite(m.subCount)) {
    subscriberCount = Math.round(m.subCount);
  }
  const videos: UnifiedVideo[] = [];
  let continuation: string | null = null;
  if (videosPayload && typeof videosPayload === "object") {
    const vp = videosPayload as Record<string, unknown>;
    const arr = Array.isArray(vp.videos) ? vp.videos : [];
    for (const item of arr) {
      if (invidiousItemIsShort(item)) continue;
      const v = mapInvidiousItem(item, invidiousBase);
      if (v && !unifiedVideoIsLikelyShort(v)) videos.push(v);
    }
    const c = vp.continuation;
    if (typeof c === "string" && c.length > 0) continuation = c;
  }
  const id =
    typeof m.authorId === "string" && m.authorId.length > 0
      ? m.authorId
      : channelId;
  if (!name && videos.length === 0) return null;
  return channelPageResultSchema.parse({
    channelId: id,
    name: name || "Channel",
    description,
    avatarUrl,
    bannerUrl,
    subscriberCount,
    videos,
    continuation,
    sourceUsed: "invidious",
  });
}

function parseInvidiousChannelVideosContinuation(
  videosPayload: unknown,
  channelId: string,
  invidiousBase: string,
  opts?: { shortsOnly?: boolean },
): ChannelPageResult | null {
  if (!videosPayload || typeof videosPayload !== "object") return null;
  const vp = videosPayload as Record<string, unknown>;
  const arr = Array.isArray(vp.videos) ? vp.videos : [];
  const videos: UnifiedVideo[] = [];
  for (const item of arr) {
    const isShort = invidiousItemIsShort(item);
    if (opts?.shortsOnly) {
      if (!isShort) continue;
    } else if (isShort) {
      continue;
    }
    const v = mapInvidiousItem(item, invidiousBase);
    if (!v) continue;
    if (opts?.shortsOnly && !unifiedVideoIsLikelyShort(v)) continue;
    if (!opts?.shortsOnly && unifiedVideoIsLikelyShort(v)) continue;
    videos.push(v);
  }
  let continuation: string | null = null;
  const c = vp.continuation;
  if (typeof c === "string" && c.length > 0) continuation = c;
  if (videos.length === 0) return null;
  return channelPageResultSchema.parse({
    channelId,
    videos,
    continuation,
    sourceUsed: "invidious",
  });
}

async function fetchPipedChannelShortsPage(
  pipedBase: string,
  channelId: string,
  continuation?: string,
): Promise<ChannelPageResult | null> {
  if (continuation) {
    const json = await fetchJson(
      buildPipedChannelNextUrl(pipedBase, channelId, continuation),
    );
    return parsePipedChannelContinuation(json, channelId, pipedBase, {
      shortsOnly: true,
    });
  }

  const json = await fetchJson(buildPipedChannelUrl(pipedBase, channelId));
  if (!json || typeof json !== "object") return null;
  const root = json as Record<string, unknown>;
  const name = typeof root.name === "string" ? root.name : undefined;
  const id =
    typeof root.id === "string" && root.id.length > 0 ? root.id : channelId;

  const tabs = Array.isArray(root.tabs) ? root.tabs : [];
  for (const tab of tabs) {
    if (!tab || typeof tab !== "object") continue;
    const t = tab as Record<string, unknown>;
    const tabName = typeof t.name === "string" ? t.name.toLowerCase() : "";
    if (tabName !== "shorts") continue;
    const data = typeof t.data === "string" ? t.data : null;
    if (!data) continue;
    const tabJson = await fetchJson(buildPipedChannelTabsUrl(pipedBase, data));
    const videos = videosFromPipedListItems(
      pipedListItemsFromPayload(tabJson),
      pipedBase,
      channelId,
      { shortsOnly: true },
    );
    return channelPageResultSchema.parse({
      channelId: id,
      name,
      videos,
      continuation: pipedChannelNextContinuation(tabJson),
      sourceUsed: "piped",
    });
  }

  const fallback = videosFromPipedListItems(
    pipedListItemsFromPayload(json),
    pipedBase,
    channelId,
    { shortsOnly: true },
  );
  if (fallback.length === 0) return null;
  return channelPageResultSchema.parse({
    channelId: id,
    name,
    videos: fallback,
    continuation: pipedChannelNextContinuation(json),
    sourceUsed: "piped",
  });
}

async function fetchInvidiousChannelShortsPage(
  invidiousBase: string,
  channelId: string,
  continuation?: string,
): Promise<ChannelPageResult | null> {
  if (continuation) {
    const json = await fetchJson(
      buildInvidiousChannelShortsUrl(invidiousBase, channelId, continuation),
    );
    return parseInvidiousChannelVideosContinuation(
      json,
      channelId,
      invidiousBase,
      { shortsOnly: true },
    );
  }

  const [metaJson, shortsJson] = await Promise.all([
    fetchJson(buildInvidiousChannelMetaUrl(invidiousBase, channelId)),
    fetchJson(buildInvidiousChannelShortsUrl(invidiousBase, channelId)),
  ]);
  if (!metaJson || typeof metaJson !== "object") return null;
  const m = metaJson as Record<string, unknown>;
  const name =
    typeof m.author === "string"
      ? m.author
      : typeof m.title === "string"
        ? m.title
        : undefined;
  const description =
    typeof m.description === "string" ? m.description : undefined;
  const avatarUrl = resolveInvidiousThumbnail(
    m.authorThumbnails,
    invidiousBase,
  );
  const bannerUrl = resolveInvidiousThumbnail(m.authorBanners, invidiousBase);
  let subscriberCount: number | undefined;
  if (typeof m.subCount === "number" && Number.isFinite(m.subCount)) {
    subscriberCount = Math.round(m.subCount);
  }
  const id =
    typeof m.authorId === "string" && m.authorId.length > 0
      ? m.authorId
      : channelId;

  const page = parseInvidiousChannelVideosContinuation(
    shortsJson,
    channelId,
    invidiousBase,
    { shortsOnly: true },
  );
  if (!page) return null;
  return channelPageResultSchema.parse({
    ...page,
    channelId: id,
    name,
    description,
    avatarUrl,
    bannerUrl,
    subscriberCount,
  });
}

export async function fetchChannelPage(
  db: AppDb,
  input: ChannelPageInput,
  overrides?: ProxySourceOverrides,
  opts?: FetchChannelPageOptions,
): Promise<ChannelPageResult> {
  const key = channelCacheKey(input);
  if (!opts?.bypassChannelCache) {
    const fresh = readFreshChannelCache(db, key);
    if (fresh) return fresh;
  }
  const inFlight = inFlightChannel.get(key);
  if (inFlight) return inFlight;

  const task = (async (): Promise<ChannelPageResult> => {
    const { pipedBase, invidiousBase } = resolveProxyBases(overrides);
    const errors: string[] = [];
    const tab = input.tab ?? "videos";

    let resolved: ChannelPageResult | null = null;
    let pipedChannelPayload: unknown;

    if (tab === "shorts") {
      if (pipedBase) {
        try {
          acquireUpstreamSlot();
          if (!input.continuation) acquireUpstreamSlot();
          resolved = await fetchPipedChannelShortsPage(
            pipedBase,
            input.channelId,
            input.continuation,
          );
        } catch (e) {
          recordUpstreamFailure(e, "piped", errors);
        }
      }
      if (!resolved && invidiousBase) {
        if (invidiousPortCollidesWithNextApp(invidiousBase)) {
          errors.push("invidious:port collision with Next.js");
        } else {
          try {
            if (!input.continuation) {
              acquireUpstreamSlot();
              acquireUpstreamSlot();
            } else {
              acquireUpstreamSlot();
            }
            resolved = await fetchInvidiousChannelShortsPage(
              invidiousBase,
              input.channelId,
              input.continuation,
            );
          } catch (e) {
            recordUpstreamFailure(e, "invidious", errors);
          }
        }
      }
    } else if (pipedBase) {
      try {
        acquireUpstreamSlot();
        const url = input.continuation
          ? buildPipedChannelNextUrl(
              pipedBase,
              input.channelId,
              input.continuation,
            )
          : buildPipedChannelUrl(pipedBase, input.channelId);
        const json = await fetchJson(url);
        if (!input.continuation) pipedChannelPayload = json;
        resolved = input.continuation
          ? parsePipedChannelContinuation(json, input.channelId, pipedBase)
          : parsePipedChannelPage(json, input.channelId, pipedBase);
        if (resolved && resolved.videos.length === 0 && !input.continuation) {
          const channelLabel =
            resolved.name && resolved.name !== "Channel"
              ? resolved.name
              : input.channelId;
          const fallbackVideos = await tryPipedChannelVideoFallbacks(
            pipedBase,
            input.channelId,
            json,
            channelLabel,
          );
          if (fallbackVideos.length > 0) {
            resolved = { ...resolved, videos: fallbackVideos };
          } else {
            resolved = null;
          }
        }
      } catch (e) {
        recordUpstreamFailure(e, "piped", errors);
      }
    }

    if (tab !== "shorts" && !resolved && invidiousBase) {
      if (invidiousPortCollidesWithNextApp(invidiousBase)) {
        errors.push("invidious:port collision with Next.js");
      } else {
        try {
          if (input.continuation) {
            acquireUpstreamSlot();
            const json = await fetchJson(
              buildInvidiousChannelVideosUrl(
                invidiousBase,
                input.channelId,
                input.continuation,
              ),
            );
            resolved = parseInvidiousChannelVideosContinuation(
              json,
              input.channelId,
              invidiousBase,
            );
            if (resolved && resolved.videos.length === 0) {
              const fallbackVideos = await tryInvidiousChannelVideoFallbacks(
                invidiousBase,
                input.channelId,
                input.channelId,
              );
              if (fallbackVideos.length > 0) {
                resolved = { ...resolved, videos: fallbackVideos };
              }
            }
          } else {
            acquireUpstreamSlot();
            acquireUpstreamSlot();
            const metaUrl = buildInvidiousChannelMetaUrl(
              invidiousBase,
              input.channelId,
            );
            const videosUrl = buildInvidiousChannelVideosUrl(
              invidiousBase,
              input.channelId,
            );
            const [metaJson, videosJson] = await Promise.all([
              fetchJson(metaUrl),
              fetchJson(videosUrl),
            ]);
            resolved = parseInvidiousChannelCombined(
              metaJson,
              videosJson,
              input.channelId,
              invidiousBase,
            );
            if (resolved && resolved.videos.length === 0) {
              const channelLabel =
                resolved.name && resolved.name !== "Channel"
                  ? resolved.name
                  : typeof (metaJson as Record<string, unknown>).author ===
                      "string"
                    ? ((metaJson as Record<string, unknown>).author as string)
                    : input.channelId;
              const fallbackVideos = await tryInvidiousChannelVideoFallbacks(
                invidiousBase,
                input.channelId,
                channelLabel,
              );
              if (fallbackVideos.length > 0) {
                resolved = { ...resolved, videos: fallbackVideos };
              }
            }
          }
        } catch (e) {
          recordUpstreamFailure(e, "invidious", errors);
        }
      }
    }

    if (!resolved) {
      const stale = readStaleChannelCache(db, key);
      if (stale) return stale;
      throwIfUpstreamFailed(errors, "channel unavailable");
    }

    if (tab === "videos" && !input.continuation) {
      resolved = {
        ...resolved,
        videos: await enrichChannelVideosWithLiveStreams(
          resolved.videos,
          input.channelId,
          {
            pipedBase,
            invidiousBase,
            sourceUsed: resolved.sourceUsed,
            pipedChannelPayload,
          },
        ),
      };
    }

    const nowSec = Math.floor(Date.now() / 1000);
    const sortedVideos = sortVideosNewestFirst(resolved.videos, nowSec);
    resolved = { ...resolved, videos: sortedVideos };

    const store = {
      channelId: resolved.channelId,
      name: resolved.name,
      description: resolved.description,
      avatarUrl: resolved.avatarUrl,
      bannerUrl: resolved.bannerUrl,
      subscriberCount: resolved.subscriberCount,
      videos: sortedVideos,
      continuation: resolved.continuation ?? null,
      sourceUsed: liveUpstreamSource(resolved.sourceUsed),
    };
    writeCache(db, key, store.sourceUsed, store, "channel");
    return resolved;
  })();
  inFlightChannel.set(key, task);
  try {
    return await task;
  } finally {
    inFlightChannel.delete(key);
  }
}
