import { Feather } from "@expo/vector-icons";
import { useRef, useState } from "react";
import { Image, Pressable, StyleSheet, Text, View } from "react-native";
import { LOGO, LOGO_WORDMARK } from "@/assets";
import { colors, focus, fontSize, monoFont, radius, spacing } from "@/theme";

export type Section = "home" | "search" | "subscriptions" | "history";

export const RAIL_WIDTH = 68;
const EXPANDED_WIDTH = 228;

type FeatherName = keyof typeof Feather.glyphMap;

const SECTIONS: { key: Section; label: string; icon: FeatherName }[] = [
  { key: "home", label: "Home", icon: "home" },
  { key: "search", label: "Search", icon: "search" },
  { key: "subscriptions", label: "Subscriptions", icon: "tv" },
  { key: "history", label: "History", icon: "clock" },
];

type Props = {
  active: Section;
  onSelect: (section: Section) => void;
  onSignOut: () => void;
};

export function Sidebar({ active, onSelect, onSignOut }: Props) {
  const [expanded, setExpanded] = useState(false);
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // focus-within: expand while any row is focused, collapse shortly after the
  // last one blurs (the timer absorbs the blur→focus gap between rows).
  const handleFocus = () => {
    if (blurTimer.current) clearTimeout(blurTimer.current);
    setExpanded(true);
  };
  const handleBlur = () => {
    if (blurTimer.current) clearTimeout(blurTimer.current);
    blurTimer.current = setTimeout(() => setExpanded(false), 60);
  };

  return (
    <View
      style={[
        styles.sidebar,
        { width: expanded ? EXPANDED_WIDTH : RAIL_WIDTH },
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
        {SECTIONS.map((section) => (
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

      <NavRow
        icon="log-out"
        label="Sign out"
        active={false}
        expanded={expanded}
        onFocus={handleFocus}
        onBlur={handleBlur}
        onPress={onSignOut}
      />
      {expanded ? (
        <View style={styles.footer}>
          <View style={styles.footerStatus}>
            <View style={styles.statusDot} />
            <Text style={styles.footerText} numberOfLines={1}>
              Feed from your instance
            </Text>
          </View>
          <Text style={styles.footerBrand}>owntube</Text>
        </View>
      ) : null}
    </View>
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
  footer: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingHorizontal: spacing.sm,
    paddingTop: spacing.md,
    gap: spacing.xs,
  },
  footerStatus: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.success,
  },
  footerText: {
    color: colors.mutedForeground,
    fontSize: 13,
  },
  footerBrand: {
    color: colors.mutedForeground,
    fontSize: 12,
    fontFamily: monoFont,
  },
});
