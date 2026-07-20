import { StyleSheet, Text } from "react-native";
import { CarouselFeed } from "@/components/CarouselFeed";
import type { Nav } from "@/lib/navigation";
import { trpcClient } from "@/lib/trpc";
import { useInfiniteFeed } from "@/lib/use-infinite-feed";
import { colors, fontSize } from "@/theme";

/**
 * The watch queue, in queue order. `listDetailed` returns the whole queue in
 * one shot (it is user-curated and short), so there is no pagination — the
 * shelves are just chunked by CarouselFeed.
 */
export function QueueScreen({ nav }: { nav: Nav }) {
  const feed = useInfiniteFeed<never>(
    () =>
      trpcClient.queue.listDetailed.query().then((rows) => ({
        items: rows.map((row) => ({
          videoId: row.videoId,
          title: row.videoTitle,
          thumbnailUrl: row.thumbnailUrl,
          // listDetailed falls back to channelId, which is nullable.
          channelName: row.channelName ?? undefined,
        })),
        next: undefined,
      })),
    [],
  );

  return (
    <CarouselFeed
      feed={feed}
      onSelect={(videoId) => nav.openVideo(videoId)}
      header={<Text style={styles.heading}>Queue</Text>}
      emptyText="Your queue is empty."
    />
  );
}

const styles = StyleSheet.create({
  heading: {
    color: colors.foreground,
    fontSize: fontSize.xl,
    fontWeight: "700",
  },
});
