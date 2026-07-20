import { Feather } from "@expo/vector-icons";
import { useEffect, useRef, useState } from "react";
import {
  FlatList,
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { CarouselFeed } from "@/components/CarouselFeed";
import { channelInitial } from "@/lib/format";
import type { Nav } from "@/lib/navigation";
import { trpcClient } from "@/lib/trpc";
import { useInfiniteFeed } from "@/lib/use-infinite-feed";
import { errorMessage } from "@/lib/use-query";
import { colors, focus, fontSize, radius, spacing } from "@/theme";

/** Server caps listSidebar at 50; asking for more is a validation error. */
const CHANNEL_LIMIT = 50;
const FEED_PAGE_SIZE = 24;
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

type SidebarChannel = {
  channelId: string;
  channelName: string;
  avatarUrl: string | null;
};

/**
 * What the videos pane is showing. The channel pane is a two-level menu: the
 * root lists All / Tags / channels, and "Tags" drills into the tag list.
 */
type Selection =
  | { kind: "all" }
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
export function SubscriptionsScreen({ nav }: { nav: Nav }) {
  const [channels, setChannels] = useState<SidebarChannel[]>([]);
  const [selected, setSelected] = useState<Selection>({ kind: "all" });
  const [level, setLevel] = useState<PaneLevel>("root");
  const [tags, setTags] = useState<{ tag: string; count: number }[]>([]);
  const [channelsError, setChannelsError] = useState<string | null>(null);
  const selectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;
    trpcClient.subscriptions.listSidebar
      .query({ limit: CHANNEL_LIMIT })
      .then((rows) => {
        if (!cancelled) setChannels(rows);
      })
      // Don't swallow this: an empty channel list is indistinguishable from a
      // failed query otherwise.
      .catch((err: unknown) => {
        if (!cancelled) setChannelsError(errorMessage(err));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    trpcClient.channelTags.listAll
      .query()
      .then((rows) => {
        if (!cancelled) setTags(rows);
      })
      // Tags are optional; the rest of the pane still works without them.
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

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
      if (selected.kind === "channel") {
        return trpcClient.channel.page
          .query({ channelId: selected.channelId, continuation: cursor })
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
        })
        .then((r) => ({ items: r.videos, next: r.nextCursor ?? undefined }));
    },
    [selected],
  );

  const heading =
    selected.kind === "channel"
      ? (channels.find((c) => c.channelId === selected.channelId)
          ?.channelName ?? "Channel")
      : selected.kind === "tag"
        ? selected.tag
        : "All subscriptions";

  return (
    <View style={styles.screen}>
      <Text style={styles.title}>Subscriptions</Text>
      <View style={styles.columns}>
        <View style={styles.pane}>
          {level === "root" ? (
            <FlatList
              data={channels}
              keyExtractor={(item) => item.channelId}
              ListHeaderComponent={
                <>
                  <ChannelRow
                    label="Everything"
                    icon="list"
                    active={selected.kind === "all"}
                    onFocus={() => selectAfterDelay({ kind: "all" })}
                    onPress={() => selectNow({ kind: "all" })}
                  />
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
                  {/* Separates the two overview rows from the channels. */}
                  <View style={styles.groupGap} />
                </>
              }
              renderItem={({ item }) => (
                <ChannelRow
                  label={item.channelName}
                  avatarUrl={item.avatarUrl}
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
              )}
              showsVerticalScrollIndicator={false}
              removeClippedSubviews={false}
              ListEmptyComponent={
                channelsError ? (
                  <Text style={styles.paneError}>{channelsError}</Text>
                ) : null
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
          <CarouselFeed
            feed={feed}
            onSelect={(videoId) => nav.openVideo(videoId)}
            header={<Text style={styles.heading}>{heading}</Text>}
            emptyText={
              selected.kind === "all"
                ? "You're not subscribed to any channels yet."
                : "No videos here yet."
            }
            // The channel list owns focus here; grabbing it back on every
            // selection change would fight the user's way down the list.
            preferFirstRowFocus={false}
          />
        </View>
      </View>
    </View>
  );
}

function ChannelRow({
  label,
  avatarUrl,
  icon,
  trailingIcon,
  active,
  onFocus,
  onPress,
}: {
  label: string;
  avatarUrl?: string | null;
  /** Used by rows without a channel avatar (All, Tags, Back). */
  icon?: keyof typeof Feather.glyphMap;
  /** Marks a row that drills into a submenu. */
  trailingIcon?: keyof typeof Feather.glyphMap;
  active: boolean;
  onFocus: () => void;
  onPress: () => void;
}) {
  const [focused, setFocused] = useState(false);
  const tint = active || focused ? colors.brand : colors.foreground;

  return (
    <Pressable
      onFocus={() => {
        setFocused(true);
        onFocus();
      }}
      onBlur={() => setFocused(false)}
      onPress={onPress}
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
        <Image source={{ uri: avatarUrl }} style={styles.avatar} />
      ) : (
        <View style={[styles.avatar, styles.avatarFallback]}>
          <Text style={styles.avatarInitial}>{channelInitial(label)}</Text>
        </View>
      )}
      <Text style={[styles.rowLabel, { color: tint }]} numberOfLines={1}>
        {label}
      </Text>
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
  paneError: {
    color: colors.mutedForeground,
    fontSize: fontSize.sm,
    paddingHorizontal: spacing.sm,
  },
  rowActive: { backgroundColor: colors.brandSoft },
  rowFocused: { backgroundColor: colors.accent, borderColor: colors.ring },
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
