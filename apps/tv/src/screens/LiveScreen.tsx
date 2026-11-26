import { Text } from "react-native";
import { CarouselFeed } from "@/components/CarouselFeed";
import type { Nav } from "@/lib/navigation";
import { trpcClient } from "@/lib/trpc";
import { createStyles } from "@/lib/ui-scale";
import { useInfiniteFeed } from "@/lib/use-infinite-feed";
import { colors, fontSize } from "@/theme";

/** YouTube's Live page: what is streaming now. */
export function LiveScreen({ nav }: { nav: Nav }) {
  const feed = useInfiniteFeed<never>(
    () =>
      trpcClient.live.list
        .query({ limit: 60 })
        .then((result) => ({ items: result.videos, next: undefined })),
    [],
    "live.list",
  );

  return (
    <CarouselFeed
      feed={feed}
      onSelect={(videoId, videos) =>
        nav.openVideo(videoId, { context: { source: "feed", videos } })
      }
      header={<Text style={styles.heading}>Live</Text>}
      emptyText="Nothing is live right now."
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
