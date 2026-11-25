import { useEvent } from "expo";
import { router, useLocalSearchParams } from "expo-router";
import { SymbolView } from "expo-symbols";
import { VideoView } from "expo-video";
import { useCallback, useEffect } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  pageRouteOf,
  WebPageView,
  watchTarget,
  webPathOf,
} from "@/components/web-screen";
import { getCurrentTab } from "@/lib/current-tab";
import {
  applyPageHints,
  getPlayer,
  openVideo,
  retryPlayback,
  useNowPlaying,
} from "@/player/store";

/**
 * The player panel, YouTube-style: one sheet with the video on top (Apple's
 * own controls: scrubbing, Picture-in-Picture, AirPlay, speed, full screen)
 * and the video's page below it: title, channel, actions, description,
 * comments, related videos.
 *
 * - Swipe down (or the chevron) leaves the video playing in the mini player,
 *   back where you were browsing; nothing was added to Back.
 * - Another video tapped in the panel replaces this one in place.
 * - Any other page (the channel…) swipes the panel away and opens in the tab
 *   you were browsing.
 *
 * `/player?v=<id>&t=<s>` opens a video directly (links from outside the app).
 */
export default function PlayerPanel() {
  const { v, t } = useLocalSearchParams<{ v?: string; t?: string }>();
  const nowPlaying = useNowPlaying();
  const player = getPlayer();
  const insets = useSafeAreaInsets();
  const { status } = useEvent(player, "statusChange", {
    status: player.status,
  });
  const { isPlaying } = useEvent(player, "playingChange", {
    isPlaying: player.playing,
  });

  useEffect(() => {
    if (!v) return;
    const start = t ? Number(t) : undefined;
    openVideo(
      { videoId: v, startSeconds: start && start > 0 ? start : undefined },
      { present: false },
    );
  }, [v, t]);

  useEffect(() => {
    if (!nowPlaying && !v && router.canGoBack()) router.back();
  }, [nowPlaying, v]);

  const onNavigate = useCallback((url: string) => {
    const video = watchTarget(url);
    if (video) {
      openVideo(video, { present: false });
      return;
    }
    // Swipe the panel away (the video plays on in the mini player) and open
    // the page in the tab you were browsing.
    const path = webPathOf(url);
    if (router.canGoBack()) router.back();
    setTimeout(() => {
      router.push({
        pathname: pageRouteOf(getCurrentTab()) as never,
        params: { path },
      });
    }, 350);
  }, []);

  if (!nowPlaying) return <View style={styles.screen} />;
  const { video, error } = nowPlaying;

  return (
    <View style={styles.screen}>
      <View style={styles.bar}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Minimize player"
          hitSlop={12}
          onPress={() => router.back()}
          style={styles.close}
        >
          <SymbolView name="chevron.down" tintColor="#fff" size={20} />
        </Pressable>
        {status === "loading" && !isPlaying && !error ? (
          <Text style={styles.status}>Loading…</Text>
        ) : null}
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
      ) : null}
      <View style={[styles.page, { paddingBottom: insets.bottom }]}>
        {/* The video's web page without its own player (`panel=1`): it
            reports title, artwork and the resume position (`play`). A new
            video gets a new page. */}
        <WebPageView
          key={video.videoId}
          path={`/watch?v=${encodeURIComponent(video.videoId)}&panel=1`}
          onNavigate={onNavigate}
          onPlay={applyPageHints}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#000" },
  bar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 12,
  },
  close: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.14)",
  },
  status: { color: "rgba(255,255,255,0.6)", fontSize: 15 },
  video: { width: "100%", aspectRatio: 16 / 9, backgroundColor: "#000" },
  errorRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  error: { color: "#ff6b81", fontSize: 15, flex: 1 },
  retry: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 18,
    backgroundColor: "rgba(255,255,255,0.14)",
  },
  retryLabel: { color: "#fff", fontSize: 15, fontWeight: "600" },
  page: { flex: 1 },
});
