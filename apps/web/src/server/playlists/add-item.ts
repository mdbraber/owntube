import { and, asc, eq, sql } from "drizzle-orm";
import type { AppDb } from "@/server/db/client";
import { playlistItems, playlists } from "@/server/db/schema";

export function isOwnedPlaylist(
  db: AppDb,
  userId: number,
  playlistId: number,
): boolean {
  return (
    db
      .select({ id: playlists.id })
      .from(playlists)
      .where(and(eq(playlists.id, playlistId), eq(playlists.userId, userId)))
      .limit(1)
      .all()[0] !== undefined
  );
}

/**
 * Append a video to one of the user's playlists. A video already in the
 * playlist stays where it is (the insert is ignored). False when the playlist
 * isn't the user's.
 */
export function addVideoToPlaylist(
  db: AppDb,
  userId: number,
  item: { playlistId: number; videoId: string; channelId?: string | null },
  now: number = Math.floor(Date.now() / 1000),
): boolean {
  if (!isOwnedPlaylist(db, userId, item.playlistId)) return false;
  const maxPos = db
    .select({
      n: sql<number>`coalesce(max(${playlistItems.position}), -1)`,
    })
    .from(playlistItems)
    .where(eq(playlistItems.playlistId, item.playlistId))
    .all()[0];
  db.insert(playlistItems)
    .values({
      playlistId: item.playlistId,
      videoId: item.videoId,
      channelId: item.channelId ?? null,
      addedAt: now,
      position: Number(maxPos?.n ?? -1) + 1,
    })
    .onConflictDoNothing({
      target: [playlistItems.playlistId, playlistItems.videoId],
    })
    .run();
  db.update(playlists)
    .set({ updatedAt: now })
    .where(eq(playlists.id, item.playlistId))
    .run();
  return true;
}

/**
 * The id of the user's playlist named `name` (trimmed, case-insensitive; the
 * oldest when several match), creating it when there is none.
 */
export function playlistIdByName(
  db: AppDb,
  userId: number,
  name: string,
  now: number = Math.floor(Date.now() / 1000),
): number {
  const wanted = name.trim();
  const found = db
    .select({ id: playlists.id })
    .from(playlists)
    .where(
      and(
        eq(playlists.userId, userId),
        sql`lower(trim(${playlists.name})) = lower(${wanted})`,
      ),
    )
    .orderBy(asc(playlists.id))
    .limit(1)
    .all()[0];
  if (found) return found.id;
  return db
    .insert(playlists)
    .values({ userId, name: wanted, createdAt: now, updatedAt: now })
    .returning({ id: playlists.id })
    .get().id;
}
