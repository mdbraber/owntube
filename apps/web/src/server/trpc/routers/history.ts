import { and, desc, eq, like, or } from "drizzle-orm";
import { z } from "zod";
import { fetchVideoSummaries } from "@/server/catalog";
import { readChannelMetaByIds } from "@/server/channel-meta/store";
import { watchHistory } from "@/server/db/schema";
import { fireHooks } from "@/server/hooks/run-hooks";
import { removeWatchedFromQueue } from "@/server/queue/remove-watched";
import { clearRecommendationCachesForUser } from "@/server/recommendation/engine";
import { loadWatchedVideoIdsForRecommendations } from "@/server/recommendation/watched-videos";
import { protectedProcedure, router } from "@/server/trpc/init";

const historyEventInputSchema = z.object({
  videoId: z.string().min(5).max(64),
  channelId: z.string().min(1).max(128),
  durationWatched: z
    .number()
    .int()
    .min(0)
    .max(60 * 60 * 24)
    .default(0),
  /** Real playback position (video.currentTime) for resume; omitted/0 keeps the saved one. */
  positionSeconds: z
    .number()
    .int()
    .min(0)
    .max(60 * 60 * 24)
    .optional(),
  completed: z.boolean().default(false),
  /** Total video length; 0 = unknown. Rows with 0 are excluded from engagement-weighted signals. */
  videoDurationSeconds: z
    .number()
    .int()
    .min(0)
    .max(60 * 60 * 24)
    .default(0),
  /** Recorded from the Shorts feed — kept out of the long-form recommendation signal. */
  isShort: z.boolean().default(false),
  /** Denormalized for history search/display; absent on events from callers without detail loaded. */
  videoTitle: z.string().trim().min(1).max(300).optional(),
  channelName: z.string().trim().min(1).max(200).optional(),
});

const historyPageInputSchema = z.object({
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(20),
  q: z.string().trim().max(128).optional(),
  /** Exclude videos watched to completion / marked watched. */
  hideWatched: z.boolean().default(false),
});

function nowUnix(): number {
  return Math.floor(Date.now() / 1000);
}

export const historyRouter = router({
  watchedVideoIds: protectedProcedure.query(({ ctx }) => {
    return [...loadWatchedVideoIdsForRecommendations(ctx.db, ctx.userId)];
  }),
  upsertEvent: protectedProcedure
    .input(historyEventInputSchema)
    .mutation(async ({ ctx, input }) => {
      const ts = nowUnix();
      const recent = ctx.db
        .select()
        .from(watchHistory)
        .where(
          and(
            eq(watchHistory.userId, ctx.userId),
            eq(watchHistory.videoId, input.videoId),
            eq(watchHistory.isDeleted, 0),
          ),
        )
        .orderBy(desc(watchHistory.startedAt))
        .limit(1)
        .all()[0];

      // A video keeps a single history row: re-watching updates that row and
      // bumps startedAt so it moves to the top (last-watched wins), rather than
      // appending a duplicate.
      if (recent) {
        const duration = Math.max(
          recent.durationWatched,
          input.durationWatched,
        );
        const completed = recent.completed || (input.completed ? 1 : 0);
        // Position is the *latest* known playback point (unlike max-merged
        // duration). A 0/absent value keeps the saved one so the mount-time
        // event can't wipe a resume point before playback starts.
        const positionSeconds =
          input.positionSeconds && input.positionSeconds > 0
            ? input.positionSeconds
            : recent.positionSeconds;
        ctx.db
          .update(watchHistory)
          .set({
            startedAt: ts,
            durationWatched: duration,
            positionSeconds,
            completed,
            videoDurationSeconds: Math.max(
              recent.videoDurationSeconds,
              input.videoDurationSeconds,
            ),
            videoTitle: recent.videoTitle ?? input.videoTitle ?? null,
            channelName: recent.channelName ?? input.channelName ?? null,
            createdAt: ts,
          })
          .where(eq(watchHistory.id, recent.id))
          .run();
        let dequeued = false;
        if (input.completed) {
          dequeued =
            removeWatchedFromQueue(ctx.db, ctx.userId, [input.videoId]).length >
            0;
          clearRecommendationCachesForUser(ctx.userId);
        }
        if (!input.isShort) {
          fireHooks({
            event: completed === 1 ? "watched" : "progress",
            videoId: input.videoId,
            channelId: input.channelId,
            positionSeconds,
            completed: completed === 1,
            durationSeconds: Math.max(
              recent.videoDurationSeconds,
              input.videoDurationSeconds,
            ),
            videoTitle: recent.videoTitle ?? input.videoTitle,
            channelName: recent.channelName ?? input.channelName,
            source: "live",
          });
        }
        return { id: recent.id, updated: true, dequeued };
      }

      const inserted = ctx.db
        .insert(watchHistory)
        .values({
          userId: ctx.userId,
          videoId: input.videoId,
          channelId: input.channelId,
          startedAt: ts,
          durationWatched: input.durationWatched,
          positionSeconds: input.positionSeconds ?? 0,
          completed: input.completed ? 1 : 0,
          videoDurationSeconds: input.videoDurationSeconds,
          isDeleted: 0,
          isShort: input.isShort ? 1 : 0,
          videoTitle: input.videoTitle ?? null,
          channelName: input.channelName ?? null,
          createdAt: ts,
        })
        .returning({ id: watchHistory.id })
        .get();
      let dequeued = false;
      if (input.completed) {
        dequeued =
          removeWatchedFromQueue(ctx.db, ctx.userId, [input.videoId]).length >
          0;
        clearRecommendationCachesForUser(ctx.userId);
      }
      if (!input.isShort) {
        fireHooks({
          event: input.completed ? "watched" : "progress",
          videoId: input.videoId,
          channelId: input.channelId,
          positionSeconds: input.positionSeconds ?? 0,
          completed: !!input.completed,
          durationSeconds: input.videoDurationSeconds,
          videoTitle: input.videoTitle,
          channelName: input.channelName,
          source: "live",
        });
      }
      return { id: inserted.id, updated: false, dequeued };
    }),
  /**
   * Lightweight watch-progress map source: newest row per video is resolved
   * client-side (rows arrive newest first). Backs the thumbnail progress bars
   * on cards/rows everywhere, so it stays id + numbers only.
   */
  progressAll: protectedProcedure.query(({ ctx }) => {
    return ctx.db
      .select({
        videoId: watchHistory.videoId,
        positionSeconds: watchHistory.positionSeconds,
        durationWatched: watchHistory.durationWatched,
        videoDurationSeconds: watchHistory.videoDurationSeconds,
        completed: watchHistory.completed,
      })
      .from(watchHistory)
      .where(
        and(eq(watchHistory.userId, ctx.userId), eq(watchHistory.isDeleted, 0)),
      )
      .orderBy(desc(watchHistory.startedAt))
      .limit(3000)
      .all();
  }),

  list: protectedProcedure
    .input(historyPageInputSchema)
    .query(async ({ ctx, input }) => {
      const offset = (input.page - 1) * input.pageSize;
      const q = input.q?.trim();
      const baseWhere = and(
        eq(watchHistory.userId, ctx.userId),
        eq(watchHistory.isDeleted, 0),
        input.hideWatched ? eq(watchHistory.completed, 0) : undefined,
      );
      const where = q
        ? and(
            baseWhere,
            or(
              like(watchHistory.videoTitle, `%${q}%`),
              like(watchHistory.channelName, `%${q}%`),
              like(watchHistory.videoId, `%${q}%`),
              like(watchHistory.channelId, `%${q}%`),
            ),
          )
        : baseWhere;
      const rows = ctx.db
        .select({
          id: watchHistory.id,
          videoId: watchHistory.videoId,
          channelId: watchHistory.channelId,
          startedAt: watchHistory.startedAt,
          durationWatched: watchHistory.durationWatched,
          videoDurationSeconds: watchHistory.videoDurationSeconds,
          completed: watchHistory.completed,
          videoTitle: watchHistory.videoTitle,
          channelName: watchHistory.channelName,
        })
        .from(watchHistory)
        .where(where)
        .orderBy(desc(watchHistory.startedAt))
        .limit(input.pageSize)
        .offset(offset)
        .all();
      // Channel avatars come from the local channel_meta cache in one read.
      const metaById = readChannelMetaByIds(ctx.db, [
        ...new Set(rows.map((r) => r.channelId)),
      ]);
      // Rows from before titles were stored: one batch call for all of them.
      const byId = await fetchVideoSummaries(
        rows.filter((r) => !r.videoTitle).map((r) => r.videoId),
      ).catch(() => new Map());
      const enriched = rows.map((row) => {
        const meta = metaById.get(row.channelId);
        const channelAvatarUrl = meta?.avatarUrl ?? undefined;
        // A row without a denormalized name (older rows) borrows the cached
        // channel name. Never the channel id: clients print this under the title.
        const cachedChannelName = row.channelName ?? meta?.channelName;
        // Rows written since titles were denormalized need no upstream call;
        // the client derives the thumbnail from videoId.
        if (row.videoTitle) {
          return {
            ...row,
            videoTitle: row.videoTitle,
            thumbnailUrl: undefined as string | undefined,
            channelName: cachedChannelName,
            channelAvatarUrl,
          };
        }
        const v = byId.get(row.videoId);
        return {
          ...row,
          videoTitle: v?.title ?? row.videoId,
          thumbnailUrl: v?.thumbnailUrl as string | undefined,
          channelName: v?.channelName ?? cachedChannelName,
          channelAvatarUrl: v?.channelAvatarUrl ?? channelAvatarUrl,
        };
      });
      return enriched;
    }),
  /**
   * Forget where a video was left off, keeping the entry itself. The TV's
   * Continue watching row is driven by the saved position, so this is what
   * "remove from Continue watching" does — the video stays in History, it
   * just stops being offered to resume.
   */
  clearProgress: protectedProcedure
    .input(z.object({ videoId: z.string().min(5).max(64) }))
    .mutation(({ ctx, input }) => {
      ctx.db
        .update(watchHistory)
        .set({ positionSeconds: 0 })
        .where(
          and(
            eq(watchHistory.videoId, input.videoId),
            eq(watchHistory.userId, ctx.userId),
          ),
        )
        .run();
      return { ok: true };
    }),

  softDelete: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(({ ctx, input }) => {
      ctx.db
        .update(watchHistory)
        .set({ isDeleted: 1 })
        .where(
          and(
            eq(watchHistory.id, input.id),
            eq(watchHistory.userId, ctx.userId),
          ),
        )
        .run();
      return { ok: true };
    }),
});
