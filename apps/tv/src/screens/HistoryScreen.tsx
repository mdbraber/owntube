import { useRef } from "react";
import { Text } from "react-native";
import { type CardMenuExtras, useCardMenu } from "@/components/CardMenu";
import { CarouselFeed } from "@/components/CarouselFeed";
import type { Nav } from "@/lib/navigation";
import { queryClient } from "@/lib/query-client";
import { trpcClient } from "@/lib/trpc";
import { createStyles } from "@/lib/ui-scale";
import { useInfiniteFeed } from "@/lib/use-infinite-feed";
import { colors, fontSize } from "@/theme";

const PAGE_SIZE = 24;

/**
 * Watch history as stacked carousels. Selecting an entry resumes from the saved
 * `durationWatched` (kept in a side map since the feed carries only videos).
 */
export function HistoryScreen({ nav }: { nav: Nav }) {
  const resumeRef = useRef<Map<string, number>>(new Map());
  /** History row ids by video, for "Remove from history". */
  const rowIdRef = useRef<Map<string, number>>(new Map());

  const feed = useInfiniteFeed<number>(
    (page) =>
      trpcClient.history.list
        .query({ page: page ?? 1, pageSize: PAGE_SIZE })
        .then((rows) => {
          for (const row of rows) {
            resumeRef.current.set(row.videoId, row.durationWatched);
            rowIdRef.current.set(row.videoId, row.id);
          }
          return {
            items: rows.map((row) => ({
              videoId: row.videoId,
              title: row.videoTitle,
              thumbnailUrl: row.thumbnailUrl,
              channelName: row.channelName,
            })),
            next: rows.length === PAGE_SIZE ? (page ?? 1) + 1 : undefined,
          };
        }),
    [],
    "history.list",
  );

  const { notify } = useCardMenu();
  const menuExtras: CardMenuExtras = (video) => {
    const id = rowIdRef.current.get(video.videoId);
    if (id === undefined) return [];
    return [
      {
        key: "forget",
        label: "Remove from history",
        onPress: () => {
          trpcClient.history.softDelete
            .mutate({ id })
            .then(() => {
              notify("Removed from history");
              void queryClient.invalidateQueries({
                queryKey: ["feed", "history.list"],
              });
              void queryClient.invalidateQueries({ queryKey: [["history"]] });
            })
            .catch(() => notify("Couldn't remove it"));
        },
      },
    ];
  };

  return (
    <CarouselFeed
      menuExtras={menuExtras}
      feed={feed}
      onSelect={(videoId) =>
        nav.openVideo(videoId, {
          resumeSeconds: resumeRef.current.get(videoId),
        })
      }
      header={<Text style={styles.heading}>History</Text>}
      emptyText="Nothing watched yet."
    />
  );
}

const styles = createStyles({
  heading: {
    color: colors.foreground,
    fontSize: fontSize.xl,
    fontWeight: "700",
  },
});
