import { StyleSheet, Text } from "react-native";
import { CarouselFeed } from "@/components/CarouselFeed";
import type { Nav } from "@/lib/navigation";
import { trpcClient } from "@/lib/trpc";
import { useInfiniteFeed } from "@/lib/use-infinite-feed";
import { colors, fontSize } from "@/theme";

const PAGE_SIZE = 24;

/**
 * The personalised feed as a plain paged grid.
 *
 * Home shows the same `feed.home` source but as a hero plus a couple of rails;
 * this is the "just show me everything you'd recommend" view, which is what the
 * sidebar entry implies.
 */
export function RecommendedScreen({ nav }: { nav: Nav }) {
  const feed = useInfiniteFeed<number>(
    (page) =>
      trpcClient.feed.home
        .query({ page: page ?? 1, pageSize: PAGE_SIZE })
        .then((result) => ({
          items: result.videos,
          next:
            result.videos.length === PAGE_SIZE ? (page ?? 1) + 1 : undefined,
        })),
    [],
    "feed.home:recommended",
  );

  return (
    <CarouselFeed
      feed={feed}
      onSelect={(videoId) => nav.openVideo(videoId)}
      header={<Text style={styles.heading}>Recommended</Text>}
      emptyText="Nothing recommended yet — watch a few videos first."
    />
  );
}

const styles = StyleSheet.create({
  heading: {
    color: colors.foreground,
    fontSize: fontSize.xxl,
    fontWeight: "700",
  },
});
