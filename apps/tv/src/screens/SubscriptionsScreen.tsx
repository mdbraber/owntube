import { Feather } from "@expo/vector-icons";
import type { UnifiedVideo } from "@web/server/services/proxy.types";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  FlatList,
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useCardMenu } from "@/components/CardMenu";
import { CarouselFeed } from "@/components/CarouselFeed";
import { MenuPanel } from "@/components/MenuPanel";
import { TagShelves } from "@/components/TagShelves";
import { errorMessage } from "@/lib/error-message";
import { channelInitial, sizedAvatarUrl } from "@/lib/format";
import { setLongPressTarget, takeSuppressedPress } from "@/lib/long-press";
import type { Nav } from "@/lib/navigation";
import { queryClient } from "@/lib/query-client";
import { useActiveBackHandler } from "@/lib/screen-active";
import { trpcClient } from "@/lib/trpc";
import { trpc } from "@/lib/trpc-react";
import { useInfiniteFeed } from "@/lib/use-infinite-feed";
import { colors, focus, fontSize, radius, spacing } from "@/theme";

const FEED_PAGE_SIZE = 24;
/** A channel that uploaded within this long gets a "new" dot. */
const NEW_WINDOW_SECONDS = 3 * 24 * 60 * 60;
/**
 * dp. The YouTube TV app's channel column is ~440 physical px of a 1920-wide
 * panel; at density 2 that is 220dp, with 27dp avatars on a 39dp row pitch.
 */
const PANE_WIDTH = 220;
const AVATAR_SIZE = 28;
/**
 * Selection follows focus, so hold briefly before fetching — otherwise holding
 * the D-pad down through a long channel list fires a request per row.
 */
const FOCUS_SELECT_DELAY_MS = 350;
/** Channels listed above the "A–Z" heading, most recent upload first. */
const RECENT_CHANNELS = 8;

/**
 * What the videos pane is showing. The channel pane is a two-level menu: the
 * root lists All / By tag / Tags / channels, and "Tags" drills into the tag
 * list. "By tag" shows every tag at once, a shelf each.
 */
type Selection =
  | { kind: "all" }
  | { kind: "byTag" }
  | { kind: "channel"; channelId: string }
  | { kind: "tag"; tag: string };

type PaneLevel = "root" | "tags";

/**
 * Subscriptions as a channel list beside that channel's videos, like the
 * Android TV YouTube app — including its interaction model: moving focus
 * through the channel list updates the videos pane directly, rather than
 * requiring a select press.
 *
 * The merged feed is paged (`mergedFeedInfinite`) rather than fetched whole —
 * `mergedFeed` pulls several upstream pages for every subscribed channel before
 * returning anything, so it gets slower the more channels you follow.
 */
export function SubscriptionsScreen({
  nav,
  favoritesOnly = false,
}: {
  nav: Nav;
  /**
   * The Favorites section: the same two panes, limited to channels carrying
   * the favorite tag, without the tag menus.
   */
  favoritesOnly?: boolean;
}) {
  const [selected, setSelected] = useState<Selection>({ kind: "all" });
  const [level, setLevel] = useState<PaneLevel>("root");
  const selectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Every subscription (listSidebar stops at 50), ordered the way the sidebar
  // is: newest upload first, then newest subscription.
  const allSubscriptions = trpc.subscriptions.listDetailed.useQuery(undefined, {
    enabled: !favoritesOnly,
  });
  const favoriteChannels = trpc.subscriptions.listTagged.useQuery(
    { favorites: true },
    { enabled: favoritesOnly },
  );
  const sidebar = favoritesOnly ? favoriteChannels : allSubscriptions;
  const channels = useMemo(
    () =>
      [...(sidebar.data ?? [])].sort(
        (a, b) =>
          (b.latestVideoAt ?? 0) - (a.latestVideoAt ?? 0) ||
          b.subscribedAt - a.subscribedAt,
      ),
    [sidebar.data],
  );
  // The YouTube app's channel column: the most recently active channels
  // first, then an "A–Z" heading over every channel alphabetically (so the
  // recent ones appear twice, as they do there).
  type PaneItem =
    | { kind: "channel"; key: string; channel: (typeof channels)[number] }
    | { kind: "heading"; key: string; label: string };
  const paneItems = useMemo((): PaneItem[] => {
    if (channels.length <= RECENT_CHANNELS) {
      return channels.map((c) => ({
        kind: "channel",
        key: c.channelId,
        channel: c,
      }));
    }
    const alphabetical = [...channels].sort((a, b) =>
      a.channelName.localeCompare(b.channelName, undefined, {
        sensitivity: "base",
      }),
    );
    return [
      ...channels.slice(0, RECENT_CHANNELS).map(
        (c): PaneItem => ({
          kind: "channel",
          key: `recent:${c.channelId}`,
          channel: c,
        }),
      ),
      { kind: "heading", key: "az", label: "A–Z" },
      ...alphabetical.map(
        (c): PaneItem => ({ kind: "channel", key: c.channelId, channel: c }),
      ),
    ];
  }, [channels]);
  const nowSeconds = Date.now() / 1000;
  const { notify } = useCardMenu();
  /** Long-press on a channel row: its menu (open, unsubscribe). */
  const [channelMenu, setChannelMenu] = useState<{
    channelId: string;
    name: string;
  } | null>(null);
  const unsubscribe = (channelId: string, name: string) => {
    trpcClient.subscriptions.remove
      .mutate({ channelId })
      .then(() => {
        notify(`Unsubscribed from ${name}`);
        if (selected.kind === "channel" && selected.channelId === channelId) {
          setSelected({ kind: "all" });
        }
        void sidebar.refetch();
        void queryClient.invalidateQueries({ queryKey: ["feed"] });
      })
      .catch(() => notify("Couldn't unsubscribe"));
  };
  const unfavorite = (channelId: string, name: string) => {
    trpcClient.favorites.set
      .mutate({ channelId, favorite: false })
      .then(() => {
        notify(`Removed ${name} from favorites`);
        if (selected.kind === "channel" && selected.channelId === channelId) {
          setSelected({ kind: "all" });
        }
        void sidebar.refetch();
        void queryClient.invalidateQueries({ queryKey: ["feed"] });
        void queryClient.invalidateQueries({ queryKey: [["favorites"]] });
      })
      .catch(() => notify("Couldn't update favorites"));
  };
  const channelsError = sidebar.error ? errorMessage(sidebar.error) : null;

  const tagList = trpc.channelTags.listAll.useQuery(undefined, {
    enabled: !favoritesOnly,
  });
  const tags = favoritesOnly ? [] : (tagList.data ?? []);

  useEffect(() => {
    // listSidebar orders by newest upload, but that field is only populated by
    // the recency backfill — without it the list falls back to subscription
    // date. Fire once, then let the cached list refresh.
    trpcClient.subscriptions.refreshRecency
      .mutate()
      .then(() => sidebar.refetch())
      .catch(() => {});
  }, [sidebar.refetch]);

  // Back leaves the tag submenu before it leaves Subscriptions, matching the
  // player's controls-then-video order.
  useActiveBackHandler(() => {
    if (level !== "tags") return false;
    setLevel("root");
    return true;
  });

  // Drop a pending selection if the screen goes away mid-debounce.
  useEffect(
    () => () => {
      if (selectTimerRef.current) clearTimeout(selectTimerRef.current);
    },
    [],
  );

  const selectAfterDelay = (next: Selection) => {
    if (selectTimerRef.current) clearTimeout(selectTimerRef.current);
    selectTimerRef.current = setTimeout(
      () => setSelected(next),
      FOCUS_SELECT_DELAY_MS,
    );
  };

  const selectNow = (next: Selection) => {
    if (selectTimerRef.current) clearTimeout(selectTimerRef.current);
    setSelected(next);
  };

  const feed = useInfiniteFeed<string>(
    (cursor) => {
      // Its shelves fetch for themselves (TagShelves).
      if (selected.kind === "byTag") {
        return Promise.resolve({ items: [], next: undefined });
      }
      if (selected.kind === "channel") {
        // Focus moves through the channel rail fire one request per row
        // (debounced, but still one per row) — cacheOnly keeps that instant
        // instead of blocking on a live ~1s+ upstream fetch per channel.
        return trpcClient.channel.page
          .query({
            channelId: selected.channelId,
            continuation: cursor,
            cacheOnly: true,
          })
          .then((page) => ({
            items: page.videos,
            next: page.continuation ?? undefined,
          }));
      }
      return trpcClient.subscriptions.mergedFeedInfinite
        .query({
          limit: FEED_PAGE_SIZE,
          cursor: cursor ?? null,
          includeTags: selected.kind === "tag" ? [selected.tag] : undefined,
          favorites: favoritesOnly || undefined,
        })
        .then((r) => ({ items: r.videos, next: r.nextCursor ?? undefined }));
    },
    [selected, favoritesOnly],
    favoritesOnly ? "favorites.feed" : "subscriptions.feed",
  );

  // Stable, so the memoized shelves don't re-render on every screen render.
  const openFromTag = useCallback(
    (videoId: string, tag: string, videos: UnifiedVideo[]) =>
      nav.openVideo(videoId, {
        context: { source: "feed", label: tag, videos },
      }),
    [nav],
  );

  const heading =
    selected.kind === "channel"
      ? (channels.find((c) => c.channelId === selected.channelId)
          ?.channelName ?? "Channel")
      : selected.kind === "tag"
        ? selected.tag
        : selected.kind === "byTag"
          ? "By tag"
          : favoritesOnly
            ? "All favorites"
            : "All subscriptions";

  return (
    <View style={styles.screen}>
      <Text style={styles.title}>
        {favoritesOnly ? "Favorites" : "Subscriptions"}
      </Text>
      <View style={styles.columns}>
        <View style={styles.pane}>
          {level === "root" ? (
            <FlatList
              data={paneItems}
              keyExtractor={(item) => item.key}
              ListHeaderComponent={
                <>
                  <ChannelRow
                    label="All"
                    icon="list"
                    active={selected.kind === "all"}
                    onFocus={() => selectAfterDelay({ kind: "all" })}
                    onPress={() => selectNow({ kind: "all" })}
                  />
                  {tags.length > 0 ? (
                    <ChannelRow
                      label="By tag"
                      icon="layers"
                      active={selected.kind === "byTag"}
                      onFocus={() => selectAfterDelay({ kind: "byTag" })}
                      onPress={() => selectNow({ kind: "byTag" })}
                    />
                  ) : null}
                  {tags.length > 0 ? (
                    <ChannelRow
                      label="Tags"
                      icon="tag"
                      trailingIcon="chevron-right"
                      active={selected.kind === "tag"}
                      // Drill-in only on press: moving focus past it on the way
                      // to the channels below shouldn't change the pane.
                      onFocus={() => {}}
                      onPress={() => setLevel("tags")}
                    />
                  ) : null}
                  {/* Separates the overview rows from the channels. */}
                  <View style={styles.groupGap} />
                </>
              }
              renderItem={({ item: paneItem }) => {
                if (paneItem.kind === "heading") {
                  return (
                    <Text style={styles.sectionLabel}>{paneItem.label}</Text>
                  );
                }
                const item = paneItem.channel;
                return (
                  <ChannelRow
                    label={item.channelName}
                    avatarUrl={item.avatarUrl}
                    fresh={
                      item.latestVideoAt !== null &&
                      nowSeconds - item.latestVideoAt < NEW_WINDOW_SECONDS
                    }
                    onLongPress={() =>
                      setChannelMenu({
                        channelId: item.channelId,
                        name: item.channelName,
                      })
                    }
                    active={
                      selected.kind === "channel" &&
                      selected.channelId === item.channelId
                    }
                    onFocus={() =>
                      selectAfterDelay({
                        kind: "channel",
                        channelId: item.channelId,
                      })
                    }
                    onPress={() =>
                      selectNow({ kind: "channel", channelId: item.channelId })
                    }
                  />
                );
              }}
              showsVerticalScrollIndicator={false}
              removeClippedSubviews={false}
              ListEmptyComponent={
                channelsError ? (
                  <Text style={styles.paneError}>{channelsError}</Text>
                ) : undefined
              }
            />
          ) : (
            <FlatList
              data={tags}
              keyExtractor={(item) => item.tag}
              ListHeaderComponent={
                <ChannelRow
                  label="Back"
                  icon="chevron-left"
                  active={false}
                  onFocus={() => {}}
                  onPress={() => setLevel("root")}
                />
              }
              renderItem={({ item }) => (
                <ChannelRow
                  label={`${item.tag} (${item.count})`}
                  icon="tag"
                  active={selected.kind === "tag" && selected.tag === item.tag}
                  onFocus={() =>
                    selectAfterDelay({ kind: "tag", tag: item.tag })
                  }
                  onPress={() => selectNow({ kind: "tag", tag: item.tag })}
                />
              )}
              showsVerticalScrollIndicator={false}
              removeClippedSubviews={false}
            />
          )}
        </View>

        <View style={styles.feed}>
          {selected.kind === "byTag" ? (
            <TagShelves
              tags={tags}
              onSelect={openFromTag}
              header={<Text style={styles.heading}>{heading}</Text>}
            />
          ) : (
            <CarouselFeed
              feed={feed}
              onSelect={(videoId, videos) =>
                nav.openVideo(videoId, { context: { source: "feed", videos } })
              }
              header={<Text style={styles.heading}>{heading}</Text>}
              emptyText={
                selected.kind !== "all"
                  ? "No videos here yet."
                  : favoritesOnly
                    ? "No favorites yet. Star a channel on its page to add it here."
                    : "You're not subscribed to any channels yet."
              }
              // The channel list owns focus here; grabbing it back on every
              // selection change would fight the user's way down the list.
              preferFirstRowFocus={false}
            />
          )}
        </View>
      </View>
      {channelMenu ? (
        <MenuPanel
          onClose={() => setChannelMenu(null)}
          buildPage={() => ({
            title: channelMenu.name,
            items: [
              {
                key: "open",
                label: "Open channel",
                onPress: () => {
                  setChannelMenu(null);
                  nav.openChannel(channelMenu.channelId);
                },
              },
              ...(favoritesOnly
                ? [
                    {
                      key: "unfavorite",
                      label: "Remove from favorites",
                      onPress: () => {
                        setChannelMenu(null);
                        unfavorite(channelMenu.channelId, channelMenu.name);
                      },
                    },
                  ]
                : []),
              {
                key: "unsubscribe",
                label: "Unsubscribe",
                confirm: `Unsubscribe from ${channelMenu.name}?`,
                onPress: () => {
                  setChannelMenu(null);
                  unsubscribe(channelMenu.channelId, channelMenu.name);
                },
              },
            ],
          })}
        />
      ) : null}
    </View>
  );
}

function ChannelRow({
  label,
  avatarUrl,
  icon,
  trailingIcon,
  active,
  fresh,
  onFocus,
  onPress,
  onLongPress,
}: {
  label: string;
  avatarUrl?: string | null;
  /** Used by rows without a channel avatar (All, Tags, Back). */
  icon?: keyof typeof Feather.glyphMap;
  /** Marks a row that drills into a submenu. */
  trailingIcon?: keyof typeof Feather.glyphMap;
  active: boolean;
  /** Uploaded recently: shows a dot, like the web sidebar's. */
  fresh?: boolean;
  onFocus: () => void;
  onPress: () => void;
  onLongPress?: () => void;
}) {
  const [focused, setFocused] = useState(false);
  const tint = focused ? colors.focusForeground : colors.foreground;
  const longPressRef = useRef(onLongPress);
  longPressRef.current = onLongPress;
  const [longPressAction] = useState(() => () => longPressRef.current?.());

  return (
    <Pressable
      onFocus={() => {
        setFocused(true);
        if (onLongPress) setLongPressTarget(longPressAction);
        onFocus();
      }}
      onBlur={() => {
        setFocused(false);
        setLongPressTarget(null, longPressAction);
      }}
      onPress={() => {
        if (!takeSuppressedPress()) onPress();
      }}
      style={[
        styles.row,
        active && styles.rowActive,
        focused && styles.rowFocused,
      ]}
    >
      {icon ? (
        <View style={[styles.avatar, styles.avatarFallback]}>
          <Feather name={icon} size={16} color={tint} />
        </View>
      ) : avatarUrl ? (
        <Image
          source={{ uri: sizedAvatarUrl(avatarUrl, AVATAR_SIZE) }}
          style={styles.avatar}
        />
      ) : (
        <View style={[styles.avatar, styles.avatarFallback]}>
          <Text style={styles.avatarInitial}>{channelInitial(label)}</Text>
        </View>
      )}
      <Text style={[styles.rowLabel, { color: tint }]} numberOfLines={1}>
        {label}
      </Text>
      {fresh ? <View style={styles.freshDot} /> : null}
      {trailingIcon ? (
        <Feather name={trailingIcon} size={16} color={tint} />
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  title: {
    color: colors.foreground,
    fontSize: fontSize.xxl,
    fontWeight: "700",
    marginBottom: spacing.lg,
  },
  columns: { flex: 1, flexDirection: "row" },
  pane: {
    width: PANE_WIDTH,
    paddingRight: spacing.lg,
    borderRightWidth: 1,
    borderRightColor: colors.border,
  },
  feed: { flex: 1, paddingLeft: spacing.xl },
  heading: {
    color: colors.mutedForeground,
    fontSize: fontSize.lg,
    fontWeight: "600",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 5,
    marginBottom: 5,
    borderRadius: radius.shell,
    borderWidth: focus.borderWidth,
    borderColor: "transparent",
  },
  groupGap: { height: spacing.lg },
  sectionLabel: {
    color: colors.mutedForeground,
    fontSize: fontSize.sm,
    fontWeight: "600",
    marginTop: spacing.md,
    marginBottom: spacing.xs,
    marginLeft: spacing.sm,
  },
  freshDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.brand,
  },
  paneError: {
    color: colors.mutedForeground,
    fontSize: fontSize.sm,
    paddingHorizontal: spacing.sm,
  },
  rowActive: { backgroundColor: colors.brandSoft },
  rowFocused: {
    backgroundColor: colors.focusFill,
    borderColor: colors.focusFill,
  },
  avatar: {
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
    borderRadius: AVATAR_SIZE / 2,
  },
  avatarFallback: {
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.accent,
  },
  avatarInitial: {
    color: colors.foreground,
    fontWeight: "700",
    fontSize: fontSize.base,
  },
  rowLabel: { flex: 1, fontSize: fontSize.md, fontWeight: "600" },
});
