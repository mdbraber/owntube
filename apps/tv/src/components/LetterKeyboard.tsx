import { Feather } from "@expo/vector-icons";
import { type ReactNode, useState } from "react";
import {
  Pressable,
  StyleSheet,
  Text,
  TVFocusGuideView,
  View,
} from "react-native";
import { colors, fontSize, radius, spacing } from "@/theme";

const LETTERS = [
  ["a", "b", "c", "d", "e", "f", "g"],
  ["h", "i", "j", "k", "l", "m", "n"],
  ["o", "p", "q", "r", "s", "t", "u"],
  ["v", "w", "x", "y", "z", "-", "'"],
];

const SYMBOLS = [
  ["1", "2", "3", "4", "5", "6", "7"],
  ["8", "9", "0", ".", ",", "?", "!"],
  ["@", "#", "&", "(", ")", ":", ";"],
  ["/", "+", "=", "_", '"', "*", "%"],
];

type Props = {
  onKey: (char: string) => void;
  onDelete: () => void;
  onClear: () => void;
  onSubmit: () => void;
  /** Lets the page fold the keyboard away once focus leaves it. */
  onFocusChange?: (focused: boolean) => void;
  hasTVPreferredFocus?: boolean;
};

/**
 * The Android TV YouTube app's search keyboard: a letter grid on the page
 * itself, so typing never brings up the system keyboard over the results. A
 * column on the right deletes and switches to digits and symbols; Space,
 * Clear and Search run along the bottom. Coming back into the grid returns to
 * the key you left.
 */
export function LetterKeyboard({
  onKey,
  onDelete,
  onClear,
  onSubmit,
  onFocusChange,
  hasTVPreferredFocus,
}: Props) {
  const [symbols, setSymbols] = useState(false);
  const rows = symbols ? SYMBOLS : LETTERS;
  const side: ReactNode[] = [
    <Key
      key="del"
      icon="delete"
      onPress={onDelete}
      onFocusChange={onFocusChange}
    />,
    <Key
      key="mode"
      onPress={() => setSymbols((s) => !s)}
      onFocusChange={onFocusChange}
      label={symbols ? "ABC" : "&123"}
      small
    />,
  ];

  return (
    <TVFocusGuideView autoFocus trapFocusRight style={styles.keyboard}>
      {rows.map((row, r) => (
        <View key={row[0]} style={styles.row}>
          {row.map((char, c) => (
            <Key
              key={char}
              label={char.toUpperCase()}
              onPress={() => onKey(char)}
              onFocusChange={onFocusChange}
              hasTVPreferredFocus={hasTVPreferredFocus && r === 0 && c === 0}
            />
          ))}
          {side[r] ?? <View style={styles.spacer} />}
        </View>
      ))}
      <View style={styles.actions}>
        <Action
          label="Space"
          onPress={() => onKey(" ")}
          onFocusChange={onFocusChange}
        />
        <Action label="Clear" onPress={onClear} onFocusChange={onFocusChange} />
        <Action
          label="Search"
          onPress={onSubmit}
          onFocusChange={onFocusChange}
        />
      </View>
    </TVFocusGuideView>
  );
}

function Key({
  label,
  icon,
  onPress,
  onFocusChange,
  hasTVPreferredFocus,
  small,
}: {
  label?: string;
  icon?: "delete";
  onPress: () => void;
  onFocusChange?: (focused: boolean) => void;
  hasTVPreferredFocus?: boolean;
  small?: boolean;
}) {
  const [focused, setFocused] = useState(false);
  const color = focused ? colors.focusForeground : colors.foreground;
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
      style={[styles.key, focused && styles.focused]}
    >
      {icon ? (
        <Feather name={icon} size={20} color={color} />
      ) : (
        <Text style={[styles.keyText, small && styles.keySmall, { color }]}>
          {label}
        </Text>
      )}
    </Pressable>
  );
}

function Action({
  label,
  onPress,
  onFocusChange,
}: {
  label: string;
  onPress: () => void;
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
      style={[styles.action, focused && styles.focused]}
    >
      <Text
        style={[
          styles.actionText,
          { color: focused ? colors.focusForeground : colors.foreground },
        ]}
      >
        {label.toUpperCase()}
      </Text>
    </Pressable>
  );
}

const KEY = 38;

const styles = StyleSheet.create({
  keyboard: { gap: 2 },
  row: { flexDirection: "row", gap: 4 },
  key: {
    width: KEY,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 6,
  },
  spacer: { width: KEY },
  focused: { backgroundColor: colors.focusFill },
  keyText: { fontSize: fontSize.lg, fontWeight: "500" },
  keySmall: { fontSize: fontSize.sm, fontWeight: "700" },
  actions: {
    flexDirection: "row",
    gap: spacing.xs,
    marginTop: spacing.xs,
  },
  action: {
    height: 32,
    paddingHorizontal: spacing.md,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.shell,
    backgroundColor: colors.surfaceStrong,
  },
  actionText: { fontSize: fontSize.sm, fontWeight: "700" },
});
