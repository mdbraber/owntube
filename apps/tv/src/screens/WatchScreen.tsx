import {
  ORIGINAL_CAPTION_LANGUAGE,
  pickDefaultCaptionIndex,
} from "@web/lib/caption-default";
import type {
  SponsorBlockCategory,
  SponsorBlockSegment,
} from "@web/lib/sponsorblock";
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
import { activateKeepAwakeAsync, deactivateKeepAwake } from "expo-keep-awake";
import { useVideoPlayer, type VideoPlayer, VideoView } from "expo-video";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  AppState,
  BackHandler,
  findNodeHandle,
  Image,
  Pressable,
  StyleSheet,
  Text,
  useTVEventHandler,
  View,
} from "react-native";
import { DetailsPanel } from "@/components/DetailsPanel";
import { FocusButton } from "@/components/FocusButton";
import { IconButton } from "@/components/IconButton";
import {
  type MenuItem,
  type MenuPage,
  MenuPanel,
} from "@/components/MenuPanel";
import { UpNext } from "@/components/UpNext";
import { VideoRow } from "@/components/VideoRow";
import {
  audioLanguageOptions,
  languageName,
  urlLooksLikeOriginalAudio,
} from "@/lib/audio-languages";
import { getToken } from "@/lib/auth-token";
import { baseUrl } from "@/lib/config";
import { errorMessage } from "@/lib/error-message";
import {
  channelInitial,
  formatTime,
  formatViews,
  sizedAvatarUrl,
} from "@/lib/format";
import {
  contextNeighbours,
  type OpenVideoOptions,
  type PlayContext,
} from "@/lib/navigation";
import {
  formatRate,
  loadPlayerPrefs,
  PLAYBACK_RATES,
  playerPrefs,
  savePlayerPrefs,
} from "@/lib/player-prefs";
import { usePlaylistMenu } from "@/lib/playlist-menu";
import { queryClient } from "@/lib/query-client";
import { useRecordWatchProgress } from "@/lib/record-watch-progress";
import {
  SPONSORBLOCK_COLORS,
  SPONSORBLOCK_LABELS,
} from "@/lib/sponsorblock-labels";
import { trpcClient } from "@/lib/trpc";
import { trpc } from "@/lib/trpc-react";
import { colors, focus, fontSize, monoFont, radius, spacing } from "@/theme";
import { raiseSubtitles } from "../../modules/player-subtitles";
import { removeWatchNext, upsertWatchNext } from "../../modules/watch-next";

// Used only when settings fail to load; mirrors the web's
// DEFAULT_SPONSORBLOCK_CATEGORIES (a runtime import would bundle zod).
const DEFAULT_SKIP_CATEGORIES: SponsorBlockCategory[] = [
  "sponsor",
  "selfpromo",
  "interaction",
  "intro",
  "outro",
  "preview",
  "hook",
];

/**
 * Why a video won't play, for a message that says what to do: wait for an
 * upcoming stream, sign in to YouTube elsewhere for an age gate, or give up
 * on a removed video. The server maps these onto tRPC codes (video.detail).
 */
type PlaybackProblem =
  | { kind: "upcoming"; startsAt?: number }
  | { kind: "age" }
  | { kind: "unavailable" }
  | { kind: "other" };

function classifyError(err: unknown): PlaybackProblem {
  const data = (
    err as { data?: { code?: string; premiereTimestamp?: number | null } }
  )?.data;
  switch (data?.code) {
    case "PRECONDITION_FAILED":
      return {
        kind: "upcoming",
        startsAt: data.premiereTimestamp ?? undefined,
      };
    case "UNPROCESSABLE_CONTENT":
      return { kind: "age" };
    case "NOT_FOUND":
      return { kind: "unavailable" };
    default:
      return { kind: "other" };
  }
}

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string; problem: PlaybackProblem }
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

/** expo-video 2.0 doesn't export the track type by name. */
type SubtitleTrack = NonNullable<VideoPlayer["subtitleTrack"]>;

type Toast = {
  text: string;
  /** Shown while the controls are hidden, when OK does something. */
  hint?: string;
  segment?: SponsorBlockSegment;
  action?: "undo" | "skip";
};

/** How long a toast stays up; a SponsorBlock undo is offered for this long. */
const TOAST_MS = 5000;

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
 * The adaptive "Auto" source (server DASH, listed first) wins whenever the
 * server offers it: it is a single media source that adapts across renditions,
 * so ExoPlayer keeps audio and video in sync itself.
 *
 * Everything else is a compromise. YouTube's muxed (video+audio) progressive
 * streams stop at 360p; every higher rendition is adaptive and arrives as a
 * separate video-only + audio pair, which this screen plays as two ExoPlayer
 * instances nudged into alignment. Two players drift, and correcting drift by
 * seeking the audio player is audible — sound drops out and returns out of
 * step. So without Auto we take the best muxed stream and accept 360p rather
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
 * Stream selection prefers server DASH, then HLS, then muxed progressive MP4
 * streams. Adaptive-only HD rows are played as synchronized video-only + audio
 * sources.
 *
 * At the end it offers the next video of its play context (queue, playlist,
 * feed), or the first related video when it has none; the remote's next and
 * previous keys move through the same list.
 */
export function WatchScreen({
  videoId,
  resumeSeconds,
  context,
  onOpenVideo,
  onReplaceVideo,
  onOpenChannel,
  onBack,
  onHome,
  active = true,
}: {
  videoId: string;
  resumeSeconds?: number;
  context?: PlayContext;
  onOpenVideo: (videoId: string) => void;
  /** Swaps this video for another in place (next/previous). */
  onReplaceVideo: (videoId: string, options?: OpenVideoOptions) => void;
  onOpenChannel: (channelId: string) => void;
  onBack: () => void;
  /** Leaves the player for the Home section. */
  onHome: () => void;
  /**
   * False while a channel page sits on top: the shell keeps the player
   * mounted (so Back returns to the same spot without reloading) but it must
   * be paused and ignore the remote.
   */
  active?: boolean;
}) {
  const activeRef = useRef(active);
  activeRef.current = active;

  // Android TV drops into its screensaver on ~5 minutes without input, and a
  // playing video is not input. Hold the screen on while the player is shown.
  useEffect(() => {
    if (!active) return;
    const tag = `watch:${videoId}`;
    void activateKeepAwakeAsync(tag);
    return () => {
      void deactivateKeepAwake(tag);
    };
  }, [active, videoId]);

  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [isPlaying, setIsPlaying] = useState(true);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [isBuffering, setIsBuffering] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [channelFocused, setChannelFocused] = useState(false);
  /**
   * Audio language for multi-audio (dubbed) videos, as an index into
   * audioLanguageOptions (0 = the original — also the server manifest's
   * default). expo-video 2.0 exposes no audio-track API, so switching swaps
   * the DASH manifest URL for one filtered to the picked language (`&lang=`).
   */
  const [audioLangIndex, setAudioLangIndex] = useState(0);
  /**
   * One transient message at a time, top right. SponsorBlock toasts carry an
   * action that OK performs while the controls are hidden: undo a skip, or
   * skip a segment when auto-skip is off.
   */
  const [toast, setToast] = useState<Toast | null>(null);
  const toastRef = useRef<Toast | null>(null);
  toastRef.current = toast;
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showToast = useCallback((next: Toast, ms = TOAST_MS) => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToast(next);
    toastTimerRef.current = setTimeout(() => setToast(null), ms);
  }, []);
  /** The settings panel (gear button). */
  const [menuOpen, setMenuOpen] = useState(false);
  /** Which page the settings panel opens on (the CC button opens captions). */
  const [menuStart, setMenuStart] = useState("root");
  const menuOpenRef = useRef(false);
  menuOpenRef.current = menuOpen;
  const closeMenu = useCallback(() => setMenuOpen(false), []);
  /**
   * Quality ceiling picked in the panel, in pixels; null follows the
   * defaultPlaybackQuality setting. Applied to the server DASH manifest.
   */
  const [qualityCap, setQualityCap] = useState<number | null>(null);
  const [playbackRate, setPlaybackRate] = useState(
    () => playerPrefs().playbackRate,
  );
  const [subtitleTracks, setSubtitleTracks] = useState<SubtitleTrack[]>([]);
  const [subtitleTrack, setSubtitleTrack] = useState<SubtitleTrack | null>(
    null,
  );
  const [statsOn, setStatsOn] = useState(false);
  const [segments, setSegments] = useState<SponsorBlockSegment[]>([]);
  /** Segments the viewer chose to watch (undo), so they aren't skipped again. */
  const keptSegmentsRef = useRef(new Set<string>());
  /** Set when OK was spent on a SponsorBlock toast, so it doesn't also pause. */
  const swallowPressRef = useRef(false);
  /** Playback reached the end (and wasn't dismissed since). */
  const [ended, setEnded] = useState(false);
  /**
   * Whether OK went down on the scrubber itself. Cancel on the up-next card
   * goes on the key's release, which then lands on the scrubber that takes
   * focus in the card's place and would replay the finished video; a press
   * that never went down there is ignored instead.
   */
  const scrubberPressedInRef = useRef(true);
  /**
   * Played to the end and not started again. The controls can't auto-hide
   * then (nothing plays), and hiding them would only uncover a finished
   * picture, so Back leaves at once.
   */
  const finishedRef = useRef(false);
  /** Marked watched from the menu: kept out of Continue watching on leave. */
  const markedWatchedRef = useRef(false);
  const onBackRef = useRef(onBack);
  onBackRef.current = onBack;
  /** Bumped by Retry on the error screen to load the video again. */
  const [reloadKey, setReloadKey] = useState(0);
  /** Description and comments beside the picture. */
  const [detailsOpen, setDetailsOpen] = useState(false);
  const detailsOpenRef = useRef(false);
  detailsOpenRef.current = detailsOpen;
  const closeDetails = useCallback(() => setDetailsOpen(false), []);
  /** Live: seconds behind the live edge, while the controls show. */
  const [behindLive, setBehindLive] = useState(0);
  // Scrubbing: left/right move a pending position that only commits on release,
  // so holding the D-pad sweeps the bar instead of firing a seek per press.
  const [scrubSeconds, setScrubSeconds] = useState<number | null>(null);
  const [scrubberFocused, setScrubberFocused] = useState(false);
  // The related rail is cropped by the screen edge until one of its cards takes
  // focus, at which point it expands so the focused card is fully visible.
  const [relatedFocused, setRelatedFocused] = useState(false);
  const relatedFocusCount = useRef(0);
  // Moving focus from one card to the next fires a blur then a focus as two
  // separate calls, so the count dips to 0 between them — debounce collapsing
  // on that dip, or the reveal animation restarts (shrink then grow) on every
  // single step down the rail and never finishes expanding.
  const relatedCollapseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
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
    sponsorBlockCategories: SponsorBlockCategory[];
    autoplayNext: boolean;
    /** Account setting: "original" or a language tag. */
    captionLanguage: string;
  }>({
    maxHeight: DEFAULT_HEIGHT,
    sponsorBlockEnabled: true,
    sponsorBlockAutoSkip: true,
    sponsorBlockCategories: DEFAULT_SKIP_CATEGORIES,
    autoplayNext: true,
    captionLanguage: ORIGINAL_CAPTION_LANGUAGE,
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
  // Stable (refs and state setters only) so the memoized related row and its
  // cards don't re-render with every player tick.
  const onRelatedCardFocusChange = useCallback((focused: boolean) => {
    relatedFocusCount.current = Math.max(
      0,
      relatedFocusCount.current + (focused ? 1 : -1),
    );
    if (relatedFocusCount.current > 0) {
      if (relatedCollapseTimerRef.current) {
        clearTimeout(relatedCollapseTimerRef.current);
        relatedCollapseTimerRef.current = null;
      }
      setRelatedFocused(true);
    } else {
      if (relatedCollapseTimerRef.current) {
        clearTimeout(relatedCollapseTimerRef.current);
      }
      relatedCollapseTimerRef.current = setTimeout(() => {
        setRelatedFocused(false);
      }, RELATED_COLLAPSE_DELAY_MS);
    }
    focusedButtonsRef.current = Math.max(
      0,
      focusedButtonsRef.current + (focused ? 1 : -1),
    );
  }, []);
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
  /**
   * Time this source has actually spent playing: settled time, plus the run in
   * progress since `playingSinceRef` (null while not playing).
   */
  const playedMsRef = useRef(0);
  const playingSinceRef = useRef<number | null>(null);
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
  // Re-runs on reloadKey too: Retry on the error screen.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reloadKey is a trigger
  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });
    setAudioLangIndex(0);
    detailRef.current = null;
    currentTimeRef.current = 0;
    playedMsRef.current = 0;
    playingSinceRef.current = null;
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
          sponsorBlockCategories: st.sponsorBlockCategories,
          autoplayNext: st.autoplayNext,
          captionLanguage: st.captionLanguage ?? ORIGINAL_CAPTION_LANGUAGE,
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
        setChannelId(detail.channelId ?? null);
        const playbackOptions = buildPlaybackOptions(detail);
        const maxHeight = settingsRef.current.maxHeight;
        if (playbackOptions.length === 0) {
          setState({
            status: "error",
            message: "This video has no playable stream available.",
            problem: detail.isUpcoming
              ? { kind: "upcoming" }
              : { kind: "other" },
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

        const { sponsorBlockEnabled, sponsorBlockCategories: categories } =
          settingsRef.current;
        if (!sponsorBlockEnabled || categories.length === 0) return;
        queryClient
          .fetchQuery({
            queryKey: [["sponsorblock", "segments"], { videoId, categories }],
            queryFn: () =>
              trpcClient.sponsorblock.segments.query({
                videoId,
                categories,
                durationSeconds: detail.durationSeconds,
              }),
          })
          .then((segments) => {
            if (cancelled) return;
            segmentsRef.current = segments;
            setSegments(segments);
          })
          .catch(() => {});
      })
      .catch((err: unknown) => {
        if (!cancelled)
          setState({
            status: "error",
            message: errorMessage(err),
            problem: classifyError(err),
          });
      });

    return () => {
      cancelled = true;
    };
  }, [videoId, reloadKey]);

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

  // Channel subscribe button: unknown state hides it (see ChannelScreen).
  const [channelId, setChannelId] = useState<string | null>(null);
  const subscription = trpc.subscriptions.status.useQuery(
    { channelId: channelId ?? "" },
    { enabled: channelId !== null },
  );
  const [subscribedOverride, setSubscribedOverride] = useState<boolean | null>(
    null,
  );
  const subscribed =
    subscribedOverride ?? subscription.data?.subscribed ?? null;
  const [subscribePending, setSubscribePending] = useState(false);
  const toggleSubscribed = () => {
    if (!channelId || subscribed === null || subscribePending) return;
    const next = !subscribed;
    setSubscribePending(true);
    setSubscribedOverride(next);
    (next
      ? trpcClient.subscriptions.add.mutate({ channelId })
      : trpcClient.subscriptions.remove.mutate({ channelId })
    )
      .then(() => {
        void queryClient.invalidateQueries({ queryKey: ["feed"] });
        void queryClient.invalidateQueries({
          queryKey: [["subscriptions"]],
        });
      })
      .catch(() => setSubscribedOverride(!next))
      .finally(() => setSubscribePending(false));
  };

  // Save to playlist: only fetched once the panel opens.
  const playlistMenu = usePlaylistMenu({
    video: { videoId, channelId },
    enabled: menuOpen,
    notify: (text) => showToast({ text }),
    onCreated: closeMenu,
  });

  const relatedQuery = trpc.video.related.useQuery({ videoId });
  const related: UnifiedVideo[] = relatedQuery.data?.videos ?? NO_VIDEOS;

  // A context ends where it ends; only a video opened on its own runs on into
  // its related videos.
  const neighbours = contextNeighbours(context, videoId);
  const nextVideo = context ? neighbours.next : related[0];
  const previousVideo = neighbours.previous;
  const playNext = useCallback(() => {
    if (nextVideo) onReplaceVideo(nextVideo.videoId, { context });
  }, [nextVideo, context, onReplaceVideo]);
  const playNextRef = useRef(playNext);
  playNextRef.current = playNext;
  // Only an end with somewhere to go shows the card; without one the controls
  // simply stay up, paused at the end.
  const showUpNext = ended && nextVideo !== undefined;
  const showUpNextRef = useRef(false);
  showUpNextRef.current = showUpNext;

  const playbackRateRef = useRef(playbackRate);
  playbackRateRef.current = playbackRate;

  // Load the stream and resume from the saved offset.
  useEffect(() => {
    if (state.status !== "ready") return;
    const selectedOption = state.playbackOptions[state.selectedOptionIndex];
    if (!selectedOption) return;

    selectedOptionRef.current = selectedOption;
    // Shown on the system's now-playing card and to the Assistant.
    const metadata = {
      title: state.detail.title,
      artist: state.detail.channelName,
      artwork: state.detail.thumbnailUrl,
    };
    if (selectedOption.kind === "split") {
      player.muted = true;
      player.replace({
        uri: selectedOption.videoUrl,
        headers: authHeader,
        metadata,
      });
      audioPlayer.replace(selectedOption.audioUrl);
    } else {
      // A non-default audio language narrows the server DASH manifest to that
      // language (index 0 is the original — already the manifest default).
      let uri = selectedOption.videoUrl;
      if (selectedOption.id === "dash-vp9") {
        if (audioLangIndex > 0) {
          const langs = audioLanguageOptions(state.detail.audioSources ?? []);
          const picked = langs[audioLangIndex];
          if (picked) uri = `${uri}&lang=${encodeURIComponent(picked.lang)}`;
        }
        // The panel's choice, else the shared defaultPlaybackQuality. Servers
        // without the parameter ignore it and serve the full ladder.
        const cap = qualityCap ?? settingsRef.current.maxHeight;
        if (Number.isFinite(cap)) uri = `${uri}&maxHeight=${cap}`;
      }
      player.muted = false;
      player.replace({ uri, headers: authHeader, metadata });
      audioPlayer.pause();
      audioPlayer.replace(null);
    }
    const pendingSeek = pendingSeekRef.current;
    pendingSeekRef.current = null;
    // A saved position in the last seconds would end the video on arrival —
    // start it over instead. (The resume lookup can't always tell: some
    // progress rows carry no duration.)
    const total = state.detail.durationSeconds ?? 0;
    const resumeUsable =
      resumeSeconds !== undefined &&
      !(total > 0 && resumeSeconds > total - RESUME_END_GUARD_SECONDS);
    const startSeconds =
      pendingSeek ?? (resumeUsable ? resumeSeconds : undefined);
    if (startSeconds && startSeconds > 5) {
      player.currentTime = startSeconds;
      if (selectedOption.kind === "split")
        audioPlayer.currentTime = startSeconds;
    }
    player.playbackRate = playbackRateRef.current;
    audioPlayer.playbackRate = playbackRateRef.current;
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
  }, [
    state,
    player,
    audioPlayer,
    resumeSeconds,
    authHeader,
    audioLangIndex,
    qualityCap,
  ]);

  const showToastRef = useRef(showToast);
  showToastRef.current = showToast;

  /**
   * Records the stream's subtitle tracks and, the first time any appear,
   * turns on the device's preferred caption language if the video has it.
   */
  const captionsAppliedRef = useRef(false);
  const applySubtitleTracks = (tracks: SubtitleTrack[]) => {
    setSubtitleTracks(tracks);
    if (captionsAppliedRef.current || tracks.length === 0) return;
    captionsAppliedRef.current = true;
    if (!playerPrefs().captionsEnabled) return;
    const track = defaultCaptionTrack(tracks);
    if (track) {
      player.subtitleTrack = track;
      setSubtitleTrack(track);
    }
  };

  /** The account's caption language for this video (see caption-default). */
  const defaultCaptionTrack = (
    tracks: SubtitleTrack[],
  ): SubtitleTrack | undefined => {
    const original = audioLanguageOptions(
      detailRef.current?.audioSources ?? [],
    ).find((lang) => lang.isOriginal)?.lang;
    const index = pickDefaultCaptionIndex(
      tracks.map((t) => ({
        label: t.label ?? "",
        languageCode: t.language ?? "",
      })),
      {
        preferred: settingsRef.current.captionLanguage,
        originalAudioLanguage: original,
      },
    );
    return tracks[index];
  };
  const applySubtitleTracksRef = useRef(applySubtitleTracks);
  applySubtitleTracksRef.current = applySubtitleTracks;

  useEffect(() => {
    loadPlayerPrefs().then((prefs) => {
      if (prefs.playbackRate === playbackRateRef.current) return;
      setPlaybackRate(prefs.playbackRate);
      player.playbackRate = prefs.playbackRate;
      audioPlayer.playbackRate = prefs.playbackRate;
    });
  }, [player, audioPlayer]);

  // SponsorBlock auto-skip: on each tick, jump past any segment we're inside.
  useEffect(() => {
    const sub = player.addListener("timeUpdate", ({ currentTime }) => {
      currentTimeRef.current = currentTime;
      // The clock only feeds the overlay. While it's hidden, skip the state
      // update: each one re-renders this whole screen, once a second, for
      // nothing on screen. Revealing the overlay resyncs it (see below).
      if (controlsVisibleRef.current) {
        setCurrentTime(currentTime);
        if (player.isLive) setBehindLive(player.currentOffsetFromLive ?? 0);
      }
      const hit = segmentsRef.current.find(
        (s) =>
          currentTime >= s.startSeconds &&
          currentTime < s.endSeconds - 0.5 &&
          !keptSegmentsRef.current.has(s.uuid),
      );
      const selectedOption = selectedOptionRef.current;
      if (hit && settingsRef.current.sponsorBlockAutoSkip) {
        player.currentTime = hit.endSeconds;
        if (selectedOption?.kind === "split") {
          audioPlayer.currentTime = hit.endSeconds;
        }
        showToastRef.current({
          text: `Skipped ${SPONSORBLOCK_LABELS[hit.category] ?? "segment"}`,
          hint: "OK to undo",
          segment: hit,
          action: "undo",
        });
        return;
      }
      // Auto-skip off: offer the skip for as long as the segment plays.
      const offered = toastRef.current?.action === "skip";
      if (hit && !offered) {
        showToastRef.current(
          {
            text: SPONSORBLOCK_LABELS[hit.category] ?? "Segment",
            hint: "OK to skip",
            segment: hit,
            action: "skip",
          },
          (hit.endSeconds - currentTime) * 1000,
        );
      } else if (!hit && offered) {
        setToast(null);
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
      // In the background (under a channel page): Back belongs to the shell.
      if (!activeRef.current) return false;
      // A finished video, with or without the card over it, is left in one
      // press; Cancel on the card is the way to stay on it.
      if (showUpNextRef.current || finishedRef.current) {
        onBackRef.current();
        return true;
      }
      if (!controlsVisibleRef.current) return false;
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
      setControlsVisible(false);
      return true;
    });
    return () => sub.remove();
  }, []);

  // The Android TV home screen's Continue watching row: a video left part
  // way through goes in (opening it resumes via owntube://watch), and one
  // watched to the end comes out.
  useEffect(
    () => () => {
      const detail = detailRef.current;
      if (!detail || detail.isLive) return;
      if (markedWatchedRef.current) {
        removeWatchNext(detail.videoId);
        return;
      }
      const duration = detail.durationSeconds ?? 0;
      const position = currentTimeRef.current;
      if (duration <= 0) return;
      const fraction = position / duration;
      if (fraction >= WATCH_NEXT_DONE_FRACTION) {
        removeWatchNext(detail.videoId);
      } else if (fraction >= WATCH_NEXT_MIN_FRACTION) {
        upsertWatchNext({
          videoId: detail.videoId,
          title: detail.title,
          channelName: detail.channelName,
          posterUrl: detail.thumbnailUrl,
          positionMs: Math.floor(position * 1000),
          durationMs: Math.floor(duration * 1000),
        });
      }
    },
    [],
  );

  // Progress to history on an interval and on leave: the resume point, and
  // time actually played as the recommender's signal (see the hook).
  useRecordWatchProgress({
    detail: detailRef,
    position: currentTimeRef,
    playing: isPlayingRef,
  });

  /**
   * The end: record the video as watched straight away (the server also drops
   * it from the queue then), and offer what comes next.
   */
  useEffect(() => {
    const sub = player.addListener("playToEnd", () => {
      // Only believe an end playback actually reached. A seek applied before
      // the source reports its duration can land past it, and the player then
      // announces the end of a video that has barely started — resuming from
      // Continue watching put the up-next card over one that had just begun.
      // Position alone isn't proof (the duration may be unknown yet, or the
      // position already reads the end), so also require that this source has
      // actually played: a video sent from the phone got the card before a
      // single frame had run. Resume never starts within the last
      // RESUME_END_GUARD_SECONDS, so a real end always clears this.
      const total = detailRef.current?.durationSeconds || player.duration || 0;
      if (total > 0 && currentTimeRef.current < total - END_TOLERANCE_SECONDS) {
        return;
      }
      const since = playingSinceRef.current;
      const playedMs =
        playedMsRef.current + (since === null ? 0 : Date.now() - since);
      if (playedMs < END_TOLERANCE_SECONDS * 1000) return;
      recordCompleted(videoId, detailRef.current, currentTimeRef.current);
      finishedRef.current = true;
      setEnded(true);
    });
    return () => sub.remove();
  }, [player, videoId]);

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
        raiseSubtitles();
        setDuration(player.duration);
        applySubtitleTracksRef.current(player.availableSubtitleTracks);
        setSubtitleTrack(player.subtitleTrack);
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
        applySubtitleTracksRef.current(availableSubtitleTracks);
      },
    );
    const selected = player.addListener(
      "subtitleTrackChange",
      ({ subtitleTrack }) => {
        if (subtitleTrack) raiseSubtitles();
        setSubtitleTrack(subtitleTrack);
      },
    );
    return () => {
      available.remove();
      selected.remove();
    };
  }, [player]);

  // Show the overlay, then auto-hide after a few seconds of inactivity.
  const revealControls = useCallback(() => {
    setCurrentTime(currentTimeRef.current);
    setControlsVisible(true);
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    hideTimerRef.current = setTimeout(() => {
      if (isPlayingRef.current) setControlsVisible(false);
    }, 4000);
  }, []);

  // Closing the settings panel remounts the controls; show them, with the
  // usual auto-hide, rather than leaving whatever state they were in.
  const menuWasOpenRef = useRef(false);
  useEffect(() => {
    const open = menuOpen || detailsOpen;
    if (menuWasOpenRef.current && !open) revealControls();
    menuWasOpenRef.current = open;
  }, [menuOpen, detailsOpen, revealControls]);

  // Playback also starts and stops without a key press: a stall, audio focus
  // lost to another app, or expo-video's MediaSession acting on a media button
  // while this activity isn't in front (in front, the with-media-keys plugin
  // claims those keys so only the handler below runs). Follow the player.
  useEffect(() => {
    const sub = player.addListener(
      "playingChange",
      ({ isPlaying: playing }) => {
        const since = playingSinceRef.current;
        if (since !== null) playedMsRef.current += Date.now() - since;
        playingSinceRef.current = playing ? Date.now() : null;
        if (playing) finishedRef.current = false;
        // The MediaSession still owns the hardware Play/Pause key while the
        // player sits behind a channel page; don't let it resume there.
        if (playing && !activeRef.current) {
          player.pause();
          audioPlayer.pause();
          return;
        }
        setIsPlaying(playing);
        revealControls();
      },
    );
    return () => sub.remove();
  }, [player, audioPlayer, revealControls]);

  // Back from another app, or from standby: expo-video paused the player on
  // the way out, and the activity came back with a new video surface. A
  // hardware decoder (the KPN box's Amlogic) draws nothing onto it until the
  // next frame is decoded, so a paused player left a black screen that looked
  // like the box had switched off. Seeking to where it stands decodes that
  // frame; the controls come up so it's clear what's on screen.
  useEffect(() => {
    const sub = AppState.addEventListener("change", (next) => {
      if (next !== "active" || !activeRef.current) return;
      if (!player.playing) {
        const at = player.currentTime;
        player.currentTime = at;
      }
      revealControls();
    });
    return () => sub.remove();
  }, [player, revealControls]);

  // Sent to the background (a channel page opened on top): pause, and close
  // any panel so its own Back handler can't claim presses meant for the page.
  // Coming back leaves it paused with the controls up, ready for OK.
  useEffect(() => {
    if (active) return;
    player.pause();
    audioPlayer.pause();
    setIsPlaying(false);
    setMenuOpen(false);
    setDetailsOpen(false);
  }, [active, player, audioPlayer]);

  // Any remote key re-shows the controls (fires regardless of focus target).
  // While paused the overlay stays pinned; while playing it auto-hides.
  useEffect(() => {
    if (isPlaying) {
      revealControls();
    } else {
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
      setCurrentTime(currentTimeRef.current);
      setControlsVisible(true);
    }
  }, [isPlaying, revealControls]);

  useEffect(
    () => () => {
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
      if (relatedCollapseTimerRef.current) {
        clearTimeout(relatedCollapseTimerRef.current);
      }
    },
    [],
  );

  const togglePlayback = () => {
    if (isPlaying) {
      player.pause();
      audioPlayer.pause();
      setIsPlaying(false);
    } else {
      // Play at the very end replays from the start. Playing on from there
      // would only end again at once and bring the up-next card straight back.
      const total = detailRef.current?.durationSeconds || player.duration || 0;
      if (total > 0 && currentTimeRef.current >= total - 1) {
        player.currentTime = 0;
        if (selectedOptionRef.current?.kind === "split") {
          audioPlayer.currentTime = 0;
        }
      }
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

  /** Cancel on the up-next card: stay on the finished video, controls up. */
  const dismissUpNext = () => {
    scrubberPressedInRef.current = false;
    setEnded(false);
    revealControls();
  };

  const commitScrubOrToggle = () => {
    if (!scrubberPressedInRef.current) {
      scrubberPressedInRef.current = true;
      return;
    }
    if (swallowPressRef.current) {
      swallowPressRef.current = false;
      return;
    }
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

  // A rating only changes the icon, so say what it did: it is a taste signal
  // for the recommender, the same as on the web player.
  const setRatingValue = (next: "like" | "dislike") => {
    const active = rating !== next;
    setRating(active ? next : null);
    showToast({
      text: !active
        ? "Rating removed"
        : next === "like"
          ? "Liked — you'll see more like this"
          : "Disliked — you'll see less like this",
    });
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

  /** Previous restarts the video unless it has barely begun, like a CD player. */
  const playPrevious = () => {
    if (currentTimeRef.current > RESTART_THRESHOLD_SECONDS || !previousVideo) {
      player.currentTime = 0;
      if (selectedOptionRef.current?.kind === "split") {
        audioPlayer.currentTime = 0;
      }
      return;
    }
    onReplaceVideo(previousVideo.videoId, { context });
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
    if (!activeRef.current) return;
    if (event.eventType === "focus" || event.eventType === "blur") return;
    // The up-next card and the settings panel own the screen; their buttons
    // take the D-pad.
    if (
      showUpNextRef.current ||
      menuOpenRef.current ||
      detailsOpenRef.current
    ) {
      return;
    }
    // ACTION_UP is 1; the same long-press event fires on press and release.
    const isKeyUp = Number(event.eventKeyAction) === 1;
    // OK with the controls hidden acts on a SponsorBlock toast (undo / skip)
    // instead of pausing. The key-down event arrives before the focused
    // scrubber's onPress, which then swallows the same press.
    if (
      event.eventType === "select" &&
      !isKeyUp &&
      !controlsVisibleRef.current &&
      actOnToastRef.current()
    ) {
      swallowPressRef.current = true;
      return;
    }
    revealControls();
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
      case "next":
        if (!isKeyUp) playNextRef.current();
        break;
      case "previous":
        if (!isKeyUp) playPrevious();
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
  /**
   * Picks a caption track (null = off) for this video, and remembers on/off
   * for the next; the language comes from the account setting each time.
   */
  const chooseSubtitles = (track: SubtitleTrack | null) => {
    player.subtitleTrack = track;
    setSubtitleTrack(track);
    savePlayerPrefs({ captionsEnabled: track !== null });
  };

  /**
   * Swaps the playing source (quality, audio language) keeping position and
   * play state, through the same pending-seek mechanism the error fallback
   * uses.
   */
  const keepPositionAcrossSwap = () => {
    pendingSeekRef.current = currentTimeRef.current;
    shouldPlayAfterReplaceRef.current = isPlayingRef.current;
  };

  const chooseAudioLanguage = (index: number) => {
    if (state.status !== "ready" || index === audioLangIndex) return;
    const langs = audioLanguageOptions(state.detail.audioSources ?? []);
    keepPositionAcrossSwap();
    setAudioLangIndex(index);
    showToast({ text: `Audio: ${langs[index]?.label ?? ""}` });
  };

  /** Quality: a ceiling on the server DASH source, or another source. */
  const chooseQuality = (cap: number | null) => {
    if (state.status !== "ready") return;
    const dashIndex = state.playbackOptions.findIndex(
      (o) => o.id === "dash-vp9",
    );
    if (dashIndex < 0) return;
    if (cap === qualityCap && dashIndex === state.selectedOptionIndex) return;
    keepPositionAcrossSwap();
    setQualityCap(cap);
    setState((previous) =>
      previous.status === "ready"
        ? { ...previous, selectedOptionIndex: dashIndex }
        : previous,
    );
  };

  const chooseSource = (index: number) => {
    if (state.status !== "ready" || index === state.selectedOptionIndex) return;
    keepPositionAcrossSwap();
    setState((previous) =>
      previous.status === "ready"
        ? { ...previous, selectedOptionIndex: index }
        : previous,
    );
  };

  const chooseRate = (rate: number) => {
    setPlaybackRate(rate);
    player.playbackRate = rate;
    audioPlayer.playbackRate = rate;
    savePlayerPrefs({ playbackRate: rate });
  };

  const seekTo = (seconds: number) => {
    player.currentTime = seconds;
    if (selectedOptionRef.current?.kind === "split") {
      audioPlayer.currentTime = seconds;
    }
  };

  /** OK on a SponsorBlock toast: undo the skip, or take the offered one. */
  const actOnToast = (): boolean => {
    const current = toastRef.current;
    if (!current?.segment || !current.action) return false;
    if (current.action === "undo") {
      keptSegmentsRef.current.add(current.segment.uuid);
      seekTo(current.segment.startSeconds);
    } else {
      seekTo(current.segment.endSeconds);
    }
    setToast(null);
    return true;
  };

  const actOnToastRef = useRef(actOnToast);
  actOnToastRef.current = actOnToast;

  /**
   * Marking the playing video watched finishes it, as reaching the end would:
   * recorded as completed (which also dequeues it), then the up-next card, or
   * Home when nothing follows.
   */
  const markWatched = () => {
    const detail = detailRef.current;
    if (!detail) return;
    markedWatchedRef.current = true;
    player.pause();
    audioPlayer.pause();
    setIsPlaying(false);
    const done = recordCompleted(
      videoId,
      detail,
      detail.durationSeconds || currentTimeRef.current,
    );
    void done.then(() =>
      queryClient.invalidateQueries({
        queryKey: [["history", "progressAll"]],
      }),
    );
    if (nextVideo) {
      setEnded(true);
      showToast({ text: "Marked as watched" });
    } else {
      onHome();
    }
  };

  useEffect(
    () => () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    },
    [],
  );

  // An upcoming stream checks again every minute, so it starts by itself.
  const upcoming =
    state.status === "error" && state.problem.kind === "upcoming";
  useEffect(() => {
    if (!upcoming) return;
    const timer = setInterval(() => setReloadKey((k) => k + 1), 60_000);
    return () => clearInterval(timer);
  }, [upcoming]);

  if (state.status === "loading") {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={colors.brand} />
        <Text style={styles.muted}>Loading...</Text>
      </View>
    );
  }

  if (state.status === "error") {
    const { problem } = state;
    const title =
      problem.kind === "upcoming"
        ? "Not started yet"
        : problem.kind === "age"
          ? "Age-restricted"
          : problem.kind === "unavailable"
            ? "Video unavailable"
            : "Playback unavailable";
    const body =
      problem.kind === "upcoming"
        ? problem.startsAt
          ? `Starts ${new Date(problem.startsAt * 1000).toLocaleString()}. This screen checks again every minute.`
          : "This stream or premiere hasn't started. This screen checks again every minute."
        : problem.kind === "age"
          ? "YouTube only shows this video to signed-in adults, so it can't play here."
          : problem.kind === "unavailable"
            ? "It may have been removed or made private."
            : state.message;
    return (
      <View style={styles.centered}>
        <Text style={styles.errorTitle}>{title}</Text>
        <Text style={[styles.muted, styles.errorBody]}>{body}</Text>
        <View style={styles.errorButtons}>
          {problem.kind !== "unavailable" ? (
            <FocusButton
              label="Retry"
              variant="primary"
              onPress={() => setReloadKey((k) => k + 1)}
              hasTVPreferredFocus
            />
          ) : null}
          <FocusButton
            label="Back"
            onPress={onBack}
            hasTVPreferredFocus={problem.kind === "unavailable"}
          />
        </View>
      </View>
    );
  }

  const { detail } = state;

  const audioLangs = audioLanguageOptions(detail.audioSources ?? []);
  // The manifest-swap chooser only works on the server DASH source; the other
  // options (HLS/muxed/split fallbacks) carry a single fixed audio track.
  const canChooseAudioLanguage =
    audioLangs.length >= 2 &&
    state.playbackOptions[state.selectedOptionIndex]?.id === "dash-vp9";

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

  const selectedOption = state.playbackOptions[state.selectedOptionIndex];
  const onDash = selectedOption?.id === "dash-vp9";
  const effectiveCap = qualityCap ?? settingsRef.current.maxHeight;
  const qualityLabelNow = !onDash
    ? (selectedOption?.label ?? "")
    : qualityCap === null
      ? Number.isFinite(effectiveCap)
        ? `Auto (up to ${effectiveCap}p)`
        : "Auto"
      : `${qualityCap}p`;
  const heights = qualityHeights(detail);
  // Some streams label tracks with just their code ("nl-nl"): name those.
  const subtitleLabel = (track: SubtitleTrack) => {
    const label = track.label?.trim();
    const code = track.language?.trim();
    if (label && label.toLowerCase() !== code?.toLowerCase()) return label;
    return code ? languageName(code) : label || "Unknown";
  };

  /** The settings panel's pages, rebuilt from current state on each render. */
  const buildPage = (key: string): MenuPage => {
    switch (key) {
      case "quality":
        return {
          title: "Quality",
          items: [
            {
              key: "auto",
              label: Number.isFinite(settingsRef.current.maxHeight)
                ? `Auto (up to ${settingsRef.current.maxHeight}p)`
                : "Auto",
              selected: onDash && qualityCap === null,
              onPress: () => chooseQuality(null),
            },
            ...heights.map<MenuItem>((height) => ({
              key: `h${height}`,
              label: `${height}p`,
              selected: onDash && qualityCap === height,
              onPress: () => chooseQuality(height),
            })),
            // The fallback sources, for when DASH misbehaves on a device.
            ...state.playbackOptions
              .map((option, index) => ({ option, index }))
              .filter(({ option }) => option.id !== "dash-vp9")
              .map<MenuItem>(({ option, index }) => ({
                key: option.id,
                label: sourceMenuLabel(option),
                selected: index === state.selectedOptionIndex,
                onPress: () => chooseSource(index),
              })),
          ],
        };
      case "captions":
        return {
          title: "Captions",
          items: [
            {
              key: "off",
              label: "Off",
              selected: subtitleTrack === null,
              onPress: () => chooseSubtitles(null),
            },
            // The account's language first, then the rest as the stream lists them.
            ...captionsInPickerOrder(
              subtitleTracks,
              defaultCaptionTrack(subtitleTracks),
            ).map<MenuItem>((track) => ({
              key: track.id,
              label: subtitleLabel(track),
              selected: subtitleTrack?.id === track.id,
              onPress: () => chooseSubtitles(track),
            })),
          ],
        };
      case "audio":
        return {
          title: "Audio language",
          items: audioLangs.map<MenuItem>((lang, index) => ({
            key: lang.lang,
            label: lang.label,
            selected: index === audioLangIndex,
            onPress: () => chooseAudioLanguage(index),
          })),
        };
      case "speed":
        return {
          title: "Speed",
          items: PLAYBACK_RATES.map<MenuItem>((rate) => ({
            key: String(rate),
            label: formatRate(rate),
            selected: rate === playbackRate,
            onPress: () => chooseRate(rate),
          })),
        };
      case "chapters":
        return {
          title: "Chapters",
          items: chapters.map<MenuItem>((chapter, index) => ({
            key: String(chapter.startSeconds),
            label: chapter.title,
            detail: formatTime(chapter.startSeconds),
            selected: index === chapterIndex,
            onPress: () => {
              seekTo(chapter.startSeconds);
              setMenuOpen(false);
            },
          })),
        };
      case "playlists":
      case "newPlaylist":
        return playlistMenu.buildPage(key) ?? { title: "", items: [] };
      default:
        return {
          title: "Settings",
          items: [
            {
              key: "quality",
              label: "Quality",
              detail: qualityLabelNow,
              submenu: "quality",
            },
            // Captions have their own button (CC), which opens their page.
            ...(canChooseAudioLanguage
              ? [
                  {
                    key: "audio",
                    label: "Audio language",
                    detail: audioLangs[audioLangIndex]?.label,
                    submenu: "audio",
                  },
                ]
              : []),
            {
              key: "speed",
              label: "Speed",
              detail: formatRate(playbackRate),
              submenu: "speed",
            },
            ...(chapters.length > 0
              ? [{ key: "chapters", label: "Chapters", submenu: "chapters" }]
              : []),
            {
              key: "playlists",
              label: "Save to playlist",
              submenu: "playlists",
            },
            {
              key: "queue",
              label: queued ? "Remove from queue" : "Add to queue",
              onPress: () => {
                setMenuOpen(false);
                toggleQueued();
                showToast({
                  text: queued ? "Removed from queue" : "Added to queue",
                });
              },
            },
            {
              key: "ignore",
              label: "Not interested",
              onPress: () => {
                setMenuOpen(false);
                trpcClient.interactions.set
                  .mutate({
                    videoId,
                    channelId: detail.channelId ?? undefined,
                    type: "ignore",
                    active: true,
                    title: detail.title,
                  })
                  .then(() =>
                    showToast({ text: "Got it — you'll see less like this" }),
                  )
                  .catch(() => {});
              },
            },
            ...(detail.channelId
              ? [
                  {
                    key: "block",
                    label: "Don't recommend channel",
                    onPress: () => {
                      setMenuOpen(false);
                      trpcClient.interactions.blockRecommendationChannel
                        .mutate({ channelId: detail.channelId as string })
                        .then(() =>
                          showToast({
                            text: `Won't recommend ${detail.channelName ?? "this channel"}`,
                          }),
                        )
                        .catch(() => {});
                    },
                  },
                ]
              : []),
            {
              key: "stats",
              label: "Stats for nerds",
              detail: statsOn ? "On" : "Off",
              onPress: () => {
                setStatsOn((on) => !on);
                return "stay";
              },
            },
          ],
        };
    }
  };

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
      {toast ? (
        <View style={styles.toast} pointerEvents="none">
          <Text style={styles.toastText}>{toast.text}</Text>
          {toast.hint && !controlsVisible ? (
            <Text style={styles.toastHint}>{toast.hint}</Text>
          ) : null}
        </View>
      ) : null}
      {statsOn ? (
        <StatsOverlay
          player={player}
          option={selectedOption}
          cap={onDash ? effectiveCap : undefined}
          subtitles={subtitleTrack ? subtitleLabel(subtitleTrack) : "off"}
        />
      ) : null}

      {showUpNext && nextVideo ? (
        <UpNext
          key={nextVideo.videoId}
          video={nextVideo}
          contextLabel={context?.label}
          autoplay={settingsRef.current.autoplayNext}
          onPlay={playNext}
          onCancel={dismissUpNext}
        />
      ) : menuOpen ? (
        <MenuPanel
          buildPage={buildPage}
          onClose={closeMenu}
          startPage={menuStart}
        />
      ) : detailsOpen ? (
        <DetailsPanel detail={detail} onClose={closeDetails} />
      ) : (
        // Controls stay mounted (so a focused button always catches the next key
        // to re-reveal them); visibility is just opacity. The up-next card
        // replaces them, so focus can't wander into hidden buttons behind it.
        <View
          style={[
            StyleSheet.absoluteFill,
            { opacity: controlsVisible ? 1 : 0 },
          ]}
          pointerEvents="box-none"
        >
          <View style={styles.topInfo} pointerEvents="none">
            {detail.isLive ? (
              <View style={styles.liveBadge}>
                <Text style={styles.liveBadgeText}>LIVE</Text>
              </View>
            ) : null}
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
                onPressIn={() => {
                  scrubberPressedInRef.current = true;
                }}
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
                  ? segments.map((segment) => (
                      <View
                        key={segment.uuid}
                        pointerEvents="none"
                        style={[
                          styles.segmentMark,
                          {
                            left: `${Math.min(100, (segment.startSeconds / totalSeconds) * 100)}%`,
                            width: `${Math.max(0.3, ((segment.endSeconds - segment.startSeconds) / totalSeconds) * 100)}%`,
                            backgroundColor:
                              SPONSORBLOCK_COLORS[segment.category] ??
                              colors.success,
                          },
                        ]}
                      />
                    ))
                  : null}
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
                        source={{
                          uri: sizedAvatarUrl(detail.channelAvatarUrl, AVATAR),
                        }}
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
                {subscribed !== null ? (
                  <FocusButton
                    label={subscribed ? "Subscribed" : "Subscribe"}
                    variant={subscribed ? "ghost" : "primary"}
                    onPress={toggleSubscribed}
                    onFocusChange={onButtonFocusChange}
                    style={styles.subscribe}
                  />
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
                {/* Same threshold as the web (LIVE_EDGE_SECONDS). */}
                {detail.isLive && behindLive >= LIVE_EDGE_SECONDS ? (
                  <FocusButton
                    label="Go live"
                    onPress={() => {
                      player.currentTime = player.duration;
                      setBehindLive(0);
                    }}
                    onFocusChange={onButtonFocusChange}
                    style={styles.goLive}
                  />
                ) : null}
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
                {/* Finishes the video: see markWatched. */}
                <IconButton
                  icon="check-circle"
                  onPress={markWatched}
                  onFocusChange={onButtonFocusChange}
                />
                <IconButton
                  icon="bookmark"
                  active={saved}
                  onPress={toggleSaved}
                  onFocusChange={onButtonFocusChange}
                />
                {/* Only offered when the stream actually carries subtitles. */}
                {subtitleTracks.length > 0 ? (
                  <IconButton
                    icon="type"
                    action="captions"
                    active={subtitleTrack !== null}
                    onPress={() => {
                      setMenuStart("captions");
                      setMenuOpen(true);
                    }}
                    onFocusChange={onButtonFocusChange}
                  />
                ) : null}
                <IconButton
                  icon="info"
                  onPress={() => setDetailsOpen(true)}
                  onFocusChange={onButtonFocusChange}
                />
                {/* Quality, captions, audio language, speed, chapters… */}
                <IconButton
                  icon="more-vertical"
                  onPress={() => {
                    setMenuStart("root");
                    setMenuOpen(true);
                  }}
                  onFocusChange={onButtonFocusChange}
                />
              </View>
            </View>

            {related.length > 0 ? (
              <Animated.View
                style={[styles.relatedRow, { height: relatedHeight }]}
              >
                {/* Taken out of flow so the animated height above can't bound
                  it: an in-flow child measured exactly the cropped height, so
                  the reveal animated the peek to itself and the rail never
                  opened. Pinned to the top, the edge the crop keeps. */}
                <View
                  style={styles.relatedMeasure}
                  onLayout={(e) => {
                    relatedFullHeight.current = e.nativeEvent.layout.height;
                  }}
                >
                  <VideoRow
                    videos={related}
                    onSelect={onOpenVideo}
                    onCardFocusChange={onRelatedCardFocusChange}
                  />
                </View>
              </Animated.View>
            ) : null}
          </View>
        </View>
      )}
    </View>
  );
}

const NO_VIDEOS: UnifiedVideo[] = [];
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

/** Seconds behind the live edge before "Go live" shows (the web's value). */
const LIVE_EDGE_SECONDS = 15;

/** Watch Next row bounds: worth resuming, and as good as finished. */
const WATCH_NEXT_MIN_FRACTION = 0.03;
const WATCH_NEXT_DONE_FRACTION = 0.95;

/** A resume point this close to the end starts the video over instead. */
const RESUME_END_GUARD_SECONDS = 15;
/** How close playback must have got for an announced end to be a real one. */
const END_TOLERANCE_SECONDS = 5;

/**
 * Records a video as watched to the end: completed in history (the server
 * also drops it from the queue then) and out of the Android TV home screen's
 * Continue watching row.
 */
function recordCompleted(
  videoId: string,
  detail: VideoDetail | null,
  positionSeconds: number,
): Promise<unknown> {
  removeWatchNext(videoId);
  if (!detail) return Promise.resolve();
  const done = detail.channelId
    ? trpcClient.history.upsertEvent.mutate({
        videoId: detail.videoId,
        channelId: detail.channelId,
        // The server keeps the larger of this and the recorded play time;
        // what matters here is `completed`.
        durationWatched: 0,
        positionSeconds: Math.floor(positionSeconds),
        completed: true,
        videoDurationSeconds: detail.durationSeconds,
        videoTitle: detail.title,
        channelName: detail.channelName,
      })
    : trpcClient.subscriptions.markWatched.mutate({ videoId });
  return done.catch(() => {});
}

/** Past this, "previous" restarts the video instead of going back one. */
const RESTART_THRESHOLD_SECONDS = 5;

/** Playhead knob shown while the scrubber holds focus. */
const SCRUB_KNOB = 18;
const TRACK_HEIGHT = 7;
/** Scrubber padding, so the knob can be centred on the bar arithmetically. */
const SCRUB_PAD = 8;

/** How much of the related rail stays on screen under the controls. */
const RELATED_PEEK_HEIGHT = 104;
const RELATED_REVEAL_MS = 180;
/** Longer than one focus-move's blur→focus gap, shorter than a deliberate exit. */
const RELATED_COLLAPSE_DELAY_MS = 150;

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
  relatedMeasure: { position: "absolute", top: 0, left: 0, right: 0 },
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
  toast: {
    position: "absolute",
    top: 36,
    right: 36,
    alignItems: "flex-end",
    backgroundColor: "rgba(0, 0, 0, 0.75)",
    borderRadius: radius.shell,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  toastText: { color: colors.foreground, fontSize: fontSize.md },
  toastHint: { color: colors.mutedForeground, fontSize: fontSize.sm },
  subscribe: { minHeight: 40, marginLeft: spacing.sm },
  goLive: { minHeight: 40, paddingHorizontal: spacing.md },
  liveBadge: {
    alignSelf: "flex-start",
    backgroundColor: colors.brand,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 2,
    marginBottom: spacing.xs,
  },
  liveBadgeText: {
    color: colors.primaryForeground,
    fontSize: fontSize.sm,
    fontWeight: "800",
  },
  errorBody: { maxWidth: 720, textAlign: "center" },
  errorButtons: { flexDirection: "row", gap: spacing.md },
  stats: {
    position: "absolute",
    top: 36,
    left: 36,
    padding: spacing.sm,
    borderRadius: radius.shell,
    backgroundColor: "rgba(0, 0, 0, 0.75)",
  },
  statsText: {
    color: colors.foreground,
    fontSize: fontSize.sm,
    fontFamily: monoFont,
  },
  segmentMark: {
    position: "absolute",
    top: SCRUB_PAD,
    height: TRACK_HEIGHT,
    opacity: 0.85,
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

/**
 * The quality rungs the video offers, tallest first — what the panel lists as
 * ceilings for the DASH source. By YouTube's label ("1080p"), which the
 * server's `maxHeight` also goes by; the frame height of a cinemascope
 * rendition (804, 608…) would list odd rungs.
 */
function qualityHeights(detail: VideoDetail): number[] {
  const heights = new Set<number>();
  for (const source of detail.videoSources) {
    const labelled = source.quality?.match(/(\d{3,4})p/)?.[1];
    const height = labelled ? Number.parseInt(labelled, 10) : source.height;
    if (typeof height === "number" && height >= 144) heights.add(height);
  }
  return [...heights].sort((a, b) => b - a);
}

function sourceMenuLabel(option: PlaybackOption): string {
  if (option.kind === "split") return `${option.label} (separate audio)`;
  if (option.kind === "muxed") return `${option.label} (MP4)`;
  return option.label;
}

/**
 * Stats for nerds: what is actually playing, for debugging real TVs. Polls the
 * player once a second on its own, so the screen around it doesn't re-render.
 */
function StatsOverlay({
  player,
  option,
  cap,
  subtitles,
}: {
  player: VideoPlayer;
  option: PlaybackOption | undefined;
  cap: number | undefined;
  subtitles: string;
}) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(timer);
  }, []);
  const buffered = Math.max(0, player.bufferedPosition - player.currentTime);
  const host = (() => {
    try {
      return new URL(option?.videoUrl ?? "").host;
    } catch {
      return "?";
    }
  })();
  const rows: [string, string][] = [
    ["Source", `${option?.id ?? "?"} · ${option?.label ?? ""}`],
    ["Host", host],
    ["Cap", cap === undefined || !Number.isFinite(cap) ? "none" : `${cap}p`],
    ["Status", `${player.status}${player.playing ? " · playing" : ""}`],
    [
      "Position",
      `${formatTime(player.currentTime)} / ${formatTime(player.duration)}`,
    ],
    ["Buffer", `${buffered.toFixed(1)} s`],
    ["Speed", formatRate(player.playbackRate)],
    ["Live", player.isLive ? "yes" : "no"],
    ["Captions", subtitles],
  ];
  return (
    <View style={styles.stats} pointerEvents="none">
      {rows.map(([label, value]) => (
        <Text key={label} style={styles.statsText} numberOfLines={1}>
          {label.padEnd(9)} {value}
        </Text>
      ))}
    </View>
  );
}

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

  // Live streams have no fixed-duration adaptiveFormats to build a VOD DASH/HLS
  // manifest from (no init/index byte ranges) — /dash/…/manifest.mpd and /hls
  // 502. OwnTube serves YouTube's own live DASH, via invidious-companion, at
  // /dash/<id>/live.mpd; the raw upstream live HLS URL's segments 403, so it
  // is only a last resort. Mirrors apps/web/src/lib/pick-playback.ts's
  // `dash-live` branch.
  if (detail.isLive) {
    addOption({
      id: "live-dash",
      label: "Live",
      videoUrl: `${baseUrl()}/dash/${encodeURIComponent(detail.videoId)}/live.mpd`,
      kind: "auto",
    });
    if (detail.hlsUrl) {
      addOption({
        id: "live-hls",
        label: "Live (HLS)",
        videoUrl: detail.hlsUrl,
        kind: "auto",
      });
    }
    return options;
  }

  // Server-generated DASH first: one manifest carrying both the video ladder
  // (VP9 unlocks the rungs above 1080p that the AVC-only HLS path cannot) and
  // the audio track, so ExoPlayer owns A/V sync instead of this screen nudging
  // two players into alignment. See apps/web/src/server/services/dash.
  addOption({
    id: "dash-vp9",
    label: "Auto",
    videoUrl: `${baseUrl()}/dash/${detail.videoId}/manifest.mpd?video=vp9`,
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
  // Multi-audio videos list auto-dubs alongside (sometimes before) the
  // original; the split fallback carries exactly one audio URL, so make sure
  // it is the original and not whatever language happened to sort first.
  const originalBonus = urlLooksLikeOriginalAudio(source.url) ? 1000 : 0;
  return originalBonus + codecScore + (source.bitrate ?? 0) / 1_000_000;
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

/** `tracks` with `first` (the account's default) moved to the front. */
function captionsInPickerOrder(
  tracks: SubtitleTrack[],
  first: SubtitleTrack | undefined,
): SubtitleTrack[] {
  if (!first) return tracks;
  return [first, ...tracks.filter((t) => t.id !== first.id)];
}
