import type { UnifiedVideo } from "@web/server/services/proxy.types";
import { memo, useCallback } from "react";
import {
  FlatList,
  type ListRenderItem,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SkeletonRows } from "@/components/Skeleton";
import { VideoRow } from "@/components/VideoRow";
import { trpc } from "@/lib/trpc-react";
import { colors, fontSize, spacing } from "@/theme";

/** Latest uploads per tag shelf; the tag's own page has the rest. */
const SHELF_VIDEOS = 16;

type Tag = { tag: string; count: number };

type Props = {
  tags: Tag[];
  /** Plays a video with its shelf as the context, so next stays in the tag. */
  onSelect: (videoId: string, tag: string, videos: UnifiedVideo[]) => void;
  header?: React.ReactNode;
};

/**
 * Subscriptions "By tag": one shelf per tag, each the newest uploads from the
 * channels carrying it, stacked like Home's rows. Shelves load as the list
 * brings them in, so many tags don't all fetch at once.
 */
export function TagShelves({ tags, onSelect, header }: Props) {
  const renderItem = useCallback<ListRenderItem<Tag>>(
    ({ item }) => <TagShelf tag={item.tag} onSelect={onSelect} />,
    [onSelect],
  );

  if (tags.length === 0) {
    return (
      <View>
        {header}
        <Text style={styles.muted}>
          No tags yet. Tag channels on the web to group them here.
        </Text>
      </View>
    );
  }

  return (
    <FlatList
      data={tags}
      keyExtractor={(item) => item.tag}
      ListHeaderComponent={
        header ? <View style={styles.header}>{header}</View> : null
      }
      renderItem={renderItem}
      contentContainerStyle={styles.list}
      showsVerticalScrollIndicator={false}
      // Off-viewport shelves stay attached so D-pad focus reaches them on the
      // first press (as in CarouselFeed).
      removeClippedSubviews={false}
      initialNumToRender={2}
      windowSize={3}
    />
  );
}

const TagShelf = memo(function TagShelf({
  tag,
  onSelect,
}: {
  tag: string;
  onSelect: Props["onSelect"];
}) {
  const feed = trpc.subscriptions.mergedFeedInfinite.useQuery({
    limit: SHELF_VIDEOS,
    cursor: null,
    includeTags: [tag],
  });
  const videos = feed.data?.videos ?? [];
  const handleSelect = useCallback(
    (videoId: string) => onSelect(videoId, tag, videos),
    [onSelect, tag, videos],
  );

  if (feed.isPending) {
    return (
      <View style={styles.shelf}>
        <Text style={styles.title}>{tag}</Text>
        <SkeletonRows rows={1} heading={false} />
      </View>
    );
  }
  // A tag whose channels have nothing (or a failed load) takes no room.
  if (videos.length === 0) return null;
  return (
    <View style={styles.shelf}>
      <VideoRow title={tag} videos={videos} onSelect={handleSelect} />
    </View>
  );
});

const styles = StyleSheet.create({
  list: { paddingBottom: spacing.screen },
  header: { marginBottom: spacing.lg },
  shelf: { marginBottom: spacing.xl },
  title: {
    color: colors.cardTitle,
    fontSize: fontSize.md,
    fontWeight: "700",
    marginBottom: spacing.sm,
  },
  muted: { color: colors.mutedForeground, fontSize: fontSize.md },
});
