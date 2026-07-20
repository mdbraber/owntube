import { Feather } from "@expo/vector-icons";
import { useState } from "react";
import { Pressable, StyleSheet, Text } from "react-native";
import { ActionIcon, type ActionIconName } from "@/components/ActionIcon";
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
  /** Renders text instead of an icon — used for the "CC" badge. */
  text?: string;
  /** Draws the web app's own glyph instead of a Feather lookalike. */
  action?: ActionIconName;
};

/** Circular D-pad focusable icon button — brand fill + light ring on focus. */
export function IconButton({
  icon,
  onPress,
  large,
  hasTVPreferredFocus,
  onFocusChange,
  active,
  text,
  action,
}: Props) {
  const [focused, setFocused] = useState(false);
  const size = large ? 40 : 30;
  const iconSize = large ? 20 : 16;
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
      {action ? (
        <ActionIcon
          name={action}
          size={iconSize}
          color={activeFill ? colors.primaryForeground : colors.foreground}
        />
      ) : text ? (
        <Text
          style={[
            styles.text,
            {
              fontSize: iconSize - 2,
              color: activeFill ? colors.primaryForeground : colors.foreground,
            },
          ]}
        >
          {text}
        </Text>
      ) : (
        <Feather
          name={icon}
          size={iconSize}
          color={activeFill ? colors.primaryForeground : colors.foreground}
        />
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  text: { fontWeight: "800", letterSpacing: -0.5 },
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
