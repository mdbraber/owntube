import { Feather } from "@expo/vector-icons";
import { forwardRef, useEffect, useRef, useState } from "react";
import {
  Animated,
  findNodeHandle,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TVFocusGuideView,
  View,
} from "react-native";
import { channelInitial } from "@/lib/format";
import { colors, focus, fontSize, radius, spacing } from "@/theme";

export type Section =
  | "home"
  | "recommended"
  | "search"
  | "subscriptions"
  | "saved"
  | "trending"
  | "shorts"
  | "playlists"
  | "queue"
  | "history"
  | "settings";

/** Row box and the pitch between two rows, shared with the scroll maths. */
const ROW_HEIGHT = 50;
/** Matches the nav icons, so the profile row sits on the same vertical line. */
const AVATAR_SIZE = 30;
const ROW_PITCH = ROW_HEIGHT + spacing.xs;

export const RAIL_WIDTH = 68;
export const EXPANDED_WIDTH = 228;

export type FeatherName = keyof typeof Feather.glyphMap;

export const SECTIONS: { key: Section; label: string; icon: FeatherName }[] = [
  { key: "home", label: "Home", icon: "home" },
  { key: "search", label: "Search", icon: "search" },
  { key: "queue", label: "Queue", icon: "list" },
  { key: "subscriptions", label: "Subscriptions", icon: "tv" },
  { key: "recommended", label: "Recommended", icon: "star" },
  { key: "trending", label: "Trending", icon: "trending-up" },
  { key: "shorts", label: "Shorts", icon: "smartphone" },
  { key: "saved", label: "Saved", icon: "bookmark" },
  { key: "playlists", label: "Playlists", icon: "folder" },
  { key: "history", label: "History", icon: "clock" },
  { key: "settings", label: "Settings", icon: "settings" },
];

type Props = {
  active: Section;
  onSelect: (section: Section) => void;
  /** The signed-in account, shown where the logo used to sit. */
  profileLabel?: string;
  /** Opens "Who's watching" — the row above the sections is the way in. */
  onSwitchProfile?: () => void;
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
  /** Reports the active row's native handle (see lib/sidebar-focus). */
  onActiveRowHandle?: (handle: number | null) => void;
};

export function Sidebar({
  active,
  onSelect,
  profileLabel,
  onSwitchProfile,
  sections,
  onExpandedChange,
  width,
  onActiveRowHandle,
}: Props) {
  const visible = sections
    ? sections
        .map((key) => SECTIONS.find((s) => s.key === key))
        .filter((s): s is (typeof SECTIONS)[number] => Boolean(s))
    : SECTIONS;
  const [expanded, setExpanded] = useState(false);
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const scrollRef = useRef<ScrollView>(null);
  const [navHeight, setNavHeight] = useState(0);
  const activeIndex = visible.findIndex((s) => s.key === active);
  // State, not a ref: the guide's destinations must follow the active row.
  const [activeRow, setActiveRow] = useState<View | null>(null);
  useEffect(() => {
    onActiveRowHandle?.(activeRow ? findNodeHandle(activeRow) : null);
  }, [activeRow, onActiveRowHandle]);

  // Collapsing hands the rail back to the page, so put the active section back
  // in view: left where the user scrolled it, a rail parked on Settings shows
  // neither the current section nor the first few. Scrolls the least it can —
  // to the top whenever the active row already fits on the first screenful.
  useEffect(() => {
    if (expanded || navHeight === 0 || activeIndex < 0) return;
    const y = Math.max(0, activeIndex * ROW_PITCH + ROW_HEIGHT - navHeight);
    scrollRef.current?.scrollTo({ y, animated: false });
  }, [expanded, navHeight, activeIndex]);

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
      {/* Entering the rail from the page lands on the section you're in, not
          on whichever row happens to sit level with the card you left — from a
          shelf halfway down Home that was Subscriptions. While focus is inside,
          Up and Down move between rows as usual. */}
      <TVFocusGuideView
        destinations={activeRow ? [activeRow] : []}
        style={styles.guide}
      >
        <ProfileRow
          label={profileLabel}
          expanded={expanded}
          onFocus={handleFocus}
          onBlur={handleBlur}
          onPress={() => onSwitchProfile?.()}
        />

        {/* Scrolls: at 50dp a row, only seven fit a 540dp panel, and every
          section past that used to take focus while staying off screen —
          invisible rows you could land on but never see. Android scrolls the
          newly focused child into view for us. */}
        <ScrollView
          ref={scrollRef}
          style={styles.nav}
          contentContainerStyle={styles.navContent}
          onLayout={(e) => setNavHeight(e.nativeEvent.layout.height)}
          showsVerticalScrollIndicator={false}
        >
          {visible.map((section) => (
            <NavRow
              key={section.key}
              ref={active === section.key ? setActiveRow : undefined}
              icon={section.icon}
              label={section.label}
              active={active === section.key}
              expanded={expanded}
              onFocus={handleFocus}
              onBlur={handleBlur}
              onPress={() => onSelect(section.key)}
            />
          ))}
        </ScrollView>
      </TVFocusGuideView>
    </Animated.View>
  );
}

/**
 * Who is watching, and the way to change it. It takes the logo's place: the
 * mark says nothing a TV owner needs mid-session, while the account behind the
 * history and subscriptions on screen is worth showing — and worth being one
 * press from switching. No avatar is stored for an account, so the initial of
 * its address stands in, the same fallback a channel without a picture gets.
 */
function ProfileRow({
  label,
  expanded,
  onFocus,
  onBlur,
  onPress,
}: {
  label?: string;
  expanded: boolean;
  onFocus: () => void;
  onBlur: () => void;
  onPress: () => void;
}) {
  const [focused, setFocused] = useState(false);
  const tint = focused ? colors.brand : colors.foreground;

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
        focused && styles.rowFocused,
      ]}
    >
      <View style={styles.avatar}>
        <Text style={styles.avatarInitial}>{channelInitial(label)}</Text>
      </View>
      {expanded ? (
        <View style={styles.labelWrap}>
          <Text style={[styles.label, { color: tint }]} numberOfLines={1}>
            {label ?? "Signed in"}
          </Text>
          <Text style={styles.switchHint} numberOfLines={1}>
            Switch profile
          </Text>
        </View>
      ) : null}
    </Pressable>
  );
}

const NavRow = forwardRef<
  View,
  {
    icon: FeatherName;
    label: string;
    active: boolean;
    expanded: boolean;
    onFocus: () => void;
    onBlur: () => void;
    onPress: () => void;
  }
>(function NavRow(
  { icon, label, active, expanded, onFocus, onBlur, onPress },
  ref,
) {
  const [focused, setFocused] = useState(false);
  const tint = active || focused ? colors.brand : colors.foreground;

  return (
    <Pressable
      ref={ref}
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
});

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
  avatar: {
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
    borderRadius: AVATAR_SIZE / 2,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.brand,
  },
  avatarInitial: {
    color: colors.primaryForeground,
    fontWeight: "700",
    fontSize: fontSize.md,
  },
  switchHint: { color: colors.mutedForeground, fontSize: fontSize.sm },
  guide: { flex: 1, gap: spacing.lg },
  nav: { flex: 1 },
  navContent: { gap: spacing.xs },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    height: ROW_HEIGHT,
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
