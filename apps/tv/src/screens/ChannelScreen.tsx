import { useEffect, useState } from "react";
import { Image, ScrollView, Text, View } from "react-native";
import { CarouselFeed } from "@/components/CarouselFeed";
import { ChannelTiles } from "@/components/ChannelTiles";
import { FocusButton } from "@/components/FocusButton";
import {
  channelInitial,
  formatSubscribersLabel,
  sizedAvatarUrl,
} from "@/lib/format";
import type { Nav } from "@/lib/navigation";
import { queryClient } from "@/lib/query-client";
import { trpcClient } from "@/lib/trpc";
import { trpc } from "@/lib/trpc-react";
import { createStyles } from "@/lib/ui-scale";
import { useInfiniteFeed } from "@/lib/use-infinite-feed";
import { colors, fontSize, radius, spacing } from "@/theme";

type ChannelMeta = {
  name?: string;
  avatarUrl?: string;
  subscriberCount?: number;
};

/** A channel's videos as stacked carousels, reachable from the player. */
/** dp; the header avatar. */
const CHANNEL_AVATAR = 84;

export function ChannelScreen({
  channelId,
  nav,
}: {
  channelId: string;
  nav: Nav;
}) {
  const [meta, setMeta] = useState<ChannelMeta>({});
  const [tab, setTab] = useState<ChannelTab>("videos");
  // Switching tabs remounts the page below the header, which drops focus;
  // after a tab press, the chosen tab takes focus back (and the first video
  // row doesn't grab it instead).
  const [tabChosen, setTabChosen] = useState(false);
  const [pending, setPending] = useState(false);
  // Unknown state hides the button rather than showing a wrong label, so an
  // error leaves this undefined on purpose.
  const status = trpc.subscriptions.status.useQuery({ channelId });
  const [override, setOverride] = useState<boolean | null>(null);
  const subscribed = override ?? status.data?.subscribed ?? null;

  // Drop the optimistic value when the channel changes, so it can't leak
  // across screens; channelId is the only trigger.
  // Starred = carries the favorite tag (and subscribed). Same optimistic
  // pattern as the subscribe button.
  const favoriteStatus = trpc.favorites.status.useQuery({ channelId });
  const [favoriteOverride, setFavoriteOverride] = useState<boolean | null>(
    null,
  );
  const favorite = favoriteOverride ?? favoriteStatus.data?.favorite ?? null;
  const [favoritePending, setFavoritePending] = useState(false);

  // biome-ignore lint/correctness/useExhaustiveDependencies: reset on channel
  useEffect(() => {
    setOverride(null);
    setFavoriteOverride(null);
  }, [channelId]);

  const toggleFavorite = () => {
    if (favorite === null || favoritePending) return;
    setFavoritePending(true);
    const next = !favorite;
    trpcClient.favorites.set
      .mutate({ channelId, favorite: next })
      .then(() => {
        setFavoriteOverride(next);
        // Starring subscribes too.
        if (next) setOverride(true);
        void queryClient.invalidateQueries({ queryKey: ["feed"] });
        void queryClient.invalidateQueries({ queryKey: [["subscriptions"]] });
        void queryClient.invalidateQueries({ queryKey: [["channelTags"]] });
      })
      .catch(() => setFavoriteOverride(null))
      .finally(() => setFavoritePending(false));
  };

  const toggleSubscription = () => {
    if (subscribed === null || pending) return;
    setPending(true);
    const next = !subscribed;
    const call = next
      ? trpcClient.subscriptions.add.mutate({ channelId })
      : trpcClient.subscriptions.remove.mutate({ channelId });
    call
      .then(() => {
        setOverride(next);
        // A favorite counts only while subscribed; the tag stays, so
        // subscribing again brings the star back.
        setFavoriteOverride(null);
        void favoriteStatus.refetch();
        // The subscriptions feed and channel rail both change on subscribe.
        void queryClient.invalidateQueries({ queryKey: ["feed"] });
      })
      .catch(() => setOverride(null))
      .finally(() => setPending(false));
  };

  const feed = useInfiniteFeed<string>(
    (continuation) =>
      trpcClient.channel.page
        .query({
          channelId,
          continuation,
          tab: tab === "shorts" ? "shorts" : "videos",
        })
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
    [channelId, tab === "shorts" ? "shorts" : "videos"],
    `channel.page:${channelId}`,
  );

  // The channel's own YouTube playlists, shown as cards; OK plays one through.
  const playlistsFeed = useInfiniteFeed<never>(
    () =>
      tab !== "playlists"
        ? Promise.resolve({ items: [], next: undefined })
        : trpcClient.channel.playlists.query({ channelId }).then((r) => ({
            items: r.playlists.map((p) => ({
              videoId: p.playlistId,
              title: p.title,
              thumbnailUrl: p.thumbnailUrl ?? undefined,
              channelName:
                p.videoCount !== null ? `${p.videoCount} videos` : undefined,
            })),
            next: undefined,
          })),
    [channelId, tab === "playlists"],
    `channel.playlists:${channelId}`,
  );
  const related = trpc.channel.relatedChannels.useQuery(
    { channelId },
    { enabled: tab === "similar" },
  );
  const playPlaylist = (playlistId: string) => {
    trpcClient.channel.ytPlaylist
      .query({ playlistId })
      .then((playlist) => {
        const first = playlist.videos[0];
        if (!first) return;
        nav.openVideo(first.videoId, {
          context: {
            source: "playlist",
            label: playlist.title,
            videos: playlist.videos,
          },
        });
      })
      .catch(() => {});
  };

  const subscribersLabel = formatSubscribersLabel(meta.subscriberCount);
  const header = (
    <View style={styles.header}>
      {meta.avatarUrl ? (
        <Image
          source={{ uri: sizedAvatarUrl(meta.avatarUrl, CHANNEL_AVATAR) }}
          style={styles.avatar}
        />
      ) : (
        <View style={[styles.avatar, styles.avatarFallback]}>
          <Text style={styles.avatarInitial}>{channelInitial(meta.name)}</Text>
        </View>
      )}
      <View style={styles.headerText}>
        <Text style={styles.name}>{meta.name ?? "Channel"}</Text>
        {subscribersLabel ? (
          <Text style={styles.subs}>{subscribersLabel}</Text>
        ) : null}
      </View>
      {favorite !== null ? (
        <FocusButton
          label={favorite ? "★ Favorite" : "☆ Favorite"}
          selected={favorite}
          onPress={toggleFavorite}
          disabled={favoritePending}
        />
      ) : null}
      {subscribed !== null ? (
        <FocusButton
          label={subscribed ? "Subscribed" : "Subscribe"}
          onPress={toggleSubscription}
          disabled={pending}
        />
      ) : null}
    </View>
  );

  const chrome = (
    <View style={styles.chrome}>
      {header}
      <View style={styles.chips}>
        {TABS.map(({ key, label }) => (
          <FocusButton
            key={key}
            label={label}
            selected={tab === key}
            hasTVPreferredFocus={tabChosen && tab === key}
            onPress={() => {
              setTabChosen(true);
              setTab(key);
            }}
            style={styles.chip}
          />
        ))}
      </View>
    </View>
  );

  if (tab === "similar") {
    const channels = (related.data?.channels ?? []).map((c) => ({
      channelId: c.channelId,
      name: c.channelName,
      avatarUrl: c.channelAvatarUrl,
      subscriberCount: c.subscriberCount,
    }));
    return (
      <ScrollView contentContainerStyle={styles.similar}>
        {chrome}
        {channels.length > 0 ? (
          <ChannelTiles
            title="Similar channels"
            channels={channels}
            onSelect={nav.openChannel}
          />
        ) : (
          <Text style={styles.subs}>
            {related.isLoading ? "Loading…" : "No similar channels found."}
          </Text>
        )}
      </ScrollView>
    );
  }

  if (tab === "playlists") {
    return (
      <CarouselFeed
        feed={playlistsFeed}
        onSelect={playPlaylist}
        header={chrome}
        preferFirstRowFocus={!tabChosen}
        disableMenu
        emptyText="This channel has no playlists."
      />
    );
  }

  return (
    <CarouselFeed
      feed={feed}
      onSelect={(videoId, videos) =>
        nav.openVideo(videoId, { context: { source: "feed", videos } })
      }
      header={chrome}
      preferFirstRowFocus={!tabChosen}
      emptyText={
        tab === "shorts"
          ? "This channel has no Shorts."
          : "This channel has no videos."
      }
    />
  );
}

type ChannelTab = "videos" | "shorts" | "playlists" | "similar";

const TABS: { key: ChannelTab; label: string }[] = [
  { key: "videos", label: "Videos" },
  { key: "shorts", label: "Shorts" },
  { key: "playlists", label: "Playlists" },
  { key: "similar", label: "Similar" },
];

const styles = createStyles({
  chrome: { gap: spacing.md },
  chips: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: spacing.sm,
  },
  chip: { minHeight: 40, paddingHorizontal: spacing.md },
  chipsLabel: { color: colors.mutedForeground, fontSize: fontSize.sm },
  similar: { gap: spacing.lg, paddingBottom: spacing.screen },
  headerText: { flex: 1 },
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
    width: CHANNEL_AVATAR,
    height: CHANNEL_AVATAR,
    borderRadius: CHANNEL_AVATAR / 2,
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
