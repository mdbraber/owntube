import { Text, View } from "react-native";
import { CarouselFeed } from "@/components/CarouselFeed";
import { VideoRow } from "@/components/VideoRow";
import type { Nav } from "@/lib/navigation";
import { trpcClient } from "@/lib/trpc";
import { trpc } from "@/lib/trpc-react";
import { createStyles } from "@/lib/ui-scale";
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

  // The web's Shorts shelf sits on this page too; OK opens the Shorts player
  // at that short.
  const shorts = trpc.shorts.feed.useQuery({ limit: 12, purpose: "shelf" });
  const shortsVideos = shorts.data?.videos ?? [];

  return (
    <CarouselFeed
      feed={feed}
      onSelect={(videoId, videos) =>
        nav.openVideo(videoId, { context: { source: "feed", videos } })
      }
      header={
        <View style={styles.header}>
          <Text style={styles.heading}>Recommended</Text>
          {shortsVideos.length > 0 ? (
            <VideoRow
              title="Shorts"
              videos={shortsVideos}
              onSelect={(videoId) =>
                nav.openShorts(shortsVideos.find((v) => v.videoId === videoId))
              }
            />
          ) : null}
        </View>
      }
      emptyText="Nothing recommended yet — watch a few videos first."
    />
  );
}

const styles = createStyles({
  header: { gap: 20 },
  heading: {
    color: colors.foreground,
    fontSize: fontSize.xxl,
    fontWeight: "700",
  },
});
