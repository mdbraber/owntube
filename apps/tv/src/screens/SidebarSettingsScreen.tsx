import { Feather } from "@expo/vector-icons";
import { useEffect, useRef, useState } from "react";
import {
  BackHandler,
  findNodeHandle,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useTVEventHandler,
  View,
} from "react-native";
import { type FeatherName, SECTIONS, type Section } from "@/components/Sidebar";
import {
  ALL_SECTIONS,
  loadSidebarPrefs,
  saveSidebarPrefs,
} from "@/lib/sidebar-prefs";
import { colors, focus, fontSize, radius, spacing } from "@/theme";

const ROW_HEIGHT = 44;

/**
 * Reorder and hide sidebar entries.
 *
 * Dragging has no analogue on a remote, so a row is picked up with OK and then
 * moved with up/down until OK puts it down. Left/right shows or hides it.
 * Keeping the two verbs on separate keys stops either happening by accident
 * while doing the other.
 */
export function SidebarSettingsScreen({
  onChange,
  onBack,
}: {
  onChange?: (order: Section[]) => void;
  onBack: () => void;
}) {
  /** Every section, in display order — hidden ones included so they can return. */
  const [order, setOrder] = useState<Section[]>(ALL_SECTIONS);
  const [hidden, setHidden] = useState<Set<Section>>(new Set());
  const [grabbed, setGrabbed] = useState<Section | null>(null);
  const grabbedRef = useRef<Section | null>(null);
  grabbedRef.current = grabbed;

  useEffect(() => {
    loadSidebarPrefs().then((prefs) => {
      const missing = ALL_SECTIONS.filter((s) => !prefs.order.includes(s));
      setOrder([...prefs.order, ...missing]);
      setHidden(new Set(missing));
    });
  }, []);

  /** The sidebar gets the visible sections, in this list's order. */
  const persist = (nextOrder: Section[], nextHidden: Set<Section>) => {
    setOrder(nextOrder);
    setHidden(nextHidden);
    const shown = nextOrder.filter((s) => !nextHidden.has(s));
    onChange?.(shown);
    void saveSidebarPrefs({ order: shown });
  };

  const move = (key: Section, delta: number) => {
    const from = order.indexOf(key);
    const to = from + delta;
    if (from < 0 || to < 0 || to >= order.length) return;
    const next = [...order];
    const [item] = next.splice(from, 1);
    if (item) next.splice(to, 0, item);
    persist(next, hidden);
  };

  const toggleVisible = (key: Section) => {
    // Settings must stay reachable, or these prefs can't be changed again.
    if (key === "settings") return;
    const next = new Set(hidden);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    persist(order, next);
  };

  useTVEventHandler((event) => {
    const key = grabbedRef.current;
    if (!key) return;
    switch (event.eventType) {
      case "up":
        move(key, -1);
        break;
      case "down":
        move(key, 1);
        break;
      case "left":
      case "right":
        toggleVisible(key);
        break;
      default:
        break;
    }
  });

  // Back puts a held row down before it leaves the page.
  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      if (grabbedRef.current) {
        setGrabbed(null);
        return true;
      }
      onBack();
      return true;
    });
    return () => sub.remove();
  }, [onBack]);

  return (
    <ScrollView showsVerticalScrollIndicator={false}>
      <Text style={styles.title}>Sidebar</Text>
      <Text style={styles.hint}>
        OK picks a row up and puts it down · up and down move it · left and
        right show or hide it
      </Text>

      {order.map((key) => {
        const meta = SECTIONS.find((s) => s.key === key);
        if (!meta) return null;
        return (
          <SidebarRow
            key={key}
            label={meta.label}
            icon={meta.icon}
            hidden={hidden.has(key)}
            grabbed={grabbed === key}
            locked={key === "settings"}
            onPress={() => setGrabbed(grabbed === key ? null : key)}
          />
        );
      })}
    </ScrollView>
  );
}

function SidebarRow({
  label,
  icon,
  hidden,
  grabbed,
  locked,
  onPress,
}: {
  label: string;
  icon: FeatherName;
  hidden: boolean;
  grabbed: boolean;
  locked: boolean;
  onPress: () => void;
}) {
  const [focused, setFocused] = useState(false);
  const rowRef = useRef<View>(null);
  const [handle, setHandle] = useState<number | null>(null);
  const tint = hidden ? colors.mutedForeground : colors.foreground;

  return (
    <Pressable
      ref={rowRef}
      onLayout={() => {
        if (handle === null) setHandle(findNodeHandle(rowRef.current));
      }}
      // While held, pin focus to this row in every direction: the key handler
      // reorders instead, and Android would otherwise move focus away first.
      nextFocusUp={grabbed ? (handle ?? undefined) : undefined}
      nextFocusDown={grabbed ? (handle ?? undefined) : undefined}
      nextFocusLeft={grabbed ? (handle ?? undefined) : undefined}
      nextFocusRight={grabbed ? (handle ?? undefined) : undefined}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onPress={onPress}
      style={[
        styles.row,
        focused && styles.rowFocused,
        grabbed && styles.rowGrabbed,
      ]}
    >
      <View style={styles.iconSlot}>
        <Feather name={icon} size={20} color={tint} />
      </View>
      <Text style={[styles.label, { color: tint }]} numberOfLines={1}>
        {label}
      </Text>
      <Text style={styles.state}>
        {locked ? "Always shown" : hidden ? "Hidden" : "Shown"}
      </Text>
      <View style={styles.grip}>
        {grabbed ? (
          <Feather name="move" size={16} color={colors.brand} />
        ) : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  title: {
    color: colors.foreground,
    fontSize: fontSize.xxl,
    fontWeight: "700",
    marginBottom: spacing.xs,
  },
  hint: {
    color: colors.mutedForeground,
    fontSize: fontSize.sm,
    marginBottom: spacing.lg,
  },
  // Fixed height plus fixed-width icon/state columns keep every row identical
  // and the labels on one vertical line.
  row: {
    flexDirection: "row",
    alignItems: "center",
    height: ROW_HEIGHT,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.xs,
    borderRadius: radius.shell,
    borderWidth: focus.borderWidth,
    borderColor: "transparent",
    backgroundColor: colors.surface,
  },
  rowFocused: { borderColor: colors.ring, backgroundColor: colors.accent },
  rowGrabbed: { backgroundColor: colors.brandSoft, borderColor: colors.brand },
  iconSlot: { width: 32 },
  label: { flex: 1, fontSize: fontSize.md, fontWeight: "600" },
  state: {
    width: 110,
    textAlign: "right",
    color: colors.mutedForeground,
    fontSize: fontSize.sm,
  },
  grip: { width: 24, alignItems: "flex-end" },
});
