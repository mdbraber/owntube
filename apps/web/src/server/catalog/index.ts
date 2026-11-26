import { GatewayError, isNotCached } from "@owntube/contracts/client";
import type { VideoDetail as GatewayVideoDetail } from "@owntube/contracts/model";
import type {
  ChannelPageInput,
  ChannelPageResult,
  RelatedVideosResult,
  SearchVideosInput,
  SearchVideosResult,
  TrendingInput,
  TrendingVideosResult,
  UnifiedVideo,
  VideoCommentsInput,
  VideoCommentsResult,
  VideoDetail,
} from "@/server/catalog/types";
import { UpstreamAgeRestrictedError } from "@/server/errors/upstream-age-restricted";
import { UpstreamLiveUpcomingError } from "@/server/errors/upstream-live-upcoming";
import { UpstreamUnavailableError } from "@/server/errors/upstream-unavailable";
import {
  SIGN_IN_REQUIRED_REASON,
  UpstreamVideoUnavailableError,
} from "@/server/errors/upstream-video-unavailable";
import { gateway } from "@/server/gateway/client";
import {
  largestImage,
  toUnifiedChannel,
  toUnifiedComment,
  toUnifiedVideo,
  toVideoDetail,
} from "@/server/gateway/map";
import { signedVideoPage } from "@/server/gateway/playback";

/**
 * YouTube's catalogue for the web app, read from the gateway. The gateway
 * caches (fresh, stale on failure, shared misses), so nothing here does.
 */

/** A `cache: "only"` read found nothing; the caller renders without it. */
export class CatalogNotCachedError extends Error {
  readonly name = "CatalogNotCachedError";
}

export type CacheMode = { cache?: "only" | "refresh" };

/** The gateway's failures as the web app's typed errors. */
function rethrow(error: unknown): never {
  if (isNotCached(error)) throw new CatalogNotCachedError("not cached");
  if (error instanceof GatewayError) {
    if (error.status === 400)
      throw new UpstreamVideoUnavailableError("This link is not valid.");
    throw new UpstreamUnavailableError(
      `YouTube is unavailable right now. Try again later. (${error.message})`,
    );
  }
  throw error;
}

async function call<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    rethrow(error);
  }
}

function throwIfUnplayable(d: GatewayVideoDetail): void {
  const u = d.unplayable;
  if (!u) return;
  switch (u.kind) {
    case "age-restricted":
      throw new UpstreamAgeRestrictedError(
        "This video is age-restricted, and OwnTube watches without an account.",
        d.videoId,
      );
    case "upcoming":
      throw new UpstreamLiveUpcomingError(
        u.reason,
        d.videoId,
        d.startsAt === undefined ? undefined : Math.floor(d.startsAt / 1000),
      );
    case "login-required":
      throw new UpstreamVideoUnavailableError(
        SIGN_IN_REQUIRED_REASON,
        d.videoId,
      );
    case "bot-check":
      throw new UpstreamUnavailableError(
        "YouTube is checking OwnTube for bots right now. Try again in a while.",
      );
    default:
      throw new UpstreamVideoUnavailableError(u.reason, d.videoId);
  }
}

/** A video page with signed playback URLs; throws why YouTube will not play it. */
export async function fetchVideoDetail(
  input: { videoId: string },
  opts: CacheMode = {},
): Promise<VideoDetail> {
  const d = await call(() => gateway().video(input.videoId, opts));
  throwIfUnplayable(d);
  const signed = await signedVideoPage(d.videoId, {
    live: d.live === "live" || d.live === "post-live",
  });
  return toVideoDetail(d, signed);
}

/** List-row summaries by id, for stored lists (queue, history, saved, playlists). */
export async function fetchVideoSummaries(
  videoIds: readonly string[],
  opts: CacheMode = {},
): Promise<Map<string, UnifiedVideo>> {
  const out = new Map<string, UnifiedVideo>();
  const ids = [...new Set(videoIds)];
  for (let i = 0; i < ids.length; i += 100) {
    const batch = ids.slice(i, i + 100);
    const videos = await call(() => gateway().videos(batch, opts));
    for (const v of videos) out.set(v.videoId, toUnifiedVideo(v));
  }
  return out;
}

/** YouTube's own related list (on the video page). */
export async function fetchRelatedVideos(
  input: { videoId: string },
  limit = 20,
): Promise<RelatedVideosResult> {
  const d = await call(() => gateway().video(input.videoId));
  return { videos: d.related.map(toUnifiedVideo).slice(0, limit) };
}

export async function fetchVideoComments(
  input: VideoCommentsInput,
  opts: CacheMode = {},
): Promise<VideoCommentsResult> {
  const page = await call(() =>
    gateway().comments(input.videoId, {
      sort: input.sortBy,
      ...(input.continuation ? { continuation: input.continuation } : {}),
      ...opts,
    }),
  );
  return {
    videoId: input.videoId,
    comments: page.comments.map(toUnifiedComment),
    continuation: page.continuation ?? null,
    commentCount: page.count?.value,
  };
}

export async function searchVideos(
  input: SearchVideosInput,
): Promise<SearchVideosResult> {
  const page = await call(() =>
    gateway().search(input.q, {
      ...(input.date ? { uploadDate: input.date } : {}),
      ...(input.continuation ? { continuation: input.continuation } : {}),
    }),
  );
  const videos = page.videos.map(toUnifiedVideo);
  return {
    videos: input.limit ? videos.slice(0, input.limit) : videos,
    channels: page.channels.map(toUnifiedChannel),
    continuation: page.continuation ?? null,
  };
}

/** YouTube's Live page (what Invidious called trending). */
export async function fetchTrendingVideos(
  input: Partial<TrendingInput> = {},
  opts: CacheMode = {},
): Promise<TrendingVideosResult> {
  const page = await call(() => gateway().live(opts));
  const videos = page.videos.map(toUnifiedVideo);
  return { videos: input.limit ? videos.slice(0, input.limit) : videos };
}

const UCID_RE = /^UC[0-9A-Za-z_-]{22}$/;

/**
 * Decode a channel token that may arrive percent-encoded from the URL path
 * (Next does not reliably decode the dynamic segment, so "@" can reach us as
 * "%40", or double-encoded).
 */
export function normalizeChannelToken(raw: string): string {
  let s = raw.trim();
  for (let i = 0; i < 3 && /%[0-9a-fA-F]{2}/.test(s); i++) {
    try {
      const decoded = decodeURIComponent(s);
      if (decoded === s) break;
      s = decoded;
    } catch {
      break;
    }
  }
  return s;
}

/** A `UC…` id for a channel id, `@handle`, or custom/user name; undefined when YouTube knows none. */
export async function resolveChannelId(
  token: string,
): Promise<string | undefined> {
  const t = normalizeChannelToken(token);
  if (UCID_RE.test(t)) return t;
  const bare = t.replace(/^@/, "");
  const forms = t.startsWith("@")
    ? [`https://www.youtube.com/@${bare}`]
    : [
        `https://www.youtube.com/@${bare}`,
        `https://www.youtube.com/c/${bare}`,
        `https://www.youtube.com/user/${bare}`,
      ];
  for (const url of forms) {
    const id = await call(() => gateway().resolveChannel(url)).catch(
      () => null,
    );
    if (id && UCID_RE.test(id)) return id;
  }
  return undefined;
}

export async function fetchChannelPage(
  input: ChannelPageInput,
  opts: CacheMode = {},
): Promise<ChannelPageResult> {
  const channelId =
    (await resolveChannelId(input.channelId)) ?? input.channelId;
  if (!UCID_RE.test(channelId))
    throw new UpstreamVideoUnavailableError("This channel does not exist.");
  const page = await call(() =>
    gateway().channel(channelId, {
      tab: input.tab ?? "videos",
      ...(input.continuation ? { continuation: input.continuation } : {}),
      ...opts,
    }),
  );
  const c = page.channel;
  return {
    channelId,
    name: c?.name,
    description: c?.description,
    avatarUrl: c ? largestImage(c.avatars) : undefined,
    bannerUrl: c ? largestImage(c.banners) : undefined,
    subscriberCount: c?.subscribers?.value,
    // Members-only uploads are listed like any other, but cannot be watched anonymously.
    videos: page.videos.filter((v) => !v.membersOnly).map(toUnifiedVideo),
    continuation: page.continuation ?? null,
  };
}

export type ChannelPlaylistSummary = {
  playlistId: string;
  title: string;
  thumbnailUrl: string | null;
  videoCount: number | null;
};

/** The channel's public playlists (first page). */
export async function fetchChannelPlaylists(input: {
  channelId: string;
}): Promise<{ playlists: ChannelPlaylistSummary[] }> {
  const page = await call(() =>
    gateway().channel(input.channelId, { tab: "playlists" }),
  );
  return {
    playlists: page.playlists.map((p) => ({
      playlistId: p.playlistId,
      title: p.title,
      thumbnailUrl: largestImage(p.thumbnails) ?? null,
      videoCount: p.videoCount ?? null,
    })),
  };
}

export type YtPlaylistResult = {
  playlistId: string;
  title: string;
  channelId: string | null;
  channelName: string | null;
  videos: UnifiedVideo[];
  continuation: string | null;
};

export async function fetchYtPlaylist(input: {
  playlistId: string;
  continuation?: string;
}): Promise<YtPlaylistResult> {
  const page = await call(() =>
    gateway().playlist(
      input.playlistId,
      input.continuation ? { continuation: input.continuation } : {},
    ),
  );
  return {
    playlistId: input.playlistId,
    title: page.playlist?.title ?? "",
    channelId: page.playlist?.channel?.channelId ?? null,
    channelName: page.playlist?.channel?.name ?? null,
    videos: page.videos.map(toUnifiedVideo),
    continuation: page.continuation ?? null,
  };
}

/** Channels the channel features on its home tab. */
export async function fetchFeaturedChannels(channelId: string) {
  const page = await call(() => gateway().channel(channelId));
  return page.channel?.featuredChannels.map(toUnifiedChannel) ?? [];
}

export async function fetchSearchSuggestions(q: string): Promise<string[]> {
  const query = q.trim();
  if (!query) return [];
  return call(() => gateway().suggestions(query));
}
