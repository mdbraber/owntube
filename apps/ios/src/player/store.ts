import {
  LIVE_IDLE_CHECK_MS,
  shouldStopIdleLive,
} from "@web/lib/live-idle-stop";
import type { NativePlayRequest } from "@web/lib/native-app";
import { buildWatchPlayback } from "@web/lib/pick-playback";
import type { VideoDetail } from "@web/server/catalog/types";
import { router } from "expo-router";
import { createVideoPlayer, type VideoPlayer } from "expo-video";
import { useSyncExternalStore } from "react";
import { SERVER_URL } from "@/lib/config";
import { setResumeAction } from "@/lib/home-screen-actions";
import { getToken } from "@/lib/session";
import { trpc } from "@/lib/trpc";

/**
 * The app's one video player. It lives here, not in a screen, so playback
 * goes on when the player screen closes: in the mini player above the tab
 * bar, in Picture-in-Picture, and with the screen locked.
 */
export type NowPlaying = {
  video: NativePlayRequest;
  /** What failed to play, once every source has. */
  error?: string;
  /**
   * What plays next, in order: the queue, then related videos. At the end of
   * a video the queue plays on, and related videos do with `autoplayNext`.
   */
  upNext: UpNextItem[];
  /** The account's "Autoplay next": related videos play on at the end. */
  autoplayNext: boolean;
  /**
   * A live stream stopped for idleness ("Still watching?", see
   * live-idle-stop.ts): its source is unloaded until resumeAfterIdle.
   */
  idleStopped?: boolean;
};

export type UpNextItem = {
  videoId: string;
  title: string;
  channelName?: string;
  thumbnailUrl?: string;
  durationSeconds?: number;
  /** From the queue: playing it takes it off the queue, as on the web. */
  fromQueue: boolean;
};

let state: NowPlaying | null = null;
const listeners = new Set<() => void>();

function setState(next: NowPlaying | null) {
  state = next;
  for (const listener of listeners) listener();
}

export function useNowPlaying(): NowPlaying | null {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => state,
  );
}

let player: VideoPlayer | null = null;

/** The shared player, created on first use. */
export function getPlayer(): VideoPlayer {
  if (player) return player;
  const created = createVideoPlayer(null);
  created.staysActiveInBackground = true;
  created.showNowPlayingNotification = true;
  created.allowsExternalPlayback = true;
  created.timeUpdateEventInterval = 1;
  created.addListener("statusChange", ({ status, error }) => {
    if (status === "readyToPlay") onReady();
    if (status === "error") void tryNextSource(error?.message);
  });
  created.addListener("playingChange", ({ isPlaying }) => {
    progress.playing = isPlaying;
    // Someone pressed pause or play (in the app, on the lock screen, in
    // Picture-in-Picture): a pause while the stream is ready, not a stall,
    // and the play that follows it. Stalls come with status "loading".
    if (!isPlaying && created.status === "readyToPlay") {
      pausedWhileReady = true;
      noteInteraction();
    } else if (isPlaying && pausedWhileReady) {
      pausedWhileReady = false;
      noteInteraction();
    }
  });
  created.addListener("playToEnd", () => {
    resumeSettled = true;
    void saveProgress();
    // The queue always plays on; related videos only with Autoplay next on.
    const next = state?.upNext[0];
    if (next && (next.fromQueue || state?.autoplayNext)) {
      playNext(next, { present: false });
    }
  });
  player = created;
  return created;
}

// --- Sources -----------------------------------------------------------------

/** The sources still to try for the current video, best first. */
let pending: string[] = [];
/** The current video's detail while it loads (it brings the fallbacks). */
let detailLoading: Promise<unknown> | null = null;

/** The video id `pending` belongs to; a newer play request replaces it. */
let loadingId: string | null = null;
let seekTo: number | undefined;
let autoplay = true;

const absolute = (url: string) => new URL(url, SERVER_URL).toString();

/**
 * Fallbacks after the server's HLS, from the video's detail: the same choice
 * the web app makes for Safari on iPhone (HLS, then muxed progressive MP4),
 * since AVPlayer, like it, plays neither DASH nor split audio and video.
 */
function fallbackSources(detail: VideoDetail): string[] {
  if (detail.isLive) return detail.hlsUrl ? [absolute(detail.hlsUrl)] : [];
  const playback = buildWatchPlayback(detail, { avoidSplitAudioVideo: true });
  if (playback.kind === "hls") return [absolute(playback.url)];
  if (playback.kind === "progressive") {
    return playback.variants
      .flatMap((variant) => (variant.t === "muxed" ? [variant.url] : []))
      .slice(0, 2)
      .map(absolute);
  }
  return [];
}

/**
 * How long a source may take to become playable. AVPlayer can wait on a
 * stalled stream indefinitely without failing, which would never reach the
 * fallbacks. Generous, so a slow connection (cellular) isn't mistaken for a
 * dead stream.
 */
const READY_TIMEOUT_MS = 30_000;
let readyTimer: ReturnType<typeof setTimeout> | null = null;

function clearReadyTimer() {
  if (readyTimer) clearTimeout(readyTimer);
  readyTimer = null;
}

function load(uri: string) {
  const video = state?.video;
  if (!video) return;
  clearReadyTimer();
  const forVideo = video.videoId;
  readyTimer = setTimeout(() => {
    readyTimer = null;
    if (loadingId === forVideo && getPlayer().status !== "readyToPlay") {
      void tryNextSource("The video took too long to load.");
    }
  }, READY_TIMEOUT_MS);
  // replaceAsync: `replace` loads the asset on the main thread on iOS.
  void getPlayer().replaceAsync({
    uri,
    contentType: uri.includes(".m3u8") ? "hls" : "auto",
    metadata: {
      title: video.title,
      artist: video.channelName,
      artwork: video.poster,
    },
  });
}

function onReady() {
  clearReadyTimer();
  const current = getPlayer();
  if (seekTo !== undefined) {
    current.currentTime = seekTo;
    seekTo = undefined;
  }
  if (autoplay) current.play();
  autoplay = false;
}

async function tryNextSource(message?: string) {
  const videoId = loadingId;
  // The fallbacks come with the video's detail; if the first source failed
  // before it arrived, wait for it rather than give up.
  if (!pending.length && detailLoading) await detailLoading;
  if (videoId !== loadingId) return;
  const next = pending.shift();
  if (next) {
    // Resume where the failed source was, not at the start.
    seekTo = Math.max(seekTo ?? 0, getPlayer().currentTime);
    autoplay = true;
    load(next);
    return;
  }
  if (videoId && state?.video.videoId === videoId) {
    setState({
      ...state,
      error: message || "This video can't be played.",
    });
  }
}

/** What's known about a video when it's opened (a link knows little). */
export type OpenVideo = {
  videoId: string;
  /** A start time the user chose (a link's `t`). */
  startSeconds?: number;
  title?: string;
  channelName?: string;
  poster?: string;
  durationSeconds?: number;
  isLive?: boolean;
};

/**
 * The page's resume position was applied, or isn't wanted: the opener chose
 * a start (a link's `t`), or the video already ended.
 */
let resumeSettled = false;

/** How long to hold the first load for the video's title and artwork. */
const METADATA_WAIT_MS = 1500;

/**
 * Opens a video in the player panel, YouTube-style: the panel slides up over
 * whatever you were browsing (nothing is added to Back), and swiping it down
 * leaves the video playing in the mini player. The same video opens the panel
 * again; another one replaces what's playing.
 *
 * Starts with the server's HLS, which AVPlayer plays natively, and keeps the
 * detail-based sources as fallbacks.
 */
export function openVideo(
  video: OpenVideo,
  { present = true }: { present?: boolean } = {},
) {
  if (
    state?.video.videoId === video.videoId &&
    !state.error &&
    !state.idleStopped
  ) {
    if (present) router.navigate("/player");
    return;
  }

  void saveProgress();
  const request: NativePlayRequest = {
    videoId: video.videoId,
    title: video.title ?? "",
    channelName: video.channelName,
    poster: video.poster,
    startSeconds: video.startSeconds,
    durationSeconds: video.durationSeconds,
    isLive: video.isLive,
    autoplay: true,
  };
  setState({ video: request, upNext: [], autoplayNext: false });
  noteInteraction();
  loadingId = video.videoId;
  resumeSettled = video.startSeconds !== undefined;
  seekTo = video.startSeconds && !video.isLive ? video.startSeconds : undefined;
  autoplay = true;
  progress.reset(request);
  pending = [];
  getPlayer().pause();
  if (present) router.navigate("/player");

  const detail: Promise<VideoDetail | null> = trpc.video.detail
    .query({ videoId: video.videoId })
    .then((value) => {
      if (loadingId !== video.videoId) return null;
      progress.detail = value;
      mergeVideo(video.videoId, {
        title: value.title,
        channelName: value.channelName,
        poster: value.thumbnailUrl && absolute(value.thumbnailUrl),
        durationSeconds: value.durationSeconds,
        isLive: value.isLive,
      });
      pending.push(...fallbackSources(value));
      void loadUpNext(video.videoId);
      return value;
    })
    .catch(() => null);
  detailLoading = detail.finally(() => {
    if (loadingId === video.videoId) detailLoading = null;
  });

  // Hold the first load briefly for the detail: Now Playing (lock screen,
  // Control Center) takes its title and artwork from the source.
  const metadata = new Promise((resolve) =>
    setTimeout(resolve, METADATA_WAIT_MS),
  );
  void Promise.race([detail, metadata]).then(() => {
    if (loadingId !== video.videoId) return;
    if (state?.video.isLive) {
      // Live has no server HLS; its stream comes from the detail.
      void detail.then(() => {
        if (loadingId === video.videoId) void tryNextSource();
      });
      return;
    }
    load(`${SERVER_URL}/hls/${encodeURIComponent(video.videoId)}/master.m3u8`);
  });
  if (state) setResumeAction(state.video);
}

/** Fills in what the opener didn't know about the current video. */
function mergeVideo(videoId: string, known: Partial<NativePlayRequest>) {
  if (!state || state.video.videoId !== videoId) return;
  const video = { ...state.video };
  for (const [key, value] of Object.entries(known)) {
    const field = key as keyof NativePlayRequest;
    if (value !== undefined && !video[field]) {
      (video as Record<string, unknown>)[field] = value;
    }
  }
  setState({ ...state, video });
  progress.video = video;
  setResumeAction(video);
}

/**
 * The watch page in the panel reports its video (`play` message): its
 * metadata, and where to resume from history. A resume position applies only
 * near the start, so it never yanks a video the user is already watching.
 */
export function applyPageHints(video: NativePlayRequest) {
  if (state?.video.videoId !== video.videoId) return;
  mergeVideo(video.videoId, video);
  if (resumeSettled || video.isLive) return;
  resumeSettled = true;
  const resumeAt = video.startSeconds ?? 0;
  if (resumeAt < 5) return;
  const current = getPlayer();
  if (current.status === "readyToPlay") {
    if (current.currentTime < 3) current.currentTime = resumeAt;
  } else {
    seekTo = resumeAt;
  }
}

/**
 * A page outside the panel asked to play (a watch page loaded in a tab): open
 * it in the panel, with what the page knows.
 */
export function playVideo(video: NativePlayRequest) {
  openVideo(video);
  applyPageHints(video);
}

/** Plays an Up next item (tapped, or at the end of the current video). */
export function playNext(
  item: UpNextItem,
  options: { present?: boolean } = {},
) {
  if (item.fromQueue) {
    void trpc.queue.remove.mutate({ videoId: item.videoId }).catch(() => {});
  }
  openVideo(
    {
      videoId: item.videoId,
      title: item.title,
      channelName: item.channelName,
      poster: item.thumbnailUrl,
      durationSeconds: item.durationSeconds,
    },
    options,
  );
}

let refreshTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * The queue changed (the page added or removed a video, or reordered it):
 * reload Up next. Debounced, as every open page reports the change.
 */
export function refreshUpNext() {
  const videoId = state?.video.videoId;
  if (!videoId) return;
  if (refreshTimer) clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => {
    refreshTimer = null;
    if (state?.video.videoId === videoId) void loadUpNext(videoId);
  }, 400);
}

/**
 * Fills in Up next: the queue (signed in), then related videos. "Autoplay
 * next" comes from the account's settings (signed out: on, the web default).
 */
async function loadUpNext(videoId: string) {
  const signedIn = Boolean(await getToken());
  const [queue, settings, related] = await Promise.all([
    signedIn
      ? trpc.queue.listDetailed.query().catch(() => [])
      : Promise.resolve([]),
    signedIn
      ? trpc.settings.get.query().catch(() => null)
      : Promise.resolve(null),
    trpc.video.related.query({ videoId }).catch(() => null),
  ]);
  const current = state;
  if (current?.video.videoId !== videoId) return;
  const seen = new Set([videoId]);
  const upNext: UpNextItem[] = [];
  const add = (item: UpNextItem) => {
    if (seen.has(item.videoId)) return;
    seen.add(item.videoId);
    upNext.push(item);
  };
  for (const item of queue) {
    add({
      videoId: item.videoId,
      title: item.videoTitle,
      channelName: item.channelName ?? undefined,
      thumbnailUrl: item.thumbnailUrl && absolute(item.thumbnailUrl),
      durationSeconds: item.durationSeconds,
      fromQueue: true,
    });
  }
  for (const video of related?.videos ?? []) {
    add({
      videoId: video.videoId,
      title: video.title,
      channelName: video.channelName,
      thumbnailUrl: video.thumbnailUrl && absolute(video.thumbnailUrl),
      durationSeconds: video.durationSeconds,
      fromQueue: false,
    });
  }
  setState({
    ...current,
    upNext,
    autoplayNext: settings?.autoplayNext ?? true,
  });
}

/** Loads the current video again from its first source (after an error). */
export function retryPlayback() {
  const video = state?.video;
  if (!video) return;
  const position = getPlayer().currentTime;
  setState(null);
  openVideo(
    {
      ...video,
      startSeconds: position > 0 ? position : video.startSeconds,
    },
    { present: false },
  );
}

// --- "Still watching?" (live only) -------------------------------------------

let lastInteractionAt = Date.now();
/** Whether the last pause came while the stream was ready (see playingChange). */
let pausedWhileReady = false;

/** Someone touched the player panel or mini player, or used its controls. */
export function noteInteraction() {
  lastInteractionAt = Date.now();
}

/**
 * A live stream left hours without interaction, also in the background or in
 * Picture-in-Picture, is unloaded rather than paused: AVPlayer keeps
 * reloading a live playlist while paused, and every reload is a request to
 * YouTube. The panel and mini player then offer to carry on.
 */
function stopIfIdleLive() {
  if (!state || state.idleStopped || state.error) return;
  const isLive = state.video.isLive === true;
  if (!shouldStopIdleLive(lastInteractionAt, Date.now(), isLive)) return;
  clearReadyTimer();
  loadingId = null;
  pending = [];
  getPlayer().pause();
  void getPlayer().replaceAsync(null);
  setState({ ...state, idleStopped: true });
}

setInterval(stopIfIdleLive, LIVE_IDLE_CHECK_MS);

/** "Still watching?" answered: loads the live stream again, at the live edge. */
export function resumeAfterIdle() {
  const video = state?.idleStopped ? state.video : null;
  if (!video) return;
  openVideo({ ...video, startSeconds: undefined }, { present: false });
}

/** Stops playback and leaves the mini player. */
export function stopPlayback() {
  clearReadyTimer();
  void saveProgress();
  getPlayer().pause();
  void getPlayer().replaceAsync(null);
  loadingId = null;
  pending = [];
  progress.reset(null);
  setState(null);
}

// --- Watch progress ----------------------------------------------------------

/** Matches the web and TV trackers. */
const SAVE_INTERVAL_MS = 20_000;
const COMPLETION_RATIO = 0.9;
const MIN_TRACKED_SECONDS = 5;
const MAX_TRACKED_SECONDS = 86_400;

const clamp = (value: number) =>
  Math.min(MAX_TRACKED_SECONDS, Math.max(0, Math.floor(value)));

/**
 * Records watch progress to history as the TV app does
 * (apps/tv/src/lib/record-watch-progress.ts): position for Continue watching,
 * time actually played as the recommender's signal. Needs the app's session.
 */
const progress = {
  video: null as NativePlayRequest | null,
  detail: null as VideoDetail | null,
  playing: false,
  playedMs: 0,
  lastTick: Date.now(),
  reset(video: NativePlayRequest | null) {
    this.video = video;
    this.detail = null;
    this.playing = false;
    this.playedMs = 0;
    this.lastTick = Date.now();
  },
  accumulate() {
    const now = Date.now();
    if (this.playing) this.playedMs += now - this.lastTick;
    this.lastTick = now;
  },
};

async function saveProgress() {
  progress.accumulate();
  const { video, detail } = progress;
  if (!video || video.isLive || !detail?.channelId) return;
  const playedSeconds = clamp(progress.playedMs / 1000);
  if (playedSeconds < MIN_TRACKED_SECONDS) return;
  if (!(await getToken())) return;
  const positionSeconds = clamp(getPlayer().currentTime);
  const durationSeconds = clamp(
    detail.durationSeconds ?? video.durationSeconds ?? 0,
  );
  await trpc.history.upsertEvent
    .mutate({
      videoId: video.videoId,
      channelId: detail.channelId,
      durationWatched: playedSeconds,
      positionSeconds,
      completed:
        durationSeconds > 0 &&
        positionSeconds >= durationSeconds * COMPLETION_RATIO,
      videoDurationSeconds: durationSeconds,
      isShort: false,
      videoTitle: video.title,
      channelName: video.channelName ?? detail.channelName,
    })
    .catch(() => {});
}

setInterval(() => {
  if (progress.playing) void saveProgress();
}, SAVE_INTERVAL_MS);

/** Saves progress now: the app is going to the background. */
export function flushProgress() {
  void saveProgress();
}
