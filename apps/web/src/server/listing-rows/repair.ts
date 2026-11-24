import { logger } from "@/lib/logger";
import type { AppDb } from "@/server/db/client";
import { UpstreamVideoUnavailableError } from "@/server/errors/upstream-video-unavailable";
import type { RssEntry } from "@/server/rss/cache";
import { readFreshCacheRow, writeCache } from "@/server/services/proxy/cache";
import type { UnifiedVideo, VideoDetail } from "@/server/services/proxy.types";

/**
 * Repairs a channel's video listing once, as it is fetched from upstream and
 * before it is cached, so every reader (subscriptions feed, channel page, TV,
 * recommendations) gets the same corrected rows.
 *
 * Invidious' channel listing is unreliable in two ways that both show up as
 * `viewCount: 0`:
 *
 * - Broken rows. Dates are derived from YouTube's relative text at request
 *   time; when that text degenerates ("0 seconds ago") the row lands on *now*
 *   with zero views, although the video is public with a real count.
 * - Unplayable rows. Members-only (and paid) uploads are listed like any other,
 *   with zero views, but this server fetches anonymously and can't play them.
 *
 * The uploads RSS fixes the first kind for a channel's ~15 newest videos. Any
 * row still at zero views after that is looked up once on the single-video
 * endpoint, which settles both cases: it either returns the real date and
 * count, or refuses with YouTube's own reason ("Join this channel to get
 * access to members-only content"), in which case the row is dropped. Guessing
 * members-only from the listing alone has hidden public videos before (see
 * commit daf0050); this only drops what YouTube itself refuses.
 *
 * Each lookup's outcome is remembered in `video_cache` (kind `listing-row`),
 * so a video costs one upstream request per TTL, not one per refresh.
 */

/** Lookups per listing, so a channel full of zero-view rows can't drain the upstream budget. */
export const MAX_LOOKUPS_PER_LISTING = 6;

/** How long a lookup's answer is trusted, by outcome. */
export const LOOKUP_TTL_SEC = {
  /** A public video with a real count: its date won't change, the count is good enough. */
  public: 7 * 24 * 3600,
  /** Public but still at zero views (just uploaded): ask again soon. */
  publicZeroViews: 60 * 60,
  /**
   * Refused by YouTube. Members-first uploads go public after a while; when
   * they do the listing reports views and the row is no longer looked up, so
   * this only bounds how long a refusal is remembered.
   */
  unavailable: 24 * 3600,
  /** Rate limit, upstream down: retry on a later refresh, not every page view. */
  failed: 15 * 60,
} as const;

type Lookup =
  | { kind: "public"; publishedAt?: number; viewCount?: number }
  | { kind: "unavailable"; reason: string }
  | { kind: "failed" };

export type RepairDeps = {
  rssEntries: (db: AppDb, channelId: string) => Promise<RssEntry[]>;
  videoDetail: (db: AppDb, videoId: string) => Promise<VideoDetail>;
};

function lookupCacheKey(videoId: string): string {
  return `listing-row:v1:${videoId}`;
}

function hasViews(v: UnifiedVideo): boolean {
  return typeof v.viewCount === "number" && v.viewCount > 0;
}

function needsLookup(v: UnifiedVideo): boolean {
  return !v.isLive && !v.isUpcoming && !hasViews(v);
}

function withPublishedAt(v: UnifiedVideo, publishedAt: number): UnifiedVideo {
  return {
    ...v,
    publishedAt,
    publishedText: new Date(publishedAt * 1000).toISOString(),
  };
}

/** Exact date, view count (when the listing has none) and channel name from the RSS. */
function applyRss(videos: UnifiedVideo[], entries: RssEntry[]): UnifiedVideo[] {
  const byId = new Map(entries.map((e) => [e.videoId, e]));
  return videos.map((v) => {
    const e = byId.get(v.videoId);
    if (!e) return v;
    let out = v;
    if (typeof e.publishedAt === "number" && Number.isFinite(e.publishedAt)) {
      out = withPublishedAt(out, e.publishedAt);
    }
    if (!hasViews(out) && typeof e.viewCount === "number" && e.viewCount > 0) {
      out = { ...out, viewCount: e.viewCount };
    }
    if (!out.channelName?.trim() && e.channelName) {
      out = { ...out, channelName: e.channelName };
    }
    return out;
  });
}

function readLookup(db: AppDb, videoId: string): Lookup | null {
  const row = readFreshCacheRow(db, lookupCacheKey(videoId));
  if (!row) return null;
  try {
    return JSON.parse(row.payloadJson) as Lookup;
  } catch {
    return null;
  }
}

function writeLookup(db: AppDb, videoId: string, lookup: Lookup): void {
  const ttlSec =
    lookup.kind === "public"
      ? (lookup.viewCount ?? 0) > 0
        ? LOOKUP_TTL_SEC.public
        : LOOKUP_TTL_SEC.publicZeroViews
      : LOOKUP_TTL_SEC[lookup.kind];
  writeCache(db, lookupCacheKey(videoId), "invidious", lookup, "listing-row", {
    ttlSec,
  });
}

async function lookUp(
  db: AppDb,
  videoId: string,
  deps: RepairDeps,
): Promise<Lookup> {
  let lookup: Lookup;
  try {
    const detail = await deps.videoDetail(db, videoId);
    lookup = {
      kind: "public",
      publishedAt:
        typeof detail.publishedAt === "number" && detail.publishedAt > 0
          ? detail.publishedAt
          : undefined,
      viewCount:
        typeof detail.viewCount === "number" && detail.viewCount > 0
          ? detail.viewCount
          : undefined,
    };
  } catch (e) {
    lookup =
      e instanceof UpstreamVideoUnavailableError
        ? { kind: "unavailable", reason: e.reason }
        : { kind: "failed" };
  }
  writeLookup(db, videoId, lookup);
  return lookup;
}

function applyLookup(v: UnifiedVideo, lookup: Lookup): UnifiedVideo | null {
  if (lookup.kind === "unavailable") return null;
  if (lookup.kind === "failed") return v;
  let out = v;
  if (lookup.publishedAt) out = withPublishedAt(out, lookup.publishedAt);
  if (lookup.viewCount) out = { ...out, viewCount: lookup.viewCount };
  return out;
}

export async function repairListingRows(
  db: AppDb,
  channelId: string,
  videos: UnifiedVideo[],
  deps: RepairDeps,
): Promise<UnifiedVideo[]> {
  if (videos.length === 0) return videos;

  let rss: RssEntry[] = [];
  try {
    rss = await deps.rssEntries(db, channelId);
  } catch {
    /* RSS is a nice-to-have here; the lookups below still run. */
  }
  const patched = applyRss(videos, rss);

  // Cached answers first; only rows without one count towards the cap.
  const lookups = new Map<string, Lookup>();
  const toFetch: string[] = [];
  for (const v of patched) {
    if (!needsLookup(v)) continue;
    const cached = readLookup(db, v.videoId);
    if (cached) lookups.set(v.videoId, cached);
    else if (toFetch.length < MAX_LOOKUPS_PER_LISTING) toFetch.push(v.videoId);
  }
  const fetched = await Promise.all(toFetch.map((id) => lookUp(db, id, deps)));
  toFetch.forEach((id, i) => {
    lookups.set(id, fetched[i]);
  });

  const out: UnifiedVideo[] = [];
  let dropped = 0;
  for (const v of patched) {
    const lookup = lookups.get(v.videoId);
    const repaired = lookup ? applyLookup(v, lookup) : v;
    if (repaired) out.push(repaired);
    else dropped += 1;
  }
  if (toFetch.length > 0 || dropped > 0) {
    logger.info("listing_rows.repaired", {
      channelId,
      lookedUp: toFetch.length,
      dropped,
    });
  }
  return out;
}
