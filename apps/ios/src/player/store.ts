import type { NativePlayRequest } from "@web/lib/native-app";
import { buildWatchPlayback } from "@web/lib/pick-playback";
import type { VideoDetail } from "@web/server/services/proxy.types";
import { router } from "expo-router";
import { createVideoPlayer, type VideoPlayer } from "expo-video";
import { useSyncExternalStore } from "react";
import { SERVER_URL } from "@/lib/config";
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
  });
  player = created;
  return created;
}

// --- Sources -----------------------------------------------------------------

/** The sources still to try for the current video, best first. */
let pending: string[] = [];
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

function load(uri: string) {
  const video = state?.video;
  if (!video) return;
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

/**
 * Plays a video the web page asked for (or opens the player on it again).
 * Starts with the server's HLS, which AVPlayer plays natively, and keeps the
 * detail-based sources as fallbacks.
 */
export function playVideo(video: NativePlayRequest) {
  const current = getPlayer();
  if (state?.video.videoId === video.videoId && !state.error) {
    if (video.autoplay) current.play();
    router.navigate("/player");
    return;
  }

  void saveProgress();
  setState({ video });
  loadingId = video.videoId;
  seekTo = video.startSeconds && !video.isLive ? video.startSeconds : undefined;
  autoplay = video.autoplay;
  progress.reset(video);

  pending = [];
  const detail = trpc.video.detail
    .query({ videoId: video.videoId })
    .then((value) => {
      if (loadingId !== video.videoId) return null;
      progress.detail = value;
      pending.push(...fallbackSources(value));
      return value;
    })
    .catch(() => null);

  if (video.isLive) {
    // Live has no server HLS; its stream comes from the detail.
    void detail.then((value) => {
      if (value && loadingId === video.videoId) void tryNextSource();
    });
  } else {
    load(`${SERVER_URL}/hls/${encodeURIComponent(video.videoId)}/master.m3u8`);
  }
  router.navigate("/player");
}

/** Stops playback and leaves the mini player. */
export function stopPlayback() {
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
