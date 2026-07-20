import { Feather } from "@expo/vector-icons";
import { useRef, useState } from "react";
import {
  Animated,
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { LOGO, LOGO_WORDMARK } from "@/assets";
import { colors, focus, fontSize, radius, spacing } from "@/theme";

export type Section =
  | "home"
  | "recommended"
  | "search"
  | "subscriptions"
  | "playlists"
  | "queue"
  | "history"
  | "settings";

export const RAIL_WIDTH = 68;
export const EXPANDED_WIDTH = 228;

export type FeatherName = keyof typeof Feather.glyphMap;

export const SECTIONS: { key: Section; label: string; icon: FeatherName }[] = [
  { key: "home", label: "Home", icon: "home" },
  { key: "search", label: "Search", icon: "search" },
  { key: "queue", label: "Queue", icon: "list" },
  { key: "subscriptions", label: "Subscriptions", icon: "tv" },
  { key: "recommended", label: "Recommended", icon: "star" },
  { key: "playlists", label: "Playlists", icon: "folder" },
  { key: "history", label: "History", icon: "clock" },
  { key: "settings", label: "Settings", icon: "settings" },
];

type Props = {
  active: Section;
  onSelect: (section: Section) => void;
  /** Lets the shell make room instead of letting the rail cover content. */
  onExpandedChange?: (expanded: boolean) => void;
  /**
   * Shared with the shell's content inset so the rail and the page it displaces
   * move as one. Animating them separately let the content lag and slide under
   * the rail, and rapid focus changes made it jitter.
   */
  width?: Animated.Value;
  /** Ordered visible sections; omitted ones are hidden (see sidebar-prefs). */
  sections?: Section[];
};

export function Sidebar({
  active,
  onSelect,
  sections,
  onExpandedChange,
  width,
}: Props) {
  const visible = sections
    ? sections
        .map((key) => SECTIONS.find((s) => s.key === key))
        .filter((s): s is (typeof SECTIONS)[number] => Boolean(s))
    : SECTIONS;
  const [expanded, setExpanded] = useState(false);
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // focus-within: expand while any row is focused, collapse shortly after the
  // last one blurs (the timer absorbs the blur→focus gap between rows).
  const handleFocus = () => {
    if (blurTimer.current) clearTimeout(blurTimer.current);
    setExpanded((prev) => {
      if (!prev) onExpandedChange?.(true);
      return true;
    });
  };
  const handleBlur = () => {
    if (blurTimer.current) clearTimeout(blurTimer.current);
    blurTimer.current = setTimeout(() => {
      setExpanded((prev) => {
        if (prev) onExpandedChange?.(false);
        return false;
      });
    }, 60);
  };

  return (
    <Animated.View
      style={[
        styles.sidebar,
        { width: width ?? (expanded ? EXPANDED_WIDTH : RAIL_WIDTH) },
      ]}
    >
      <View style={styles.brandRow}>
        <Image
          source={expanded ? LOGO_WORDMARK : LOGO}
          style={expanded ? styles.wordmark : styles.mark}
          resizeMode="contain"
        />
      </View>

      <View style={styles.nav}>
        {visible.map((section) => (
          <NavRow
            key={section.key}
            icon={section.icon}
            label={section.label}
            active={active === section.key}
            expanded={expanded}
            onFocus={handleFocus}
            onBlur={handleBlur}
            onPress={() => onSelect(section.key)}
          />
        ))}
      </View>
    </Animated.View>
  );
}

function NavRow({
  icon,
  label,
  active,
  expanded,
  onFocus,
  onBlur,
  onPress,
}: {
  icon: FeatherName;
  label: string;
  active: boolean;
  expanded: boolean;
  onFocus: () => void;
  onBlur: () => void;
  onPress: () => void;
}) {
  const [focused, setFocused] = useState(false);
  const tint = active || focused ? colors.brand : colors.foreground;

  return (
    <Pressable
      onFocus={() => {
        setFocused(true);
        onFocus();
      }}
      onBlur={() => {
        setFocused(false);
        onBlur();
      }}
      onPress={onPress}
      style={[
        styles.row,
        !expanded && styles.rowCollapsed,
        active && styles.rowActive,
        focused && styles.rowFocused,
      ]}
    >
      <Feather name={icon} size={24} color={tint} />
      {expanded ? (
        <View style={styles.labelWrap}>
          <Text style={[styles.label, { color: tint }]} numberOfLines={1}>
            {label}
          </Text>
          {active ? <View style={styles.underscore} /> : null}
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  sidebar: {
    position: "absolute",
    left: 0,
    top: 0,
    bottom: 0,
    zIndex: 10,
    backgroundColor: colors.sidebar,
    borderRightWidth: 1,
    borderRightColor: colors.border,
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.sm,
    gap: spacing.lg,
  },
  brandRow: {
    height: 44,
    justifyContent: "center",
    paddingHorizontal: 6,
  },
  mark: { width: 36, height: 36 },
  wordmark: { width: 152, height: 32 },
  nav: { flex: 1, gap: spacing.xs },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    height: 50,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.shell,
    borderWidth: focus.borderWidth,
    borderColor: "transparent",
  },
  rowCollapsed: { justifyContent: "center", paddingHorizontal: 0 },
  rowActive: { backgroundColor: colors.brandSoft },
  rowFocused: {
    backgroundColor: colors.accent,
    borderColor: colors.ring,
    shadowColor: colors.brand,
    shadowOpacity: 0.22,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  },
  labelWrap: { alignItems: "flex-start" },
  label: { fontSize: fontSize.md, fontWeight: "600" },
  underscore: {
    marginTop: 3,
    height: 2,
    alignSelf: "stretch",
    backgroundColor: colors.foreground,
    borderRadius: 2,
  },
});
