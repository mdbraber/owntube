import { useEffect, useRef } from "react";
import { Animated, View } from "react-native";
import { VIDEO_CARD_WIDTH } from "@/components/VideoCard";
import { createStyles } from "@/lib/ui-scale";
import { colors, radius, spacing } from "@/theme";

/** Card-sized placeholders per shelf; enough to cross a 1080p panel. */
const CARDS = ["a", "b", "c", "d", "e"];
/** Shelves on offer; `rows` takes the first so many. */
const SHELVES = ["one", "two", "three", "four"];

/**
 * Placeholder shelves shown while a page's first data loads, in the shape of
 * the rows that replace them, so nothing jumps when they land — what the
 * YouTube and Plex clients show instead of a spinner. They pulse gently so a
 * slow server still reads as loading rather than stuck.
 */
export function SkeletonRows({
  rows = 2,
  heading = true,
}: {
  rows?: number;
  /** A bar where the row title goes. */
  heading?: boolean;
}) {
  const pulse = useRef(new Animated.Value(0.5)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 900,
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0.5,
          duration: 900,
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  return (
    <Animated.View style={[styles.rows, { opacity: pulse }]}>
      {SHELVES.slice(0, rows).map((shelf) => (
        <View key={shelf} style={styles.row}>
          {heading ? <View style={styles.heading} /> : null}
          <View style={styles.cards}>
            {CARDS.map((card) => (
              <View key={card} style={styles.card}>
                <View style={styles.thumb} />
                <View style={styles.meta}>
                  <View style={styles.avatar} />
                  <View style={styles.lines}>
                    <View style={styles.line} />
                    <View style={[styles.line, styles.lineShort]} />
                  </View>
                </View>
              </View>
            ))}
          </View>
        </View>
      ))}
    </Animated.View>
  );
}

const styles = createStyles({
  rows: { gap: spacing.xl },
  row: { gap: spacing.sm },
  heading: {
    width: 180,
    height: 22,
    borderRadius: 6,
    backgroundColor: colors.muted,
  },
  cards: { flexDirection: "row", gap: spacing.md, paddingHorizontal: 3 },
  card: { width: VIDEO_CARD_WIDTH },
  thumb: {
    width: "100%",
    aspectRatio: 16 / 9,
    borderRadius: radius.card,
    backgroundColor: colors.muted,
  },
  meta: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.sm },
  avatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.muted,
  },
  lines: { flex: 1, gap: 6, paddingTop: 4 },
  line: { height: 12, borderRadius: 4, backgroundColor: colors.muted },
  lineShort: { width: "55%" },
});
