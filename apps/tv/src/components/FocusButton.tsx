import { useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  type PressableProps,
  type StyleProp,
  StyleSheet,
  Text,
  type ViewStyle,
} from "react-native";
import { colors, focus, fontSize, radius, spacing } from "@/theme";

type Variant = "primary" | "ghost";

type Props = {
  label: string;
  onPress: () => void;
  variant?: Variant;
  disabled?: boolean;
  loading?: boolean;
  hasTVPreferredFocus?: boolean;
  style?: StyleProp<ViewStyle>;
  /** Lets a parent follow focus, e.g. to preview the selected row. */
  onFocusChange?: (focused: boolean) => void;
};

export function FocusButton({
  label,
  onPress,
  variant = "ghost",
  disabled = false,
  loading = false,
  hasTVPreferredFocus,
  style,
  onFocusChange,
}: Props) {
  const [focused, setFocused] = useState(false);
  const isDisabled = disabled || loading;

  const onFocus: PressableProps["onFocus"] = () => {
    setFocused(true);
    onFocusChange?.(true);
  };
  const onBlur: PressableProps["onBlur"] = () => {
    setFocused(false);
    onFocusChange?.(false);
  };

  return (
    <Pressable
      hasTVPreferredFocus={hasTVPreferredFocus}
      disabled={isDisabled}
      onFocus={onFocus}
      onBlur={onBlur}
      onPress={onPress}
      style={[
        styles.base,
        variant === "primary" && styles.primary,
        focused && styles.focused,
        isDisabled && styles.disabled,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={colors.foreground} />
      ) : (
        <Text style={styles.label}>{label}</Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: 48,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.shell,
    backgroundColor: colors.surface,
    borderWidth: focus.borderWidth,
    borderColor: colors.surfaceBorder,
    alignItems: "center",
    justifyContent: "center",
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
  disabled: { opacity: 0.4 },
  label: {
    color: colors.foreground,
    fontSize: fontSize.md,
    fontWeight: "600",
  },
});
