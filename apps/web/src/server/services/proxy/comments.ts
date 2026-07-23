import { invidiousPortCollidesWithNextApp } from "@/lib/invidious-port-collision";
import type { AppDb } from "@/server/db/client";
import {
  readFreshCacheRow,
  readLatestCacheRow,
  registerInFlight,
  writeCache,
} from "@/server/services/proxy/cache";
import {
  type ProxySourceOverrides,
  resolveProxyBaseCandidates,
} from "@/server/services/proxy/config";
import {
  recordUpstreamFailure,
  throwIfUpstreamFailed,
} from "@/server/services/proxy/errors";
import { fetchJson } from "@/server/services/proxy/http";
import {
  channelIdFromPath,
  liveUpstreamSource,
  normalizeBaseUrl,
  resolveInvidiousAbsoluteMediaUrl,
  resolveInvidiousThumbnail,
} from "@/server/services/proxy/normalize";
import {
  type UnifiedComment,
  unifiedCommentSchema,
  type VideoCommentsInput,
  type VideoCommentsResult,
  videoCommentsResultSchema,
} from "@/server/services/proxy.types";
import { acquireUpstreamSlot } from "@/server/services/rate-limiter";

/**
 * Thrown by a cache-only comments read (SSR prefetch) when nothing is cached,
 * so the prefetch fails instead of seeding the query with empty data — the
 * client then fetches on mount as usual.
 */
export class CommentsCacheMissError extends Error {
  constructor() {
    super("comments cache-only miss");
    this.name = "CommentsCacheMissError";
  }
}

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

const inFlightComments = new Map<string, Promise<VideoCommentsResult>>();

export function clearCommentsInFlight(): void {
  inFlightComments.clear();
}

function commentsCacheKey(videoId: string, sortBy: string): string {
  return `comments:v1:${videoId}:${sortBy}`;
}

function readCommentsCacheRow(
  row: { payloadJson: string } | undefined,
): VideoCommentsResult | null {
  if (!row) return null;
  const parsed = videoCommentsResultSchema.safeParse(
    JSON.parse(row.payloadJson) as unknown,
  );
  return parsed.success ? parsed.data : null;
}

/**
 * First comment pages (no continuation) are cached in `video_cache` with
 * serve-stale-and-revalidate semantics, so the cache warmer can pre-fetch the
 * likely-next videos and the watch page's slowest interactive call becomes a
 * local read. Continuation pages stay live — they're an explicit "load more".
 */
export async function fetchVideoComments(
  db: AppDb,
  input: VideoCommentsInput,
  overrides?: ProxySourceOverrides,
  opts?: { cacheOnly?: boolean },
): Promise<VideoCommentsResult> {
  const continuationRequested = Boolean(input.continuation?.trim());
  if (continuationRequested) {
    if (opts?.cacheOnly) throw new CommentsCacheMissError();
    return fetchVideoCommentsLive(input, overrides);
  }

  const key = commentsCacheKey(input.videoId, input.sortBy);
  const fresh = readCommentsCacheRow(readFreshCacheRow(db, key));
  if (fresh) return fresh;

  // Cache-only (SSR prefetch): never block the watch page on an upstream
  // comments fetch. Serve stale if we have any; otherwise signal a miss so the
  // prefetch doesn't seed the query with empty data — the client fetches on
  // mount exactly as before.
  if (opts?.cacheOnly) {
    const stale = readCommentsCacheRow(readLatestCacheRow(db, key));
    if (stale) return stale;
    throw new CommentsCacheMissError();
  }

  const inFlight = inFlightComments.get(key);
  if (inFlight) return inFlight;
  const task = (async () => {
    const live = await fetchVideoCommentsLive(input, overrides);
    writeCache(db, key, liveUpstreamSource(live.sourceUsed), live, "comments");
    return live;
  })();
  registerInFlight(inFlightComments, key, task);

  const stale = readCommentsCacheRow(readLatestCacheRow(db, key));
  if (stale) return stale;
  return task;
}

async function fetchVideoCommentsLive(
  input: VideoCommentsInput,
  overrides?: ProxySourceOverrides,
): Promise<VideoCommentsResult> {
  const { pipedBases, invidiousBases } = resolveProxyBaseCandidates(overrides);
  const errors: string[] = [];
  const continuation = input.continuation?.trim() || undefined;

  let resolved: VideoCommentsResult | null = null;
  for (const invidiousBase of invidiousBases) {
    if (invidiousPortCollidesWithNextApp(invidiousBase)) {
      errors.push(
        "invidious:INVIDIOUS_BASE_URL port conflicts with Next.js PORT (server would call itself).",
      );
      continue;
    }
    try {
      acquireUpstreamSlot();
      const json = await fetchJson(
        buildInvidiousCommentsUrl(
          invidiousBase,
          input.videoId,
          input.sortBy,
          continuation,
        ),
        { source: "invidious", baseUrl: invidiousBase },
      );
      resolved = mapInvidiousComments(json, invidiousBase, input.videoId);
      break;
    } catch (error) {
      recordUpstreamFailure(error, "invidious", errors, invidiousBase);
    }
  }

  if (!resolved && input.sortBy === "top") {
    for (const pipedBase of pipedBases) {
      try {
        acquireUpstreamSlot();
        const url = continuation
          ? buildPipedCommentsNextUrl(pipedBase, input.videoId, continuation)
          : buildPipedCommentsUrl(pipedBase, input.videoId);
        const json = await fetchJson(url, {
          source: "piped",
          baseUrl: pipedBase,
        });
        resolved = mapPipedComments(json, pipedBase, input.videoId);
        break;
      } catch (error) {
        recordUpstreamFailure(error, "piped", errors, pipedBase);
      }
    }
  }

  if (!resolved) {
    throwIfUpstreamFailed(errors, "comments unavailable");
  }
  return resolved;
}
