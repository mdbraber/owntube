import { Feather } from "@expo/vector-icons";
import { useState } from "react";
import { Pressable, StyleSheet } from "react-native";
import { colors, focus } from "@/theme";

type Props = {
  icon: keyof typeof Feather.glyphMap;
  onPress: () => void;
  /** The primary control (play/pause) renders larger. */
  large?: boolean;
  hasTVPreferredFocus?: boolean;
  /** Lets the player know when the transport button owns focus (for scrubbing). */
  onFocusChange?: (focused: boolean) => void;
  /** Highlights a toggled-on state, e.g. CC enabled. */
  active?: boolean;
};

/** Circular D-pad focusable icon button — brand fill + light ring on focus. */
export function IconButton({
  icon,
  onPress,
  large,
  hasTVPreferredFocus,
  onFocusChange,
  active,
}: Props) {
  const [focused, setFocused] = useState(false);
  const size = large ? 72 : 56;
  const iconSize = large ? 32 : 24;
  const activeFill = focused || large || Boolean(active);

  return (
    <Pressable
      hasTVPreferredFocus={hasTVPreferredFocus}
      onFocus={() => {
        setFocused(true);
        onFocusChange?.(true);
      }}
      onBlur={() => {
        setFocused(false);
        onFocusChange?.(false);
      }}
      onPress={onPress}
      style={[
        styles.button,
        { width: size, height: size, borderRadius: size / 2 },
        large && styles.primary,
        active && styles.primary,
        focused && styles.focused,
      ]}
    >
      <Feather
        name={icon}
        size={iconSize}
        color={activeFill ? colors.primaryForeground : colors.foreground}
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surface,
    borderWidth: focus.borderWidth,
    borderColor: colors.surfaceBorder,
  },
  primary: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  focused: {
    backgroundColor: colors.brand,
    borderColor: colors.primaryForeground,
    shadowColor: colors.brand,
    shadowOpacity: focus.shadowOpacity,
    shadowRadius: focus.shadowRadius,
    shadowOffset: focus.shadowOffset,
    elevation: focus.elevation,
    transform: [{ scale: focus.scale }],
  },
});
