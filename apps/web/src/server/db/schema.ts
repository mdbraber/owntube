import { sql } from "drizzle-orm";
import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const users = sqliteTable("users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const userProfile = sqliteTable("user_profile", {
  userId: integer("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  profileJson: text("profile_json").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const watchHistory = sqliteTable(
  "watch_history",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    videoId: text("video_id").notNull(),
    channelId: text("channel_id").notNull(),
    startedAt: integer("started_at").notNull(),
    durationWatched: integer("duration_watched").notNull().default(0),
    completed: integer("completed").notNull().default(0),
    /** Total video length when the watch was recorded; 0 = unknown (pre-tracking rows, engagement signals ignore them). */
    videoDurationSeconds: integer("video_duration_seconds")
      .notNull()
      .default(0),
    isDeleted: integer("is_deleted").notNull().default(0),
    /** 1 when recorded from the Shorts feed — excluded from the long-form recommendation signal. */
    isShort: integer("is_short").notNull().default(0),
    /** Denormalized at watch time so history search/display work without upstream fetches; null on pre-migration rows. */
    videoTitle: text("video_title"),
    channelName: text("channel_name"),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [
    index("watch_history_user_started_idx").on(t.userId, t.startedAt),
    index("watch_history_video_idx").on(t.videoId),
    index("watch_history_channel_idx").on(t.channelId),
    // One active row per (user, video); duplicates are soft-deleted.
    uniqueIndex("watch_history_user_video_active_uidx")
      .on(t.userId, t.videoId)
      .where(sql`is_deleted = 0`),
  ],
);

export const interactions = sqliteTable(
  "interactions",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    videoId: text("video_id").notNull(),
    channelId: text("channel_id"),
    type: text("type").notNull(),
    createdAt: integer("created_at").notNull(),
    title: text("title"),
  },
  (t) => [
    index("interactions_user_video_idx").on(t.userId, t.videoId),
    index("interactions_video_idx").on(t.videoId),
    index("interactions_channel_idx").on(t.channelId),
  ],
);

export const subscriptions = sqliteTable(
  "subscriptions",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    channelId: text("channel_id").notNull(),
    subscribedAt: integer("subscribed_at").notNull(),
  },
  (t) => [
    uniqueIndex("subscriptions_user_channel_uidx").on(t.userId, t.channelId),
    index("subscriptions_channel_idx").on(t.channelId),
  ],
);

export const channelMeta = sqliteTable(
  "channel_meta",
  {
    channelId: text("channel_id").primaryKey(),
    channelName: text("channel_name").notNull(),
    avatarUrl: text("avatar_url"),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [index("channel_meta_updated_idx").on(t.updatedAt)],
);

export const playlists = sqliteTable(
  "playlists",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [index("playlists_user_idx").on(t.userId)],
);

export const playlistItems = sqliteTable(
  "playlist_items",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    playlistId: integer("playlist_id")
      .notNull()
      .references(() => playlists.id, { onDelete: "cascade" }),
    videoId: text("video_id").notNull(),
    channelId: text("channel_id"),
    addedAt: integer("added_at").notNull(),
  },
  (t) => [
    uniqueIndex("playlist_items_unique_video").on(t.playlistId, t.videoId),
    index("playlist_items_playlist_idx").on(t.playlistId),
  ],
);

/** Shorts the user scrolled past in the vertical feed (separate from long-form history; loaders apply a seen window so old rows recycle). */
export const shortsSeen = sqliteTable(
  "shorts_seen",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    videoId: text("video_id").notNull(),
    channelId: text("channel_id").notNull(),
    seenAt: integer("seen_at").notNull(),
  },
  (t) => [
    uniqueIndex("shorts_seen_user_video_uidx").on(t.userId, t.videoId),
    index("shorts_seen_user_seen_idx").on(t.userId, t.seenAt),
  ],
);

export const videoCache = sqliteTable(
  "video_cache",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    cacheKey: text("cache_key").notNull().unique(),
    source: text("source").notNull(),
    kind: text("kind").notNull(),
    payloadJson: text("payload_json").notNull(),
    fetchedAt: integer("fetched_at").notNull(),
    expiresAt: integer("expires_at").notNull(),
  },
  (t) => [
    index("video_cache_expires_idx").on(t.expiresAt),
    index("video_cache_kind_idx").on(t.kind),
  ],
);

export const watchQueue = sqliteTable(
  "watch_queue",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    videoId: text("video_id").notNull(),
    title: text("title").notNull(),
    channelId: text("channel_id"),
    position: integer("position").notNull(),
    addedAt: integer("added_at").notNull(),
  },
  (t) => [
    uniqueIndex("watch_queue_user_video_uidx").on(t.userId, t.videoId),
    index("watch_queue_user_pos_idx").on(t.userId, t.position),
  ],
);
