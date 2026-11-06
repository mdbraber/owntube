import { forwardRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  type PressableProps,
  type StyleProp,
  StyleSheet,
  Text,
  type View,
  type ViewStyle,
} from "react-native";
import { colors, focus, fontSize, radius, spacing } from "@/theme";

type Variant = "primary" | "ghost";

type Props = {
  label: string;
  onPress: () => void;
  variant?: Variant;
  /**
   * The current one of a set (a sort order). Outlined, not filled: filled is
   * what focus looks like, so a filled current chip read as a second focus.
   */
  selected?: boolean;
  disabled?: boolean;
  loading?: boolean;
  hasTVPreferredFocus?: boolean;
  style?: StyleProp<ViewStyle>;
  /** Lets a parent follow focus, e.g. to preview the selected row. */
  onFocusChange?: (focused: boolean) => void;
};

export const FocusButton = forwardRef<View, Props>(function FocusButton(
  {
    label,
    onPress,
    variant = "ghost",
    selected = false,
    disabled = false,
    loading = false,
    hasTVPreferredFocus,
    style,
    onFocusChange,
  },
  ref,
) {
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
      ref={ref}
      hasTVPreferredFocus={hasTVPreferredFocus}
      disabled={isDisabled}
      onFocus={onFocus}
      onBlur={onBlur}
      onPress={onPress}
      style={[
        styles.base,
        variant === "primary" && styles.primary,
        selected && styles.selected,
        focused && styles.focused,
        isDisabled && styles.disabled,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={colors.foreground} />
      ) : (
        <Text
          style={[styles.label, selected && !focused && styles.labelSelected]}
        >
          {label}
        </Text>
      )}
    </Pressable>
  );
});

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
  selected: {
    backgroundColor: colors.brandSoftSolid,
    borderColor: colors.brand,
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
  labelSelected: { color: colors.brand },
});
