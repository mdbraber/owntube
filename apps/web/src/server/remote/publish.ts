import { and, asc, desc, eq, inArray } from "drizzle-orm";
import {
  isSubscriptionShort,
  type LongFormWindow,
} from "@/lib/long-form-uploads";
import { parseChaptersFromDescription } from "@/lib/video-chapters";
import {
  fetchChannelPage,
  fetchVideoDetail,
  fetchVideoSummaries,
} from "@/server/catalog";
import type { UnifiedVideo } from "@/server/catalog/types";
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
import { signedEnclosures } from "@/server/gateway/playback";
import { memosByVideo, withMemoPreamble } from "@/server/memos/feed-memos";
import { ensureRssPass, feedToken, sha256Hex } from "@/server/remote/rss-pass";
import { getChannelRssEntries, getLongFormWindows } from "@/server/rss/cache";
import { getUserSettings } from "@/server/settings/profile";

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
  /** Absolute origin used to build enclosure/link URLs. */
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
  /** Duration/Shorts lookups for channel feed items (tests pass their own). */
  factsOf?: VideoFactsResolver;
};

const DEFAULT_CHANNEL_LIMIT = 30;
const DEFAULT_MERGED_LIMIT = 50;
const DEFAULT_CONCURRENCY = 5;
/** Live detail lookups per publish run for videos no cache has; the rest
 * wait for the next run (a new subscription's backlog, a cleared cache). */
const LIVE_LOOKUPS_PER_RUN = 60;

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
  rows: { videoId: string; title?: string | null }[],
  appOrigin: string,
  concurrency: number,
): Promise<FeedItem[]> {
  const items = await mapWithConcurrency(rows, concurrency, async (r) => {
    const enc = await signedEnclosures(r.videoId, appOrigin);
    try {
      const d = await fetchVideoDetail({ videoId: r.videoId });
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

/** What a channel-based feed needs from a video beyond its RSS entry. */
export type VideoFacts = Pick<
  UnifiedVideo,
  "durationSeconds" | "isShort" | "isLive" | "isUpcoming"
>;

export type VideoFactsResolver = (
  channelId: string,
  videoId: string,
) => Promise<VideoFacts>;

/** Facts from a video summary; undefined unless the duration is known. */
function pickFacts(v: unknown): VideoFacts | undefined {
  if (!v || typeof v !== "object") return undefined;
  const o = v as Record<string, unknown>;
  const d = o.durationSeconds;
  if (typeof d !== "number" || !(d > 0)) return undefined;
  const flag = (k: string) => (o[k] === true ? { [k]: true } : {});
  return {
    durationSeconds: d,
    ...flag("isShort"),
    ...flag("isLive"),
    ...flag("isUpcoming"),
  };
}

/**
 * YouTube's uploads RSS carries no duration, so channel-based feed items would
 * go out without `<itunes:duration>` (podcast apps show "unknown" until the
 * episode is loaded), and there'd be nothing to tell a Short by once it has
 * aged out of the long-form window. A video's duration never changes, so any
 * cached copy will do: the channel's page in the gateway's cache first, then
 * the video's cached summary. Only a video neither has is looked up live (at
 * most `liveLookups` per run). One resolver per publish run; lookups are
 * shared across feeds and users.
 */
export function createVideoFactsResolver(
  options: {
    liveLookups?: number;
    /** A channel's videos, cache-only. */
    channelVideos?: (channelId: string) => Promise<UnifiedVideo[]>;
    /** One video's summary, cache-only or live. */
    summary?: (
      videoId: string,
      cacheOnly: boolean,
    ) => Promise<UnifiedVideo | undefined>;
  } = {},
): VideoFactsResolver {
  const channelVideos =
    options.channelVideos ??
    (async (channelId: string) =>
      (await fetchChannelPage({ channelId }, { cache: "only" })).videos);
  const summary =
    options.summary ??
    (async (videoId: string, cacheOnly: boolean) =>
      (
        await fetchVideoSummaries([videoId], cacheOnly ? { cache: "only" } : {})
      ).get(videoId));
  let liveLeft = options.liveLookups ?? LIVE_LOOKUPS_PER_RUN;
  const byChannel = new Map<string, Promise<Map<string, VideoFacts>>>();
  const byVideo = new Map<string, Promise<VideoFacts>>();

  const channelFacts = (channelId: string) => {
    let m = byChannel.get(channelId);
    if (!m) {
      m = channelVideos(channelId).then(
        (videos) => {
          const facts = new Map<string, VideoFacts>();
          for (const v of videos) {
            const f = pickFacts(v);
            if (f) facts.set(v.videoId, f);
          }
          return facts;
        },
        () => new Map<string, VideoFacts>(),
      );
      byChannel.set(channelId, m);
    }
    return m;
  };

  const resolve = async (videoId: string): Promise<VideoFacts> => {
    const cached = pickFacts(
      await summary(videoId, true).catch(() => undefined),
    );
    if (cached) return cached;
    if (liveLeft <= 0) return {};
    liveLeft--;
    return (
      pickFacts(await summary(videoId, false).catch(() => undefined)) ?? {}
    );
  };

  return async (channelId, videoId) => {
    const fromChannel = (await channelFacts(channelId)).get(videoId);
    if (fromChannel) return fromChannel;
    let p = byVideo.get(videoId);
    if (!p) {
      p = resolve(videoId);
      byVideo.set(videoId, p);
    }
    return p;
  };
}

/**
 * Merge several channels' cached uploads RSS into one newest-first item list,
 * without Shorts — the same rule as the subscriptions page. Facts are looked
 * up a page at a time until `limit` non-Shorts are found.
 */
async function mergedChannelItems(
  db: AppDb,
  channelIds: string[],
  appOrigin: string,
  limit: number,
  factsOf: VideoFactsResolver,
  concurrency: number,
): Promise<FeedItem[]> {
  const [perChannel, windows] = await Promise.all([
    Promise.all(
      channelIds.map((c) => getChannelRssEntries(db, c).catch(() => [])),
    ),
    getLongFormWindows(db, channelIds).catch(
      () => new Map<string, LongFormWindow>(),
    ),
  ]);
  const seen = new Set<string>();
  const candidates = perChannel
    .flat()
    .filter((e) => (seen.has(e.videoId) ? false : seen.add(e.videoId)))
    .sort((a, b) => (b.publishedAt ?? 0) - (a.publishedAt ?? 0));
  const out: FeedItem[] = [];
  for (let i = 0; i < candidates.length && out.length < limit; i += limit) {
    const page = candidates.slice(i, i + limit);
    const looked = await mapWithConcurrency(page, concurrency, async (e) => ({
      facts: await factsOf(e.channelId, e.videoId),
      enc: await signedEnclosures(e.videoId, appOrigin),
    }));
    page.forEach((e, j) => {
      const item = looked[j];
      if (!item) return;
      const { facts: f, enc } = item;
      if (out.length >= limit || isSubscriptionShort({ ...e, ...f }, windows)) {
        return;
      }
      out.push({
        videoId: e.videoId,
        title: e.title,
        ...(f.durationSeconds !== undefined
          ? { durationSeconds: f.durationSeconds }
          : {}),
        publishedAt: e.publishedAt,
        thumbnailUrl: publicThumbnail(e.videoId),
        channelName: e.channelName,
        ...enc,
      });
    });
  }
  return out;
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
  opts: Required<Omit<PublishOptions, "onLog" | "factsOf">> & {
    onLog?: PublishOptions["onLog"];
  },
  factsOf: VideoFactsResolver,
): Promise<{ feeds: FeedSnapshot[]; refs: PublishedFeedRef[] }> {
  const { appOrigin, channelFeedLimit, mergedFeedLimit, concurrency } = opts;
  const now = Math.floor(Date.now() / 1000);
  const includeMemos = getUserSettings(db, userId).includeMemosInFeeds;
  /** The user's own lists, with memos on top of each description if asked. */
  const listItems = async (
    rows: { videoId: string; title?: string | null }[],
  ): Promise<FeedItem[]> => {
    const items = await enrichVideoItems(rows, appOrigin, concurrency);
    if (!includeMemos) return items;
    const memos = memosByVideo(
      db,
      userId,
      items.map((i) => i.videoId),
    );
    return items.map((item) => {
      const list = memos.get(item.videoId);
      return list
        ? { ...item, description: withMemoPreamble(item.description, list) }
        : item;
    });
  };
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
    const items = await listItems(itemRows);
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
    const items = await listItems(queueRows);
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
    const items = await listItems(savedRows);
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
      factsOf,
      concurrency,
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
      factsOf,
      concurrency,
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
      factsOf,
      concurrency,
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
  /** Secret feed-URL path segment derived from the RSS password. */
  feedToken: string;
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
  const factsOf = options.factsOf ?? createVideoFactsResolver();
  const all: FeedSnapshot[] = [];
  const creds: FeedOwnerCredential[] = [];
  for (const u of userRows) {
    // The full email — unique by schema, so usernames can't collide.
    const username = u.email;
    const pass = ensureRssPass(db, u.id);
    creds.push({
      username,
      passSha256: sha256Hex(pass),
      feedToken: feedToken(pass),
    });
    const { feeds, refs } = await buildFeedsForUser(
      db,
      u.id,
      username,
      opts,
      factsOf,
    );
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
