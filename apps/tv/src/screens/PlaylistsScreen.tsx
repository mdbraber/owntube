import { Feather } from "@expo/vector-icons";
import type { UnifiedVideo } from "@web/server/catalog/types";
import { useEffect, useMemo, useState } from "react";
import { FlatList, Pressable, Text, View } from "react-native";
import { type CardMenuExtras, useCardMenu } from "@/components/CardMenu";
import { CarouselFeed } from "@/components/CarouselFeed";
import { FocusButton } from "@/components/FocusButton";
import { errorMessage } from "@/lib/error-message";
import type { Nav, PlayContext } from "@/lib/navigation";
import { playAllStart } from "@/lib/play-all";
import { queryClient } from "@/lib/query-client";
import { moveId } from "@/lib/reorder";
import { trpcClient } from "@/lib/trpc";
import { trpc } from "@/lib/trpc-react";
import { createStyles, s } from "@/lib/ui-scale";
import { useInfiniteFeed } from "@/lib/use-infinite-feed";
import { useProgressLookup } from "@/lib/watch-progress";
import { colors, focus, fontSize, radius, spacing } from "@/theme";

const PANE_WIDTH = 220;
/** Matches the Subscriptions pane's avatar, so both lists share a row pitch. */
const ROW_ICON_SIZE = 28;

type Playlist = { id: number; name: string; itemCount: number };

/**
 * Playlists beside their contents, mirroring the Subscriptions layout so the
 * two behave the same: selection follows focus, and the videos pane never
 * steals focus back mid-scroll.
 *
 * Browse-only for now — creating and reordering playlists is far easier on the
 * web, and a TV remote is the wrong tool for it.
 */
export function PlaylistsScreen({ nav }: { nav: Nav }) {
  const [selected, setSelected] = useState<number | null>(null);
  // Cached and shared like every other read; revisiting shows the last list
  // immediately instead of refetching.
  const list = trpc.playlists.list.useQuery();
  const playlists: Playlist[] = useMemo(
    () =>
      (list.data ?? []).map((r) => ({
        id: r.id,
        name: r.name,
        itemCount: r.itemCount,
      })),
    [list.data],
  );
  const error = list.error ? errorMessage(list.error) : null;

  useEffect(() => {
    setSelected((prev) => prev ?? playlists[0]?.id ?? null);
  }, [playlists]);

  const feed = useInfiniteFeed<never>(
    () =>
      selected === null
        ? Promise.resolve({ items: [], next: undefined })
        : trpcClient.playlists.itemsDetailed
            .query({ playlistId: selected })
            .then((rows) => ({
              items: rows.map((row) => ({
                videoId: row.videoId,
                title: row.videoTitle,
                thumbnailUrl: row.thumbnailUrl,
                channelName: row.channelName ?? undefined,
              })),
              next: undefined,
            })),
    [selected],
    selected === null ? undefined : `playlists.itemsDetailed:${selected}`,
  );

  const heading = playlists.find((p) => p.id === selected)?.name ?? "Playlists";
  const progress = useProgressLookup();
  const play = (videoId: string, videos: UnifiedVideo[]) => {
    const context: PlayContext = { source: "playlist", label: heading, videos };
    nav.openVideo(videoId, { context });
  };
  const first = playAllStart(feed.videos, progress);

  const { notify } = useCardMenu();
  const menuExtras: CardMenuExtras = (video) => {
    if (selected === null) return [];
    const playlistId = selected;
    const refresh = () =>
      queryClient.invalidateQueries({
        queryKey: ["feed", `playlists.itemsDetailed:${playlistId}`],
      });
    const ids = feed.videos.map((v) => v.videoId);
    const move = (delta: -1 | 1) => {
      const next = moveId(ids, video.videoId, delta);
      if (!next) return;
      trpcClient.playlists.reorderItems
        .mutate({ playlistId, videoIds: next })
        .then(refresh)
        .catch(() => notify("Couldn't reorder the playlist"));
    };
    return [
      {
        key: "remove",
        label: `Remove from ${heading}`,
        onPress: () => {
          trpcClient.playlists.removeItem
            .mutate({ playlistId, videoId: video.videoId })
            .then(() => {
              notify(`Removed from ${heading}`);
              return refresh();
            })
            .catch(() => notify("Couldn't update the playlist"));
        },
      },
      { key: "up", label: "Move up", onPress: () => move(-1) },
      { key: "down", label: "Move down", onPress: () => move(1) },
    ];
  };

  return (
    <View style={styles.screen}>
      <Text style={styles.title}>Playlists</Text>
      <View style={styles.columns}>
        <View style={styles.pane}>
          <FlatList
            data={playlists}
            keyExtractor={(item) => String(item.id)}
            showsVerticalScrollIndicator={false}
            removeClippedSubviews={false}
            renderItem={({ item }) => (
              <PlaylistRow
                label={item.name}
                count={item.itemCount}
                active={selected === item.id}
                onFocus={() => setSelected(item.id)}
                onPress={() => setSelected(item.id)}
              />
            )}
            ListEmptyComponent={
              <Text style={styles.muted}>
                {error ?? "No playlists yet — create one on the web."}
              </Text>
            }
          />
        </View>
        <View style={styles.feed}>
          <CarouselFeed
            feed={feed}
            onSelect={play}
            menuExtras={menuExtras}
            header={
              <View style={styles.feedHeader}>
                <Text style={styles.heading}>{heading}</Text>
                {first ? (
                  <FocusButton
                    label="Play all"
                    variant="primary"
                    onPress={() => play(first.videoId, feed.videos)}
                  />
                ) : null}
              </View>
            }
            emptyText="This playlist is empty."
            preferFirstRowFocus={false}
          />
        </View>
      </View>
    </View>
  );
}

/**
 * A pane row shaped like the Subscriptions one: borderless until focused, icon
 * then left-aligned label, brand tint once selected. Kept local rather than
 * shared — that pane's rows also carry avatars, fresh dots and submenu
 * chevrons, none of which a playlist has.
 */
function PlaylistRow({
  label,
  count,
  active,
  onFocus,
  onPress,
}: {
  label: string;
  count: number;
  active: boolean;
  onFocus: () => void;
  onPress: () => void;
}) {
  const [focused, setFocused] = useState(false);
  const tint = focused ? colors.focusForeground : colors.foreground;
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
      <View style={styles.rowIcon}>
        <Feather name="folder" size={s(16)} color={tint} />
      </View>
      <Text style={[styles.rowLabel, { color: tint }]} numberOfLines={1}>
        {label}
      </Text>
      <Text style={styles.rowCount}>{count}</Text>
    </Pressable>
  );
}

const styles = createStyles({
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
  feedHeader: { flexDirection: "row", alignItems: "center", gap: spacing.lg },
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
  // Focused lands after active, so the opaque fill is the one under the focus
  // ring — a translucent one would show the glow through it.
  rowActive: { backgroundColor: colors.brandSoft },
  rowFocused: {
    backgroundColor: colors.focusFill,
    borderColor: colors.focusFill,
  },
  rowIcon: {
    width: ROW_ICON_SIZE,
    height: ROW_ICON_SIZE,
    borderRadius: ROW_ICON_SIZE / 2,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.accent,
  },
  rowLabel: { flex: 1, fontSize: fontSize.md, fontWeight: "600" },
  // Sits where the Subscriptions row keeps its fresh dot and chevron. Muted
  // rather than tinted, so it reads as metadata and not a second label.
  rowCount: { color: colors.mutedForeground, fontSize: fontSize.sm },
  muted: { color: colors.mutedForeground, fontSize: fontSize.sm },
});
