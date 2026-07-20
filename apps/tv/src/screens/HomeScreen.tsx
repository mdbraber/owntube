import { useEffect, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { CarouselFeed } from "@/components/CarouselFeed";
import { HomeHero } from "@/components/HomeHero";
import type { Nav } from "@/lib/navigation";
import { trpcClient } from "@/lib/trpc";
import { useInfiniteFeed } from "@/lib/use-infinite-feed";
import { colors, fontSize, monoFont, spacing } from "@/theme";

type HomeLabels = {
  hero: string;
  rail: string;
  subtitle: string;
};

const DEFAULT_LABELS: HomeLabels = {
  hero: "Trending now",
  rail: "Trending",
  subtitle: "Preparing your feed...",
};

/**
 * Personalized home feed as stacked carousels. The server handles cold start
 * (falls back to trending), and pages are 1-indexed with a `hasMore` flag.
 */
export function HomeScreen({ nav }: { nav: Nav }) {
  const mountedRef = useRef(true);
  const [labels, setLabels] = useState<HomeLabels>(DEFAULT_LABELS);

  useEffect(
    () => () => {
      mountedRef.current = false;
    },
    [],
  );

  const feed = useInfiniteFeed<number>(
    (page) =>
      trpcClient.feed.home.query({ page: page ?? 1 }).then((result) => {
        if (page === undefined && mountedRef.current) {
          const personalized =
            result.kind === "personalized" && result.coldStart !== true;
          setLabels({
            hero: personalized ? "Top pick for you" : "Trending now",
            rail: personalized ? "For You" : "Trending",
            subtitle: personalized
              ? "Based on the channels you watched recently."
              : `Trending ${result.region}`,
          });
        }
        return {
          items: result.videos,
          next: result.hasMore ? (page ?? 1) + 1 : undefined,
        };
      }),
    [],
    "feed.home",
  );

  useEffect(() => {
    if (
      feed.status === "ready" &&
      feed.videos.length === 1 &&
      feed.hasMore &&
      !feed.loadingMore
    ) {
      feed.loadMore();
    }
  }, [
    feed.status,
    feed.videos.length,
    feed.hasMore,
    feed.loadingMore,
    feed.loadMore,
  ]);

  const [heroVideo, ...railVideos] = feed.videos;
  const header = heroVideo ? (
    <View style={styles.header}>
      <HomeHero
        video={heroVideo}
        label={labels.hero}
        onPress={(videoId) => nav.openVideo(videoId)}
      />
      {railVideos.length > 0 ? (
        <View style={styles.railHeader}>
          <View>
            <Text style={styles.heading}>{labels.rail}</Text>
            <Text style={styles.subtitle}>{labels.subtitle}</Text>
          </View>
          <Text style={styles.count}>
            {feed.videos.length} video{feed.videos.length === 1 ? "" : "s"}
          </Text>
        </View>
      ) : null}
    </View>
  ) : (
    <Text style={styles.heading}>Home</Text>
  );

  return (
    <CarouselFeed
      feed={feed}
      onSelect={(videoId) => nav.openVideo(videoId)}
      header={header}
      videos={railVideos}
      preferFirstRowFocus={false}
      emptyText={
        heroVideo
          ? "Scroll to load more rows."
          : "No recommendations yet - watch a few videos to get started."
      }
    />
  );
}

const styles = StyleSheet.create({
  header: {
    gap: spacing.lg,
    paddingTop: 8,
    paddingHorizontal: 8,
  },
  railHeader: {
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
    gap: spacing.lg,
  },
  heading: {
    color: colors.foreground,
    fontSize: fontSize.xl,
    fontWeight: "700",
  },
  subtitle: {
    color: colors.mutedForeground,
    fontSize: fontSize.sm,
    marginTop: 4,
  },
  count: {
    color: colors.mutedForeground,
    fontSize: fontSize.sm,
    fontFamily: monoFont,
  },
});
