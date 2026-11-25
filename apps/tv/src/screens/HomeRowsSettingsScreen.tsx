import { Feather } from "@expo/vector-icons";
import { blockTagLists, homeBlockTitle } from "@web/lib/home-blocks";
import { useEffect, useRef, useState } from "react";
import {
  BackHandler,
  findNodeHandle,
  Pressable,
  ScrollView,
  Text,
  useTVEventHandler,
  View,
} from "react-native";
import { HOME_BLOCK_TITLES, type HomeBlock } from "@/components/HomeBlockRow";
import { errorMessage } from "@/lib/error-message";
import { queryClient } from "@/lib/query-client";
import { trpcClient } from "@/lib/trpc";
import { trpc } from "@/lib/trpc-react";
import type { TVView } from "@/lib/tv-focus";
import { createStyles, s } from "@/lib/ui-scale";
import { colors, focus, fontSize, radius, spacing } from "@/theme";

const ROW_HEIGHT = 44;

/**
 * Block types the TV can add; a "playlist" block needs a playlist picked on
 * the web. Tag blocks are offered per tag, below these.
 */
const ADDABLE: HomeBlock["type"][] = [
  "subscriptions",
  "favorites",
  "recommended",
  "explore",
  "history",
  "queue",
  "saved",
  "playlists",
];

/** A block added here gets the web's defaults (lib/home-blocks.ts). */
function defaultBlock(type: HomeBlock["type"], tag?: string): HomeBlock {
  return {
    id: `b${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
    type,
    options: tag ? { [`tag:${tag}`]: true } : undefined,
    limit: 8,
    rows: 2,
    layout: "cards",
    size: "md",
  };
}

type Row =
  | { kind: "block"; block: HomeBlock }
  | { kind: "available"; type: HomeBlock["type"] }
  | { kind: "availableTag"; tag: string };

/** The one tag a single-tag block shows, else null (bundles, other types). */
function singleTag(block: HomeBlock): string | null {
  if (block.type !== "tag") return null;
  const { includeTags } = blockTagLists(block);
  return includeTags?.length === 1 ? includeTags[0] : null;
}

/**
 * Reorder, hide and restore the home rows. The same `homeBlocks` setting the
 * web home is built from, so a change here shows up there too — and the web
 * remains the place for a block's finer options.
 *
 * Same verbs as the sidebar editor: OK picks a row up and puts it down,
 * up/down move it, left/right hide or show it. Hidden types are listed after
 * the shown rows so they can be brought back.
 */
export function HomeRowsSettingsScreen({ onBack }: { onBack: () => void }) {
  const stored = trpc.settings.get.useQuery();
  const playlists = trpc.playlists.list.useQuery();
  const tags = trpc.channelTags.listAll.useQuery();
  const [blocks, setBlocks] = useState<HomeBlock[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [grabbed, setGrabbed] = useState<string | null>(null);
  const grabbedRef = useRef<string | null>(null);
  grabbedRef.current = grabbed;
  const blocksRef = useRef<HomeBlock[] | null>(null);
  blocksRef.current = blocks;

  useEffect(() => {
    if (stored.data && blocks === null) setBlocks(stored.data.homeBlocks);
  }, [stored.data, blocks]);

  /** Optimistic: the list reflects the change, the server catches up. */
  const persist = (next: HomeBlock[]) => {
    setBlocks(next);
    trpcClient.settings.update
      .mutate({ homeBlocks: next })
      .then(() => {
        void queryClient.invalidateQueries({
          queryKey: [["settings", "get"]],
        });
      })
      .catch((err: unknown) => setError(errorMessage(err)));
  };

  const move = (id: string, delta: number) => {
    const current = blocksRef.current;
    if (!current) return;
    const from = current.findIndex((b) => b.id === id);
    const to = from + delta;
    if (from < 0 || to < 0 || to >= current.length) return;
    const next = [...current];
    const [item] = next.splice(from, 1);
    if (item) next.splice(to, 0, item);
    persist(next);
  };

  const remove = (id: string) => {
    const current = blocksRef.current;
    if (!current) return;
    persist(current.filter((b) => b.id !== id));
    setGrabbed(null);
  };

  const add = (type: HomeBlock["type"], tag?: string) => {
    const current = blocksRef.current;
    if (!current) return;
    persist([...current, defaultBlock(type, tag)]);
    setGrabbed(null);
  };

  useTVEventHandler((event) => {
    const id = grabbedRef.current;
    if (!id) return;
    // See SidebarSettingsScreen for why long* presses count on the way down.
    const isKeyUp = Number(event.eventKeyAction) === 1;
    switch (event.eventType) {
      case "up":
        move(id, -1);
        break;
      case "down":
        move(id, 1);
        break;
      case "longUp":
        if (!isKeyUp) move(id, -1);
        break;
      case "longDown":
        if (!isKeyUp) move(id, 1);
        break;
      case "left":
      case "right":
        toggle(id);
        break;
      case "longLeft":
      case "longRight":
        if (!isKeyUp) toggle(id);
        break;
      default:
        break;
    }
  });
  const toggle = (id: string) => {
    if (id.startsWith("add:")) add(id.slice(4) as HomeBlock["type"]);
    else if (id.startsWith("addtag:")) add("tag", id.slice(7));
    else remove(id);
  };

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

  const rows: Row[] = [
    ...(blocks ?? []).map((block): Row => ({ kind: "block", block })),
    ...ADDABLE.filter((type) => !blocks?.some((b) => b.type === type)).map(
      (type): Row => ({ kind: "available", type }),
    ),
    ...(tags.data ?? [])
      .filter(({ tag }) => !blocks?.some((b) => singleTag(b) === tag))
      .map(({ tag }): Row => ({ kind: "availableTag", tag })),
  ];
  const titleOf = (block: HomeBlock) =>
    block.type === "playlist"
      ? (playlists.data?.find((p) => p.id === block.playlistId)?.name ??
        "Playlist")
      : block.type === "tag" || block.title?.trim()
        ? homeBlockTitle(block)
        : HOME_BLOCK_TITLES[block.type];
  const rowId = (row: Row) =>
    row.kind === "block"
      ? row.block.id
      : row.kind === "available"
        ? `add:${row.type}`
        : `addtag:${row.tag}`;
  const rowLabel = (row: Row) =>
    row.kind === "block"
      ? titleOf(row.block)
      : row.kind === "available"
        ? HOME_BLOCK_TITLES[row.type]
        : `#${row.tag}`;
  const rowState = (row: Row) => {
    if (row.kind !== "block") return "Hidden";
    if (row.block.type === "playlist") return "Shown · add back on the web";
    if (row.block.type === "tag" && singleTag(row.block) === null) {
      return "Shown · add back on the web";
    }
    return "Shown";
  };

  return (
    <ScrollView showsVerticalScrollIndicator={false}>
      <Text style={styles.title}>Home rows</Text>
      <Text style={styles.hint}>
        OK picks a row up and puts it down · up and down move it · left and
        right hide or show it · the web has each row's options
      </Text>
      {blocks === null ? (
        <Text style={styles.muted}>
          {stored.error ? errorMessage(stored.error) : "Loading…"}
        </Text>
      ) : null}
      {rows.map((row, index) => {
        const id = rowId(row);
        return (
          <BlockRow
            key={id}
            // The button that opened the page is gone; without a first
            // row to land on, focus fell back to the rail.
            hasTVPreferredFocus={index === 0}
            label={rowLabel(row)}
            state={rowState(row)}
            hidden={row.kind !== "block"}
            grabbed={grabbed === id}
            onPress={() => setGrabbed(grabbed === id ? null : id)}
          />
        );
      })}
      {error ? <Text style={styles.muted}>{error}</Text> : null}
    </ScrollView>
  );
}

function BlockRow({
  label,
  state,
  hidden,
  grabbed,
  hasTVPreferredFocus,
  onPress,
}: {
  label: string;
  state: string;
  hidden: boolean;
  grabbed: boolean;
  hasTVPreferredFocus?: boolean;
  onPress: () => void;
}) {
  const [focused, setFocused] = useState(false);
  const rowRef = useRef<TVView>(null);
  const [handle, setHandle] = useState<number | null>(null);
  const tint = hidden ? colors.mutedForeground : colors.foreground;

  // Focus follows a held row through a reorder (see SidebarSettingsScreen).
  useEffect(() => {
    if (grabbed && !focused) rowRef.current?.requestTVFocus?.();
  }, [grabbed, focused]);

  return (
    <Pressable
      ref={rowRef}
      hasTVPreferredFocus={hasTVPreferredFocus}
      onLayout={() => {
        if (handle === null) setHandle(findNodeHandle(rowRef.current) ?? null);
      }}
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
        <Feather name={hidden ? "eye-off" : "eye"} size={s(20)} color={tint} />
      </View>
      <Text style={[styles.label, { color: tint }]} numberOfLines={1}>
        {label}
      </Text>
      <Text style={styles.state} numberOfLines={1}>
        {state}
      </Text>
      <View style={styles.grip}>
        {grabbed ? (
          <Feather name="move" size={s(16)} color={colors.brand} />
        ) : null}
      </View>
    </Pressable>
  );
}

const styles = createStyles({
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
  muted: { color: colors.mutedForeground, fontSize: fontSize.md },
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
    width: 220,
    textAlign: "right",
    color: colors.mutedForeground,
    fontSize: fontSize.sm,
  },
  grip: { width: 24, alignItems: "flex-end" },
});
