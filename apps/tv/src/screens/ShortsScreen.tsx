import { useInfiniteQuery } from "@tanstack/react-query";
import type { UnifiedVideo } from "@web/server/catalog/types";
import { useKeepAwake } from "expo-keep-awake";
import { useVideoPlayer, VideoView } from "expo-video";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  findNodeHandle,
  Pressable,
  StyleSheet,
  Text,
  useTVEventHandler,
  View,
} from "react-native";
import { getToken } from "@/lib/auth-token";
import { manifestUrl } from "@/lib/playback-url";
import { queryClient } from "@/lib/query-client";
import { trpcClient } from "@/lib/trpc";
import type { TVView } from "@/lib/tv-focus";
import { createStyles } from "@/lib/ui-scale";
import { colors, fontSize, radius, spacing } from "@/theme";

/** A short counts as seen after this long on screen. */
const SEEN_AFTER_MS = 2000;
/** Fetch the next page when this close to the end. */
const PREFETCH_REMAINING = 3;

/**
 * Shorts, one at a time and full height: Up and Down move between them, OK
 * pauses, Left returns to the sidebar. Each plays on a loop until you move on,
 * and is marked seen (so the feed stops offering it) after a couple of
 * seconds.
 */
export function ShortsScreen({ startVideo }: { startVideo?: UnifiedVideo }) {
  useKeepAwake();
  const feed = useInfiniteQuery({
    queryKey: ["feed", "shorts.feed"],
    queryFn: ({ pageParam }) =>
      trpcClient.shorts.feed.query({
        limit: 20,
        cursor: pageParam ?? null,
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });

  const shorts = useMemo(() => {
    const seen = new Set<string>();
    const out: UnifiedVideo[] = startVideo ? [startVideo] : [];
    if (startVideo) seen.add(startVideo.videoId);
    for (const page of feed.data?.pages ?? []) {
      for (const video of page.videos) {
        if (seen.has(video.videoId)) continue;
        seen.add(video.videoId);
        out.push(video);
      }
    }
    return out;
  }, [feed.data, startVideo]);

  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const current = shorts[index];

  const [authHeader, setAuthHeader] = useState<Record<string, string> | null>(
    null,
  );
  useEffect(() => {
    getToken().then((token) =>
      setAuthHeader(token ? { Authorization: `Bearer ${token}` } : {}),
    );
  }, []);

  const player = useVideoPlayer(null, (p) => {
    p.loop = true;
  });

  // Load each short as it comes up: its video page carries the signed
  // gateway manifests (see playback-url.ts).
  useEffect(() => {
    if (!current || !authHeader) return;
    let cancelled = false;
    queryClient
      .fetchQuery({
        queryKey: [["video", "detail"], { videoId: current.videoId }],
        queryFn: () =>
          trpcClient.video.detail.query({ videoId: current.videoId }),
        staleTime: 60_000,
      })
      .then((detail) => {
        const uri = manifestUrl(detail, { maxHeight: 1080 });
        if (cancelled || !uri) return;
        player.replace({
          uri,
          headers: authHeader,
          metadata: { title: current.title, artist: current.channelName },
        });
        player.play();
        setPaused(false);
      })
      .catch(() => {});
    const timer = setTimeout(() => {
      if (!current.channelId) return;
      trpcClient.shorts.markSeen
        .mutate({ videoId: current.videoId, channelId: current.channelId })
        .catch(() => {});
    }, SEEN_AFTER_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [current, authHeader, player]);

  // Keep a few shorts ahead.
  useEffect(() => {
    if (
      shorts.length - index <= PREFETCH_REMAINING &&
      feed.hasNextPage &&
      !feed.isFetchingNextPage
    ) {
      void feed.fetchNextPage();
    }
  }, [index, shorts.length, feed]);

  const stateRef = useRef({ count: shorts.length });
  stateRef.current = { count: shorts.length };
  // Up/Down browse only while the short itself has focus; in the sidebar
  // they must still move through the sections. Android TV reports a plain
  // arrow press once, on key-up; a key-down copy (when enabled) is skipped.
  const [surfaceFocused, setSurfaceFocused] = useState(false);
  const surfaceRef = useRef<TVView>(null);
  const [surfaceHandle, setSurfaceHandle] = useState<number | null>(null);
  const surfaceFocusedRef = useRef(false);
  surfaceFocusedRef.current = surfaceFocused;
  useTVEventHandler((event) => {
    if (!surfaceFocusedRef.current) return;
    if (Number(event.eventKeyAction) === 0) return;
    if (event.eventType === "down") {
      setIndex((i) => Math.min(i + 1, Math.max(0, stateRef.current.count - 1)));
    } else if (event.eventType === "up") {
      setIndex((i) => Math.max(0, i - 1));
    }
  });

  const togglePause = () => {
    if (paused) player.play();
    else player.pause();
    setPaused(!paused);
  };

  if (!current) {
    return (
      <View style={styles.centered}>
        {feed.isPending ? (
          <ActivityIndicator size="large" color={colors.brand} />
        ) : (
          <Text style={styles.muted}>No Shorts right now.</Text>
        )}
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.frame}>
        <VideoView
          style={StyleSheet.absoluteFill}
          player={player}
          contentFit="contain"
          nativeControls={false}
        />
      </View>
      {/* One focusable surface: OK pauses; up/down are read as TV events. */}
      <Pressable
        ref={surfaceRef}
        onLayout={() => {
          if (surfaceHandle === null) {
            setSurfaceHandle(findNodeHandle(surfaceRef.current) ?? null);
          }
        }}
        // Up/Down change the short; pinning focus here stops Android also
        // moving it into the sidebar. Left still leaves.
        nextFocusUp={surfaceHandle ?? undefined}
        nextFocusDown={surfaceHandle ?? undefined}
        hasTVPreferredFocus
        onPress={togglePause}
        onFocus={() => setSurfaceFocused(true)}
        onBlur={() => setSurfaceFocused(false)}
        style={StyleSheet.absoluteFill}
      />
      <View style={styles.info} pointerEvents="none">
        <Text style={styles.title} numberOfLines={3}>
          {current.title}
        </Text>
        {current.channelName ? (
          <Text style={styles.channel}>{current.channelName}</Text>
        ) : null}
        <Text style={styles.hint}>
          {paused ? "Paused · " : ""}
          {index + 1} / {shorts.length} ·{" "}
          {surfaceFocused ? "↑↓ to browse" : "→ to watch, then ↑↓"}
        </Text>
      </View>
    </View>
  );
}

/** Portrait frame, the height of the screen area. */
const FRAME_ASPECT = 9 / 16;

const styles = createStyles({
  container: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.xl,
  },
  frame: {
    height: "100%",
    aspectRatio: FRAME_ASPECT,
    borderRadius: radius.card,
    overflow: "hidden",
    backgroundColor: colors.videoBackground,
  },
  info: { width: 320, gap: spacing.sm },
  title: { color: colors.foreground, fontSize: fontSize.lg, fontWeight: "700" },
  channel: { color: colors.mutedForeground, fontSize: fontSize.md },
  hint: { color: colors.mutedForeground, fontSize: fontSize.sm },
  centered: { flex: 1, alignItems: "center", justifyContent: "center" },
  muted: { color: colors.mutedForeground, fontSize: fontSize.md },
});
