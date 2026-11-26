import type { UnifiedVideo } from "@web/server/catalog/types";
import type { WatchProgress } from "@/lib/watch-progress";

/**
 * Where "Play all" starts: the first video not yet finished, so a half-watched
 * playlist picks up where it was left rather than replaying the start.
 */
export function playAllStart(
  videos: UnifiedVideo[],
  progress: (videoId: string) => WatchProgress | null,
): UnifiedVideo | undefined {
  return videos.find((v) => !progress(v.videoId)?.completed) ?? videos[0];
}
