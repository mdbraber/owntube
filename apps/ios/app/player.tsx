import { useEvent } from "expo";
import { Image } from "expo-image";
import { router } from "expo-router";
import { SymbolView } from "expo-symbols";
import { VideoView } from "expo-video";
import { useEffect } from "react";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  getPlayer,
  playNext,
  retryPlayback,
  type UpNextItem,
  useNowPlaying,
} from "@/player/store";

/**
 * The video player, as a sheet over the app. Apple's own controls
 * (AVPlayerViewController): scrubbing, Picture-in-Picture, AirPlay, speed,
 * full screen. Swiping the sheet down keeps the video playing in the mini
 * player; leaving the app with it playing goes to Picture-in-Picture.
 */
export default function PlayerScreen() {
  const nowPlaying = useNowPlaying();
  const player = getPlayer();
  const insets = useSafeAreaInsets();
  const { status } = useEvent(player, "statusChange", {
    status: player.status,
  });

  useEffect(() => {
    if (!nowPlaying && router.canGoBack()) router.back();
  }, [nowPlaying]);

  if (!nowPlaying) return null;
  const { video, error } = nowPlaying;

  return (
    <View style={styles.screen}>
      <View style={[styles.bar, { paddingTop: 12 }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close player"
          hitSlop={12}
          onPress={() => router.back()}
          style={styles.close}
        >
          <SymbolView name="chevron.down" tintColor="#fff" size={20} />
        </Pressable>
      </View>
      <VideoView
        player={player}
        style={styles.video}
        nativeControls
        contentFit="contain"
        allowsPictureInPicture
        startsPictureInPictureAutomatically
        fullscreenOptions={{ enable: true }}
      />
      <FlatList
        data={nowPlaying.upNext}
        keyExtractor={(item) => item.videoId}
        contentContainerStyle={{ paddingBottom: insets.bottom + 16 }}
        ListHeaderComponent={
          <View style={styles.info}>
            <Text style={styles.title} numberOfLines={3}>
              {video.title}
            </Text>
            {video.channelName ? (
              <Text style={styles.channel}>{video.channelName}</Text>
            ) : null}
            {error ? (
              <View style={styles.errorRow}>
                <Text style={styles.error}>{error}</Text>
                <Pressable
                  accessibilityRole="button"
                  onPress={retryPlayback}
                  style={styles.retry}
                >
                  <Text style={styles.retryLabel}>Try again</Text>
                </Pressable>
              </View>
            ) : status === "loading" ? (
              <Text style={styles.channel}>Loading…</Text>
            ) : null}
            {nowPlaying.upNext.length > 0 ? (
              <View style={styles.upNextHeader}>
                <Text style={styles.upNextTitle}>Up next</Text>
                <Text style={styles.upNextNote}>
                  {nowPlaying.upNext[0]?.fromQueue
                    ? "From your queue"
                    : nowPlaying.autoplayNext
                      ? "Autoplay is on"
                      : "Autoplay is off"}
                </Text>
              </View>
            ) : null}
          </View>
        }
        renderItem={({ item }) => <UpNextRow item={item} />}
      />
    </View>
  );
}

function formatDuration(seconds?: number): string | null {
  if (!seconds) return null;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60)
    .toString()
    .padStart(2, "0");
  return h ? `${h}:${m.toString().padStart(2, "0")}:${s}` : `${m}:${s}`;
}

function UpNextRow({ item }: { item: UpNextItem }) {
  const duration = formatDuration(item.durationSeconds);
  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => playNext(item)}
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
        <Text style={styles.rowChannel} numberOfLines={1}>
          {item.fromQueue ? "Queue · " : ""}
          {item.channelName ?? ""}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#000" },
  bar: { paddingHorizontal: 16, paddingBottom: 12 },
  close: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.14)",
  },
  video: { width: "100%", aspectRatio: 16 / 9, backgroundColor: "#000" },
  info: { paddingHorizontal: 16, paddingTop: 16, gap: 6, paddingBottom: 4 },
  title: { color: "#fff", fontSize: 20, fontWeight: "600" },
  channel: { color: "rgba(255,255,255,0.6)", fontSize: 15 },
  errorRow: { marginTop: 8, gap: 10, alignItems: "flex-start" },
  error: { color: "#ff6b81", fontSize: 15 },
  retry: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 18,
    backgroundColor: "rgba(255,255,255,0.14)",
  },
  retryLabel: { color: "#fff", fontSize: 15, fontWeight: "600" },
  upNextHeader: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    marginTop: 20,
    marginBottom: 4,
  },
  upNextTitle: { color: "#fff", fontSize: 17, fontWeight: "600" },
  upNextNote: { color: "rgba(255,255,255,0.5)", fontSize: 13 },
  row: {
    flexDirection: "row",
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  rowPressed: { backgroundColor: "rgba(255,255,255,0.08)" },
  thumb: {
    width: 144,
    height: 81,
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
  rowTitle: { color: "#fff", fontSize: 15, fontWeight: "500" },
  rowChannel: { color: "rgba(255,255,255,0.6)", fontSize: 13 },
});
