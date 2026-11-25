import { Image } from "expo-image";
import { SymbolView } from "expo-symbols";
import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { ACCENT } from "@/lib/theme";
import { type NowPlaying, playNext, type UpNextItem } from "@/player/store";

function formatDuration(seconds?: number): string | null {
  if (!seconds) return null;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60)
    .toString()
    .padStart(2, "0");
  return h ? `${h}:${m.toString().padStart(2, "0")}:${s}` : `${m}:${s}`;
}

/** One video in the queue or the related list; tapping it plays it. */
export function UpNextRow({ item }: { item: UpNextItem }) {
  const duration = formatDuration(item.durationSeconds);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Play ${item.title}`}
      onPress={() => playNext(item, { present: false })}
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
    >
      <View>
        <Image
          source={item.thumbnailUrl}
          style={styles.thumb}
          contentFit="cover"
        />
        {duration ? <Text style={styles.duration}>{duration}</Text> : null}
      </View>
      <View style={styles.rowText}>
        <Text style={styles.rowTitle} numberOfLines={2}>
          {item.title}
        </Text>
        {item.channelName ? (
          <Text style={styles.rowChannel} numberOfLines={1}>
            {item.channelName}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

/**
 * The queue, as its own section of the player panel (YouTube's queue bar):
 * collapsed, the next video in it and how many follow; open, the whole
 * queue. Shown only while the queue has videos.
 */
export function QueueSection({
  nowPlaying,
  collapsible = true,
}: {
  nowPlaying: NowPlaying;
  /** Phone: a bar that opens; wide layouts: always open. */
  collapsible?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const queue = nowPlaying.upNext.filter((item) => item.fromQueue);
  if (queue.length === 0) return null;
  const expanded = open || !collapsible;
  const next = queue[0];

  return (
    <View style={styles.queue}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        accessibilityLabel={`Queue, ${queue.length} videos`}
        disabled={!collapsible}
        onPress={() => setOpen((value) => !value)}
        style={styles.queueHeader}
      >
        <SymbolView
          name="text.line.first.and.arrowtriangle.forward"
          tintColor={ACCENT}
          size={18}
        />
        <View style={styles.queueHeaderText}>
          <Text style={styles.queueTitle}>
            Queue · {queue.length} {queue.length === 1 ? "video" : "videos"}
          </Text>
          {!expanded && next ? (
            <Text style={styles.queueNext} numberOfLines={1}>
              Next: {next.title}
            </Text>
          ) : null}
        </View>
        {collapsible ? (
          <SymbolView
            name={expanded ? "chevron.up" : "chevron.down"}
            tintColor="rgba(255,255,255,0.7)"
            size={14}
          />
        ) : null}
      </Pressable>
      {expanded ? (
        <ScrollView
          style={collapsible ? styles.queueList : undefined}
          scrollEnabled={collapsible}
        >
          {queue.map((item) => (
            <UpNextRow key={item.videoId} item={item} />
          ))}
        </ScrollView>
      ) : null}
    </View>
  );
}

/**
 * The right-hand column of the panel on wide screens (iPad): the queue, then
 * related videos, as YouTube's iPad layout.
 */
export function UpNextColumn({ nowPlaying }: { nowPlaying: NowPlaying }) {
  const related = nowPlaying.upNext.filter((item) => !item.fromQueue);
  return (
    <ScrollView
      style={styles.column}
      contentContainerStyle={styles.columnContent}
    >
      <QueueSection nowPlaying={nowPlaying} collapsible={false} />
      {related.length > 0 ? (
        <>
          <View style={styles.relatedHeader}>
            <Text style={styles.queueTitle}>Up next</Text>
            <Text style={styles.queueNext}>
              {nowPlaying.autoplayNext ? "Autoplay is on" : "Autoplay is off"}
            </Text>
          </View>
          {related.map((item) => (
            <UpNextRow key={item.videoId} item={item} />
          ))}
        </>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  queue: {
    backgroundColor: "#16161a",
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "rgba(255,255,255,0.12)",
  },
  queueHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  queueHeaderText: { flex: 1, gap: 2 },
  queueTitle: { color: "#fff", fontSize: 15, fontWeight: "600" },
  queueNext: { color: "rgba(255,255,255,0.6)", fontSize: 13 },
  queueList: { maxHeight: 280 },
  relatedHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "baseline",
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 6,
  },
  column: { flex: 1, backgroundColor: "#0e0e11" },
  columnContent: { paddingBottom: 24 },
  row: {
    flexDirection: "row",
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  rowPressed: { backgroundColor: "rgba(255,255,255,0.08)" },
  thumb: {
    width: 128,
    height: 72,
    borderRadius: 8,
    backgroundColor: "#222",
  },
  duration: {
    position: "absolute",
    right: 4,
    bottom: 4,
    color: "#fff",
    fontSize: 11,
    fontWeight: "600",
    backgroundColor: "rgba(0,0,0,0.75)",
    borderRadius: 4,
    overflow: "hidden",
    paddingHorizontal: 4,
    paddingVertical: 1,
  },
  rowText: { flex: 1, gap: 4 },
  rowTitle: { color: "#fff", fontSize: 14, fontWeight: "500" },
  rowChannel: { color: "rgba(255,255,255,0.6)", fontSize: 12 },
});
