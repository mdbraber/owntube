import { TRPCError } from "@trpc/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { logger } from "@/lib/logger";
import { fetchVideoSummaries } from "@/server/catalog";
import { videoMemos } from "@/server/db/schema";
import {
  insertMemo,
  listMemos,
  memoBySource,
  memoCounts,
  memoOccurredAtSchema,
  memoSourceSchema,
  memoTextSchema,
  memoVideoIdSchema,
  ownedMemo,
  toVideoMemo,
} from "@/server/memos/memos";
import {
  addVideoToPlaylist,
  isOwnedPlaylist,
  playlistIdByName,
} from "@/server/playlists/add-item";
import { protectedProcedure, router } from "@/server/trpc/init";

function nowUnix(): number {
  return Math.floor(Date.now() / 1000);
}

const memoIdSchema = z.number().int().positive();

const addMemoInputSchema = z
  .object({
    videoId: memoVideoIdSchema,
    channelId: z.string().min(1).max(128).optional(),
    text: memoTextSchema,
    occurredAt: memoOccurredAtSchema.optional(),
    /** Omitted: a memo typed in OwnTube (`direct`). */
    source: memoSourceSchema.optional(),
    /** Also add the video to this playlist of the user's… */
    playlistId: z.number().int().positive().optional(),
    /**
     * …or to the user's playlist with this name (case-insensitive), created
     * when there is none, so an automation needs no playlist id.
     */
    playlistName: z.string().trim().min(1).max(120).optional(),
    /** What the client already knows about the video; saves a lookup. */
    videoTitle: z.string().trim().min(1).max(500).optional(),
    channelName: z.string().trim().min(1).max(200).optional(),
  })
  .refine((v) => v.playlistId === undefined || v.playlistName === undefined, {
    message: "Give playlistId or playlistName, not both.",
  });

type VideoFacts = {
  videoTitle: string | null;
  channelName: string | null;
  channelId: string | null;
};

/**
 * Title and channel for the memo row, so library search can find the video
 * later. An automation usually sends only the id: look it up once (best
 * effort — the memo is stored either way).
 */
async function videoFacts(input: {
  videoId: string;
  channelId?: string;
  videoTitle?: string;
  channelName?: string;
}): Promise<VideoFacts> {
  const known: VideoFacts = {
    videoTitle: input.videoTitle ?? null,
    channelName: input.channelName ?? null,
    channelId: input.channelId ?? null,
  };
  if (known.videoTitle && known.channelName && known.channelId) return known;
  try {
    const v = (await fetchVideoSummaries([input.videoId])).get(input.videoId);
    return {
      videoTitle: known.videoTitle ?? v?.title ?? null,
      channelName: known.channelName ?? v?.channelName ?? null,
      channelId: known.channelId ?? v?.channelId ?? null,
    };
  } catch (error) {
    logger.warn("memos.video_lookup_failed", {
      videoId: input.videoId,
      error: error instanceof Error ? error.message : String(error),
    });
    return known;
  }
}

export const memosRouter = router({
  /** The user's memos on one video, oldest first. */
  list: protectedProcedure
    .input(z.object({ videoId: memoVideoIdSchema }))
    .query(({ ctx, input }) => listMemos(ctx.db, ctx.userId, input.videoId)),

  /** Memo count + latest memo text per video, for the card markers. */
  counts: protectedProcedure
    .input(z.object({ videoIds: z.array(z.string().min(1).max(64)).max(200) }))
    .query(({ ctx, input }) => memoCounts(ctx.db, ctx.userId, input.videoIds)),

  /**
   * Add a memo. One with the same source URL and video is returned unchanged (`created:
   * false`), so retries are harmless. With `playlistId` or `playlistName`, the
   * video is added to that playlist as well (already there: left alone).
   */
  add: protectedProcedure
    .input(addMemoInputSchema)
    .mutation(async ({ ctx, input }) => {
      if (
        input.playlistId !== undefined &&
        !isOwnedPlaylist(ctx.db, ctx.userId, input.playlistId)
      ) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "No such playlist.",
        });
      }
      const ts = nowUnix();
      const source = input.source ?? { kind: "direct" as const };
      const existing =
        source.kind === "direct"
          ? undefined
          : memoBySource(ctx.db, ctx.userId, source.url, input.videoId);
      // A retry of a stored source memo needs no lookup.
      const facts = existing
        ? {
            videoTitle: null,
            channelName: null,
            channelId: input.channelId ?? null,
          }
        : await videoFacts(input);
      const { memo, created } = insertMemo(
        ctx.db,
        ctx.userId,
        {
          videoId: input.videoId,
          channelId: facts.channelId,
          text: input.text,
          occurredAt: input.occurredAt ?? ts,
          source,
          videoTitle: facts.videoTitle,
          channelName: facts.channelName,
        },
        ts,
      );
      const playlistId =
        input.playlistId ??
        (input.playlistName !== undefined
          ? playlistIdByName(ctx.db, ctx.userId, input.playlistName, ts)
          : undefined);
      const addedToPlaylist =
        playlistId !== undefined &&
        addVideoToPlaylist(
          ctx.db,
          ctx.userId,
          { playlistId, videoId: memo.videoId, channelId: memo.channelId },
          ts,
        );
      return { memo, created, addedToPlaylist };
    }),

  /** Edit a memo typed in OwnTube. Source memos are quotes: read-only. */
  update: protectedProcedure
    .input(z.object({ id: memoIdSchema, text: memoTextSchema }))
    .mutation(({ ctx, input }) => {
      const row = ownedMemo(ctx.db, ctx.userId, input.id);
      if (!row) {
        throw new TRPCError({ code: "NOT_FOUND", message: "No such memo." });
      }
      if (row.sourceKind !== "direct") {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Memos from Slack or a link are quotes and can't be edited.",
        });
      }
      const updated = ctx.db
        .update(videoMemos)
        .set({ text: input.text, updatedAt: nowUnix() })
        .where(
          and(eq(videoMemos.id, input.id), eq(videoMemos.userId, ctx.userId)),
        )
        .returning()
        .get();
      return toVideoMemo(updated ?? row);
    }),

  /** Delete any of the user's memos; returns it (the client's Undo re-adds it). */
  remove: protectedProcedure
    .input(z.object({ id: memoIdSchema }))
    .mutation(({ ctx, input }) => {
      const row = ownedMemo(ctx.db, ctx.userId, input.id);
      if (!row) {
        throw new TRPCError({ code: "NOT_FOUND", message: "No such memo." });
      }
      ctx.db
        .delete(videoMemos)
        .where(
          and(eq(videoMemos.id, input.id), eq(videoMemos.userId, ctx.userId)),
        )
        .run();
      return toVideoMemo(row);
    }),
});
