import { z } from "zod";

export const searchVideosInputSchema = z.object({
  q: z.string().min(1).max(500),
  limit: z.number().int().min(1).max(50).optional(),
  continuation: z.string().max(4096).optional(),
  /** ISO 3166-1 alpha-2 — Invidious search; optional hint for Piped. */
  region: z.string().length(2).optional(),
});

export type SearchVideosInput = z.infer<typeof searchVideosInputSchema>;

export const unifiedVideoSchema = z.object({
  videoId: z.string(),
  title: z.string(),
  channelId: z.string().optional(),
  channelName: z.string().optional(),
  /** Channel / uploader avatar from upstream (absolute URL). */
  channelAvatarUrl: z.string().optional(),
  thumbnailUrl: z.string().optional(),
  durationSeconds: z.number().optional(),
  viewCount: z.number().optional(),
  publishedText: z.string().optional(),
  /** Unix seconds when known from upstream (Invidious `published`, Piped `uploaded`, …). */
  publishedAt: z.number().optional(),
  /** Active live broadcast (Piped `livestream`, Invidious `liveNow`). */
  isLive: z.boolean().optional(),
  /** Scheduled premiere not started yet (Invidious `isUpcoming`). */
  isUpcoming: z.boolean().optional(),
});

export type UnifiedVideo = z.infer<typeof unifiedVideoSchema>;

export const unifiedChannelSchema = z.object({
  channelId: z.string(),
  name: z.string(),
  avatarUrl: z.string().optional(),
  subscriberCount: z.number().optional(),
  description: z.string().optional(),
});

export type UnifiedChannel = z.infer<typeof unifiedChannelSchema>;

export const searchVideosResultSchema = z.object({
  videos: z.array(unifiedVideoSchema),
  channels: z.array(unifiedChannelSchema).optional(),
  continuation: z.string().nullable().optional(),
  sourceUsed: z.enum(["piped", "invidious", "cache"]),
  warning: z.string().optional(),
  stale: z.boolean().optional(),
});

export const cachedSearchPayloadSchema = z.object({
  videos: z.array(unifiedVideoSchema),
  channels: z.array(unifiedChannelSchema).optional(),
  continuation: z.string().nullable().optional(),
  sourceUsed: z.enum(["piped", "invidious"]),
});

export type SearchVideosResult = z.infer<typeof searchVideosResultSchema>;

export const upstreamPlaybackSourceSchema = z.enum(["piped", "invidious"]);

export type UpstreamPlaybackSource = z.infer<
  typeof upstreamPlaybackSourceSchema
>;

export const videoDetailInputSchema = z.object({
  videoId: z.string().min(11).max(20),
  /** Force live playback catalog from this upstream when both are configured. */
  preferUpstream: upstreamPlaybackSourceSchema.optional(),
});

export type VideoDetailInput = z.infer<typeof videoDetailInputSchema>;

export const videoStoryboardSchema = z.object({
  templateUrl: z.string().url(),
  thumbWidth: z.number().int().positive(),
  thumbHeight: z.number().int().positive(),
  count: z.number().int().positive(),
  intervalMs: z.number().int().positive(),
  columns: z.number().int().positive(),
  rows: z.number().int().positive(),
  storyboardCount: z.number().int().positive(),
});

export type VideoStoryboard = z.infer<typeof videoStoryboardSchema>;

export const streamSourceSchema = z.object({
  url: z.string().url(),
  mimeType: z.string().optional(),
  quality: z.string().optional(),
  /** Bitrate in bits per second (Invidious/Piped `bitrate`). */
  bitrate: z.number().finite().nonnegative().optional(),
  /** Frames per second when upstream provides it. */
  fps: z.number().positive().optional(),
  /** Video height in pixels when upstream provides it (0 = no video plane). */
  height: z.number().finite().nonnegative().optional(),
  /** BCP-47 / YouTube audio track id prefix when provided by upstream. */
  language: z.string().optional(),
  /** Invidious `audioTrack.displayName` when present. */
  audioTrackDisplayName: z.string().optional(),
  /**
   * True when this URL is video-only (YouTube/Invidious adaptive) and must not
   * be used alone in a single &lt;video src&gt; — no muxed audio.
   */
  videoOnly: z.boolean().optional(),
});

export const videoDetailSchema = z.object({
  videoId: z.string(),
  title: z.string(),
  description: z.string().optional(),
  channelId: z.string().optional(),
  channelName: z.string().optional(),
  channelAvatarUrl: z.string().optional(),
  channelSubscriberCount: z.number().optional(),
  /** Piped `/streams` may embed `relatedStreams` on the same payload. */
  relatedVideos: z.array(unifiedVideoSchema).optional(),
  storyboard: videoStoryboardSchema.optional(),
  thumbnailUrl: z.string().optional(),
  durationSeconds: z.number().int().optional(),
  viewCount: z.number().optional(),
  publishedText: z.string().optional(),
  /** Unix seconds when known from upstream (Invidious `published`, Piped `uploadDate`, …). */
  publishedAt: z.number().optional(),
  isLive: z.boolean().optional(),
  isUpcoming: z.boolean().optional(),
  hlsUrl: z.string().url().optional(),
  dashUrl: z.string().url().optional(),
  audioSources: z.array(streamSourceSchema),
  videoSources: z.array(streamSourceSchema),
  sourceUsed: z.enum(["piped", "invidious", "cache"]),
  /** Piped `/streams` `proxyUrl` — used to validate same-origin media proxy targets. */
  mediaProxyBase: z.string().url().optional(),
  warning: z.string().optional(),
  stale: z.boolean().optional(),
});

export type VideoDetail = z.infer<typeof videoDetailSchema>;

export const relatedVideosResultSchema = z.object({
  videos: z.array(unifiedVideoSchema),
  sourceUsed: z.enum(["piped", "invidious", "cache"]),
  warning: z.string().optional(),
  stale: z.boolean().optional(),
});

export type RelatedVideosResult = z.infer<typeof relatedVideosResultSchema>;

export const commentSortSchema = z.enum(["top", "new"]);

export type CommentSort = z.infer<typeof commentSortSchema>;

export const unifiedCommentSchema = z.object({
  commentId: z.string(),
  author: z.string(),
  authorId: z.string().optional(),
  text: z.string(),
  publishedText: z.string().optional(),
  authorAvatarUrl: z.string().optional(),
  likeCount: z.number().int().nonnegative().optional(),
  isPinned: z.boolean().optional(),
  isHearted: z.boolean().optional(),
  isVerified: z.boolean().optional(),
  replyCount: z.number().int().nonnegative().optional(),
});

export type UnifiedComment = z.infer<typeof unifiedCommentSchema>;

export const videoCommentsInputSchema = z.object({
  videoId: z.string().min(11).max(20),
  sortBy: commentSortSchema.default("top"),
  continuation: z.string().max(16384).optional(),
});

export type VideoCommentsInput = z.infer<typeof videoCommentsInputSchema>;

export const videoCommentsResultSchema = z.object({
  videoId: z.string(),
  comments: z.array(unifiedCommentSchema),
  disabled: z.boolean().optional(),
  continuation: z.string().nullable().optional(),
  commentCount: z.number().int().nonnegative().optional(),
  sourceUsed: z.enum(["piped", "invidious"]),
  warning: z.string().optional(),
});

export type VideoCommentsResult = z.infer<typeof videoCommentsResultSchema>;

/** Invidious `type` on `/api/v1/trending` (Piped often accepts the same query param). */
export const trendingVideoCategorySchema = z
  .enum(["music", "gaming", "movies"])
  .optional();

export const trendingInputSchema = z.object({
  region: z.string().length(2).default("US"),
  limit: z.number().int().min(1).max(60).optional(),
  category: trendingVideoCategorySchema,
});

export type TrendingInput = z.infer<typeof trendingInputSchema>;

export const trendingVideosResultSchema = z.object({
  videos: z.array(unifiedVideoSchema),
  sourceUsed: z.enum(["piped", "invidious", "cache"]),
  warning: z.string().optional(),
  stale: z.boolean().optional(),
});

export type TrendingVideosResult = z.infer<typeof trendingVideosResultSchema>;

export const shortsFeedPurposeSchema = z.enum(["feed", "shelf"]);

export type ShortsFeedPurpose = z.infer<typeof shortsFeedPurposeSchema>;

export const shortsFeedInputSchema = z.object({
  region: z.string().length(2).default("US"),
  limit: z.number().int().min(1).max(40).optional(),
  /** `shelf` = home teaser: one upstream page max, no pool rebuild on cache miss. */
  purpose: shortsFeedPurposeSchema.optional(),
  continuation: z.string().max(4096).optional(),
  /** Session scroll-past ids from the client (merged with watch history on the server). */
  excludeVideoIds: z.array(z.string().min(5).max(64)).max(200).optional(),
  /** Override regional viral queries (taste-based discovery). */
  discoveryQueries: z.array(z.string().min(1).max(128)).max(8).optional(),
});

export type ShortsFeedInput = z.infer<typeof shortsFeedInputSchema>;

export const shortsFeedResultSchema = z.object({
  videos: z.array(unifiedVideoSchema),
  continuation: z.string().nullable().optional(),
  sourceUsed: z.enum(["piped", "invidious", "cache"]),
  warning: z.string().optional(),
  stale: z.boolean().optional(),
});

export type ShortsFeedResult = z.infer<typeof shortsFeedResultSchema>;

export const cachedShortsFeedPayloadSchema = z.object({
  videos: z.array(unifiedVideoSchema),
  continuation: z.string().nullable().optional(),
  sourceUsed: z.enum(["piped", "invidious"]),
});

export const cachedTrendingPayloadSchema = z.object({
  videos: z.array(unifiedVideoSchema),
  sourceUsed: z.enum(["piped", "invidious"]),
});

export const channelTabSchema = z.enum(["videos", "shorts"]);

export type ChannelTab = z.infer<typeof channelTabSchema>;

export const channelPageInputSchema = z.object({
  channelId: z.string().min(3).max(128),
  tab: channelTabSchema.optional(),
  continuation: z.string().max(16384).optional(),
});

export type ChannelPageInput = z.infer<typeof channelPageInputSchema>;

export const channelPageResultSchema = z.object({
  channelId: z.string(),
  /** Absent on continuation-only pages (load more). */
  name: z.string().optional(),
  description: z.string().optional(),
  avatarUrl: z.string().optional(),
  bannerUrl: z.string().optional(),
  subscriberCount: z.number().optional(),
  videos: z.array(unifiedVideoSchema),
  continuation: z.string().nullable().optional(),
  sourceUsed: z.enum(["piped", "invidious", "cache"]),
  warning: z.string().optional(),
  stale: z.boolean().optional(),
});

export type ChannelPageResult = z.infer<typeof channelPageResultSchema>;

export const cachedChannelPayloadSchema = z.object({
  channelId: z.string(),
  name: z.string().optional(),
  description: z.string().optional(),
  avatarUrl: z.string().optional(),
  bannerUrl: z.string().optional(),
  subscriberCount: z.number().optional(),
  videos: z.array(unifiedVideoSchema),
  continuation: z.string().nullable().optional(),
  sourceUsed: z.enum(["piped", "invidious"]),
});
