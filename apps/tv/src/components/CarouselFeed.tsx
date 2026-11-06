import type { UnifiedVideo } from "@web/server/services/proxy.types";
import type { ReactNode, Ref } from "react";
import { useCallback, useMemo, useRef } from "react";
import {
  ActivityIndicator,
  FlatList,
  type ListRenderItem,
  StyleSheet,
  Text,
  View,
} from "react-native";
import type { CardMenuExtras } from "@/components/CardMenu";
import { FocusButton } from "@/components/FocusButton";
import { SkeletonRows } from "@/components/Skeleton";
import { VideoRow } from "@/components/VideoRow";
import type { InfiniteFeed } from "@/lib/use-infinite-feed";
import { colors, fontSize, spacing } from "@/theme";

/** Videos per horizontal shelf; more pages append more shelves. */
const ROW_SIZE = 12;

type Props = {
  feed: InfiniteFeed;
  /** Gets the whole list too, so the player can play on through it. */
  onSelect: (videoId: string, videos: UnifiedVideo[]) => void;
  header?: ReactNode;
  emptyText?: string;
  videos?: UnifiedVideo[];
  preferFirstRowFocus?: boolean;
  /** Screen-specific context-menu actions (reorder, remove…). */
  menuExtras?: CardMenuExtras;
  /** For cards that aren't videos (a channel's playlists). */
  disableMenu?: boolean;
  /** The shelves' list, e.g. to scroll back to the header. */
  listRef?: Ref<FlatList<UnifiedVideo[]>>;
};

/**
 * Stacked horizontal carousels (YouTube-TV style): the accumulated feed is
 * chunked into shelves a user scrolls through with D-pad right, and scrolling
 * down past the last shelf pulls the next page (`feed.loadMore`).
 */
export function CarouselFeed({
  feed,
  onSelect,
  header,
  emptyText,
  videos,
  preferFirstRowFocus = true,
  menuExtras,
  disableMenu,
  listRef,
}: Props) {
  const menuExtrasRef = useRef(menuExtras);
  menuExtrasRef.current = menuExtras;
  const extras = useCallback<CardMenuExtras>(
    (video) => menuExtrasRef.current?.(video) ?? [],
    [],
  );
  const listVideos = videos ?? feed.videos;
  const previousRows = useRef<UnifiedVideo[][]>([]);
  const rows = useMemo(() => {
    // Reuse unchanged shelves so appending a page only renders the new ones.
    const next = chunk(listVideos, ROW_SIZE).map((row, i) => {
      const prev = previousRows.current[i];
      return prev && sameVideos(prev, row) ? prev : row;
    });
    previousRows.current = next;
    return next;
  }, [listVideos]);

  // Screens pass inline handlers; a stable one keeps the memoized shelves
  // from re-rendering on every screen render.
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const listVideosRef = useRef(listVideos);
  listVideosRef.current = listVideos;
  const handleSelect = useCallback(
    (videoId: string) => onSelectRef.current(videoId, listVideosRef.current),
    [],
  );
  const renderItem = useCallback<ListRenderItem<UnifiedVideo[]>>(
    ({ item, index }) => (
      <VideoRow
        videos={item}
        onSelect={handleSelect}
        preferFirstFocus={preferFirstRowFocus && index === 0}
        menuExtras={extras}
        disableMenu={disableMenu}
      />
    ),
    [handleSelect, preferFirstRowFocus, extras, disableMenu],
  );

  if (feed.status === "loading") {
    // Header keeps its place; placeholder shelves stand where the real ones
    // will land, so the page doesn't jump when they do.
    return (
      <View style={styles.loadingWrap}>
        {header ? <View style={styles.header}>{header}</View> : null}
        <SkeletonRows rows={2} heading={false} />
      </View>
    );
  }

  if (feed.status === "error") {
    return (
      <View style={styles.centered}>
        {header}
        <Text style={styles.errorTitle}>Something went wrong</Text>
        <Text style={styles.muted}>{feed.message}</Text>
        <FocusButton
          label="Retry"
          variant="primary"
          loading={feed.retrying}
          onPress={feed.retry}
        />
      </View>
    );
  }

  if (listVideos.length === 0) {
    return (
      <View style={styles.emptyContainer}>
        {header ? <View style={styles.header}>{header}</View> : null}
        <Text style={styles.muted}>{emptyText ?? "Nothing here yet."}</Text>
        {feed.loadingMore ? (
          <ActivityIndicator size="small" color={colors.brand} />
        ) : null}
      </View>
    );
  }

  return (
    <FlatList
      ref={listRef}
      data={rows}
      keyExtractor={shelfKey}
      ListHeaderComponent={
        header ? <View style={styles.header}>{header}</View> : null
      }
      renderItem={renderItem}
      ItemSeparatorComponent={Gap}
      contentContainerStyle={styles.list}
      showsVerticalScrollIndicator={false}
      // Keep off-viewport shelves attached so D-pad focus reaches them on the
      // first press rather than needing one press to scroll and another to act.
      removeClippedSubviews={false}
      initialNumToRender={4}
      windowSize={7}
      onEndReached={feed.loadMore}
      onEndReachedThreshold={0.6}
      ListFooterComponent={
        feed.loadingMore ? (
          <ActivityIndicator
            style={styles.footer}
            size="small"
            color={colors.brand}
          />
        ) : null
      }
    />
  );
}

function Gap() {
  return <View style={styles.gap} />;
}

function shelfKey(_: UnifiedVideo[], index: number) {
  return `shelf-${index}`;
}

function sameVideos(a: UnifiedVideo[], b: UnifiedVideo[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function chunk(videos: UnifiedVideo[], size: number): UnifiedVideo[][] {
  const rows: UnifiedVideo[][] = [];
  for (let i = 0; i < videos.length; i += size) {
    rows.push(videos.slice(i, i + size));
  }
  return rows;
}

const styles = StyleSheet.create({
  list: { paddingBottom: spacing.screen },
  gap: { height: spacing.xl },
  header: { marginBottom: spacing.lg },
  footer: { paddingVertical: spacing.lg },
  centered: {
    flex: 1,
    justifyContent: "center",
    alignItems: "flex-start",
    gap: spacing.md,
  },
  loadingWrap: { flex: 1 },
  emptyContainer: {
    flex: 1,
    alignItems: "flex-start",
    gap: spacing.md,
  },
  errorTitle: {
    color: colors.foreground,
    fontSize: fontSize.lg,
    fontWeight: "700",
  },
  muted: { color: colors.mutedForeground, fontSize: fontSize.md },
});
