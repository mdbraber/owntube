import { useEvent } from "expo";
import { Image } from "expo-image";
import { router } from "expo-router";
import { NativeTabs } from "expo-router/native-tabs";
import { SymbolView } from "expo-symbols";
import {
  Pressable,
  StyleSheet,
  Text,
  useColorScheme,
  View,
} from "react-native";
import { getPlayer, stopPlayback, useNowPlaying } from "@/player/store";

/**
 * What's playing, above the tab bar (the tab bar's bottom accessory, drawn by
 * iOS in Liquid Glass). Tap to open the player; play/pause and close in place.
 */
export function MiniPlayer() {
  const nowPlaying = useNowPlaying();
  const player = getPlayer();
  const { isPlaying } = useEvent(player, "playingChange", {
    isPlaying: player.playing,
  });
  const placement = NativeTabs.BottomAccessory.usePlacement();
  const dark = useColorScheme() === "dark";
  const color = dark ? "#fff" : "#000";
  if (!nowPlaying) return null;
  const { video } = nowPlaying;

  return (
    <View style={styles.row}>
      <Pressable
        style={styles.open}
        accessibilityRole="button"
        accessibilityLabel={`Open player: ${video.title}`}
        onPress={() => router.navigate("/player")}
      >
        {video.poster && placement === "regular" ? (
          <Image
            source={video.poster}
            style={styles.poster}
            contentFit="cover"
          />
        ) : null}
        <Text style={[styles.title, { color }]} numberOfLines={1}>
          {video.title}
        </Text>
      </Pressable>
      <Pressable
        hitSlop={10}
        accessibilityRole="button"
        accessibilityLabel={isPlaying ? "Pause" : "Play"}
        onPress={() => (isPlaying ? player.pause() : player.play())}
        style={styles.button}
      >
        <SymbolView
          name={isPlaying ? "pause.fill" : "play.fill"}
          tintColor={color}
          size={20}
        />
      </Pressable>
      {placement === "regular" ? (
        <Pressable
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel="Stop"
          onPress={stopPlayback}
          style={styles.button}
        >
          <SymbolView name="xmark" tintColor={color} size={18} />
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    gap: 4,
  },
  open: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    minWidth: 0,
  },
  poster: { width: 44, height: 25, borderRadius: 5 },
  title: { flex: 1, fontSize: 15, fontWeight: "500" },
  button: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
  },
});
