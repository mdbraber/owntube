import { useEvent } from "expo";
import { router, useLocalSearchParams } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SymbolView } from "expo-symbols";
import { VideoView } from "expo-video";
import { useCallback, useEffect } from "react";
import {
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  pageRouteOf,
  WebPageView,
  watchTarget,
  webPathOf,
} from "@/components/web-screen";
import { getCurrentTab } from "@/lib/current-tab";
import { allowRotation, isPhone, lockToPortrait } from "@/lib/orientation";
import {
  applyPageHints,
  getPlayer,
  noteInteraction,
  openVideo,
  resumeAfterIdle,
  retryPlayback,
  useNowPlaying,
} from "@/player/store";
import { QueueSection, UpNextColumn } from "@/player/up-next";

/** The native Up next column of a wide panel (iPad). */
const COLUMN_WIDTH = 380;
/** From this width the panel splits into the video side and Up next. */
const WIDE_FROM = 1000;

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
 * Layouts, as YouTube's app:
 * - iPhone: video, the queue bar, then the page. Turning the phone sideways
 *   shows only the video, edge to edge; the rest of the app stays portrait.
 * - Wide (iPad): the video and its page on the left, Up next (queue, then
 *   related videos) in a native column on the right.
 *
 * `/player?v=<id>&t=<s>` opens a video directly (links from outside the app).
 */
export default function PlayerPanel() {
  const { v, t } = useLocalSearchParams<{ v?: string; t?: string }>();
  const nowPlaying = useNowPlaying();
  const player = getPlayer();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const landscapePhone = isPhone && width > height;
  const wide = !isPhone && width >= WIDE_FROM;

  // Only the panel turns with the phone; browsing stays portrait.
  useEffect(() => {
    allowRotation();
    return lockToPortrait;
  }, []);
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
  const { video, error, idleStopped } = nowPlaying;

  const videoView = (
    <VideoView
      player={player}
      style={landscapePhone || wide ? styles.fill : styles.video}
      nativeControls
      contentFit="contain"
      allowsPictureInPicture
      startsPictureInPictureAutomatically
      // The full-screen button turns to landscape, and turning back to
      // portrait leaves full screen, as YouTube's.
      fullscreenOptions={{
        enable: true,
        orientation: isPhone ? "landscape" : "default",
        autoExitOnRotate: isPhone,
      }}
    />
  );

  // "Still watching?": the live stream was unloaded after hours untouched.
  const idleRow = idleStopped ? (
    <View style={styles.errorRow}>
      <Text style={styles.idle}>Still watching?</Text>
      <Pressable
        accessibilityRole="button"
        onPress={resumeAfterIdle}
        style={styles.retry}
      >
        <Text style={styles.retryLabel}>Continue watching</Text>
      </Pressable>
    </View>
  ) : null;

  // iPhone on its side: the video alone, edge to edge.
  if (landscapePhone) {
    return (
      <View style={styles.screen} onTouchStart={noteInteraction}>
        <StatusBar hidden />
        {videoView}
        {idleRow}
      </View>
    );
  }

  const bar = (
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
  );

  const errorRow = error ? (
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
  ) : null;

  // The video's web page without its own player: it reports title, artwork
  // and the resume position (`play`). A new video (or layout) gets a new
  // page. Wide panels show Up next natively, so the page leaves it out.
  const panelMode = wide ? "side" : "1";
  const page = (
    <View style={[styles.page, { paddingBottom: wide ? 0 : insets.bottom }]}>
      <WebPageView
        key={`${video.videoId}:${panelMode}`}
        path={`/watch?v=${encodeURIComponent(video.videoId)}&panel=${panelMode}`}
        onNavigate={onNavigate}
        onPlay={applyPageHints}
      />
    </View>
  );

  if (wide) {
    const sideWidth = width - COLUMN_WIDTH;
    const videoHeight = Math.min((sideWidth * 9) / 16, height * 0.62);
    return (
      <View
        style={[styles.screen, styles.row, { paddingTop: insets.top }]}
        onTouchStart={noteInteraction}
      >
        <View style={styles.side}>
          {bar}
          <View style={[styles.videoBox, { height: videoHeight }]}>
            {videoView}
          </View>
          {errorRow}
          {idleRow}
          {page}
        </View>
        <View style={[styles.upNext, { paddingBottom: insets.bottom }]}>
          <UpNextColumn nowPlaying={nowPlaying} />
        </View>
      </View>
    );
  }

  return (
    <View style={styles.screen} onTouchStart={noteInteraction}>
      {bar}
      {videoView}
      {errorRow}
      {idleRow}
      <QueueSection nowPlaying={nowPlaying} />
      {page}
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
  fill: { flex: 1, backgroundColor: "#000" },
  row: { flexDirection: "row" },
  side: { flex: 1 },
  videoBox: { width: "100%", backgroundColor: "#000" },
  upNext: {
    width: COLUMN_WIDTH,
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderLeftColor: "rgba(255,255,255,0.12)",
  },
  errorRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  error: { color: "#ff6b81", fontSize: 15, flex: 1 },
  idle: { color: "#fff", fontSize: 15, flex: 1 },
  retry: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 18,
    backgroundColor: "rgba(255,255,255,0.14)",
  },
  retryLabel: { color: "#fff", fontSize: 15, fontWeight: "600" },
  page: { flex: 1 },
});
