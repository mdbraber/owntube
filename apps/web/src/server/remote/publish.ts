import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { toMediaOriginUrl } from "@/lib/media-origin";
import { parseChaptersFromDescription } from "@/lib/video-chapters";
import type { AppDb } from "@/server/db/client";
import {
  channelMeta,
  channelTags,
  interactions,
  playlistItems,
  playlists,
  publishedFeeds,
  subscriptions,
  users,
  watchQueue,
} from "@/server/db/schema";
import { ensureRssPass, sha256Hex } from "@/server/remote/rss-pass";
import { getChannelRssEntries } from "@/server/rss/cache";
import { fetchVideoDetail } from "@/server/services/proxy";

/**
 * Remote-control publisher: turns each user's local library (playlists, queue,
 * saved inbox) and subscription uploads into self-contained feed snapshots and
 * pushes them to the public companion (see `companion/`). The companion stores
 * and renders them as podcast RSS; every `<enclosure>` points back at the LAN
 * media origin (`/enclosure/<id>.{m4a,mp4}`), so metadata is public-behind-basic-auth
 * while the media itself only streams on the LAN.
 *
 * Nothing here is opt-in: we publish everything. The companion replaces its full
 * set each cycle, so deleting a playlist / unsubscribing prunes the feed.
 *
 * Access is per user: each snapshot carries its owner's Basic-Auth username
 * (the full account email — URL-encoded by clients inside feed URLs) and the
 * payload includes every user's credential as a SHA-256 — the plaintext RSS
 * password never leaves home. The companion scopes every feed route to the
 * authenticated owner, which also makes slug prefixing unnecessary: two users
 * can both have `queue`.
 */

export type FeedKind =
  | "playlist"
  | "queue"
  | "saved"
  | "subscriptions"
  | "tag"
  | "channel";

export type FeedItem = {
  videoId: string;
  title: string;
  description?: string;
  durationSeconds?: number;
  publishedAt?: number;
  thumbnailUrl?: string;
  channelName?: string;
  enclosureAudio: string;
  enclosureVideo: string;
  /** YouTube-style chapters parsed from the description; the companion serves
   * them as Podcasting 2.0 JSON chapters. Absent when none were found. */
  chapters?: { startSeconds: number; title: string }[];
};

export type FeedSnapshot = {
  kind: FeedKind;
  /** Basic-Auth username whose credentials unlock this feed on the companion. */
  owner: string;
  /** Readable, kind-namespaced on the companion (`/rss/<kind>/<slug>.*`). */
  slug: string;
  title: string;
  description?: string;
  link?: string;
  image?: string;
  updatedAt: number;
  items: FeedItem[];
};

export type PublishOptions = {
  /** Absolute origin used to build enclosure/link URLs (media host resolved from env). */
  appOrigin: string;
  /** Stable podcast cover art for the library feeds (queue, playlists, …).
   * Defaults to the companion's own /icon.png; channel feeds keep their
   * channel avatar. Item thumbnails are unaffected. */
  iconUrl?: string;
  /** Newest N uploads to keep per channel-based feed. */
  channelFeedLimit?: number;
  /** Newest N videos to keep in the merged subscriptions/tag feeds. */
  mergedFeedLimit?: number;
  /** Per-video detail lookups run this many at a time. */
  concurrency?: number;
  onLog?: (message: string) => void;
};

const DEFAULT_CHANNEL_LIMIT = 30;
const DEFAULT_MERGED_LIMIT = 50;
const DEFAULT_CONCURRENCY = 5;

function slugify(input: string, fallback: string): string {
  const s = input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  return s || fallback;
}

/** De-duplicate readable slugs within one kind by appending a suffix. */
function uniqueSlug(base: string, taken: Set<string>): string {
  let slug = base;
  let n = 2;
  while (taken.has(slug)) slug = `${base}-${n++}`;
  taken.add(slug);
  return slug;
}

function enclosures(
  videoId: string,
  appOrigin: string,
): { enclosureAudio: string; enclosureVideo: string } {
  return {
    enclosureAudio: toMediaOriginUrl(`/enclosure/${videoId}.m4a`, appOrigin),
    enclosureVideo: toMediaOriginUrl(`/enclosure/${videoId}.mp4`, appOrigin),
  };
}

/**
 * Item artwork must be reachable from anywhere (podcast apps load it off-LAN),
 * so thumbnails always point at YouTube's public CDN rather than whatever
 * LAN-proxied URL the detail lookup returns. hqdefault exists for every video;
 * maxresdefault does not.
 */
function publicThumbnail(videoId: string): string {
  return `https://i.ytimg.com/vi/${encodeURIComponent(videoId)}/hqdefault.jpg`;
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let cursor = 0;
  const runners = Array.from(
    { length: Math.min(limit, items.length) },
    async () => {
      while (true) {
        const i = cursor++;
        if (i >= items.length) return;
        out[i] = await worker(items[i] as T, i);
      }
    },
  );
  await Promise.all(runners);
  return out;
}

/**
 * Enrich an explicit list of video ids (playlists/queue/saved) into feed items
 * via `fetchVideoDetail` — the same call `interactions.listSaved` uses — so we
 * get description, duration, published date and thumbnail. Falls back to the
 * stored title when a lookup fails (age-restricted/removed).
 */
async function enrichVideoItems(
  db: AppDb,
  rows: { videoId: string; title?: string | null }[],
  appOrigin: string,
  concurrency: number,
): Promise<FeedItem[]> {
  const items = await mapWithConcurrency(rows, concurrency, async (r) => {
    const enc = enclosures(r.videoId, appOrigin);
    try {
      const d = await fetchVideoDetail(db, { videoId: r.videoId });
      const chapters = parseChaptersFromDescription(
        d.description,
        d.durationSeconds,
      );
      return {
        videoId: r.videoId,
        title: d.title ?? r.title ?? r.videoId,
        description: d.description,
        durationSeconds: d.durationSeconds,
        publishedAt: d.publishedAt,
        thumbnailUrl: publicThumbnail(r.videoId),
        channelName: d.channelName,
        ...(chapters.length > 0 ? { chapters } : {}),
        ...enc,
      } satisfies FeedItem;
    } catch {
      return {
        videoId: r.videoId,
        title: r.title ?? r.videoId,
        thumbnailUrl: publicThumbnail(r.videoId),
        ...enc,
      } satisfies FeedItem;
    }
  });
  return items;
}

/** Merge several channels' cached uploads RSS into one newest-first item list. */
async function mergedChannelItems(
  db: AppDb,
  channelIds: string[],
  appOrigin: string,
  limit: number,
): Promise<FeedItem[]> {
  const perChannel = await Promise.all(
    channelIds.map((c) => getChannelRssEntries(db, c).catch(() => [])),
  );
  const seen = new Set<string>();
  const merged = perChannel
    .flat()
    .filter((e) => (seen.has(e.videoId) ? false : seen.add(e.videoId)))
    .sort((a, b) => (b.publishedAt ?? 0) - (a.publishedAt ?? 0))
    .slice(0, limit);
  return merged.map((e) => ({
    videoId: e.videoId,
    title: e.title,
    publishedAt: e.publishedAt,
    thumbnailUrl: publicThumbnail(e.videoId),
    channelName: e.channelName,
    ...enclosures(e.videoId, appOrigin),
  }));
}

function readChannelNames(
  db: AppDb,
  channelIds: string[],
): Map<string, { name: string; avatarUrl?: string }> {
  const out = new Map<string, { name: string; avatarUrl?: string }>();
  if (channelIds.length === 0) return out;
  const rows = db
    .select({
      channelId: channelMeta.channelId,
      channelName: channelMeta.channelName,
      avatarUrl: channelMeta.avatarUrl,
    })
    .from(channelMeta)
    .where(inArray(channelMeta.channelId, channelIds))
    .all();
  for (const r of rows) {
    out.set(r.channelId, {
      name: r.channelName,
      avatarUrl: r.avatarUrl ?? undefined,
    });
  }
  return out;
}

/** What buildFeedsForUser assigned, keyed by source entity — persisted so the
 * UI can turn "this playlist / the queue" into the published feed URL. */
export type PublishedFeedRef = {
  kind: FeedKind;
  refId: string;
  slug: string;
  title: string;
};

async function buildFeedsForUser(
  db: AppDb,
  userId: number,
  owner: string,
  opts: Required<Omit<PublishOptions, "onLog">> & {
    onLog?: PublishOptions["onLog"];
  },
): Promise<{ feeds: FeedSnapshot[]; refs: PublishedFeedRef[] }> {
  const { appOrigin, channelFeedLimit, mergedFeedLimit, concurrency } = opts;
  const now = Math.floor(Date.now() / 1000);
  const feeds: FeedSnapshot[] = [];
  const refs: PublishedFeedRef[] = [];
  const pushFeed = (feed: FeedSnapshot, refId: string): void => {
    feeds.push(feed);
    refs.push({ kind: feed.kind, refId, slug: feed.slug, title: feed.title });
  };
  const slugsByKind = new Map<FeedKind, Set<string>>();
  const takenFor = (kind: FeedKind): Set<string> => {
    let s = slugsByKind.get(kind);
    if (!s) {
      s = new Set<string>();
      slugsByKind.set(kind, s);
    }
    return s;
  };

  // --- Playlists (all) ---
  const playlistRows = db
    .select()
    .from(playlists)
    .where(eq(playlists.userId, userId))
    .all();
  for (const pl of playlistRows) {
    const itemRows = db
      .select({ videoId: playlistItems.videoId })
      .from(playlistItems)
      .where(eq(playlistItems.playlistId, pl.id))
      .orderBy(asc(playlistItems.position), asc(playlistItems.addedAt))
      .all();
    if (itemRows.length === 0) continue;
    const items = await enrichVideoItems(db, itemRows, appOrigin, concurrency);
    pushFeed(
      {
        kind: "playlist",
        owner,
        slug: uniqueSlug(
          slugify(pl.name, `playlist-${pl.id}`),
          takenFor("playlist"),
        ),
        title: pl.name,
        description: pl.description ?? undefined,
        link: `${appOrigin}/playlist?list=${pl.id}`,
        image: opts.iconUrl || items[0]?.thumbnailUrl,
        updatedAt: pl.updatedAt ?? now,
        items,
      },
      String(pl.id),
    );
  }

  // --- Queue ---
  const queueRows = db
    .select({ videoId: watchQueue.videoId, title: watchQueue.title })
    .from(watchQueue)
    .where(eq(watchQueue.userId, userId))
    .orderBy(asc(watchQueue.position))
    .all();
  if (queueRows.length > 0) {
    const items = await enrichVideoItems(db, queueRows, appOrigin, concurrency);
    pushFeed(
      {
        kind: "queue",
        owner,
        slug: "queue",
        title: "Queue",
        description: "OwnTube watch queue",
        link: `${appOrigin}/`,
        image: opts.iconUrl || items[0]?.thumbnailUrl,
        updatedAt: now,
        items,
      },
      "queue",
    );
  }

  // --- Saved inbox ---
  const savedRows = db
    .select({ videoId: interactions.videoId, title: interactions.title })
    .from(interactions)
    .where(and(eq(interactions.userId, userId), eq(interactions.type, "save")))
    .orderBy(desc(interactions.createdAt))
    .all();
  if (savedRows.length > 0) {
    const items = await enrichVideoItems(db, savedRows, appOrigin, concurrency);
    pushFeed(
      {
        kind: "saved",
        owner,
        slug: "saved",
        title: "Saved",
        description: "OwnTube saved videos",
        link: `${appOrigin}/`,
        image: opts.iconUrl || items[0]?.thumbnailUrl,
        updatedAt: now,
        items,
      },
      "saved",
    );
  }

  // --- Subscription-derived channel feeds (subscribed channels only) ---
  const subRows = db
    .select({ channelId: subscriptions.channelId })
    .from(subscriptions)
    .where(eq(subscriptions.userId, userId))
    .all();
  const subChannelIds = [...new Set(subRows.map((r) => r.channelId))];
  const names = readChannelNames(db, subChannelIds);

  // All subscriptions merged.
  if (subChannelIds.length > 0) {
    const items = await mergedChannelItems(
      db,
      subChannelIds,
      appOrigin,
      mergedFeedLimit,
    );
    pushFeed(
      {
        kind: "subscriptions",
        owner,
        slug: "subscriptions",
        title: "Subscriptions",
        description: "Latest uploads from all subscribed channels",
        link: `${appOrigin}/subscriptions`,
        image: opts.iconUrl || items[0]?.thumbnailUrl,
        updatedAt: now,
        items,
      },
      "subscriptions",
    );
  }

  // Per channel tag — restricted to subscribed channels.
  const tagRows = db
    .select({ tag: channelTags.tag, channelId: channelTags.channelId })
    .from(channelTags)
    .where(eq(channelTags.userId, userId))
    .all();
  const byTag = new Map<string, string[]>();
  for (const r of tagRows) {
    if (!subChannelIds.includes(r.channelId)) continue;
    const arr = byTag.get(r.tag) ?? [];
    arr.push(r.channelId);
    byTag.set(r.tag, arr);
  }
  for (const [tag, channelIds] of byTag) {
    const items = await mergedChannelItems(
      db,
      channelIds,
      appOrigin,
      mergedFeedLimit,
    );
    if (items.length === 0) continue;
    pushFeed(
      {
        kind: "tag",
        owner,
        slug: uniqueSlug(slugify(tag, "tag"), takenFor("tag")),
        title: `#${tag}`,
        description: `Latest uploads from channels tagged "${tag}"`,
        link: `${appOrigin}/subscriptions`,
        image: opts.iconUrl || items[0]?.thumbnailUrl,
        updatedAt: now,
        items,
      },
      tag,
    );
  }

  // Per channel.
  for (const channelId of subChannelIds) {
    const items = await mergedChannelItems(
      db,
      [channelId],
      appOrigin,
      channelFeedLimit,
    );
    if (items.length === 0) continue;
    const meta = names.get(channelId);
    const title = meta?.name ?? items[0]?.channelName ?? channelId;
    pushFeed(
      {
        kind: "channel",
        owner,
        slug: uniqueSlug(slugify(title, channelId), takenFor("channel")),
        title,
        description: `Latest uploads from ${title}`,
        link: `${appOrigin}/channel/${channelId}`,
        image: meta?.avatarUrl ?? (opts.iconUrl || items[0]?.thumbnailUrl),
        updatedAt: now,
        items,
      },
      channelId,
    );
  }

  return { feeds, refs };
}

export type FeedOwnerCredential = {
  username: string;
  /** SHA-256 hex of the user's RSS password — the plaintext never leaves home. */
  passSha256: string;
};

/** Build every user's feed snapshots plus the credential set that unlocks them. */
export async function buildAllFeeds(
  db: AppDb,
  options: PublishOptions,
): Promise<{ feeds: FeedSnapshot[]; users: FeedOwnerCredential[] }> {
  const opts = {
    appOrigin: options.appOrigin,
    iconUrl: options.iconUrl ?? "",
    channelFeedLimit: options.channelFeedLimit ?? DEFAULT_CHANNEL_LIMIT,
    mergedFeedLimit: options.mergedFeedLimit ?? DEFAULT_MERGED_LIMIT,
    concurrency: options.concurrency ?? DEFAULT_CONCURRENCY,
    onLog: options.onLog,
  };
  const userRows = db
    .select({ id: users.id, email: users.email })
    .from(users)
    .all();
  const all: FeedSnapshot[] = [];
  const creds: FeedOwnerCredential[] = [];
  for (const u of userRows) {
    // The full email — unique by schema, so usernames can't collide.
    const username = u.email;
    creds.push({ username, passSha256: sha256Hex(ensureRssPass(db, u.id)) });
    const { feeds, refs } = await buildFeedsForUser(db, u.id, username, opts);
    recordPublishedFeeds(db, u.id, refs);
    opts.onLog?.(
      `publish: user ${u.id} (${username}) — ${feeds.length} feed(s)`,
    );
    all.push(...feeds);
  }
  return { feeds: all, users: creds };
}

/** Persist this run's slug assignments so the UI can build feed URLs. */
function recordPublishedFeeds(
  db: AppDb,
  userId: number,
  refs: PublishedFeedRef[],
): void {
  const now = Math.floor(Date.now() / 1000);
  db.delete(publishedFeeds).where(eq(publishedFeeds.userId, userId)).run();
  for (const r of refs) {
    db.insert(publishedFeeds)
      .values({
        userId,
        kind: r.kind,
        refId: r.refId,
        slug: r.slug,
        title: r.title,
        updatedAt: now,
      })
      .run();
  }
}

/** Build all feeds and POST them (with the credential set) to the companion. */
export async function publishFeeds(
  db: AppDb,
  options: PublishOptions & { target: string; secret: string },
): Promise<{ feedCount: number; itemCount: number }> {
  const base = options.target.replace(/\/+$/, "");
  const { feeds, users: feedUsers } = await buildAllFeeds(db, {
    ...options,
    // The companion serves the OwnTube icon itself — a stable cover that,
    // unlike a first-item thumbnail, never changes when the queue does.
    iconUrl: options.iconUrl ?? `${base}/icon.png`,
  });
  const itemCount = feeds.reduce((n, f) => n + f.items.length, 0);
  const url = `${base}/publish`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${options.secret}`,
    },
    body: JSON.stringify({ feeds, users: feedUsers }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`companion ${res.status}: ${body.slice(0, 200)}`);
  }
  return { feedCount: feeds.length, itemCount };
}
