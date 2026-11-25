import { useEvent } from "expo";
import { router } from "expo-router";
import { SymbolView } from "expo-symbols";
import { VideoView } from "expo-video";
import { useEffect } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { getPlayer, useNowPlaying } from "@/player/store";

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
      <View style={[styles.info, { paddingBottom: insets.bottom + 16 }]}>
        <Text style={styles.title} numberOfLines={3}>
          {video.title}
        </Text>
        {video.channelName ? (
          <Text style={styles.channel}>{video.channelName}</Text>
        ) : null}
        {error ? (
          <Text style={styles.error}>{error}</Text>
        ) : status === "loading" ? (
          <Text style={styles.channel}>Loading…</Text>
        ) : null}
      </View>
    </View>
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
  info: { paddingHorizontal: 16, paddingTop: 16, gap: 6 },
  title: { color: "#fff", fontSize: 20, fontWeight: "600" },
  channel: { color: "rgba(255,255,255,0.6)", fontSize: 15 },
  error: { color: "#ff6b81", fontSize: 15, marginTop: 8 },
});
