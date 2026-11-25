import { Feather } from "@expo/vector-icons";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { createStyles, s } from "@/lib/ui-scale";
import { colors, focus, fontSize, spacing } from "@/theme";

/**
 * The search entry pinned at the top of Home, laid out as in the Android TV
 * YouTube app: a round mic, then a short pill. Both only open the Search page,
 * so the keyboard and the microphone stay where the results are; one focus
 * stop covers the pair. One press Up from the first row reaches it.
 */
export function SearchBar({
  onPress,
  onFocusChange,
}: {
  onPress: () => void;
  /** Lets the page scroll back to its top when the bar takes focus. */
  onFocusChange?: (focused: boolean) => void;
}) {
  const [focused, setFocused] = useState(false);
  return (
    <Pressable
      onFocus={() => {
        setFocused(true);
        onFocusChange?.(true);
      }}
      onBlur={() => {
        setFocused(false);
        onFocusChange?.(false);
      }}
      onPress={onPress}
      style={styles.bar}
    >
      <View style={[styles.mic, focused && styles.micFocused]}>
        <Feather
          name="mic"
          size={s(20)}
          color={focused ? colors.focusForeground : colors.foreground}
        />
      </View>
      <View style={[styles.pill, focused && styles.pillFocused]}>
        <Text
          style={[styles.placeholder, focused && styles.placeholderFocused]}
          numberOfLines={1}
        >
          Search
        </Text>
      </View>
    </Pressable>
  );
}

const HEIGHT = 44;

const styles = createStyles({
  bar: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  mic: {
    width: HEIGHT,
    height: HEIGHT,
    borderRadius: HEIGHT / 2,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surfaceStrong,
  },
  micFocused: { backgroundColor: colors.focusFill },
  pill: {
    width: 320,
    height: HEIGHT,
    justifyContent: "center",
    paddingHorizontal: spacing.lg,
    borderRadius: HEIGHT / 2,
    backgroundColor: colors.surfaceStrong,
    borderWidth: focus.borderWidth,
    borderColor: "transparent",
  },
  pillFocused: { borderColor: colors.ring },
  placeholder: {
    color: colors.mutedForeground,
    fontSize: fontSize.lg,
    fontWeight: "600",
  },
  placeholderFocused: { color: colors.foreground },
});
