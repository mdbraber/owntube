import type { UnifiedVideo } from "@web/server/services/proxy.types";
import { useRef } from "react";
import { FlatList, StyleSheet, Text, View } from "react-native";
import { VIDEO_CARD_WIDTH, VideoCard } from "@/components/VideoCard";
import { colors, fontSize, spacing } from "@/theme";

type Props = {
  title?: string;
  videos: UnifiedVideo[];
  onSelect: (videoId: string) => void;
  /** Focus the first card of this row when the content area first gains focus. */
  preferFirstFocus?: boolean;
  /** Bubbles card focus so a parent can bring the row fully into view. */
  onCardFocusChange?: (focused: boolean) => void;
};

/**
 * A D-pad horizontally-scrollable row of video cards (optionally titled).
 * FlatList keeps long upstream feeds virtualized, and TV focus naturally scrolls
 * the row as the user moves right past the viewport edge.
 */
export function VideoRow({
  title,
  videos,
  onSelect,
  preferFirstFocus,
  onCardFocusChange,
}: Props) {
  const listRef = useRef<FlatList<UnifiedVideo>>(null);

  /**
   * TV focus can move to a card outside the viewport without the list
   * scrolling, so the card lands off screen. Drive the scroll from focus and
   * centre the focused card.
   */
  const revealIndex = (index: number) => {
    listRef.current?.scrollToIndex({
      index,
      animated: true,
      viewPosition: 0.5,
    });
  };

  return (
    <View style={styles.row}>
      {title ? <Text style={styles.heading}>{title}</Text> : null}
      <FlatList
        ref={listRef}
        horizontal
        data={videos}
        keyExtractor={(video) => video.videoId}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.listContent}
        // TV focus can only land on an attached view. With clipping on, the
        // card just off the viewport edge isn't focusable yet, so the first
        // D-pad press only scrolls it in and a second is needed to select.
        removeClippedSubviews={false}
        initialNumToRender={8}
        windowSize={9}
        ItemSeparatorComponent={Separator}
        renderItem={({ item, index }) => (
          <VideoCard
            video={item}
            onPress={onSelect}
            hasTVPreferredFocus={preferFirstFocus && index === 0}
            onFocusChange={(focused) => {
              if (focused) revealIndex(index);
              onCardFocusChange?.(focused);
            }}
          />
        )}
        onScrollToIndexFailed={() => {}}
        getItemLayout={(_, index) => ({
          length: VIDEO_CARD_WIDTH + spacing.md,
          offset: (VIDEO_CARD_WIDTH + spacing.md) * index,
          index,
        })}
      />
    </View>
  );
}

function Separator() {
  return <View style={{ width: spacing.md }} />;
}

const styles = StyleSheet.create({
  row: { gap: spacing.sm, overflow: "visible" },
  listContent: {
    paddingVertical: 6,
    paddingHorizontal: 3,
  },
  heading: {
    color: colors.foreground,
    fontSize: fontSize.lg,
    fontWeight: "700",
  },
});
