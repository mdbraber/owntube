import { Text } from "react-native";
import { CarouselFeed } from "@/components/CarouselFeed";
import type { Nav } from "@/lib/navigation";
import { trpcClient } from "@/lib/trpc";
import { createStyles } from "@/lib/ui-scale";
import { useInfiniteFeed } from "@/lib/use-infinite-feed";
import { colors, fontSize } from "@/theme";

/** Videos saved with the bookmark button, newest first; one unpaged list. */
export function SavedScreen({ nav }: { nav: Nav }) {
  const feed = useInfiniteFeed<never>(
    () =>
      trpcClient.interactions.listSaved.query().then((rows) => ({
        items: rows.map((row) => ({
          videoId: row.videoId,
          title: row.videoTitle,
          thumbnailUrl: row.thumbnailUrl,
          durationSeconds: row.durationSeconds,
          channelId: row.channelId ?? undefined,
          channelName: row.channelName ?? undefined,
          channelAvatarUrl: row.channelAvatarUrl,
        })),
        next: undefined,
      })),
    [],
    "interactions.listSaved",
  );

  return (
    <CarouselFeed
      feed={feed}
      onSelect={(videoId, videos) =>
        nav.openVideo(videoId, {
          context: { source: "feed", label: "Saved", videos },
        })
      }
      header={<Text style={styles.heading}>Saved</Text>}
      emptyText="Nothing saved yet — use the bookmark button in the player."
    />
  );
}

const styles = createStyles({
  heading: {
    color: colors.foreground,
    fontSize: fontSize.xxl,
    fontWeight: "700",
  },
});
