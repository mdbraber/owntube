import type { UnifiedVideo } from "@web/server/catalog/types";
import { useMemo } from "react";
import { type CardMenuExtras, useCardMenu } from "@/components/CardMenu";
import { VideoRow } from "@/components/VideoRow";
import type { Nav } from "@/lib/navigation";
import { useScreenActive } from "@/lib/screen-active";
import { trpcClient } from "@/lib/trpc";
import { trpc } from "@/lib/trpc-react";
import {
  useInProgressIds,
  useWatchProgressRefresh,
} from "@/lib/watch-progress";

/** Recent history scanned for half-watched videos; the row shows at most this many. */
const HISTORY_SCAN = 60;
const ROW_LIMIT = 20;

/**
 * Videos started but not finished, newest first, each resuming where it was
 * left. Progress decides what belongs here; history.list only supplies the
 * titles, since the progress rows carry none.
 */
export function ContinueWatchingRow({
  nav,
  onCardFocusChange,
  onCardFocus,
  preferFirstFocus,
}: {
  nav: Nav;
  /** Bubbles card focus so Home can bring the row into view. */
  onCardFocusChange?: (focused: boolean) => void;
  /** The focused card, for Home's spotlight. */
  onCardFocus?: (video: UnifiedVideo) => void;
  /** Home's first row takes the first focus. */
  preferFirstFocus?: boolean;
}) {
  const inProgress = useInProgressIds();
  const { notify } = useCardMenu();
  const refreshProgress = useWatchProgressRefresh();
  const history = trpc.history.list.useQuery(
    { page: 1, pageSize: HISTORY_SCAN, hideWatched: true },
    { retry: 1, subscribed: useScreenActive() },
  );

  const videos = useMemo(() => {
    const rows = new Map(
      (history.data ?? []).map((row) => [row.videoId, row] as const),
    );
    const out: UnifiedVideo[] = [];
    for (const videoId of inProgress) {
      const row = rows.get(videoId);
      if (!row) continue;
      out.push({
        videoId,
        title: row.videoTitle,
        thumbnailUrl: row.thumbnailUrl,
        channelName: row.channelName,
        channelAvatarUrl: row.channelAvatarUrl,
        durationSeconds: row.videoDurationSeconds || undefined,
      });
      if (out.length >= ROW_LIMIT) break;
    }
    return out;
  }, [history.data, inProgress]);

  // Long press offers to drop a video from the row. The saved position is
  // what puts it here, so clearing that is enough — the video stays in
  // History, it just stops being offered to resume.
  const menuExtras: CardMenuExtras = (video) => [
    {
      key: "forget",
      label: "Remove from Continue watching",
      onPress: () => {
        trpcClient.history.clearProgress
          .mutate({ videoId: video.videoId })
          .then(() => {
            notify("Removed from Continue watching");
            refreshProgress();
          })
          .catch(() => notify("Couldn't remove it"));
      },
    },
  ];

  if (videos.length === 0) return null;
  return (
    <VideoRow
      title="Continue watching"
      videos={videos}
      menuExtras={menuExtras}
      preferFirstFocus={preferFirstFocus}
      onCardFocusChange={(focused, video) => {
        onCardFocusChange?.(focused);
        if (focused && video) onCardFocus?.(video);
      }}
      onSelect={(videoId) =>
        nav.openVideo(videoId, { context: { source: "feed", videos } })
      }
    />
  );
}
