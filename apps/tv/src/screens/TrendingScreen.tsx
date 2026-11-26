import { Text } from "react-native";
import { CarouselFeed } from "@/components/CarouselFeed";
import type { Nav } from "@/lib/navigation";
import { trpcClient } from "@/lib/trpc";
import { trpc } from "@/lib/trpc-react";
import { createStyles } from "@/lib/ui-scale";
import { useInfiniteFeed } from "@/lib/use-infinite-feed";
import { colors, fontSize } from "@/theme";

/** Trending in the user's region (the shared `trendingRegion` setting). */
export function TrendingScreen({ nav }: { nav: Nav }) {
  const settings = trpc.settings.get.useQuery();
  const region = settings.data?.trendingRegion ?? "US";
  const feed = useInfiniteFeed<never>(
    () =>
      trpcClient.live.list
        .query({ region, limit: 60 })
        .then((result) => ({ items: result.videos, next: undefined })),
    [region],
    "live.list",
  );

  return (
    <CarouselFeed
      feed={feed}
      onSelect={(videoId, videos) =>
        nav.openVideo(videoId, { context: { source: "feed", videos } })
      }
      header={<Text style={styles.heading}>Trending · {region}</Text>}
      emptyText="Nothing trending right now."
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
