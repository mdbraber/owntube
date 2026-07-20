import type { SponsorBlockSegment } from "@web/lib/sponsorblock";
import {
  chapterIndexAt,
  parseChaptersFromDescription,
} from "@web/lib/video-chapters";
import {
  storyboardSheetUrl,
  storyboardThumbAtTime,
} from "@web/lib/video-scrub-frames";
import type {
  UnifiedVideo,
  VideoDetail,
  VideoStoryboard,
} from "@web/server/services/proxy.types";
import { useKeepAwake } from "expo-keep-awake";
import { useVideoPlayer, VideoView } from "expo-video";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  BackHandler,
  findNodeHandle,
  Image,
  Pressable,
  StyleSheet,
  Text,
  useTVEventHandler,
  View,
} from "react-native";
import { FocusButton } from "@/components/FocusButton";
import { IconButton } from "@/components/IconButton";
import { VideoRow } from "@/components/VideoRow";
import { getToken } from "@/lib/auth-token";
import { OWNTUBE_BASE_URL } from "@/lib/config";
import { channelInitial, formatTime, formatViews } from "@/lib/format";
import { queryClient } from "@/lib/query-client";
import { trpcClient } from "@/lib/trpc";
import { trpc } from "@/lib/trpc-react";
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
  /** Vertical resolution, when known. Absent for HLS "Auto". */
  height?: number;
} & (
  | { kind: "auto" | "muxed"; audioUrl?: never }
  | { kind: "split"; audioUrl: string }
);

/** Seconds moved per D-pad press, and per tick while a direction is held. */
const SCRUB_STEP_SECONDS = 10;
const SCRUB_HOLD_TICK_MS = 120;

/** Fallback ceiling if settings can't be read. */
const DEFAULT_HEIGHT = 1080;

/** Maps the shared `defaultPlaybackQuality` setting to a pixel ceiling. */
function heightForQuality(quality: string | undefined): number {
  switch (quality) {
    case "best":
      return Number.POSITIVE_INFINITY;
    case "1080p":
      return 1080;
    case "720p":
      return 720;
    case "480p":
      return 480;
    case "360p":
    case "360p-muxed":
      return 360;
    default:
      return DEFAULT_HEIGHT;
  }
}

/**
 * Picks the stream to start with.
 *
 * HLS ("Auto") wins whenever the server offers it: it is a single media source
 * that adapts up to 1080p, so ExoPlayer keeps audio and video in sync itself.
 *
 * Everything else is a compromise. YouTube's muxed (video+audio) progressive
 * streams stop at 360p; every higher rendition is adaptive and arrives as a
 * separate video-only + audio pair, which this screen plays as two ExoPlayer
 * instances nudged into alignment. Two players drift, and correcting drift by
 * seeking the audio player is audible — sound drops out and returns out of
 * step. So without HLS we take the best muxed stream and accept 360p rather
 * than ship broken audio; split sources are a last resort when nothing muxed
 * exists.
 */
function pickDefaultOptionIndex(
  options: PlaybackOption[],
  maxHeight: number,
): number {
  const auto = options.findIndex((option) => option.kind === "auto");
  if (auto >= 0) return auto;

  const bestOf = (kind: PlaybackOption["kind"]) => {
    const graded = options
      .map((option, index) => ({ option, index }))
      .filter((e) => e.option.kind === kind && e.option.height !== undefined);
    if (graded.length === 0) return -1;
    const atOrBelow = graded.filter((e) => (e.option.height ?? 0) <= maxHeight);
    const pool = atOrBelow.length > 0 ? atOrBelow : graded;
    return pool.reduce((a, b) =>
      (b.option.height ?? 0) > (a.option.height ?? 0) ? b : a,
    ).index;
  };

  const muxed = bestOf("muxed");
  if (muxed >= 0) return muxed;
  const split = bestOf("split");
  return split >= 0 ? split : 0;
}

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
  // Android TV drops into its screensaver on ~5 minutes without input, and a
  // playing video is not input. Hold the screen on for the whole screen.
  useKeepAwake();

  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [isPlaying, setIsPlaying] = useState(true);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [isBuffering, setIsBuffering] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [channelFocused, setChannelFocused] = useState(false);
  // Subtitle tracks only appear once the stream is ready, so the CC button
  // stays disabled until ExoPlayer reports some.
  const [hasSubtitles, setHasSubtitles] = useState(false);
  const [subtitlesOn, setSubtitlesOn] = useState(false);
  // Scrubbing: left/right move a pending position that only commits on release,
  // so holding the D-pad sweeps the bar instead of firing a seek per press.
  const [scrubSeconds, setScrubSeconds] = useState<number | null>(null);
  const [scrubberFocused, setScrubberFocused] = useState(false);
  // The related rail is cropped by the screen edge until one of its cards takes
  // focus, at which point it expands so the focused card is fully visible.
  const [relatedFocused, setRelatedFocused] = useState(false);
  const relatedFocusCount = useRef(0);
  /**
   * Android moves focus horizontally on left/right regardless of what the key
   * handler does, so without pinning next-focus back to the bar itself a scrub
   * press would also jump focus into the control row. Trapping it means the bar
   * keeps focus and left/right can only scrub.
   */
  const scrubberRef = useRef<View>(null);
  const [scrubberHandle, setScrubberHandle] = useState<number | null>(null);
  // Animated between the cropped peek and the row's measured natural height.
  const relatedHeight = useRef(new Animated.Value(RELATED_PEEK_HEIGHT)).current;
  const relatedFullHeight = useRef(RELATED_PEEK_HEIGHT);
  const [rating, setRating] = useState<"like" | "dislike" | null>(null);
  const [saved, setSaved] = useState(false);
  const [queued, setQueued] = useState(false);
  /**
   * Sent with the manifest request so the server can attribute the play to this
   * user — ExoPlayer fetches the manifest itself, outside the tRPC client that
   * normally carries the token.
   */
  const [authHeader, setAuthHeader] = useState<Record<string, string>>({});

  useEffect(() => {
    getToken().then((token) => {
      if (token) setAuthHeader({ Authorization: `Bearer ${token}` });
    });
  }, []);
  // Shared with the web app rather than hardcoded here.
  const settingsRef = useRef<{
    maxHeight: number;
    sponsorBlockEnabled: boolean;
    sponsorBlockAutoSkip: boolean;
  }>({
    maxHeight: DEFAULT_HEIGHT,
    sponsorBlockEnabled: true,
    sponsorBlockAutoSkip: true,
  });
  const scrubRef = useRef<number | null>(null);
  const holdTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  /**
   * How many overlay buttons currently hold focus. Left/right scrubs unless one
   * does — deriving it this way means the bar never has to be "selected" first,
   * and it can't get stuck if the bar's own focus state misreports.
   */
  const focusedButtonsRef = useRef(0);
  const onButtonFocusChange = (focused: boolean) => {
    focusedButtonsRef.current = Math.max(
      0,
      focusedButtonsRef.current + (focused ? 1 : -1),
    );
  };
  // Read by the key handler, which must see the value for the current render.
  const scrubberFocusedRef = useRef(false);
  scrubberFocusedRef.current = scrubberFocused;
  const controlsVisibleRef = useRef(true);
  controlsVisibleRef.current = controlsVisible;
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

  // Adaptive HD plays as two players (muted video + separate audio). expo-video
  // applies an audio mode per app, taking the highest-priority one across all
  // players, and the default interrupts other output "even when muted" — which
  // silences the audio player and leaves HD rows playing with no sound. Both
  // players must opt into mixing for the pair to be audible.
  const player = useVideoPlayer(null, (p) => {
    p.loop = false;
    p.timeUpdateEventInterval = 1;
    p.audioMixingMode = "mixWithOthers";
  });
  const audioPlayer = useVideoPlayer(null, (p) => {
    p.loop = false;
    p.timeUpdateEventInterval = 1;
    p.audioMixingMode = "mixWithOthers";
  });

  // Playback detail (blocking) + SponsorBlock/related (best-effort, parallel).
  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });
    setHasSubtitles(false);
    setSubtitlesOn(false);
    detailRef.current = null;
    currentTimeRef.current = 0;
    segmentsRef.current = [];
    pendingSeekRef.current = null;
    shouldPlayAfterReplaceRef.current = true;
    selectedOptionRef.current = null;

    queryClient
      .fetchQuery({
        queryKey: [["settings", "get"]],
        queryFn: () => trpcClient.settings.get.query(),
      })
      .then((st) => {
        settingsRef.current = {
          maxHeight: heightForQuality(st.defaultPlaybackQuality),
          sponsorBlockEnabled: st.sponsorBlockEnabled,
          sponsorBlockAutoSkip: st.sponsorBlockAutoSkip,
        };
      })
      // Defaults already sit in the ref; a settings failure shouldn't block play.
      .catch(() => {})
      .then(() =>
        queryClient.fetchQuery({
          queryKey: [["video", "detail"], { videoId }],
          queryFn: () => trpcClient.video.detail.query({ videoId }),
        }),
      )
      .then((detail) => {
        if (cancelled) return;
        detailRef.current = detail;
        const playbackOptions = buildPlaybackOptions(detail);
        const maxHeight = settingsRef.current.maxHeight;
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
          selectedOptionIndex: pickDefaultOptionIndex(
            playbackOptions,
            maxHeight,
          ),
        });

        if (!settingsRef.current.sponsorBlockEnabled) return;
        queryClient
          .fetchQuery({
            queryKey: [["sponsorblock", "segments"], { videoId }],
            queryFn: () =>
              trpcClient.sponsorblock.segments.query({
                videoId,
                categories: [...SKIP_CATEGORIES],
                durationSeconds: detail.durationSeconds,
              }),
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

  useEffect(() => {
    Animated.timing(relatedHeight, {
      toValue: relatedFocused ? relatedFullHeight.current : RELATED_PEEK_HEIGHT,
      duration: RELATED_REVEAL_MS,
      // Height can't run on the UI thread; the row is small enough to be smooth.
      useNativeDriver: false,
    }).start();
  }, [relatedFocused, relatedHeight]);

  // Clear via the ref so the cleanup needs no dependency on the callback.
  useEffect(
    () => () => {
      if (holdTimerRef.current) clearInterval(holdTimerRef.current);
    },
    [],
  );

  useEffect(() => {
    let cancelled = false;
    setRating(null);
    setSaved(false);
    setQueued(false);
    trpcClient.queue.list
      .query()
      .then((rows) => {
        if (!cancelled) setQueued(rows.some((r) => r.videoId === videoId));
      })
      .catch(() => {});

    trpcClient.interactions.state
      .query({ videoId })
      .then((st) => {
        if (cancelled) return;
        setRating(st.like ? "like" : st.dislike ? "dislike" : null);
        setSaved(st.save);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [videoId]);

  const relatedQuery = trpc.video.related.useQuery({ videoId });
  const related: UnifiedVideo[] = relatedQuery.data?.videos ?? [];

  // Load the stream and resume from the saved offset.
  useEffect(() => {
    if (state.status !== "ready") return;
    const selectedOption = state.playbackOptions[state.selectedOptionIndex];
    if (!selectedOption) return;

    selectedOptionRef.current = selectedOption;
    if (selectedOption.kind === "split") {
      player.muted = true;
      player.replace({ uri: selectedOption.videoUrl, headers: authHeader });
      audioPlayer.replace(selectedOption.audioUrl);
    } else {
      player.muted = false;
      player.replace({ uri: selectedOption.videoUrl, headers: authHeader });
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
  }, [state, player, audioPlayer, resumeSeconds, authHeader]);

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
      if (hit && settingsRef.current.sponsorBlockAutoSkip) {
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

  /**
   * Back dismisses the controls before it leaves the video, so the first press
   * returns you to an unobstructed picture and only the second exits. Registered
   * here so it runs before the shell's handler.
   */
  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      if (!controlsVisibleRef.current) return false;
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
      setControlsVisible(false);
      return true;
    });
    return () => sub.remove();
  }, []);

  /**
   * Report progress periodically, not only when leaving: a session that ends by
   * pulling the plug (or the box sleeping) would otherwise record nothing, and
   * the web app's resume position would sit stale.
   */
  useEffect(() => {
    const timer = setInterval(() => {
      const detail = detailRef.current;
      const watched = Math.floor(currentTimeRef.current);
      if (!detail?.channelId || watched < PROGRESS_MIN_SECONDS) return;
      if (!isPlayingRef.current) return;
      trpcClient.history.upsertEvent
        .mutate({
          videoId,
          channelId: detail.channelId,
          durationWatched: watched,
          positionSeconds: watched,
          videoDurationSeconds: detail.durationSeconds,
          videoTitle: detail.title,
        })
        .catch(() => {});
    }, PROGRESS_REPORT_MS);
    return () => clearInterval(timer);
  }, [videoId]);

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
    // Step to the next single-player source. DASH can 502 if the upstream
    // formats are missing, in which case HLS or a muxed rendition still plays.
    const fallbackIndex = state.playbackOptions.findIndex(
      (option, index) =>
        index > state.selectedOptionIndex &&
        (option.kind === "auto" || option.kind === "muxed"),
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
      if (status === "readyToPlay") {
        setDuration(player.duration);
        setHasSubtitles(player.availableSubtitleTracks.length > 0);
        setSubtitlesOn(player.subtitleTrack !== null);
      }
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

  /**
   * DASH text tracks surface asynchronously while the manifest is parsed, so
   * reading `availableSubtitleTracks` once at readyToPlay misses them and the
   * CC control never appears. Track the change events instead.
   */
  useEffect(() => {
    const available = player.addListener(
      "availableSubtitleTracksChange",
      ({ availableSubtitleTracks }) => {
        setHasSubtitles(availableSubtitleTracks.length > 0);
      },
    );
    const selected = player.addListener(
      "subtitleTrackChange",
      ({ subtitleTrack }) => {
        setSubtitlesOn(subtitleTrack !== null);
      },
    );
    return () => {
      available.remove();
      selected.remove();
    };
  }, [player]);

  // Show the overlay, then auto-hide after a few seconds of inactivity.
  const revealControls = useCallback(() => {
    setControlsVisible(true);
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    hideTimerRef.current = setTimeout(() => {
      if (isPlayingRef.current) setControlsVisible(false);
    }, 4000);
  }, []);

  // Any remote key re-shows the controls (fires regardless of focus target).
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

  /**
   * D-pad left/right scrub while the transport row owns focus, matching the TV
   * YouTube app. The seek is debounced so a held key sweeps the bar and issues
   * one seek at the end rather than one per repeat.
   */
  const scrubBy = (seconds: number) => {
    const total = duration || detailRef.current?.durationSeconds || 0;
    if (total <= 0) return;
    const from = scrubRef.current ?? currentTimeRef.current;
    const next = Math.max(0, Math.min(total, from + seconds));
    scrubRef.current = next;
    setScrubSeconds(next);
  };

  /**
   * OK on the scrubber commits the pending position and resumes; with nothing
   * pending it just toggles playback.
   */
  /**
   * react-native-tvos reports a held direction as a single `longLeft`/`longRight`
   * on press plus one on release — it suppresses repeats on purpose. So a hold
   * has to be driven here: start ticking on the press event, stop on the release.
   */
  const startHoldScrub = (seconds: number) => {
    if (holdTimerRef.current) return;
    scrubBy(seconds);
    holdTimerRef.current = setInterval(
      () => scrubBy(seconds),
      SCRUB_HOLD_TICK_MS,
    );
  };

  const stopHoldScrub = () => {
    if (!holdTimerRef.current) return;
    clearInterval(holdTimerRef.current);
    holdTimerRef.current = null;
  };

  const commitScrubOrToggle = () => {
    const target = scrubRef.current;
    if (target === null) {
      togglePlayback();
      return;
    }
    player.currentTime = target;
    if (selectedOptionRef.current?.kind === "split") {
      audioPlayer.currentTime = target;
    }
    scrubRef.current = null;
    setScrubSeconds(null);
    player.play();
    if (selectedOptionRef.current?.kind === "split") audioPlayer.play();
    setIsPlaying(true);
  };

  const setRatingValue = (next: "like" | "dislike") => {
    const active = rating !== next;
    setRating(active ? next : null);
    trpcClient.interactions.set
      .mutate({ videoId, type: next, active })
      .catch(() => {});
  };

  /** Queue is the most useful couch action: far easier than typing later. */
  const toggleQueued = () => {
    const detail = detailRef.current;
    if (!detail) return;
    const next = !queued;
    setQueued(next);
    const call = next
      ? trpcClient.queue.add.mutate({
          videoId,
          title: detail.title,
          channelId: detail.channelId ?? undefined,
        })
      : trpcClient.queue.remove.mutate({ videoId });
    call
      .then(() =>
        queryClient.invalidateQueries({
          queryKey: ["feed", "queue.listDetailed"],
        }),
      )
      // Put the toggle back if the server rejected it.
      .catch(() => setQueued(!next));
  };

  const toggleSaved = () => {
    const next = !saved;
    setSaved(next);
    trpcClient.interactions.set
      .mutate({ videoId, type: "save", active: next })
      .catch(() => {});
  };

  const seekBy = (seconds: number) => {
    player.seekBy(seconds);
    if (selectedOptionRef.current?.kind === "split") {
      audioPlayer.seekBy(seconds);
    }
  };

  /**
   * Remote transport keys never reach the on-screen buttons: Android delivers
   * them as TV events rather than routing them to the focused view, so without
   * this the remote's play/pause does nothing.
   */
  useTVEventHandler((event) => {
    if (event.eventType === "focus" || event.eventType === "blur") return;
    revealControls();
    // ACTION_UP is 1; the same long-press event fires on press and release.
    const isKeyUp = Number(event.eventKeyAction) === 1;
    const canScrub = focusedButtonsRef.current === 0;
    switch (event.eventType) {
      case "playPause":
        togglePlayback();
        break;
      case "play":
        if (!isPlayingRef.current) togglePlayback();
        break;
      case "pause":
        if (isPlayingRef.current) togglePlayback();
        break;
      case "fastForward":
        seekBy(10);
        break;
      case "rewind":
        seekBy(-10);
        break;
      // Left/right scrubs when the overlay is hidden (nothing to navigate) or
      // when the scrubber itself holds focus; anywhere else it moves between
      // controls as normal.
      case "left":
        stopHoldScrub();
        if (canScrub) scrubBy(-SCRUB_STEP_SECONDS);
        break;
      case "right":
        stopHoldScrub();
        if (canScrub) scrubBy(SCRUB_STEP_SECONDS);
        break;
      case "longLeft":
        if (!canScrub) break;
        if (isKeyUp) stopHoldScrub();
        else startHoldScrub(-SCRUB_STEP_SECONDS);
        break;
      case "longRight":
        if (!canScrub) break;
        if (isKeyUp) stopHoldScrub();
        else startHoldScrub(SCRUB_STEP_SECONDS);
        break;
      default:
        break;
    }
  });

  /**
   * Subtitles come from the stream's own tracks, so the toggle is only useful
   * once ExoPlayer has surfaced at least one.
   */
  const toggleSubtitles = () => {
    const tracks = player.availableSubtitleTracks;
    if (tracks.length === 0) return;
    const next = player.subtitleTrack ? null : tracks[0];
    player.subtitleTrack = next;
    setSubtitlesOn(next !== null);
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

  const totalSeconds = duration || detail.durationSeconds || 0;
  const scrubTarget = scrubSeconds ?? currentTime;
  const progressPct =
    totalSeconds > 0 ? Math.min(100, (scrubTarget / totalSeconds) * 100) : 0;
  // Chapters are derived from the description, exactly as the web player does.
  const chapters = parseChaptersFromDescription(
    detail.description,
    detail.durationSeconds,
  );
  const chapterIndex = chapterIndexAt(chapters, scrubTarget);
  const chapterTitle = chapterIndex >= 0 ? chapters[chapterIndex]?.title : null;

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
        <View style={styles.topInfo} pointerEvents="none">
          <Text style={styles.title} numberOfLines={2}>
            {detail.title}
          </Text>
          <Text style={styles.meta} numberOfLines={1}>
            {[detail.channelName, formatViews(detail.viewCount)]
              .filter(Boolean)
              .join(" \u2022 ")}
          </Text>
        </View>

        <View style={styles.overlay}>
          <View style={styles.timesRow}>
            <Text style={styles.time}>{formatTime(scrubTarget)}</Text>
            {chapterTitle ? (
              <Text style={styles.chapterTitle} numberOfLines={1}>
                {chapterTitle}
              </Text>
            ) : null}
            <Text style={styles.time}>{formatTime(totalSeconds)}</Text>
          </View>
          {/* Wrapper so the preview anchors to the bar, not the whole overlay. */}
          <View style={styles.trackWrap}>
            {scrubSeconds !== null && detail.storyboard ? (
              <View
                style={[
                  styles.previewRow,
                  { left: `${clampPreviewPct(progressPct)}%` },
                ]}
                pointerEvents="none"
              >
                <ScrubPreview
                  storyboard={detail.storyboard}
                  atSeconds={scrubSeconds}
                />
              </View>
            ) : null}
            <Pressable
              ref={scrubberRef}
              onLayout={() => {
                if (scrubberHandle === null) {
                  setScrubberHandle(findNodeHandle(scrubberRef.current));
                }
              }}
              nextFocusLeft={scrubberHandle ?? undefined}
              nextFocusRight={scrubberHandle ?? undefined}
              hasTVPreferredFocus
              onFocus={() => setScrubberFocused(true)}
              onBlur={() => setScrubberFocused(false)}
              onPress={commitScrubOrToggle}
              style={styles.scrubber}
            >
              <View
                style={[styles.track, scrubberFocused && styles.trackActive]}
              >
                <View
                  style={[
                    styles.trackFill,
                    scrubberFocused && styles.trackFillActive,
                    { width: `${progressPct}%` },
                  ]}
                />
              </View>
              {totalSeconds > 0
                ? chapters.map((chapter) => (
                    <View
                      key={chapter.startSeconds}
                      pointerEvents="none"
                      style={[
                        styles.chapterTick,
                        {
                          left: `${Math.min(
                            100,
                            (chapter.startSeconds / totalSeconds) * 100,
                          )}%`,
                        },
                      ]}
                    />
                  ))
                : null}
              {scrubberFocused ? (
                <View
                  style={[styles.knob, { left: `${progressPct}%` }]}
                  pointerEvents="none"
                />
              ) : null}
            </Pressable>
          </View>

          <View style={styles.controlRow}>
            <View style={styles.sideCluster}>
              {detail.channelId ? (
                <Pressable
                  onFocus={() => {
                    setChannelFocused(true);
                    onButtonFocusChange(true);
                  }}
                  onBlur={() => {
                    setChannelFocused(false);
                    onButtonFocusChange(false);
                  }}
                  onPress={() => onOpenChannel(detail.channelId as string)}
                  style={[
                    styles.avatarButton,
                    channelFocused && styles.avatarButtonFocused,
                  ]}
                >
                  {detail.channelAvatarUrl ? (
                    <Image
                      source={{ uri: detail.channelAvatarUrl }}
                      style={styles.avatar}
                    />
                  ) : (
                    <View style={[styles.avatar, styles.avatarFallback]}>
                      <Text style={styles.avatarInitial}>
                        {channelInitial(detail.channelName)}
                      </Text>
                    </View>
                  )}
                </Pressable>
              ) : null}
            </View>

            <View style={styles.transport}>
              <IconButton
                icon="rotate-ccw"
                action="skip"
                onPress={() => seekBy(-10)}
                onFocusChange={onButtonFocusChange}
              />
              <IconButton
                icon={isPlaying ? "pause" : "play"}
                action={isPlaying ? "pause" : "play"}
                large
                onPress={togglePlayback}
                onFocusChange={onButtonFocusChange}
              />
              <IconButton
                icon="rotate-cw"
                action="skipForward"
                onPress={() => seekBy(10)}
                onFocusChange={onButtonFocusChange}
              />
            </View>

            {/* Mirrors the web player's action set. */}
            <View style={styles.actions}>
              <IconButton
                icon="thumbs-up"
                action="like"
                active={rating === "like"}
                onPress={() => setRatingValue("like")}
                onFocusChange={onButtonFocusChange}
              />
              <IconButton
                icon="thumbs-down"
                action="dislike"
                active={rating === "dislike"}
                onPress={() => setRatingValue("dislike")}
                onFocusChange={onButtonFocusChange}
              />
              <IconButton
                icon={queued ? "check" : "plus"}
                active={queued}
                onPress={toggleQueued}
                onFocusChange={onButtonFocusChange}
              />
              <IconButton
                icon="bookmark"
                active={saved}
                onPress={toggleSaved}
                onFocusChange={onButtonFocusChange}
              />
              {/* Only offered when the stream actually carries subtitles. */}
              {hasSubtitles ? (
                <IconButton
                  icon="type"
                  action="captions"
                  active={subtitlesOn}
                  onPress={toggleSubtitles}
                  onFocusChange={onButtonFocusChange}
                />
              ) : null}
            </View>
          </View>

          {related.length > 0 ? (
            <Animated.View
              style={[styles.relatedRow, { height: relatedHeight }]}
            >
              {/* Clipping doesn't affect child layout, so this reports the
                  row's full height even while cropped. */}
              <View
                onLayout={(e) => {
                  relatedFullHeight.current = e.nativeEvent.layout.height;
                }}
              >
                <VideoRow
                  videos={related}
                  onSelect={onOpenVideo}
                  onCardFocusChange={(focused) => {
                    relatedFocusCount.current = Math.max(
                      0,
                      relatedFocusCount.current + (focused ? 1 : -1),
                    );
                    setRelatedFocused(relatedFocusCount.current > 0);
                    onButtonFocusChange(focused);
                  }}
                />
              </View>
            </Animated.View>
          ) : null}
        </View>
      </View>
    </View>
  );
}

const AVATAR = 44;
/** Rendered size of a scrub preview; sprite cells are scaled to fit this. */
const PREVIEW_WIDTH = 240;
/**
 * Keeps the centred preview inside the bar. The overlay spans the screen minus
 * a `spacing.screen` margin each side, so half a preview is this share of the
 * bar's width at 960dp — clamping to it stops the frame overhanging either end.
 */
function clampPreviewPct(pct: number): number {
  const barWidth = TV_WIDTH_DP - spacing.screen * 2;
  const halfPct = (PREVIEW_WIDTH / 2 / barWidth) * 100;
  return Math.min(100 - halfPct, Math.max(halfPct, pct));
}

/** Layout width in dp of a 1080p TV panel (density 2). */
const TV_WIDTH_DP = 960;

/** How often playback position is pushed to the server, and the floor for it. */
const PROGRESS_REPORT_MS = 15_000;
const PROGRESS_MIN_SECONDS = 5;

/** Playhead knob shown while the scrubber holds focus. */
const SCRUB_KNOB = 18;
const TRACK_HEIGHT = 7;
/** Scrubber padding, so the knob can be centred on the bar arithmetically. */
const SCRUB_PAD = 8;

/** How much of the related rail stays on screen under the controls. */
const RELATED_PEEK_HEIGHT = 104;
const RELATED_REVEAL_MS = 180;

/**
 * One frame of the storyboard sprite sheet, cropped to the cell for `atSeconds`.
 *
 * React Native has no background-position, so the sheet is drawn oversized
 * inside a clipping box and shifted so the wanted cell lands in view. The sheet
 * geometry maths is shared with the web player (`@web/lib/video-scrub-frames`)
 * rather than reimplemented here.
 */
function ScrubPreview({
  storyboard,
  atSeconds,
}: {
  storyboard: VideoStoryboard;
  atSeconds: number;
}) {
  const { sheetIndex, column, row } = storyboardThumbAtTime(
    storyboard,
    atSeconds,
  );
  const scale = PREVIEW_WIDTH / storyboard.thumbWidth;
  const height = storyboard.thumbHeight * scale;
  return (
    <View style={[styles.preview, { width: PREVIEW_WIDTH, height }]}>
      <Image
        source={{ uri: storyboardSheetUrl(storyboard.templateUrl, sheetIndex) }}
        style={{
          width: storyboard.columns * storyboard.thumbWidth * scale,
          height: storyboard.rows * storyboard.thumbHeight * scale,
          marginLeft: -column * storyboard.thumbWidth * scale,
          marginTop: -row * storyboard.thumbHeight * scale,
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.videoBackground },
  topInfo: {
    position: "absolute",
    top: spacing.screen,
    left: spacing.screen,
    right: spacing.screen,
  },
  meta: {
    color: colors.mutedForeground,
    fontSize: fontSize.md,
    marginTop: spacing.xs,
  },
  timesRow: { flexDirection: "row", justifyContent: "space-between" },
  controlRow: { flexDirection: "row", alignItems: "center" },
  // Side clusters flex equally so the transport stays centred on screen.
  sideCluster: { flex: 1, flexDirection: "row", alignItems: "center" },
  transport: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
  },
  actions: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: spacing.sm,
  },
  avatarButton: {
    borderRadius: AVATAR / 2 + 4,
    padding: 3,
    borderWidth: focus.borderWidth,
    borderColor: "transparent",
  },
  avatarButtonFocused: {
    borderColor: colors.ring,
    backgroundColor: colors.accent,
  },
  avatar: { width: AVATAR, height: AVATAR, borderRadius: AVATAR / 2 },
  avatarFallback: {
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.accent,
  },
  avatarInitial: { color: colors.foreground, fontWeight: "700" },
  // Cropped: only the top of each card shows, so the rail reads as continuing
  // off-screen and the controls keep their vertical position.
  // Height is animated; the overlay is bottom-anchored, so growing the row
  // pushes the controls up and brings the focused card into view.
  relatedRow: { marginTop: spacing.md, overflow: "hidden" },
  trackWrap: { position: "relative" },
  // Padding gives the focus ring somewhere to sit without moving the bar.
  // Deliberately no focus ring: the bar shows selection by turning brand-red,
  // with a knob at the playhead.
  scrubber: { paddingVertical: SCRUB_PAD },
  // Anchored to the playhead; the negative margin centres it on that point.
  previewRow: {
    position: "absolute",
    bottom: "100%",
    marginLeft: -PREVIEW_WIDTH / 2,
    marginBottom: spacing.xs,
  },
  preview: {
    overflow: "hidden",
    borderRadius: radius.shell,
    borderWidth: 2,
    borderColor: colors.ring,
    backgroundColor: colors.muted,
  },
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
    // Flush to the bottom edge so the related rail is cropped by the screen
    // rather than sitting fully inside it, as in the TV YouTube app.
    bottom: 0,
    gap: spacing.xs,
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
    height: TRACK_HEIGHT,
    borderRadius: 4,
    backgroundColor: colors.surfaceBorder,
    overflow: "hidden",
  },
  trackFill: {
    height: "100%",
    backgroundColor: colors.foreground,
    borderRadius: 4,
  },
  // Selected: the whole bar reads red, played portion solid over a red bed.
  trackActive: { backgroundColor: colors.brandSoft },
  chapterTick: {
    position: "absolute",
    top: SCRUB_PAD,
    width: 2,
    height: TRACK_HEIGHT,
    backgroundColor: colors.background,
  },
  chapterTitle: {
    flex: 1,
    textAlign: "center",
    color: colors.foreground,
    fontSize: fontSize.sm,
    fontWeight: "600",
  },
  trackFillActive: { backgroundColor: colors.brand },
  knob: {
    position: "absolute",
    top: SCRUB_PAD + (TRACK_HEIGHT - SCRUB_KNOB) / 2,
    width: SCRUB_KNOB,
    height: SCRUB_KNOB,
    borderRadius: SCRUB_KNOB / 2,
    marginLeft: -SCRUB_KNOB / 2,
    backgroundColor: colors.brand,
  },
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
  ccButton: { minWidth: 120 },
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

  // Server-generated DASH first: one manifest carrying both the video ladder
  // (VP9 unlocks the rungs above 1080p that the AVC-only HLS path cannot) and
  // the audio track, so ExoPlayer owns A/V sync instead of this screen nudging
  // two players into alignment. See apps/web/src/server/services/dash.
  addOption({
    id: "dash-vp9",
    label: "Auto",
    videoUrl: `${OWNTUBE_BASE_URL}/dash/${detail.videoId}/manifest.mpd?video=vp9`,
    kind: "auto",
  });

  if (detail.hlsUrl) {
    addOption({
      id: "auto-hls",
      label: "Auto (HLS)",
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
        height: source.height,
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
          height: source.height,
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
