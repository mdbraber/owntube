"use client";

import { useRouter } from "next/navigation";
import {
  type Dispatch,
  type SetStateAction,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { HlsVodBlock } from "@/components/player/hls-vod-block";
import { LiveBlock } from "@/components/player/live-block";
import type {
  CaptionTrack,
  VideoPlayerPayload,
} from "@/components/player/player-payload";
import {
  playbackResumeStorageKey,
  shouldAutoRecoverPlaybackSource,
  tryOneShotPlaybackRecovery,
} from "@/components/player/player-recovery";
import type { SponsorBlockChromeProps } from "@/components/player/player-types";
import {
  readWatchQueue,
  type WatchQueueItem,
  writeWatchQueue,
} from "@/components/player/watch-queue";
import { useWatchCinema } from "@/components/watch/watch-cinema-context";
import {
  mergeScrubPreview,
  type ScrubPreviewConfig,
  useScrubFramePreview,
} from "@/hooks/use-scrub-frame-preview";
import { useSponsorBlockSegments } from "@/hooks/use-sponsorblock-segments";
import {
  DEFAULT_PLAYBACK_QUALITY,
  type DefaultPlaybackQuality,
  heightCapForDefaultQuality,
  readDefaultPlaybackQuality,
} from "@/lib/default-playback-quality";
import {
  readPlayerMediaPrefs,
  writePlayerVolumeOnly,
} from "@/lib/player-media-prefs";
import type { SponsorBlockPrefs } from "@/lib/sponsorblock-prefs";
import { cn } from "@/lib/utils";
import type { VideoChapter } from "@/lib/video-chapters";
import { videoIdFromWatchHref } from "@/lib/yt-routes";
import type { VideoStoryboard } from "@/server/catalog/types";
import { trpc } from "@/trpc/react";

export type { VideoPlayerPayload };

export type VideoPlayerProps = {
  videoId: string;
  payload: VideoPlayerPayload;
  /** Subtitle tracks (same-origin VTT srcs); attached to every block's <video>. */
  captions?: CaptionTrack[];
  title: string;
  poster?: string;
  chapters?: VideoChapter[];
  startAtSeconds?: number;
  durationSeconds?: number;
  storyboard?: VideoStoryboard;
  /** Low-quality stream for timeline scrub (falls back to main stream). */
  scrubPreviewStreamSrc?: string;
  miniMode?: boolean;
  /** Vertical full-height Shorts viewer (minimal chrome, cover fit). */
  shortsMode?: boolean;
  /**
   * The currently-visible short. When a shorts slide is mounted but NOT active
   * (an adjacent slide pre-warmed for an instant swipe), this is false: the
   * player attaches and buffers/decodes the first frame but does not autoplay.
   * Flips true on becoming active → plays instantly from the warm buffer.
   */
  shortsActive?: boolean;
  /** Called when playback reaches the end (Shorts auto-advance). */
  onEnded?: () => void;
  /** Fired when the &lt;video&gt; element exposes intrinsic dimensions. */
  onVideoIntrinsics?: (width: number, height: number) => void;
  defaultPlaybackQuality?: DefaultPlaybackQuality;
  /** DASH: jump to the best quality on entering fullscreen, restore on exit. */
  fullscreenAutoBestQuality?: boolean;
  /** Volume / mute captured at handoff from watch (optional). */
  restoredVolume?: number;
  restoredMuted?: boolean;
  /** Mini player: do not autoplay (user left watch while paused). */
  miniStartPaused?: boolean;
  /** Start playing as soon as the watch page loads (user setting). */
  autoplayOnWatch?: boolean;
  /** Server-side "Autoplay next" (user settings); undefined when signed out. */
  autoplayNextDefault?: boolean;
  /**
   * External cinema control. The persistent player is hosted outside
   * WatchCinemaProvider, so the watch page bridges its cinema state through
   * here; falls back to the provider/local state when absent.
   */
  cinema?: {
    cinemaMode: boolean;
    setCinemaMode: Dispatch<SetStateAction<boolean>>;
  } | null;
  /** Server-backed SponsorBlock prefs (watch page); falls back to localStorage. */
  sponsorBlockPrefs?: SponsorBlockPrefs;
  /** Active live HLS broadcast — live chrome, no SponsorBlock/scrub preview. */
  isLive?: boolean;
};

/* ------------------------------- Top level ------------------------------- */

/** Watch time before a short ramps from its low start rung up to the default. */

export function VideoPlayer({
  videoId,
  payload,
  captions,
  title,
  poster,
  chapters = [],
  startAtSeconds,
  durationSeconds,
  storyboard,
  scrubPreviewStreamSrc,
  miniMode = false,
  shortsMode = false,
  shortsActive = true,
  onEnded: onEndedExternal,
  onVideoIntrinsics,
  defaultPlaybackQuality: defaultPlaybackQualityProp,
  fullscreenAutoBestQuality = false,
  restoredVolume,
  restoredMuted,
  miniStartPaused = false,
  autoplayOnWatch = false,
  autoplayNextDefault,
  cinema,
  sponsorBlockPrefs: sponsorBlockPrefsProp,
  isLive = false,
}: VideoPlayerProps) {
  const playerMediaRootRef = useRef<HTMLDivElement>(null);
  // Autoplay on the full watch page only (never in the mini player or Shorts,
  // which have their own autoplay semantics).
  const watchAutoplay = autoplayOnWatch && !miniMode && !shortsMode;
  /**
   * Post-Live-DVR has no frame-extractable stream: its adaptive URLs are
   * `yt_live_broadcast` ones that 403 on server-IP replay, and the main `src` is
   * the `/hls/` path that 502s for DVR (playback runs off `/dash` instead). Treat
   * it like a live stream for scrub preview — a storyboard, when the video has
   * one, is used ahead of any stream and still works.
   */
  const noScrubStream = isLive || payload.dvr === true;
  const scrubFrames = useScrubFramePreview({
    videoId,
    durationSeconds: isLive ? undefined : durationSeconds,
    storyboard: isLive ? undefined : storyboard,
    scrubPreviewStreamSrc: noScrubStream ? undefined : scrubPreviewStreamSrc,
  });
  const buildScrubPreview = useCallback(
    (streamSrc: string): ScrubPreviewConfig | null => {
      if (isLive) return null;
      return mergeScrubPreview(
        // "" is the supported "no stream" value — scrub-preview.tsx skips the
        // preview <video> and frame extraction, keeping poster/storyboard.
        noScrubStream ? "" : (scrubPreviewStreamSrc ?? streamSrc),
        poster,
        scrubFrames.primeFrames,
        scrubFrames.frameAt,
      );
    },
    [
      isLive,
      noScrubStream,
      scrubPreviewStreamSrc,
      poster,
      scrubFrames.primeFrames,
      scrubFrames.frameAt,
    ],
  );
  const { segments: sponsorSegments, prefs: sponsorBlockPrefs } =
    useSponsorBlockSegments({
      videoId,
      durationSeconds,
      enabled: !shortsMode && !isLive,
      prefs: sponsorBlockPrefsProp,
    });
  const sponsorChromeProps: SponsorBlockChromeProps = shortsMode
    ? {
        videoId,
        sponsorSegments: [],
        sponsorBlockPrefs: {
          enabled: false,
          autoSkip: false,
          categories: [],
        },
      }
    : {
        videoId,
        sponsorSegments,
        sponsorBlockPrefs,
      };
  const router = useRouter();
  const watchCinema = useWatchCinema();
  const [localCinema, setLocalCinema] = useState(false);
  const effectiveCinema = cinema ?? watchCinema;
  const cinemaMode = effectiveCinema ? effectiveCinema.cinemaMode : localCinema;
  const setCinemaMode = effectiveCinema
    ? effectiveCinema.setCinemaMode
    : setLocalCinema;
  const exitCinema = useCallback(() => setCinemaMode(false), [setCinemaMode]);
  const toggleCinema = useCallback(
    () => setCinemaMode((v) => !v),
    [setCinemaMode],
  );

  const effectivePayload: VideoPlayerPayload = payload;

  const displayPoster = shortsMode ? undefined : poster;

  const resolvedDefaultQuality =
    defaultPlaybackQualityProp ??
    (typeof window === "undefined"
      ? DEFAULT_PLAYBACK_QUALITY
      : readDefaultPlaybackQuality());
  // DASH ABR ceiling — same source of truth as the progressive start rung
  // above, translated to a plain height since DASH has no {label,t} variants.
  const dashQualityHeightCap = heightCapForDefaultQuality(
    resolvedDefaultQuality,
  );
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [resumeSeekSeconds, setResumeSeekSeconds] = useState<
    number | undefined
  >(undefined);
  const [splitVolume, setSplitVolume] = useState(() => {
    if (typeof restoredVolume === "number" && Number.isFinite(restoredVolume)) {
      return Math.min(1, Math.max(0, restoredVolume));
    }
    return readPlayerMediaPrefs().volume;
  });
  const [queue, setQueue] = useState<WatchQueueItem[]>([]);
  const [autoplayNext, setAutoplayNext] = useState(autoplayNextDefault ?? true);
  const [nextCountdown, setNextCountdown] = useState<number | null>(null);
  const nextUp = queue[0] ?? null;

  useEffect(() => {
    const load = () => setQueue(readWatchQueue());
    load();
    window.addEventListener("storage", load);
    window.addEventListener("ot:watch-queue-updated", load as EventListener);
    return () => {
      window.removeEventListener("storage", load);
      window.removeEventListener(
        "ot:watch-queue-updated",
        load as EventListener,
      );
    };
  }, []);

  // "Autoplay next" is a *global* user setting (DB), not per device: the
  // server value seeds the toggle and every flip writes through, so switching
  // it off anywhere keeps it off everywhere. localStorage remains only as a
  // signed-out fallback.
  const updateSettingsMutation = trpc.settings.update.useMutation();
  useEffect(() => {
    if (typeof autoplayNextDefault === "boolean") {
      setAutoplayNext(autoplayNextDefault);
      return;
    }
    try {
      const raw = window.localStorage.getItem("ot:watch-autoplay-next");
      if (raw === "0") setAutoplayNext(false);
      if (raw === "1") setAutoplayNext(true);
    } catch {}
  }, [autoplayNextDefault]);

  const toggleAutoplayNext = useCallback(() => {
    setAutoplayNext((v) => !v);
  }, []);
  const autoplayNextSyncRef = useRef(autoplayNext);
  useEffect(() => {
    if (autoplayNextSyncRef.current === autoplayNext) return;
    autoplayNextSyncRef.current = autoplayNext;
    try {
      window.localStorage.setItem(
        "ot:watch-autoplay-next",
        autoplayNext ? "1" : "0",
      );
    } catch {}
    updateSettingsMutation.mutate(
      { autoplayNext },
      { onError: () => {} }, // signed out: local toggle still applies
    );
  }, [autoplayNext, updateSettingsMutation.mutate]);

  useEffect(() => {
    if (nextCountdown == null) return;
    if (nextCountdown <= 0) {
      if (nextUp && autoplayNext) {
        writeWatchQueue(queue.slice(1));
        window.dispatchEvent(
          new CustomEvent("ot:queue-consume", {
            detail: { videoId: videoIdFromWatchHref(nextUp.href) ?? undefined },
          }),
        );
        router.push(nextUp.href);
      }
      setNextCountdown(null);
      return;
    }
    const t = window.setTimeout(
      () => setNextCountdown((n) => (n ?? 1) - 1),
      1000,
    );
    return () => window.clearTimeout(t);
  }, [nextCountdown, nextUp, autoplayNext, router, queue]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (typeof startAtSeconds === "number" && Number.isFinite(startAtSeconds)) {
      return;
    }
    try {
      const raw = window.sessionStorage.getItem(playbackResumeStorageKey());
      if (!raw) return;
      window.sessionStorage.removeItem(playbackResumeStorageKey());
      const parsed = Number.parseInt(raw, 10);
      if (Number.isFinite(parsed) && parsed >= 0) {
        setResumeSeekSeconds(parsed);
      }
    } catch {}
  }, [startAtSeconds]);

  // A new source starts at its own beginning with the menu closed.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset on a new payload only.
  useEffect(() => {
    setResumeSeekSeconds(undefined);
    setSettingsOpen(false);
  }, [effectivePayload]);

  useEffect(() => {
    const t = window.setTimeout(() => writePlayerVolumeOnly(splitVolume), 200);
    return () => window.clearTimeout(t);
  }, [splitVolume]);

  const active = { kind: "hls" as const, src: effectivePayload.src };

  const effectiveStartAt =
    typeof resumeSeekSeconds === "number" ? resumeSeekSeconds : startAtSeconds;

  const handlePlaybackError = useCallback(() => {
    // A broken short must never reload the whole /shorts page: the full-page
    // location.assign recovery would refetch the feed, drop scroll position and
    // re-buffer (often re-failing into a reload loop). Skip the hard recovery
    // and just advance to the next short, skipping the unplayable one.
    if (shortsMode) {
      onEndedExternal?.();
      return;
    }

    const src = active.src;
    if (src && shouldAutoRecoverPlaybackSource(src)) {
      tryOneShotPlaybackRecovery(src.split("?")[0] ?? src, videoId);
    }
  }, [active.src, onEndedExternal, shortsMode, videoId]);

  const playNextNow = useCallback(() => {
    if (!nextUp) return;
    writeWatchQueue(queue.slice(1));
    window.dispatchEvent(
      new CustomEvent("ot:queue-consume", {
        detail: { videoId: videoIdFromWatchHref(nextUp.href) ?? undefined },
      }),
    );
    router.push(nextUp.href);
  }, [nextUp, router, queue]);

  const handleVideoEnded = useCallback(() => {
    if (shortsMode) {
      onEndedExternal?.();
      return;
    }
    if (!nextUp || !autoplayNext) return;
    setNextCountdown(3);
  }, [shortsMode, onEndedExternal, nextUp, autoplayNext]);

  if (!active.src) return null;

  return (
    <div
      className={cn(
        // Shorts stay transparent so the slide's thumbnail backdrop shows while
        // the video buffers (and behind letterboxing); other modes are black.
        "relative w-full",
        shortsMode
          ? "h-full min-h-0 w-full overflow-hidden border-0 bg-transparent shadow-none ring-0"
          : cinemaMode
            ? "w-full max-w-full overflow-visible border-0 bg-black shadow-2xl ring-1 ring-white/15 sm:rounded-xl"
            : // Normal inline player. Square, borderless on phones (<sm) so the
              // watch-page video reads edge-to-edge; framed rounded card on sm+.
              "overflow-hidden bg-black sm:rounded-xl sm:border sm:border-[hsl(var(--border))] sm:shadow-lg sm:ring-1 sm:ring-black/5",
      )}
    >
      <div
        ref={playerMediaRootRef}
        data-ot-player-root=""
        data-ot-player-video-id={videoId}
        className={cn(
          "relative w-full",
          shortsMode ? "h-full min-h-0" : undefined,
        )}
      >
        {isLive ? (
          <LiveBlock
            {...sponsorChromeProps}
            captions={captions}
            reactKey={active.src}
            src={active.src}
            scrubPreview={buildScrubPreview(active.src) ?? undefined}
            title={title}
            poster={displayPoster}
            settingsOpen={settingsOpen}
            onSettingsOpenChange={setSettingsOpen}
            chapters={chapters}
            startAtSeconds={effectiveStartAt}
            cinemaMode={cinemaMode}
            onExitCinema={exitCinema}
            onToggleCinema={toggleCinema}
            onPlaybackError={handlePlaybackError}
            onEnded={handleVideoEnded}
            nextUp={nextUp}
            queue={queue}
            autoplayNext={autoplayNext}
            onToggleAutoplayNext={toggleAutoplayNext}
            onPlayNext={playNextNow}
            miniMode={miniMode}
            shortsMode={shortsMode}
            miniStartPaused={miniStartPaused}
            autoplay={watchAutoplay}
            restoredVolume={restoredVolume}
            restoredMuted={restoredMuted}
            onVideoIntrinsics={onVideoIntrinsics}
            isLive={isLive}
          />
        ) : (
          <HlsVodBlock
            {...sponsorChromeProps}
            captions={captions}
            reactKey={active.src}
            src={active.src}
            title={title}
            poster={displayPoster}
            scrubPreview={buildScrubPreview(active.src) ?? undefined}
            volume={splitVolume}
            setVolume={setSplitVolume}
            settingsOpen={settingsOpen}
            onSettingsOpenChange={setSettingsOpen}
            chapters={chapters}
            startAtSeconds={effectiveStartAt}
            cinemaMode={cinemaMode}
            onExitCinema={exitCinema}
            onToggleCinema={toggleCinema}
            onPlaybackError={handlePlaybackError}
            onEnded={handleVideoEnded}
            nextUp={nextUp}
            queue={queue}
            autoplayNext={autoplayNext}
            onToggleAutoplayNext={toggleAutoplayNext}
            onPlayNext={playNextNow}
            miniMode={miniMode}
            shortsMode={shortsMode}
            shortsActive={shortsActive}
            miniStartPaused={miniStartPaused}
            autoplay={watchAutoplay}
            restoredVolume={restoredVolume}
            restoredMuted={restoredMuted}
            onVideoIntrinsics={onVideoIntrinsics}
            defaultQualityHeightCap={dashQualityHeightCap}
            fullscreenAutoBestQuality={fullscreenAutoBestQuality}
            dash={effectivePayload.dash}
            dvr={effectivePayload.dvr === true}
          />
        )}
      </div>
      {nextCountdown != null && nextUp ? (
        <div className="absolute right-3 top-3 z-40 rounded-md bg-black/70 px-3 py-1.5 text-xs text-white shadow">
          Next in {nextCountdown}s: {nextUp.title}
        </div>
      ) : null}
    </div>
  );
}
