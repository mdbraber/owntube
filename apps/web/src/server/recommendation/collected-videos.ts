import { and, eq } from "drizzle-orm";
import type { AppDb } from "@/server/db/client";
import {
  interactions,
  playlistItems,
  playlists,
  watchQueue,
} from "@/server/db/schema";

/**
 * Video ids the user has already collected — queued to watch, saved, or added
 * to any of their playlists. These are held out of personalized
 * recommendations unconditionally: the user already knows about them, so the
 * recommended feed stays a discovery surface for things they'd otherwise not
 * see. They still act as taste signals elsewhere (a save shapes the corpus;
 * only its own video is stripped from the output).
 */
export function getCollectedVideoIds(db: AppDb, userId: number): Set<string> {
  const ids = new Set<string>();

  for (const r of db
    .select({ videoId: watchQueue.videoId })
    .from(watchQueue)
    .where(eq(watchQueue.userId, userId))
    .all()) {
    ids.add(r.videoId);
  }

  for (const r of db
    .select({ videoId: interactions.videoId })
    .from(interactions)
    .where(and(eq(interactions.userId, userId), eq(interactions.type, "save")))
    .all()) {
    ids.add(r.videoId);
  }

  // Playlist items belong to a playlist, which belongs to a user — join through
  // so we only pull this user's playlist videos.
  for (const r of db
    .select({ videoId: playlistItems.videoId })
    .from(playlistItems)
    .innerJoin(playlists, eq(playlistItems.playlistId, playlists.id))
    .where(eq(playlists.userId, userId))
    .all()) {
    ids.add(r.videoId);
  }

  return ids;
}

/** A queued / playlisted video with the channel and add time needed for taste signals. */
export type CollectedVideoRef = {
  videoId: string;
  channelId: string | null;
  addedAt: number;
};

/**
 * Queue + playlist entries, with their channel and add timestamp, for use as
 * positive taste signals (queuing or filing a video is an endorsement, like a
 * save). Saved videos are intentionally *not* included here — explicit `save`
 * interactions already feed the taste model directly in `collectUserSignals`.
 */
export function getQueuedAndPlaylistVideoRefs(
  db: AppDb,
  userId: number,
): CollectedVideoRef[] {
  const refs: CollectedVideoRef[] = [];

  for (const r of db
    .select({
      videoId: watchQueue.videoId,
      channelId: watchQueue.channelId,
      addedAt: watchQueue.addedAt,
    })
    .from(watchQueue)
    .where(eq(watchQueue.userId, userId))
    .all()) {
    refs.push(r);
  }

  for (const r of db
    .select({
      videoId: playlistItems.videoId,
      channelId: playlistItems.channelId,
      addedAt: playlistItems.addedAt,
    })
    .from(playlistItems)
    .innerJoin(playlists, eq(playlistItems.playlistId, playlists.id))
    .where(eq(playlists.userId, userId))
    .all()) {
    refs.push(r);
  }

  return refs;
}
