/**
 * Search the videos OwnTube knows locally — cached uploads of subscribed and
 * tagged channels, history, saved, queue, playlists and memos — with the
 * filter syntax of `lib/library-query.ts`. Nothing here asks YouTube: titles
 * the tables lack come from the gateway's cache only. A tag search finds what
 * OwnTube has stored for those channels, not their whole back catalogue.
 */
import { and, eq, inArray } from "drizzle-orm";
import {
  type FilterRef,
  foldText,
  type InPlace,
  type LibraryFilter,
  type LibraryVideoFacts,
  matchesLibraryQuery,
  type QueryNode,
} from "@/lib/library-query";
import { normalizeYoutubeChannelId } from "@/lib/youtube-channel-id";
import { fetchVideoSummaries } from "@/server/catalog";
import type { UnifiedVideo } from "@/server/catalog/types";
import type { AppDb } from "@/server/db/client";
import {
  channelMeta,
  channelTags,
  interactions,
  playlistItems,
  playlists,
  subscriptions,
  videoMemos,
  watchHistory,
  watchQueue,
} from "@/server/db/schema";
import { cachedRssEntries } from "@/server/rss/cache";
import { filterChannelIdsByTags } from "@/server/subscriptions/tag-filter";

export const LIBRARY_PAGE_SIZE = 24;

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

type Place = Exclude<InPlace, "favorites">;

type LibraryEntry = {
  videoId: string;
  title?: string;
  channelId?: string;
  channelName?: string;
  thumbnailUrl?: string;
  durationSeconds?: number;
  viewCount?: number;
  publishedAt?: number;
  publishedText?: string;
  /** Latest local activity (watched, saved, queued, added, memo). */
  activityAt: number;
  places: Set<Place>;
  playlistNames: Set<string>;
  memoTexts: string[];
};

type Seen = Partial<
  Pick<
    LibraryEntry,
    | "title"
    | "channelId"
    | "channelName"
    | "thumbnailUrl"
    | "durationSeconds"
    | "viewCount"
    | "publishedAt"
    | "publishedText"
  >
> & { at?: number | null };

class Library {
  readonly byId = new Map<string, LibraryEntry>();

  see(videoId: string, seen: Seen): LibraryEntry {
    let e = this.byId.get(videoId);
    if (!e) {
      e = {
        videoId,
        activityAt: 0,
        places: new Set(),
        playlistNames: new Set(),
        memoTexts: [],
      };
      this.byId.set(videoId, e);
    }
    const { at, ...facts } = seen;
    for (const [k, v] of Object.entries(facts) as [
      keyof typeof facts,
      unknown,
    ][]) {
      if (v === undefined || v === null || v === "") continue;
      if (e[k] === undefined) Object.assign(e, { [k]: v });
    }
    if (at && at > e.activityAt) e.activityAt = at;
    return e;
  }
}

function str(v: string | null | undefined): string | undefined {
  return v ?? undefined;
}

/** Load every video the user's tables and caches know, deduplicated by id. */
function collectLibrary(db: AppDb, userId: number) {
  const lib = new Library();
  const subscribed = db
    .select({ channelId: subscriptions.channelId })
    .from(subscriptions)
    .where(eq(subscriptions.userId, userId))
    .all()
    .map((r) => r.channelId);
  const tagged = db
    .selectDistinct({ channelId: channelTags.channelId })
    .from(channelTags)
    .where(eq(channelTags.userId, userId))
    .all()
    .map((r) => r.channelId);

  for (const e of cachedRssEntries(db, [...subscribed, ...tagged])) {
    lib.see(e.videoId, {
      title: e.title,
      channelId: e.channelId,
      channelName: e.channelName,
      thumbnailUrl: e.thumbnailUrl,
      publishedAt: e.publishedAt,
      publishedText: e.publishedText,
      viewCount: e.viewCount,
    });
  }

  for (const r of db
    .select()
    .from(watchHistory)
    .where(and(eq(watchHistory.userId, userId), eq(watchHistory.isDeleted, 0)))
    .all()) {
    lib
      .see(r.videoId, {
        title: str(r.videoTitle),
        channelId: r.channelId,
        channelName: str(r.channelName),
        at: r.startedAt,
      })
      .places.add("history");
  }

  for (const r of db
    .select()
    .from(interactions)
    .where(and(eq(interactions.userId, userId), eq(interactions.type, "save")))
    .all()) {
    lib
      .see(r.videoId, {
        title: str(r.title),
        channelId: str(r.channelId),
        at: r.createdAt,
      })
      .places.add("saved");
  }

  for (const r of db
    .select()
    .from(watchQueue)
    .where(eq(watchQueue.userId, userId))
    .all()) {
    lib
      .see(r.videoId, {
        title: r.title,
        channelId: str(r.channelId),
        at: r.addedAt,
      })
      .places.add("queue");
  }

  for (const r of db
    .select({
      videoId: playlistItems.videoId,
      channelId: playlistItems.channelId,
      addedAt: playlistItems.addedAt,
      name: playlists.name,
    })
    .from(playlistItems)
    .innerJoin(playlists, eq(playlistItems.playlistId, playlists.id))
    .where(eq(playlists.userId, userId))
    .all()) {
    lib
      .see(r.videoId, { channelId: str(r.channelId), at: r.addedAt })
      .playlistNames.add(r.name.toLowerCase());
  }

  for (const r of db
    .select()
    .from(videoMemos)
    .where(eq(videoMemos.userId, userId))
    .all()) {
    lib
      .see(r.videoId, {
        title: str(r.videoTitle),
        channelId: str(r.channelId),
        channelName: str(r.channelName),
        at: r.occurredAt,
      })
      .memoTexts.push(r.text);
  }

  return { lib, subscribed, tagged };
}

/** Fill titles and channels the tables lack from the gateway's cache. */
async function fillFromCache(entries: LibraryEntry[]): Promise<void> {
  const missing = entries
    .filter((e) => !e.title || !e.channelId)
    .map((e) => e.videoId)
    .filter((id) => VIDEO_ID.test(id));
  if (missing.length === 0) return;
  const byId = await fetchVideoSummaries(missing, { cache: "only" }).catch(
    () => new Map<string, UnifiedVideo>(),
  );
  for (const e of entries) {
    const v = byId.get(e.videoId);
    if (!v) continue;
    e.title ??= v.title;
    e.channelId ??= v.channelId;
    e.channelName ??= v.channelName;
    e.thumbnailUrl ??= v.thumbnailUrl;
    e.durationSeconds ??= v.durationSeconds;
    e.publishedAt ??= v.publishedAt;
    e.publishedText ??= v.publishedText;
    e.viewCount ??= v.viewCount;
  }
}

function fillChannelNames(db: AppDb, entries: LibraryEntry[]): void {
  const ids = [
    ...new Set(
      entries
        .filter((e) => !e.channelName && e.channelId)
        .map((e) => e.channelId as string),
    ),
  ];
  const names = new Map<string, string>();
  for (let i = 0; i < ids.length; i += 500) {
    for (const r of db
      .select({ id: channelMeta.channelId, name: channelMeta.channelName })
      .from(channelMeta)
      .where(inArray(channelMeta.channelId, ids.slice(i, i + 500)))
      .all()) {
      names.set(r.id, r.name);
    }
  }
  for (const e of entries) {
    if (!e.channelName && e.channelId) e.channelName = names.get(e.channelId);
  }
}

/** Tags a filter tree asks about (`tag:` and `in:favorites`). */
function tagsInTree(node: QueryNode, out = new Set<string>()): Set<string> {
  if (node.type === "and" || node.type === "or") {
    for (const c of node.children) tagsInTree(c, out);
  } else if (node.type === "not") {
    tagsInTree(node.child, out);
  } else if (node.type === "filter") {
    const f = node.filter;
    if (f.kind === "tag") out.add(f.tag);
    if (f.kind === "in" && f.place === "favorites") out.add(f.tag);
  }
  return out;
}

function noticeFor(
  f: LibraryFilter,
  channelsByTag: ReadonlyMap<string, ReadonlySet<string>>,
  playlistNames: ReadonlySet<string>,
): string | null {
  if (f.kind === "tag" && channelsByTag.get(f.tag)?.size === 0) {
    return `No channels are tagged #${f.tag}.`;
  }
  if (
    f.kind === "in" &&
    f.place === "favorites" &&
    channelsByTag.get(f.tag)?.size === 0
  ) {
    return `No channels are tagged #${f.tag}, your favorite tag.`;
  }
  if (
    f.kind === "in" &&
    f.place === "playlist" &&
    !playlistNames.has(f.name.toLowerCase())
  ) {
    return `You have no playlist named “${f.name}”.`;
  }
  return null;
}

export type LibrarySearchResult = {
  videos: UnifiedVideo[];
  total: number;
  page: number;
  pageSize: number;
  /** Why a filter can't match anything ("No channels are tagged #x."). */
  notices: string[];
};

export async function searchLibrary(
  db: AppDb,
  userId: number,
  query: { tree: QueryNode; filters: readonly FilterRef[] },
  opts: { page?: number; pageSize?: number } = {},
): Promise<LibrarySearchResult> {
  const pageSize = opts.pageSize ?? LIBRARY_PAGE_SIZE;
  const page = Math.max(1, opts.page ?? 1);
  const { lib, subscribed, tagged } = collectLibrary(db, userId);
  const entries = [...lib.byId.values()];
  await fillFromCache(entries);
  fillChannelNames(db, entries);

  const subscribedSet = new Set(subscribed.map(normalizeYoutubeChannelId));
  const channelIds = [
    ...new Set([
      ...tagged,
      ...entries.flatMap((e) =>
        e.channelId
          ? [e.channelId, normalizeYoutubeChannelId(e.channelId)]
          : [],
      ),
    ]),
  ];
  // The tags page's include logic, one tag at a time.
  const channelsByTag = new Map<string, ReadonlySet<string>>();
  for (const tag of tagsInTree(query.tree)) {
    channelsByTag.set(
      tag,
      new Set(
        filterChannelIdsByTags(db, userId, channelIds, { includeTags: [tag] }),
      ),
    );
  }

  const userPlaylists = new Set(
    db
      .select({ name: playlists.name })
      .from(playlists)
      .where(eq(playlists.userId, userId))
      .all()
      .map((r) => r.name.toLowerCase()),
  );
  const notices = [
    ...new Set(
      query.filters
        .filter((f) => !f.negated)
        .map((f) => noticeFor(f.filter, channelsByTag, userPlaylists))
        .filter((n): n is string => n !== null),
    ),
  ];

  const matches = entries.filter((e) => {
    const channel = e.channelId;
    const normalized = channel ? normalizeYoutubeChannelId(channel) : undefined;
    const places = new Set(e.places);
    if (normalized && subscribedSet.has(normalized))
      places.add("subscriptions");
    const tags = new Set<string>();
    for (const [tag, set] of channelsByTag) {
      if (channel && (set.has(channel) || set.has(normalized as string))) {
        tags.add(tag);
      }
    }
    const facts: LibraryVideoFacts = {
      haystack: foldText(
        [e.title ?? "", e.channelName ?? "", ...e.memoTexts].join("\n"),
      ),
      places,
      playlistNames: e.playlistNames,
      channelTags: tags,
      hasMemo: e.memoTexts.length > 0,
    };
    return matchesLibraryQuery(query.tree, facts);
  });

  // Newest first: by upload date where known, else by latest activity.
  const when = (e: LibraryEntry) => e.publishedAt ?? e.activityAt;
  matches.sort(
    (a, b) => when(b) - when(a) || a.videoId.localeCompare(b.videoId),
  );

  const slice = matches.slice((page - 1) * pageSize, page * pageSize);
  return {
    videos: slice.map((e) => ({
      videoId: e.videoId,
      title: e.title ?? e.videoId,
      channelId: e.channelId,
      channelName: e.channelName,
      thumbnailUrl: e.thumbnailUrl,
      durationSeconds: e.durationSeconds,
      viewCount: e.viewCount,
      publishedAt: e.publishedAt,
      publishedText: e.publishedText,
    })),
    total: matches.length,
    page,
    pageSize,
    notices,
  };
}
