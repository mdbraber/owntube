import type { SponsorBlockSegment } from "@web/lib/sponsorblock";
import type {
  UnifiedVideo,
  VideoDetail,
} from "@web/server/services/proxy.types";
import { useVideoPlayer, VideoView } from "expo-video";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  useTVEventHandler,
  View,
} from "react-native";
import { FocusButton } from "@/components/FocusButton";
import { IconButton } from "@/components/IconButton";
import { VideoRow } from "@/components/VideoRow";
import { formatTime } from "@/lib/format";
import { trpcClient } from "@/lib/trpc";
import { errorMessage } from "@/lib/use-query";
import { colors, focus, fontSize, monoFont, radius, spacing } from "@/theme";

// Skip-type categories auto-skipped on TV (filler excluded — too aggressive).
const SKIP_CATEGORIES = [
  "sponsor",
  "selfpromo",
  "intro",
  "outro",
  "interaction",
  "preview",
] as const;

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | {
      status: "ready";
      detail: VideoDetail;
      playbackOptions: PlaybackOption[];
      selectedOptionIndex: number;
    };

type PlaybackOption = {
  id: string;
  label: string;
  videoUrl: string;
} & (
  | { kind: "auto" | "muxed"; audioUrl?: never }
  | { kind: "split"; audioUrl: string }
);

/**
 * Full watch screen: plays the stream via ExoPlayer, resumes from a saved
 * offset, auto-skips SponsorBlock segments, records watch progress to history,
 * and shows a related-videos rail + channel link when paused.
 *
 * Stream selection prefers HLS auto quality, then muxed progressive MP4 streams.
 * Adaptive-only HD rows are played as synchronized video-only + audio sources.
 */
export function WatchScreen({
  videoId,
  resumeSeconds,
  onOpenVideo,
  onOpenChannel,
  onBack,
}: {
  videoId: string;
  resumeSeconds?: number;
  onOpenVideo: (videoId: string) => void;
  onOpenChannel: (channelId: string) => void;
  onBack: () => void;
}) {
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [isPlaying, setIsPlaying] = useState(true);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [isBuffering, setIsBuffering] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [channelFocused, setChannelFocused] = useState(false);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Read by the auto-hide timer to avoid hiding controls while paused.
  const isPlayingRef = useRef(isPlaying);
  isPlayingRef.current = isPlaying;

  // Latest values the timeUpdate listener and unmount cleanup read without
  // re-subscribing on every change.
  const currentTimeRef = useRef(0);
  const segmentsRef = useRef<SponsorBlockSegment[]>([]);
  const detailRef = useRef<VideoDetail | null>(null);
  const pendingSeekRef = useRef<number | null>(null);
  const shouldPlayAfterReplaceRef = useRef(true);
  const selectedOptionRef = useRef<PlaybackOption | null>(null);

  const player = useVideoPlayer(null, (p) => {
    p.loop = false;
    p.timeUpdateEventInterval = 1;
  });
  const audioPlayer = useVideoPlayer(null, (p) => {
    p.loop = false;
    p.timeUpdateEventInterval = 1;
  });

  // Playback detail (blocking) + SponsorBlock/related (best-effort, parallel).
  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });
    detailRef.current = null;
    currentTimeRef.current = 0;
    segmentsRef.current = [];
    pendingSeekRef.current = null;
    shouldPlayAfterReplaceRef.current = true;
    selectedOptionRef.current = null;

    trpcClient.video.detail
      .query({ videoId })
      .then((detail) => {
        if (cancelled) return;
        detailRef.current = detail;
        const playbackOptions = buildPlaybackOptions(detail);
        if (playbackOptions.length === 0) {
          setState({
            status: "error",
            message: "This video has no playable stream available.",
          });
          return;
        }
        setState({
          status: "ready",
          detail,
          playbackOptions,
          selectedOptionIndex: 0,
        });

        trpcClient.sponsorblock.segments
          .query({
            videoId,
            categories: [...SKIP_CATEGORIES],
            durationSeconds: detail.durationSeconds,
          })
          .then((segments) => {
            if (!cancelled) segmentsRef.current = segments;
          })
          .catch(() => {});
      })
      .catch((err: unknown) => {
        if (!cancelled)
          setState({ status: "error", message: errorMessage(err) });
      });

    return () => {
      cancelled = true;
    };
  }, [videoId]);

  const [related, setRelated] = useState<UnifiedVideo[]>([]);
  useEffect(() => {
    let cancelled = false;
    setRelated([]);
    trpcClient.video.related
      .query({ videoId })
      .then((result) => {
        if (!cancelled) setRelated(result.videos);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [videoId]);

  // Load the stream and resume from the saved offset.
  useEffect(() => {
    if (state.status !== "ready") return;
    const selectedOption = state.playbackOptions[state.selectedOptionIndex];
    if (!selectedOption) return;

    selectedOptionRef.current = selectedOption;
    if (selectedOption.kind === "split") {
      player.muted = true;
      player.replace(selectedOption.videoUrl);
      audioPlayer.replace(selectedOption.audioUrl);
    } else {
      player.muted = false;
      player.replace(selectedOption.videoUrl);
      audioPlayer.pause();
      audioPlayer.replace(null);
    }
    const startSeconds = pendingSeekRef.current ?? resumeSeconds;
    pendingSeekRef.current = null;
    if (startSeconds && startSeconds > 5) {
      player.currentTime = startSeconds;
      if (selectedOption.kind === "split")
        audioPlayer.currentTime = startSeconds;
    }
    const shouldPlay = shouldPlayAfterReplaceRef.current;
    shouldPlayAfterReplaceRef.current = true;
    if (shouldPlay) {
      player.play();
      if (selectedOption.kind === "split") audioPlayer.play();
    } else {
      player.pause();
      audioPlayer.pause();
    }
    setIsPlaying(shouldPlay);
  }, [state, player, audioPlayer, resumeSeconds]);

  // SponsorBlock auto-skip: on each tick, jump past any segment we're inside.
  useEffect(() => {
    const sub = player.addListener("timeUpdate", ({ currentTime }) => {
      currentTimeRef.current = currentTime;
      setCurrentTime(currentTime);
      const hit = segmentsRef.current.find(
        (s) =>
          currentTime >= s.startSeconds && currentTime < s.endSeconds - 0.5,
      );
      const selectedOption = selectedOptionRef.current;
      if (hit) {
        player.currentTime = hit.endSeconds;
        if (selectedOption?.kind === "split") {
          audioPlayer.currentTime = hit.endSeconds;
        }
        return;
      }
      if (selectedOption?.kind === "split") {
        const audioDelta = Math.abs(audioPlayer.currentTime - currentTime);
        if (audioDelta > 0.75) audioPlayer.currentTime = currentTime;
        if (isPlayingRef.current && !audioPlayer.playing) audioPlayer.play();
      }
    });
    return () => sub.remove();
  }, [player, audioPlayer]);

  // Record watch progress to history on leave (feeds the recommender).
  useEffect(() => {
    return () => {
      const detail = detailRef.current;
      const watched = Math.floor(currentTimeRef.current);
      if (!detail?.channelId || watched < 5) return;
      const duration = detail.durationSeconds;
      trpcClient.history.upsertEvent
        .mutate({
          videoId: detail.videoId,
          channelId: detail.channelId,
          durationWatched: watched,
          completed: duration != null && watched >= duration * 0.9,
          videoDurationSeconds: duration,
          isShort: false,
        })
        .catch(() => {});
    };
  }, []);

  const fallbackToStablePlayback = useCallback(() => {
    if (state.status !== "ready") return;
    const selectedOption = state.playbackOptions[state.selectedOptionIndex];
    if (selectedOption?.kind !== "split") return;
    const fallbackIndex = state.playbackOptions.findIndex(
      (option) => option.kind === "auto" || option.kind === "muxed",
    );
    if (fallbackIndex < 0 || fallbackIndex === state.selectedOptionIndex)
      return;
    pendingSeekRef.current = currentTimeRef.current;
    shouldPlayAfterReplaceRef.current = isPlayingRef.current;
    setState((previous) => {
      if (previous.status !== "ready") return previous;
      return { ...previous, selectedOptionIndex: fallbackIndex };
    });
  }, [state]);

  // Buffering spinner: surfaces slow upstream loads instead of a black screen.
  useEffect(() => {
    const sub = player.addListener("statusChange", ({ status }) => {
      setIsBuffering(status === "loading");
      if (status === "readyToPlay") setDuration(player.duration);
      if (status === "error") fallbackToStablePlayback();
    });
    return () => sub.remove();
  }, [player, fallbackToStablePlayback]);

  useEffect(() => {
    const sub = audioPlayer.addListener("statusChange", ({ status }) => {
      if (status === "error") fallbackToStablePlayback();
    });
    return () => sub.remove();
  }, [audioPlayer, fallbackToStablePlayback]);

  // Show the overlay, then auto-hide after a few seconds of inactivity.
  const revealControls = useCallback(() => {
    setControlsVisible(true);
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    hideTimerRef.current = setTimeout(() => {
      if (isPlayingRef.current) setControlsVisible(false);
    }, 4000);
  }, []);

  // Any remote key re-shows the controls (fires regardless of focus target).
  useTVEventHandler((event) => {
    if (event.eventType === "focus" || event.eventType === "blur") return;
    revealControls();
  });

  // While paused the overlay stays pinned; while playing it auto-hides.
  useEffect(() => {
    if (isPlaying) {
      revealControls();
    } else {
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
      setControlsVisible(true);
    }
  }, [isPlaying, revealControls]);

  useEffect(
    () => () => {
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    },
    [],
  );

  const togglePlayback = () => {
    if (isPlaying) {
      player.pause();
      audioPlayer.pause();
      setIsPlaying(false);
    } else {
      player.play();
      if (selectedOptionRef.current?.kind === "split") audioPlayer.play();
      setIsPlaying(true);
    }
  };

  const seekBy = (seconds: number) => {
    player.seekBy(seconds);
    if (selectedOptionRef.current?.kind === "split") {
      audioPlayer.seekBy(seconds);
    }
  };

  const cycleQuality = () => {
    if (state.status !== "ready" || state.playbackOptions.length <= 1) return;
    pendingSeekRef.current = currentTimeRef.current;
    shouldPlayAfterReplaceRef.current = isPlayingRef.current;
    setState((previous) => {
      if (previous.status !== "ready") return previous;
      return {
        ...previous,
        selectedOptionIndex:
          (previous.selectedOptionIndex + 1) % previous.playbackOptions.length,
      };
    });
  };

  if (state.status === "loading") {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={colors.brand} />
        <Text style={styles.muted}>Loading...</Text>
      </View>
    );
  }

  if (state.status === "error") {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorTitle}>Playback unavailable</Text>
        <Text style={styles.muted}>{state.message}</Text>
        <FocusButton label="Back" onPress={onBack} hasTVPreferredFocus />
      </View>
    );
  }

  const { detail } = state;
  const selectedQuality =
    state.playbackOptions[state.selectedOptionIndex]?.label ?? "Auto";

  return (
    <View style={styles.container}>
      <VideoView
        style={StyleSheet.absoluteFill}
        player={player}
        contentFit="contain"
        nativeControls={false}
      />
      {isBuffering ? (
        <View style={styles.bufferingOverlay} pointerEvents="none">
          <ActivityIndicator size="large" color={colors.brand} />
        </View>
      ) : null}
      {/* Controls stay mounted (so a focused button always catches the next key
          to re-reveal them); visibility is just opacity. */}
      <View
        style={[StyleSheet.absoluteFill, { opacity: controlsVisible ? 1 : 0 }]}
        pointerEvents="box-none"
      >
        <View style={styles.overlay}>
          {/* Related rail only when paused — keeps playback uncluttered. */}
          {!isPlaying && related.length > 0 ? (
            <VideoRow title="Up next" videos={related} onSelect={onOpenVideo} />
          ) : null}

          <View style={styles.info}>
            <Text style={styles.title} numberOfLines={1}>
              {detail.title}
            </Text>
            {detail.channelId && detail.channelName ? (
              <Pressable
                onFocus={() => setChannelFocused(true)}
                onBlur={() => setChannelFocused(false)}
                onPress={() => onOpenChannel(detail.channelId as string)}
                style={[
                  styles.channelButton,
                  channelFocused && styles.channelButtonFocused,
                ]}
              >
                <Text
                  style={[
                    styles.channel,
                    channelFocused && styles.channelFocused,
                  ]}
                >
                  {detail.channelName}
                </Text>
              </Pressable>
            ) : null}
          </View>

          <View style={styles.controlPanel}>
            <View style={styles.controls}>
              <IconButton icon="rotate-ccw" onPress={() => seekBy(-10)} />
              <IconButton
                icon={isPlaying ? "pause" : "play"}
                large
                onPress={togglePlayback}
                hasTVPreferredFocus
              />
              <IconButton icon="rotate-cw" onPress={() => seekBy(10)} />
              <FocusButton
                label={`Quality ${selectedQuality}`}
                onPress={cycleQuality}
                disabled={state.playbackOptions.length <= 1}
                style={styles.qualityButton}
              />
            </View>

            <View style={styles.progressRow}>
              <Text style={styles.time}>{formatTime(currentTime)}</Text>
              <View style={styles.track}>
                <View
                  style={[
                    styles.trackFill,
                    {
                      width: `${
                        duration > 0
                          ? Math.min(100, (currentTime / duration) * 100)
                          : 0
                      }%`,
                    },
                  ]}
                />
              </View>
              <Text style={styles.time}>
                {formatTime(duration || detail.durationSeconds || 0)}
              </Text>
            </View>
          </View>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.videoBackground },
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.background,
    gap: spacing.md,
  },
  overlay: {
    position: "absolute",
    left: spacing.screen,
    right: spacing.screen,
    bottom: spacing.screen,
    gap: spacing.md,
  },
  bufferingOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
  },
  info: { gap: spacing.xs },
  progressRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
  },
  track: {
    flex: 1,
    height: 7,
    borderRadius: 4,
    backgroundColor: colors.surfaceBorder,
    overflow: "hidden",
  },
  trackFill: { height: "100%", backgroundColor: colors.brand, borderRadius: 4 },
  time: {
    color: colors.mutedForeground,
    fontSize: fontSize.sm,
    fontFamily: monoFont,
    minWidth: 64,
  },
  controls: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.md,
  },
  qualityButton: { minWidth: 150 },
  controlPanel: {
    gap: spacing.md,
    paddingTop: spacing.xs,
  },
  channelButton: {
    alignSelf: "flex-start",
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
    marginLeft: -spacing.sm,
    borderRadius: radius.shell,
    borderWidth: focus.borderWidth,
    borderColor: "transparent",
  },
  channelButtonFocused: {
    borderColor: colors.ring,
    backgroundColor: colors.brandSoft,
  },
  channel: {
    color: colors.mutedForeground,
    fontSize: fontSize.md,
    fontWeight: "600",
    textShadowColor: colors.shadow,
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 8,
  },
  channelFocused: {
    color: colors.brand,
    textDecorationLine: "underline",
  },
  title: {
    color: colors.foreground,
    fontSize: fontSize.xxl,
    fontWeight: "800",
    lineHeight: 48,
    maxWidth: 1100,
    textShadowColor: colors.shadow,
    textShadowOffset: { width: 0, height: 3 },
    textShadowRadius: 12,
  },
  errorTitle: {
    color: colors.foreground,
    fontSize: fontSize.xl,
    fontWeight: "700",
  },
  muted: { color: colors.mutedForeground, fontSize: fontSize.md },
});

function buildPlaybackOptions(detail: VideoDetail): PlaybackOption[] {
  const options: PlaybackOption[] = [];
  const seen = new Set<string>();

  const addOption = (option: PlaybackOption) => {
    const key =
      option.kind === "split"
        ? `${option.label}|${option.videoUrl}|${option.audioUrl}`
        : `${option.label}|${option.videoUrl}`;
    if (seen.has(key)) return;
    seen.add(key);
    options.push(option);
  };

  if (detail.hlsUrl) {
    addOption({
      id: "auto-hls",
      label: "Auto",
      videoUrl: detail.hlsUrl,
      kind: "auto",
    });
  }

  detail.videoSources
    .filter((source) => sourceLooksMuxed(source))
    .map((source, index) => ({ source, index }))
    .sort(
      (a, b) =>
        qualityScore(b.source.quality, b.source.height, b.index, b.source.fps) -
        qualityScore(a.source.quality, a.source.height, a.index, a.source.fps),
    )
    .forEach(({ source, index }) => {
      addOption({
        id: `muxed-${index}`,
        label: qualityLabel(source.quality, source.height),
        videoUrl: source.url,
        kind: "muxed",
      });
    });

  const audioSource = selectAudioSource(detail.audioSources);
  if (audioSource) {
    const usedSplitLabels = new Set<string>();
    detail.videoSources
      .filter((source) => sourceLooksSplitVideo(source))
      .map((source, index) => ({ source, index }))
      .sort((a, b) => {
        const byQuality =
          qualityScore(
            b.source.quality,
            b.source.height,
            b.index,
            b.source.fps,
          ) -
          qualityScore(
            a.source.quality,
            a.source.height,
            a.index,
            a.source.fps,
          );
        if (byQuality !== 0) return byQuality;
        const byCodec = codecScore(b.source) - codecScore(a.source);
        if (byCodec !== 0) return byCodec;
        return (b.source.bitrate ?? 0) - (a.source.bitrate ?? 0);
      })
      .forEach(({ source, index }) => {
        const label = qualityLabel(source.quality, source.height);
        if (usedSplitLabels.has(label)) return;
        usedSplitLabels.add(label);
        addOption({
          id: `split-${index}`,
          label,
          videoUrl: source.url,
          audioUrl: audioSource.url,
          kind: "split",
        });
      });
  }

  return options;
}

function qualityLabel(quality: string | undefined, height: number | undefined) {
  const cleanQuality = quality?.trim();
  if (cleanQuality) return cleanQuality;
  if (typeof height === "number" && height > 0) return `${height}p`;
  return "MP4";
}

function qualityScore(
  quality: string | undefined,
  height: number | undefined,
  index: number,
  fps?: number,
) {
  const qualityHeight = quality?.match(/(\d{2,4})\s*p/i)?.[1];
  const fpsBonus = typeof fps === "number" && Number.isFinite(fps) ? fps : 0;
  if (qualityHeight)
    return Number.parseInt(qualityHeight, 10) * 1000 + fpsBonus;
  if (typeof height === "number" && height > 0) return height * 1000 + fpsBonus;
  return 1 - index / 1000;
}

function sourceLooksMuxed(source: VideoDetail["videoSources"][number]) {
  if (source.videoOnly === true) return false;
  if (isManifestPath(source.url)) return false;
  const mimeType = source.mimeType?.toLowerCase() ?? "";
  if (mimeType.startsWith("audio/")) return false;
  if (mimeVideoTypeWithoutAudioCodecs(source.mimeType)) return false;
  return true;
}

function sourceLooksSplitVideo(source: VideoDetail["videoSources"][number]) {
  if (source.videoOnly !== true) return false;
  if (isManifestPath(source.url)) return false;
  const mimeType = source.mimeType?.toLowerCase() ?? "";
  if (mimeType.startsWith("audio/")) return false;
  if (mimeVideoTypeButAudioOnlyCodecs(source.mimeType)) return false;
  return true;
}

function selectAudioSource(audioSources: VideoDetail["audioSources"]) {
  return audioSources
    .filter((source) => source.url && !source.videoOnly)
    .sort((a, b) => audioScore(b) - audioScore(a))[0];
}

function audioScore(source: VideoDetail["audioSources"][number]) {
  const blob = `${source.mimeType ?? ""} ${source.url}`.toLowerCase();
  const codecScore = /mp4a|audio\/mp4/.test(blob)
    ? 100
    : /opus|audio\/webm/.test(blob)
      ? 70
      : 40;
  return codecScore + (source.bitrate ?? 0) / 1_000_000;
}

function codecScore(source: VideoDetail["videoSources"][number]) {
  const blob = `${source.mimeType ?? ""} ${source.url}`.toLowerCase();
  if (/avc1|avc3|h264/.test(blob)) return 100;
  if (/video\/mp4/.test(blob) && !/av01|av1|vp9|webm/.test(blob)) return 80;
  if (/vp9|video\/webm/.test(blob)) return 50;
  if (/av01|av1/.test(blob)) return 10;
  return 40;
}

function isManifestPath(url: string) {
  const normalized = url.toLowerCase();
  return (
    normalized.includes(".m3u8") ||
    normalized.includes(".mpd") ||
    normalized.includes("/manifest/hls/") ||
    normalized.includes("/manifest/dash/")
  );
}

function mimeVideoTypeButAudioOnlyCodecs(mimeType: string | undefined) {
  if (!mimeType?.trim()) return false;
  if (!mimeType.toLowerCase().startsWith("video/")) return false;
  const match = mimeType.match(/codecs\s*=\s*"([^"]+)"/i);
  if (!match?.[1]) return false;
  const codecs = match[1].toLowerCase().replace(/\s/g, "");
  if (/avc1|avc3|av01|vp8|vp9|vp09|hev1|hvc1|dvh1|theora/.test(codecs)) {
    return false;
  }
  return /mp4a|opus|vorbis|flac/.test(codecs);
}

function mimeVideoTypeWithoutAudioCodecs(mimeType: string | undefined) {
  if (!mimeType?.trim()) return false;
  if (!mimeType.toLowerCase().startsWith("video/")) return false;
  const match = mimeType.match(/codecs\s*=\s*"([^"]+)"/i);
  if (!match?.[1]) return false;
  const codecs = match[1].toLowerCase().replace(/\s/g, "");
  const hasVideo = /avc1|avc3|av01|vp8|vp9|vp09|hev1|hvc1|dvh1|theora/.test(
    codecs,
  );
  const hasAudio = /mp4a|opus|vorbis|flac|ac-3|ec-3/.test(codecs);
  return hasVideo && !hasAudio;
}
