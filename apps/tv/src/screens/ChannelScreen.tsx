import { useState } from "react";
import { Image, StyleSheet, Text, View } from "react-native";
import { CarouselFeed } from "@/components/CarouselFeed";
import { channelInitial, formatSubscribersLabel } from "@/lib/format";
import type { Nav } from "@/lib/navigation";
import { trpcClient } from "@/lib/trpc";
import { useInfiniteFeed } from "@/lib/use-infinite-feed";
import { colors, fontSize, radius, spacing } from "@/theme";

type ChannelMeta = {
  name?: string;
  avatarUrl?: string;
  subscriberCount?: number;
};

/** A channel's videos as stacked carousels, reachable from the player. */
export function ChannelScreen({
  channelId,
  nav,
}: {
  channelId: string;
  nav: Nav;
}) {
  const [meta, setMeta] = useState<ChannelMeta>({});

  const feed = useInfiniteFeed<string>(
    (continuation) =>
      trpcClient.channel.page
        .query({ channelId, continuation })
        .then((page) => {
          // Channel metadata only comes back on the first (non-continuation) page.
          if (!continuation) {
            setMeta({
              name: page.name,
              avatarUrl: page.avatarUrl,
              subscriberCount: page.subscriberCount,
            });
          }
          return { items: page.videos, next: page.continuation ?? undefined };
        }),
    [channelId],
  );

  const subscribersLabel = formatSubscribersLabel(meta.subscriberCount);
  const header = (
    <View style={styles.header}>
      {meta.avatarUrl ? (
        <Image source={{ uri: meta.avatarUrl }} style={styles.avatar} />
      ) : (
        <View style={[styles.avatar, styles.avatarFallback]}>
          <Text style={styles.avatarInitial}>{channelInitial(meta.name)}</Text>
        </View>
      )}
      <View>
        <Text style={styles.name}>{meta.name ?? "Channel"}</Text>
        {subscribersLabel ? (
          <Text style={styles.subs}>{subscribersLabel}</Text>
        ) : null}
      </View>
    </View>
  );

  return (
    <CarouselFeed
      feed={feed}
      onSelect={(videoId) => nav.openVideo(videoId)}
      header={header}
      emptyText="This channel has no videos."
    />
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    padding: spacing.lg,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.surfaceBorder,
    backgroundColor: colors.cardElevated,
  },
  avatar: {
    width: 84,
    height: 84,
    borderRadius: 42,
    backgroundColor: colors.muted,
  },
  avatarFallback: {
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: colors.surfaceBorder,
  },
  avatarInitial: {
    color: colors.foreground,
    fontSize: fontSize.xl,
    fontWeight: "800",
  },
  name: { color: colors.foreground, fontSize: fontSize.xl, fontWeight: "700" },
  subs: { color: colors.mutedForeground, fontSize: fontSize.md, marginTop: 4 },
});
