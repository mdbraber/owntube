"use client";

import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { NativeMuxedBlock } from "@/components/player/native-block";
import type { VideoPlayerPayload } from "@/components/player/player-payload";
import {
  initialQualityIndexForPayload,
  progressiveQualityMenuFromPayload,
} from "@/components/player/player-quality";
import {
  MAX_VARIANT_FALLBACK_ATTEMPTS,
  playbackResumeStorageKey,
  shouldAutoRecoverPlaybackSource,
  tryLiveUpstreamFallback,
  tryOneShotPlaybackRecovery,
} from "@/components/player/player-recovery";
import type { SponsorBlockChromeProps } from "@/components/player/player-types";
import { SplitBlock } from "@/components/player/split-block";
import { VidstackBlock } from "@/components/player/vidstack-block";
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
  readDefaultPlaybackQuality,
} from "@/lib/default-playback-quality";
import { isDirectProgressiveVideoUrl } from "@/lib/media-source-from-url";
import { nextPlaybackVariantIndex } from "@/lib/playback-variant-fallback";
import {
  readPlayerMediaPrefs,
  writePlayerVolumeOnly,
} from "@/lib/player-media-prefs";
import type { SponsorBlockPrefs } from "@/lib/sponsorblock-prefs";
import { cn } from "@/lib/utils";
import type { VideoChapter } from "@/lib/video-chapters";
import {
  clearWatchMiniStateForOtherVideo,
  readWatchMiniEnabled,
  type WatchMiniPayload,
  writeWatchMiniState,
} from "@/lib/watch-mini-player-state";
import type { VideoStoryboard } from "@/server/services/proxy.types";

export type { VideoPlayerPayload };

type VideoPlayerProps = {
  videoId: string;
  payload: VideoPlayerPayload;
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
  /** Called when playback reaches the end (Shorts auto-advance). */
  onEnded?: () => void;
  /** Fired when the &lt;video&gt; element exposes intrinsic dimensions. */
  onVideoIntrinsics?: (width: number, height: number) => void;
  defaultPlaybackQuality?: DefaultPlaybackQuality;
  /** Persist playback snapshot for the in-app mini player (watch page, logged-in). */
  persistMiniSnapshot?: boolean;
  /** Resume quality rung when restoring from mini player state. */
  initialQualityIndex?: number;
  /** Volume / mute captured at handoff from watch (optional). */
  restoredVolume?: number;
  restoredMuted?: boolean;
  /** Mini player: do not autoplay (user left watch while paused). */
  miniStartPaused?: boolean;
  /** Start playing as soon as the watch page loads (user setting). */
  autoplayOnWatch?: boolean;
  /** Server-backed SponsorBlock prefs (watch page); falls back to localStorage. */
  sponsorBlockPrefs?: SponsorBlockPrefs;
  /** Active live HLS broadcast — live chrome, no SponsorBlock/scrub preview. */
  isLive?: boolean;
  /** Upstream that produced the current playback URL (live fallback). */
  playbackSourceUsed?: "piped" | "invidious";
};

/* ------------------------------- Top level ------------------------------- */

export function VideoPlayer({
  videoId,
  payload,
  title,
  poster,
  chapters = [],
  startAtSeconds,
  durationSeconds,
  storyboard,
  scrubPreviewStreamSrc,
  miniMode = false,
  shortsMode = false,
  onEnded: onEndedExternal,
  onVideoIntrinsics,
  defaultPlaybackQuality: defaultPlaybackQualityProp,
  persistMiniSnapshot = false,
  initialQualityIndex: initialQualityIndexProp,
  restoredVolume,
  restoredMuted,
  miniStartPaused = false,
  autoplayOnWatch = false,
  sponsorBlockPrefs: sponsorBlockPrefsProp,
  isLive = false,
  playbackSourceUsed,
}: VideoPlayerProps) {
  const playerMediaRootRef = useRef<HTMLDivElement>(null);
  // Autoplay on the full watch page only (never in the mini player or Shorts,
  // which have their own autoplay semantics).
  const watchAutoplay = autoplayOnWatch && !miniMode && !shortsMode;
  const scrubFrames = useScrubFramePreview({
    videoId,
    durationSeconds: isLive ? undefined : durationSeconds,
    storyboard: isLive ? undefined : storyboard,
    scrubPreviewStreamSrc: isLive ? undefined : scrubPreviewStreamSrc,
  });
  const buildScrubPreview = useCallback(
    (streamSrc: string): ScrubPreviewConfig | null => {
      if (isLive) return null;
      return mergeScrubPreview(
        scrubPreviewStreamSrc ?? streamSrc,
        poster,
        scrubFrames.primeFrames,
        scrubFrames.frameAt,
      );
    },
    [
      isLive,
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
  const pathname = usePathname();
  const router = useRouter();
  const watchCinema = useWatchCinema();
  const [localCinema, setLocalCinema] = useState(false);
  const cinemaMode = watchCinema ? watchCinema.cinemaMode : localCinema;
  const setCinemaMode = watchCinema
    ? watchCinema.setCinemaMode
    : setLocalCinema;
  const exitCinema = useCallback(() => setCinemaMode(false), [setCinemaMode]);
  const toggleCinema = useCallback(
    () => setCinemaMode((v) => !v),
    [setCinemaMode],
  );

  const effectivePayload: VideoPlayerPayload = payload;

  const displayPoster = shortsMode ? undefined : poster;

  const progressive =
    effectivePayload.mode === "progressive" ? effectivePayload.variants : null;
  const progressiveMobileSafe = progressive;
  const resolvedDefaultQuality =
    defaultPlaybackQualityProp ??
    (typeof window === "undefined"
      ? DEFAULT_PLAYBACK_QUALITY
      : readDefaultPlaybackQuality());
  const [qualityIndex, setQualityIndex] = useState(() => {
    if (
      typeof initialQualityIndexProp === "number" &&
      Number.isFinite(initialQualityIndexProp) &&
      initialQualityIndexProp >= 0
    ) {
      return Math.floor(initialQualityIndexProp);
    }
    return initialQualityIndexForPayload(
      effectivePayload,
      resolvedDefaultQuality,
    );
  });
  const variantFallbackAttemptsRef = useRef(0);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const progressiveQualityMenu = useMemo(
    () => progressiveQualityMenuFromPayload(effectivePayload, qualityIndex),
    [effectivePayload, qualityIndex],
  );
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
  const [autoplayNext, setAutoplayNext] = useState(true);
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

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem("ot:watch-autoplay-next");
      if (raw === "0") setAutoplayNext(false);
      if (raw === "1") setAutoplayNext(true);
    } catch {}
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(
        "ot:watch-autoplay-next",
        autoplayNext ? "1" : "0",
      );
    } catch {}
  }, [autoplayNext]);

  useEffect(() => {
    if (nextCountdown == null) return;
    if (nextCountdown <= 0) {
      if (nextUp && autoplayNext) {
        writeWatchQueue(queue.slice(1));
        window.dispatchEvent(
          new CustomEvent("ot:queue-consume", {
            detail: { videoId: nextUp.href.split("/watch/")[1]?.split("?")[0] },
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

  const setQualityWithResume = useCallback(
    (i: number, seekSeconds?: number) => {
      const nextSeek =
        typeof seekSeconds === "number" && Number.isFinite(seekSeconds)
          ? Math.max(0, seekSeconds)
          : undefined;
      setResumeSeekSeconds(nextSeek);
      setQualityIndex(i);
    },
    [],
  );

  useEffect(() => {
    if (
      miniMode &&
      typeof initialQualityIndexProp === "number" &&
      Number.isFinite(initialQualityIndexProp)
    ) {
      return;
    }
    const pref = defaultPlaybackQualityProp ?? readDefaultPlaybackQuality();
    setQualityIndex(initialQualityIndexForPayload(effectivePayload, pref));
    setResumeSeekSeconds(undefined);
    setSettingsOpen(false);
    variantFallbackAttemptsRef.current = 0;
  }, [
    effectivePayload,
    defaultPlaybackQualityProp,
    initialQualityIndexProp,
    miniMode,
  ]);

  useEffect(() => {
    if (!progressiveMobileSafe || progressiveMobileSafe.length === 0) return;
    if (qualityIndex < progressiveMobileSafe.length) return;
    setQualityIndex(0);
  }, [progressiveMobileSafe, qualityIndex]);

  useEffect(() => {
    const t = window.setTimeout(() => writePlayerVolumeOnly(splitVolume), 200);
    return () => window.clearTimeout(t);
  }, [splitVolume]);

  const active = useMemo(() => {
    if (effectivePayload.mode === "hls") {
      return { kind: "hls" as const, src: effectivePayload.src };
    }
    const v = progressiveMobileSafe?.[qualityIndex];
    if (v) {
      return { kind: "variant" as const, v };
    }
    return { kind: "empty" as const };
  }, [effectivePayload, progressiveMobileSafe, qualityIndex]);

  const effectiveStartAt =
    typeof resumeSeekSeconds === "number" ? resumeSeekSeconds : startAtSeconds;

  const handlePlaybackError = useCallback(() => {
    if (
      isLive &&
      playbackSourceUsed &&
      tryLiveUpstreamFallback(playbackSourceUsed, videoId)
    ) {
      return;
    }

    if (
      effectivePayload.mode === "progressive" &&
      progressiveMobileSafe &&
      progressiveMobileSafe.length > 1
    ) {
      const maxAttempts = Math.min(
        progressiveMobileSafe.length - 1,
        MAX_VARIANT_FALLBACK_ATTEMPTS,
      );
      if (variantFallbackAttemptsRef.current < maxAttempts) {
        const nextIdx = nextPlaybackVariantIndex(
          qualityIndex,
          progressiveMobileSafe.length,
        );
        if (nextIdx !== null) {
          variantFallbackAttemptsRef.current += 1;
          const media = playerMediaRootRef.current?.querySelector("video");
          const currentTime =
            media && Number.isFinite(media.currentTime) ? media.currentTime : 0;
          setQualityWithResume(
            nextIdx,
            currentTime > 0 ? currentTime : undefined,
          );
          return;
        }
      }
    }

    // A broken short must never reload the whole /shorts page: the full-page
    // location.assign recovery would refetch the feed, drop scroll position and
    // re-buffer (often re-failing into a reload loop). Skip the hard recovery
    // and just advance to the next short, skipping the unplayable one.
    if (shortsMode) {
      onEndedExternal?.();
      return;
    }

    const candidates: string[] = [];
    if (active.kind === "hls" && active.src) {
      candidates.push(active.src);
    } else if (active.kind === "variant") {
      if (active.v.t === "muxed") {
        candidates.push(active.v.src);
      } else {
        candidates.push(active.v.video, active.v.audio);
      }
    }
    for (const src of candidates) {
      if (!src || !shouldAutoRecoverPlaybackSource(src)) continue;
      const recoveryKey = src.split("?")[0] ?? src;
      if (tryOneShotPlaybackRecovery(recoveryKey, videoId)) return;
    }
  }, [
    active,
    effectivePayload.mode,
    isLive,
    onEndedExternal,
    playbackSourceUsed,
    progressiveMobileSafe,
    qualityIndex,
    setQualityWithResume,
    shortsMode,
    videoId,
  ]);

  const playNextNow = useCallback(() => {
    if (!nextUp) return;
    writeWatchQueue(queue.slice(1));
    window.dispatchEvent(
      new CustomEvent("ot:queue-consume", {
        detail: { videoId: nextUp.href.split("/watch/")[1]?.split("?")[0] },
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

  const snapshotPayloadForMini = useMemo((): WatchMiniPayload | null => {
    if (effectivePayload.mode === "hls") {
      return { mode: "hls", src: effectivePayload.src };
    }
    if (
      effectivePayload.mode === "progressive" &&
      effectivePayload.variants.length > 0
    ) {
      return {
        mode: "progressive",
        variants: effectivePayload.variants,
      };
    }
    return null;
  }, [effectivePayload]);

  useEffect(() => {
    if (!persistMiniSnapshot) return;
    clearWatchMiniStateForOtherVideo(videoId);
  }, [persistMiniSnapshot, videoId]);

  useEffect(() => {
    if (!pathname.startsWith("/watch/")) return;
    if (!persistMiniSnapshot) return;
    if (!readWatchMiniEnabled(true)) return;
    if (!snapshotPayloadForMini) return;

    const getWatchVideo = () =>
      playerMediaRootRef.current?.querySelector(
        "video",
      ) as HTMLVideoElement | null;

    const saveSnapshot = (target: HTMLVideoElement | null) => {
      if (!target) return;
      const currentTime = Number.isFinite(target.currentTime)
        ? Math.max(0, target.currentTime)
        : 0;
      const prefs = readPlayerMediaPrefs();
      writeWatchMiniState({
        videoId,
        title,
        poster,
        payload: snapshotPayloadForMini,
        currentTime,
        qualityIndex,
        volume: prefs.volume,
        muted: prefs.muted,
        paused: target.paused,
      });
    };

    const onTimeUpdate = () => {
      saveSnapshot(getWatchVideo());
    };
    const onPause = () => {
      saveSnapshot(getWatchVideo());
    };
    const onPageHide = () => {
      saveSnapshot(getWatchVideo());
    };

    const media = getWatchVideo();
    media?.addEventListener("timeupdate", onTimeUpdate);
    media?.addEventListener("pause", onPause);
    window.addEventListener("pagehide", onPageHide);

    return () => {
      media?.removeEventListener("timeupdate", onTimeUpdate);
      media?.removeEventListener("pause", onPause);
      window.removeEventListener("pagehide", onPageHide);
      saveSnapshot(getWatchVideo());
    };
  }, [
    pathname,
    persistMiniSnapshot,
    poster,
    qualityIndex,
    snapshotPayloadForMini,
    title,
    videoId,
  ]);

  if (active.kind === "empty") return null;
  if (active.kind === "hls" && !active.src) return null;
  if (active.kind === "variant" && !active.v) return null;

  return (
    <div
      className={cn(
        "relative w-full bg-black",
        shortsMode
          ? "relative h-full min-h-0 w-full overflow-hidden border-0 shadow-none ring-0"
          : cinemaMode
            ? "w-full max-w-full overflow-visible border-0 shadow-2xl ring-1 ring-white/15 sm:rounded-xl"
            : "overflow-hidden rounded-xl border border-[hsl(var(--border))] shadow-lg ring-1 ring-black/5",
      )}
    >
      <div
        ref={playerMediaRootRef}
        className={cn(
          "relative w-full",
          shortsMode ? "h-full min-h-0" : undefined,
        )}
      >
        {active.kind === "hls" ? (
          <VidstackBlock
            {...sponsorChromeProps}
            reactKey={active.src}
            src={active.src}
            scrubPreview={buildScrubPreview(active.src) ?? undefined}
            title={title}
            poster={displayPoster}
            progressiveQualityMenu={progressiveQualityMenu}
            setQualityIndex={setQualityWithResume}
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
            onToggleAutoplayNext={() => setAutoplayNext((v) => !v)}
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
        ) : null}
        {active.kind === "variant" && active.v.t === "muxed" ? (
          isDirectProgressiveVideoUrl(active.v.src) || shortsMode ? (
            <NativeMuxedBlock
              {...sponsorChromeProps}
              reactKey={active.v.src}
              src={active.v.src}
              scrubPreview={buildScrubPreview(active.v.src) ?? undefined}
              title={title}
              poster={displayPoster}
              volume={splitVolume}
              setVolume={setSplitVolume}
              progressiveQualityMenu={progressiveQualityMenu}
              setQualityIndex={setQualityWithResume}
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
              onToggleAutoplayNext={() => setAutoplayNext((v) => !v)}
              onPlayNext={playNextNow}
              miniMode={miniMode}
              shortsMode={shortsMode}
              miniStartPaused={miniStartPaused}
              restoredVolume={restoredVolume}
              restoredMuted={restoredMuted}
              onVideoIntrinsics={onVideoIntrinsics}
              isLive={isLive}
            />
          ) : (
            <VidstackBlock
              {...sponsorChromeProps}
              reactKey={active.v.src}
              src={active.v.src}
              scrubPreview={buildScrubPreview(active.v.src) ?? undefined}
              title={title}
              poster={displayPoster}
              progressiveQualityMenu={progressiveQualityMenu}
              setQualityIndex={setQualityWithResume}
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
              onToggleAutoplayNext={() => setAutoplayNext((v) => !v)}
              onPlayNext={playNextNow}
              miniMode={miniMode}
              shortsMode={shortsMode}
              miniStartPaused={miniStartPaused}
              restoredVolume={restoredVolume}
              restoredMuted={restoredMuted}
              onVideoIntrinsics={onVideoIntrinsics}
              isLive={isLive}
            />
          )
        ) : null}
        {active.kind === "variant" && active.v.t === "split" ? (
          <SplitBlock
            {...sponsorChromeProps}
            key={active.v.video}
            video={active.v.video}
            scrubPreview={buildScrubPreview(active.v.video) ?? undefined}
            audioTracks={active.v.audioTracks}
            defaultAudioIndex={active.v.defaultAudioIndex}
            poster={displayPoster}
            title={title}
            volume={splitVolume}
            setVolume={setSplitVolume}
            progressiveQualityMenu={progressiveQualityMenu}
            setQualityIndex={setQualityWithResume}
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
            onToggleAutoplayNext={() => setAutoplayNext((v) => !v)}
            onPlayNext={playNextNow}
            miniMode={miniMode}
            shortsMode={shortsMode}
            miniStartPaused={miniStartPaused}
            restoredVolume={restoredVolume}
            restoredMuted={restoredMuted}
            onVideoIntrinsics={onVideoIntrinsics}
            isLive={isLive}
          />
        ) : null}
      </div>
      {nextCountdown != null && nextUp ? (
        <div className="absolute right-3 top-3 z-40 rounded-md bg-black/70 px-3 py-1.5 text-xs text-white shadow">
          Next in {nextCountdown}s: {nextUp.title}
        </div>
      ) : null}
    </div>
  );
}
