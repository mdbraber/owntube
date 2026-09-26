import { and, eq, gt } from "drizzle-orm";
import type { AppDb } from "@/server/db/client";
import { watchHistory } from "@/server/db/schema";
import { runHooks } from "@/server/hooks/run-hooks";

/**
 * Reconciliation sweep: re-fire hooks for recent watch history with
 * OT_SOURCE=replay. Hooks are idempotent by contract, so re-delivery is
 * harmless in steady state and heals a receiver that was down when the live
 * events fired (e.g. pocket-sessions — its ahead-only guard drops everything
 * it already knows). Runs from the in-app feed publisher (publish-loop.ts) once per publish interval.
 */
export async function replayRecentHistory(
  db: AppDb,
  opts: { sinceHours?: number; onLog?: (msg: string) => void } = {},
): Promise<{ replayed: number }> {
  if (!process.env.OWNTUBE_HOOKS_DIR?.trim()) return { replayed: 0 };

  const since = Math.floor(Date.now() / 1000) - (opts.sinceHours ?? 48) * 3600;
  const rows = db
    .select({
      videoId: watchHistory.videoId,
      channelId: watchHistory.channelId,
      positionSeconds: watchHistory.positionSeconds,
      completed: watchHistory.completed,
      videoDurationSeconds: watchHistory.videoDurationSeconds,
      videoTitle: watchHistory.videoTitle,
      channelName: watchHistory.channelName,
    })
    .from(watchHistory)
    .where(
      and(
        eq(watchHistory.isDeleted, 0),
        eq(watchHistory.isShort, 0),
        gt(watchHistory.startedAt, since),
      ),
    )
    .all();

  for (const row of rows) {
    await runHooks({
      event: row.completed === 1 ? "watched" : "progress",
      videoId: row.videoId,
      channelId: row.channelId ?? undefined,
      positionSeconds: row.positionSeconds,
      completed: row.completed === 1,
      durationSeconds: row.videoDurationSeconds,
      videoTitle: row.videoTitle ?? undefined,
      channelName: row.channelName ?? undefined,
      source: "replay",
    });
  }
  opts.onLog?.(
    `replay-history: ${rows.length} event(s) re-fired through hooks`,
  );
  return { replayed: rows.length };
}
