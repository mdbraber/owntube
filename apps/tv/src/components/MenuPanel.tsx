import { Feather } from "@expo/vector-icons";
import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import {
  BackHandler,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TVFocusGuideView,
  View,
} from "react-native";
import { isSuppressedPress } from "@/lib/long-press";
import { colors, focus, fontSize, radius, spacing } from "@/theme";

export type MenuItem = {
  key: string;
  label: string;
  /** Current value, shown right-aligned ("720p", "Off", "1×"). */
  detail?: string;
  /** Draws a check: the current choice in a list of options. */
  selected?: boolean;
  /** Opens this page on top of the current one. */
  submenu?: string;
  /**
   * Asks first: OK opens a "Yes / Cancel" page with this question, and only
   * "Yes" runs `onPress`. For the destructive ones (Clear queue).
   */
  confirm?: string;
  /**
   * Runs on OK. Choosing an option in a submenu then returns to the page
   * below, as a settings list does; return `"stay"` to keep the page open.
   */
  onPress?: () => unknown;
};

export type MenuPage = {
  title: string;
  items: MenuItem[];
  /**
   * Free-form content (a text field) above the items. It takes the initial
   * focus, so give its focusable element `hasTVPreferredFocus`.
   */
  content?: ReactNode;
};

type Props = {
  /** Builds a page by key; "root" is the first. Rebuilt on every render, so
   * checks and values always reflect the current state. */
  buildPage: (key: string) => MenuPage;
  onClose: () => void;
  /** The page it opens on; Back from there closes it. Default "root". */
  startPage?: string;
};

/**
 * A side panel of D-pad lists with drill-down pages (Quality → 720p), the
 * pattern the YouTube TV player uses for its settings. Back steps out one
 * page, then closes; it registers its own Back handler, which Android asks
 * before the player's.
 */
export function MenuPanel({ buildPage, onClose, startPage = "root" }: Props) {
  const [stack, setStack] = useState<string[]>([startPage]);
  const key = stack[stack.length - 1] ?? "root";
  /** The item awaiting confirmation, while its confirm page shows. */
  const [confirming, setConfirming] = useState<MenuItem | null>(null);
  const page: MenuPage =
    key === CONFIRM_PAGE && confirming
      ? {
          title: confirming.confirm ?? confirming.label,
          items: [
            {
              key: "no",
              label: "Cancel",
              onPress: () => undefined,
            },
            {
              key: "yes",
              label: `Yes, ${confirming.label.toLowerCase()}`,
              onPress: confirming.onPress,
            },
          ],
        }
      : buildPage(key);
  /** The page just left, so stepping back lands on the row that opened it. */
  const [cameFrom, setCameFrom] = useState<string | null>(null);
  const pop = () => {
    setCameFrom(key);
    setStack((s) => s.slice(0, -1));
  };
  const popRef = useRef(pop);
  popRef.current = pop;

  const depthRef = useRef(stack.length);
  depthRef.current = stack.length;
  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      if (depthRef.current > 1) popRef.current();
      else onClose();
      return true;
    });
    return () => sub.remove();
  }, [onClose]);

  const choose = (item: MenuItem) => {
    // A menu opened by a long press must not act on the click that ends that
    // same hold: the card menu opens mid-hold and focuses its first row, so
    // the release could land on it and play the video the menu is about.
    if (isSuppressedPress()) return;
    if (item.submenu || (item.confirm && key !== CONFIRM_PAGE)) {
      const submenu = item.submenu ?? CONFIRM_PAGE;
      if (item.confirm) setConfirming(item);
      setCameFrom(null);
      setStack((s) => [...s, submenu]);
      return;
    }
    const result = item.onPress?.();
    if (result === "stay") return;
    if (stack.length > 1) pop();
    // Opened straight on this page (the CC button's captions): nothing to
    // step back to, so a pick closes the panel.
    else if (startPage !== "root") onClose();
  };

  // Focus lands on the row that opened the page just left, else the current
  // choice, else the first row — unless the page has its own content (a text
  // field), which then takes focus itself.
  const returnIndex = cameFrom
    ? page.items.findIndex((item) => item.submenu === cameFrom)
    : -1;
  const preferred = page.content
    ? -1
    : returnIndex >= 0
      ? returnIndex
      : Math.max(
          0,
          page.items.findIndex((item) => item.selected),
        );

  return (
    <View style={styles.scrim}>
      {/* Traps the D-pad inside the panel: it can open over a live screen
          (the card menu), whose buttons would otherwise take focus. */}
      <TVFocusGuideView
        style={styles.panel}
        trapFocusUp
        trapFocusDown
        trapFocusLeft
        trapFocusRight
      >
        <Text style={styles.title} numberOfLines={2}>
          {page.title}
        </Text>
        {page.content}
        {/* Keyed by page so each page mounts fresh and takes focus. */}
        <ScrollView key={key} contentContainerStyle={styles.list}>
          {page.items.map((item, index) => (
            <MenuRow
              key={item.key}
              item={item}
              preferred={index === preferred}
              onPress={() => choose(item)}
            />
          ))}
        </ScrollView>
      </TVFocusGuideView>
    </View>
  );
}

function MenuRow({
  item,
  preferred,
  onPress,
}: {
  item: MenuItem;
  preferred: boolean;
  onPress: () => void;
}) {
  const [focused, setFocused] = useState(false);
  return (
    <Pressable
      hasTVPreferredFocus={preferred}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onPress={onPress}
      style={[styles.row, focused && styles.rowFocused]}
    >
      <View style={styles.check}>
        {item.selected ? (
          <Feather name="check" size={16} color={colors.foreground} />
        ) : null}
      </View>
      <Text style={styles.label} numberOfLines={1}>
        {item.label}
      </Text>
      {item.detail ? (
        <Text style={styles.detail} numberOfLines={1}>
          {item.detail}
        </Text>
      ) : null}
      {item.submenu ? (
        <Feather
          name="chevron-right"
          size={16}
          color={colors.mutedForeground}
        />
      ) : null}
    </Pressable>
  );
}

const PANEL_WIDTH = 380;
const CONFIRM_PAGE = "__confirm";

const styles = StyleSheet.create({
  scrim: {
    ...StyleSheet.absoluteFill,
    alignItems: "flex-end",
    backgroundColor: colors.overlay,
  },
  panel: {
    width: PANEL_WIDTH,
    height: "100%",
    paddingVertical: spacing.screen,
    paddingHorizontal: spacing.lg,
    backgroundColor: colors.cardElevated,
    borderLeftWidth: 1,
    borderLeftColor: colors.surfaceBorder,
    gap: spacing.md,
  },
  title: {
    color: colors.foreground,
    fontSize: fontSize.lg,
    fontWeight: "700",
  },
  list: { gap: spacing.xs, paddingBottom: spacing.lg },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    minHeight: 44,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.shell,
    borderWidth: focus.borderWidth,
    borderColor: "transparent",
  },
  rowFocused: { backgroundColor: colors.brand, borderColor: colors.ring },
  check: { width: 18, alignItems: "center" },
  label: {
    flex: 1,
    color: colors.foreground,
    fontSize: fontSize.md,
    fontWeight: "600",
  },
  detail: { color: colors.foreground, fontSize: fontSize.sm, opacity: 0.8 },
});
