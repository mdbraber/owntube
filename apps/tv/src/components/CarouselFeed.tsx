import type { UnifiedVideo } from "@web/server/services/proxy.types";
import type { ReactNode } from "react";
import { useMemo } from "react";
import {
  ActivityIndicator,
  FlatList,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { VideoRow } from "@/components/VideoRow";
import type { InfiniteFeed } from "@/lib/use-infinite-feed";
import { colors, fontSize, spacing } from "@/theme";

/** Videos per horizontal shelf; more pages append more shelves. */
const ROW_SIZE = 12;

type Props = {
  feed: InfiniteFeed;
  onSelect: (videoId: string) => void;
  header?: ReactNode;
  emptyText?: string;
  videos?: UnifiedVideo[];
  preferFirstRowFocus?: boolean;
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
}: Props) {
  const listVideos = videos ?? feed.videos;
  const rows = useMemo(() => chunk(listVideos, ROW_SIZE), [listVideos]);

  if (feed.status === "loading") {
    // Header keeps its place; the spinner centres in the space left over,
    // rather than sitting against the left edge.
    return (
      <View style={styles.loadingWrap}>
        {header}
        <View style={styles.loadingCenter}>
          <ActivityIndicator size="large" color={colors.brand} />
        </View>
      </View>
    );
  }

  if (feed.status === "error") {
    return (
      <View style={styles.centered}>
        {header}
        <Text style={styles.errorTitle}>Something went wrong</Text>
        <Text style={styles.muted}>{feed.message}</Text>
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
      data={rows}
      keyExtractor={(_, index) => `shelf-${index}`}
      ListHeaderComponent={
        header ? <View style={styles.header}>{header}</View> : null
      }
      renderItem={({ item, index }) => (
        <VideoRow
          videos={item}
          onSelect={onSelect}
          preferFirstFocus={preferFirstRowFocus && index === 0}
        />
      )}
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
  return <View style={{ height: spacing.xl }} />;
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
  header: { marginBottom: spacing.lg },
  footer: { paddingVertical: spacing.lg },
  centered: {
    flex: 1,
    justifyContent: "center",
    alignItems: "flex-start",
    gap: spacing.md,
  },
  loadingWrap: { flex: 1 },
  loadingCenter: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
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
