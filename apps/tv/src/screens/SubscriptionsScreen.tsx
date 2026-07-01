import { StyleSheet, Text } from "react-native";
import { CarouselFeed } from "@/components/CarouselFeed";
import type { Nav } from "@/lib/navigation";
import { trpcClient } from "@/lib/trpc";
import { useInfiniteFeed } from "@/lib/use-infinite-feed";
import { colors, fontSize } from "@/theme";

/**
 * Latest uploads merged across followed channels. `mergedFeed` returns the full
 * set in one shot, so there's no pagination — just chunk it into shelves.
 */
export function SubscriptionsScreen({ nav }: { nav: Nav }) {
  const feed = useInfiniteFeed<never>(
    () =>
      trpcClient.subscriptions.mergedFeed
        .query()
        .then((r) => ({ items: r.videos, next: undefined })),
    [],
  );

  return (
    <CarouselFeed
      feed={feed}
      onSelect={(videoId) => nav.openVideo(videoId)}
      header={<Text style={styles.heading}>Subscriptions</Text>}
      emptyText="You're not subscribed to any channels yet."
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
