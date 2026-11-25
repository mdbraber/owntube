import type { UnifiedVideo } from "@web/server/services/proxy.types";
import { memo, useCallback, useRef } from "react";
import {
  FlatList,
  type ListRenderItem,
  Text,
  TVFocusGuideView,
  View,
} from "react-native";
import { type CardMenuExtras, useCardMenu } from "@/components/CardMenu";
import { VIDEO_CARD_WIDTH, VideoCard } from "@/components/VideoCard";
import { setLongPressTarget, takeSuppressedPress } from "@/lib/long-press";
import { createStyles, s } from "@/lib/ui-scale";
import { colors, fontSize, spacing } from "@/theme";

type Props = {
  title?: string;
  videos: UnifiedVideo[];
  onSelect: (videoId: string) => void;
  /** Focus the first card of this row when the content area first gains focus. */
  preferFirstFocus?: boolean;
  /**
   * Bubbles card focus (with the card's video) so a parent can bring the row
   * into view, or show the video's details.
   */
  onCardFocusChange?: (focused: boolean, video?: UnifiedVideo) => void;
  /** Screen-specific context-menu actions for a card. */
  menuExtras?: CardMenuExtras;
  /** Cards that aren't videos (playlists) have no video context menu. */
  disableMenu?: boolean;
  /** Nearing the row's last card: a paged row loads its next page here. */
  onEndReached?: () => void;
};

/**
 * A D-pad horizontally-scrollable row of video cards (optionally titled).
 * FlatList keeps long upstream feeds virtualized, and TV focus naturally scrolls
 * the row as the user moves right past the viewport edge.
 *
 * Memoized, with callbacks routed through refs so every card receives the same
 * function identities across renders — otherwise each parent render would
 * re-render every card in every row.
 */
export const VideoRow = memo(function VideoRow({
  title,
  videos,
  onSelect,
  preferFirstFocus,
  onCardFocusChange,
  menuExtras,
  disableMenu,
  onEndReached,
}: Props) {
  const cardMenu = useCardMenu();
  const menuRef = useRef({ cardMenu, menuExtras, videos, disableMenu });
  menuRef.current = { cardMenu, menuExtras, videos, disableMenu };
  // The focused card's long press, registered for the Shell's dispatcher.
  const longPressRef = useRef<(() => void) | null>(null);
  const handleLongPress = useCallback((video: UnifiedVideo) => {
    const { cardMenu, menuExtras } = menuRef.current;
    cardMenu.open(video, menuExtras?.(video));
  }, []);
  const listRef = useRef<FlatList<UnifiedVideo>>(null);
  /** 0 until the row has been laid out; the centring maths needs a real one. */
  const listWidthRef = useRef(0);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const onCardFocusChangeRef = useRef(onCardFocusChange);
  onCardFocusChangeRef.current = onCardFocusChange;

  const handlePress = useCallback((videoId: string) => {
    if (takeSuppressedPress()) return;
    onSelectRef.current(videoId);
  }, []);

  /**
   * TV focus can move to a card outside the viewport without the list
   * scrolling, so the card lands off screen. Drive the scroll from focus and
   * keep the focused card at the row's left edge, as the YouTube app does:
   * the eye stays in one column while the row slides under it.
   */
  const handleFocusChange = useCallback(
    (focused: boolean, index: number) => {
      const { videos, disableMenu, cardMenu } = menuRef.current;
      const video = videos[index];
      if (focused && video && !disableMenu) {
        const action = () => handleLongPress(video);
        longPressRef.current = action;
        setLongPressTarget(action);
        cardMenu.hintLongPress();
      } else if (!focused && longPressRef.current) {
        setLongPressTarget(null, longPressRef.current);
        longPressRef.current = null;
      }
      // Scrolling needs the row's measured width: before the first layout
      // FlatList works it out against a zero-width viewport and lands half an
      // item in, which pushed the first card half off the left edge the moment
      // a section opened. Android scrolls a focused child into view by itself,
      // so skipping the centring until the row is measured strands nothing.
      if (focused && listWidthRef.current > 0) {
        listRef.current?.scrollToIndex({
          index,
          animated: true,
          viewPosition: 0,
        });
      }
      onCardFocusChangeRef.current?.(focused, video);
    },
    [handleLongPress],
  );

  const renderItem = useCallback<ListRenderItem<UnifiedVideo>>(
    ({ item, index }) => (
      <VideoCard
        video={item}
        index={index}
        onPress={handlePress}
        onLongPress={disableMenu ? undefined : handleLongPress}
        hasTVPreferredFocus={preferFirstFocus && index === 0}
        onFocusChange={handleFocusChange}
      />
    ),
    [
      handlePress,
      handleLongPress,
      handleFocusChange,
      preferFirstFocus,
      disableMenu,
    ],
  );

  return (
    <View style={styles.row}>
      {title ? <Text style={styles.heading}>{title}</Text> : null}
      {/* Entering the row (from the hero above, or another row) lands on
          the card last focused here, else the first: without it Android
          picks the card nearest the previous focus, so Down from the
          full-width hero landed on the second card. Right at the row's last
          card stays put; Android otherwise hands focus to the nearest card
          in some other row. */}
      <TVFocusGuideView autoFocus trapFocusRight>
        <FlatList
          ref={listRef}
          onLayout={(e) => {
            listWidthRef.current = e.nativeEvent.layout.width;
          }}
          horizontal
          data={videos}
          keyExtractor={keyExtractor}
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.listContent}
          // TV focus can only land on an attached view. With clipping on, the
          // card just off the viewport edge isn't focusable yet, so the first
          // D-pad press only scrolls it in and a second is needed to select.
          removeClippedSubviews={false}
          // Every mounted card holds its decoded thumbnail (~0.7 MB), and rows
          // on hidden screens stay mounted. Nine viewports' worth per row ran
          // Fresco's bitmap pool into its hard cap, after which new thumbnails
          // failed to load and stayed blank. One viewport either side is still
          // ahead of the D-pad.
          initialNumToRender={5}
          windowSize={3}
          ItemSeparatorComponent={Separator}
          renderItem={renderItem}
          onScrollToIndexFailed={ignore}
          onEndReached={onEndReached}
          // Two viewports ahead, so the next page is in before the D-pad
          // gets there.
          onEndReachedThreshold={2}
          getItemLayout={getItemLayout}
        />
      </TVFocusGuideView>
    </View>
  );
});

const ITEM_LENGTH = VIDEO_CARD_WIDTH + spacing.md;

function keyExtractor(video: UnifiedVideo) {
  return video.videoId;
}

function getItemLayout(_: unknown, index: number) {
  return { length: s(ITEM_LENGTH), offset: s(ITEM_LENGTH) * index, index };
}

function ignore() {}

function Separator() {
  return <View style={styles.separator} />;
}

const styles = createStyles({
  row: { gap: spacing.sm, overflow: "visible" },
  listContent: {
    paddingVertical: 6,
    paddingHorizontal: 3,
  },
  separator: { width: spacing.md },
  // Small and grey, like the YouTube app's row titles: the cards lead.
  heading: {
    color: colors.cardTitle,
    fontSize: fontSize.md,
    fontWeight: "600",
  },
});
