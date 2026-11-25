import { useCallback, useRef } from "react";
import type { LayoutChangeEvent, ScrollViewInstance } from "react-native";
import { s } from "@/lib/ui-scale";
import { spacing } from "@/theme";

/**
 * Brings the row a card belongs to up to the top of a vertical ScrollView when
 * the card takes focus, the way the YouTube and Plex clients page through their
 * rows. Android on its own scrolls a focused view into sight by the least it
 * can, which left whatever sat above the first row (Home's hero) sliced
 * through the middle.
 *
 * Wrap each row in a View with `onLayout={(e) => onRowLayout(key, e)}` and
 * hand the row `onCardFocusChange={(f) => f && scrollToRow(key)}`; anything
 * above the rows comes back into view when focus moves up out of them. A
 * sticky header (the ScrollView's first child, `stickyHeaderIndices={[0]}`)
 * reports its height through `onHeaderLayout`, and rows land just under it.
 */
export function useRowScroll() {
  const scrollRef = useRef<ScrollViewInstance>(null);
  const rowTops = useRef(new Map<string, number>());
  const headerHeight = useRef(0);
  const onRowLayout = useCallback((key: string, e: LayoutChangeEvent) => {
    rowTops.current.set(key, e.nativeEvent.layout.y);
  }, []);
  const onHeaderLayout = useCallback((e: LayoutChangeEvent) => {
    headerHeight.current = e.nativeEvent.layout.height;
  }, []);
  const scrollToRow = useCallback((key: string) => {
    const top = rowTops.current.get(key);
    if (top === undefined) return;
    scrollRef.current?.scrollTo({
      y: Math.max(0, top - headerHeight.current - s(spacing.lg)),
      animated: true,
    });
  }, []);
  const scrollToTop = useCallback(() => {
    scrollRef.current?.scrollTo({ y: 0, animated: true });
  }, []);
  return { scrollRef, onRowLayout, onHeaderLayout, scrollToRow, scrollToTop };
}
