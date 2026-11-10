import { type ComponentRef, useRef, useState } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TVFocusGuideView,
  View,
} from "react-native";
import { type HomeBlock, HomeBlockRow } from "@/components/HomeBlockRow";
import type { Nav } from "@/lib/navigation";
import { useRowScroll } from "@/lib/row-scroll";
import { useActiveBackHandler, useScreenActive } from "@/lib/screen-active";
import { trpc } from "@/lib/trpc-react";
import { HistoryScreen } from "@/screens/HistoryScreen";
import { PlaylistsScreen } from "@/screens/PlaylistsScreen";
import { QueueScreen } from "@/screens/QueueScreen";
import { SavedScreen } from "@/screens/SavedScreen";
import { colors, focus, fontSize, radius, spacing } from "@/theme";

type Page = "history" | "queue" | "saved" | "playlists";

/** In the YouTube app's order (History, Watch later, Playlists), each a colour. */
const TILES: { key: Page; label: string; color: string }[] = [
  { key: "history", label: "History", color: "hsl(262, 62%, 46%)" },
  { key: "saved", label: "Saved", color: "hsl(196, 72%, 34%)" },
  { key: "playlists", label: "Playlists", color: "hsl(162, 70%, 28%)" },
  { key: "queue", label: "Queue", color: "hsl(22, 80%, 42%)" },
];

/**
 * The four library rows as home blocks, so the same component renders them
 * here and on Home. The layout fields are the web's; a TV row ignores them.
 */
const ROWS = TILES.map(
  (tile): HomeBlock => ({
    id: `library-${tile.key}`,
    type: tile.key,
    limit: 24,
    rows: 1,
    layout: "rows",
    size: "md",
  }),
);

/**
 * Everything the user has kept, in one place — the YouTube TV client's
 * Library page: a tile per collection, then a row of each. A tile opens the
 * full page (History, Queue, Saved, Playlists), and Back returns here.
 */
export function LibraryScreen({ nav }: { nav: Nav }) {
  const [page, setPage] = useState<Page | null>(null);
  /** Focus lands back on the tile that was opened, not the first one. */
  const [lastTile, setLastTile] = useState<Page>("history");
  // The overview stays mounted under an open page (hidden), so Back returns
  // to it as it was: rows loaded, scrolled where they were. Its tile guide
  // then hands focus back to the tile that opened the page.
  const tilesRef = useRef<ComponentRef<typeof TVFocusGuideView>>(null);
  useActiveBackHandler(() => {
    if (!page) return false;
    setPage(null);
    setTimeout(() => tilesRef.current?.requestTVFocus?.(), 0);
    return true;
  });

  // Kept mounted while hidden: stop listening, refetch stale data on return.
  // The rows below fetch the same lists, so these reads are shared, not extra.
  const subscribed = useScreenActive();
  const settings = trpc.settings.get.useQuery(undefined, { subscribed });
  const queue = trpc.queue.listDetailed.useQuery(undefined, { subscribed });
  const saved = trpc.interactions.listSaved.useQuery(undefined, {
    subscribed,
  });
  const playlists = trpc.playlists.list.useQuery(undefined, { subscribed });
  const counts: Partial<Record<Page, number>> = {
    queue: queue.data?.length,
    saved: saved.data?.length,
    playlists: playlists.data?.length,
  };

  const { scrollRef, onRowLayout, scrollToRow, scrollToTop } = useRowScroll();

  const pageView =
    page === "history" ? (
      <HistoryScreen nav={nav} />
    ) : page === "queue" ? (
      <QueueScreen nav={nav} />
    ) : page === "saved" ? (
      <SavedScreen nav={nav} />
    ) : page === "playlists" ? (
      <PlaylistsScreen nav={nav} />
    ) : null;

  return (
    <View style={styles.screen}>
      {pageView ? <View style={styles.screen}>{pageView}</View> : null}
      <View style={[styles.screen, pageView ? styles.hidden : null]}>
        <ScrollView
          ref={scrollRef}
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
        >
          {/* Coming back up from the rows returns to the tile you left, not
          whichever sits nearest; Right stops at the last tile. */}
          <TVFocusGuideView
            ref={tilesRef}
            autoFocus
            trapFocusRight
            style={styles.tiles}
          >
            {TILES.map((tile) => (
              <LibraryTile
                key={tile.key}
                label={tile.label}
                color={tile.color}
                count={counts[tile.key]}
                hasTVPreferredFocus={tile.key === lastTile}
                onFocusChange={(focused) => focused && scrollToTop()}
                onPress={() => {
                  setLastTile(tile.key);
                  setPage(tile.key);
                }}
              />
            ))}
          </TVFocusGuideView>
          {ROWS.map((block) => (
            <View key={block.id} onLayout={(e) => onRowLayout(block.id, e)}>
              <HomeBlockRow
                block={block}
                region={settings.data?.trendingRegion ?? "US"}
                nav={nav}
                onCardFocusChange={(focused) =>
                  focused && scrollToRow(block.id)
                }
              />
            </View>
          ))}
        </ScrollView>
      </View>
    </View>
  );
}

function LibraryTile({
  label,
  color,
  count,
  hasTVPreferredFocus,
  onFocusChange,
  onPress,
}: {
  label: string;
  color: string;
  count?: number;
  hasTVPreferredFocus?: boolean;
  onFocusChange?: (focused: boolean) => void;
  onPress: () => void;
}) {
  const [focused, setFocused] = useState(false);
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
        styles.tile,
        { backgroundColor: color },
        focused && styles.tileFocused,
      ]}
    >
      <View style={styles.tileCopy}>
        <Text style={styles.tileLabel}>{label}</Text>
        {count !== undefined ? (
          <Text style={styles.tileCount}>
            {count} {count === 1 ? "item" : "items"}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

const TILE_HEIGHT = 84;

const styles = StyleSheet.create({
  screen: { flex: 1 },
  // display:none also keeps the hidden overview out of D-pad focus search.
  hidden: { display: "none" },
  content: {
    gap: spacing.xl,
    paddingTop: spacing.sm,
    paddingHorizontal: 8,
    paddingBottom: spacing.screen,
  },
  tiles: { flexDirection: "row", gap: spacing.md },
  // The YouTube app's Library tiles: a block of colour, the name low on the
  // left, a white outline on focus.
  tile: {
    width: 168,
    height: TILE_HEIGHT,
    justifyContent: "flex-end",
    padding: spacing.md,
    borderRadius: radius.card,
    borderWidth: focus.borderWidth,
    borderColor: "transparent",
  },
  tileFocused: { borderColor: colors.ring },
  tileCopy: { gap: 2 },
  tileLabel: {
    color: colors.foreground,
    fontSize: fontSize.lg,
    fontWeight: "700",
  },
  tileCount: { color: "hsla(0, 0%, 100%, 0.75)", fontSize: fontSize.sm },
});
