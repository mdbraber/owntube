"use client";

import type Hls from "hls.js";
import { useCallback, useEffect, useRef, useState } from "react";
import { languageFirstAudioMenuLabel } from "@/lib/audio-track-label";
import {
  buildHlsSameOriginConfig,
  getClientAppOrigin,
  installSameOriginMediaFetchGuard,
} from "@/lib/hls-same-origin";
import { isIosLikeBrowser } from "@/lib/ios-playback";
import { getMediaOrigin } from "@/lib/media-origin";

/**
 * Audio language renditions from the HLS master (one EXT-X-MEDIA per language
 * — see hls/generate.ts). `items` stays empty for single-language videos.
 */
export type HlsVodAudioState = {
  items: { label: string }[];
  index: number;
  setIndex: (i: number) => void;
};

/** WebKit's non-standard `HTMLMediaElement.audioTracks` (native HLS only). */
type NativeAudioTrack = {
  enabled: boolean;
  label: string;
  language: string;
};
type NativeAudioTrackList = {
  length: number;
  [index: number]: NativeAudioTrack;
  addEventListener(type: string, cb: () => void): void;
  removeEventListener(type: string, cb: () => void): void;
};

function nativeAudioTracksOf(
  video: HTMLVideoElement,
): NativeAudioTrackList | null {
  const list = (video as HTMLVideoElement & { audioTracks?: unknown })
    .audioTracks;
  return list ? (list as NativeAudioTrackList) : null;
}

/**
 * Play our server-generated VOD HLS on a plain `<video>`.
 *
 * On Safari/iOS we set `video.src` directly so playback is **native** —
 * hardware-decoded, no MSE. This is the whole point: MSE engines (dash.js,
 * hls.js-on-ManagedMediaSource) stall the video track on iOS while audio keeps
 * playing. Everywhere else we use hls.js. Segments are already same-origin
 * (`/invidious/videoplayback`), so no cross-origin proxying is needed.
 *
 * Returns the audio-language state for the in-player picker, sourced from
 * hls.js's audio-track API or, on the native path, WebKit's `audioTracks`.
 */
export function useHlsVodPlayback(
  videoRef: React.RefObject<HTMLVideoElement | null>,
  src: string,
  streamKey: string,
  startAtSeconds?: number,
  autoPlay = false,
  onFatalError?: () => void,
): HlsVodAudioState {
  const hlsRef = useRef<Hls | null>(null);
  const onFatalErrorRef = useRef(onFatalError);
  onFatalErrorRef.current = onFatalError;
  const startAtRef = useRef(startAtSeconds);
  startAtRef.current = startAtSeconds;
  const autoPlayRef = useRef(autoPlay);
  autoPlayRef.current = autoPlay;
  const [audioItems, setAudioItems] = useState<{ label: string }[]>([]);
  const [audioIndex, setAudioIndex] = useState(0);
  const setAudioImplRef = useRef<(i: number) => void>(() => {});
  const setAudioIndexImperative = useCallback((i: number) => {
    setAudioImplRef.current(i);
  }, []);

  // Start playback when autoplay turns ON after setup. Key case: a pre-warmed
  // shorts slide attaches + buffers while paused (autoplay off), then becomes
  // active (autoplay on) — but MANIFEST_PARSED / loadedmetadata already fired
  // during preload, so their one-shot play attempt is long gone and nothing
  // else would start it. This effect covers the transition (and retries on the
  // next ready event). Muted shorts start fine; the watch page only reaches
  // here when its own autoplay setting is on.
  useEffect(() => {
    if (!autoPlay) return;
    const v = videoRef.current;
    if (!v) return;
    // Auto-play until playback has started ONCE, then stop forcing it. Without
    // this the canplay/loadeddata listeners re-fire whenever the media re-reaches
    // ready — e.g. Safari re-buffering a backgrounded tab — and resume a video
    // the user deliberately paused. Retries stay armed until the first real
    // start (covers autoplay initially blocked, or a pre-warmed shorts slide).
    // A re-attach over an already-playing video (mini-player transitions,
    // host re-activation) counts as started — otherwise no 'playing' event
    // ever fires after mount and the retry stays armed forever.
    let started = !v.paused;
    const markStarted = () => {
      started = true;
    };
    const play = () => {
      if (started) return;
      // Never auto-start an ended video: play() on an ended element restarts
      // it from 0 (the "finished video replays itself" bug — canplay refires
      // around the ended transition and re-triggered this retry).
      if (v.ended) return;
      if (v.paused) void v.play().catch(() => {});
    };
    play();
    v.addEventListener("playing", markStarted);
    v.addEventListener("canplay", play);
    v.addEventListener("loadeddata", play);
    return () => {
      v.removeEventListener("playing", markStarted);
      v.removeEventListener("canplay", play);
      v.removeEventListener("loadeddata", play);
    };
  }, [autoPlay, videoRef]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: streamKey forces a fresh instance when the source swaps without changing the URL.
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !src) return;

    // Fresh source: reset the audio picker until the new manifest reports.
    setAudioItems([]);
    setAudioIndex(0);

    const applyStartAndPlay = () => {
      const start = startAtRef.current;
      if (typeof start === "number" && Number.isFinite(start) && start > 0) {
        try {
          video.currentTime = start;
        } catch {
          /* not seekable yet */
        }
      }
      if (autoPlayRef.current) void video.play().catch(() => {});
    };

    // Native HLS (Safari/iOS) is normally the robust, hardware-decoded path —
    // BUT the macOS media stack (a real Mac, or an iPad in "Request Desktop
    // Website" mode — both report a real, unmanaged `window.MediaSource`)
    // rejects our byte-range fMP4 VOD manifest natively with
    // MEDIA_ERR_SRC_NOT_SUPPORTED. hls.js parses the manifest itself and plays
    // it over real MSE there. So we only take the native path when the browser
    // has NO real MediaSource — i.e. iPhone/iPad-class WebKit that exposes only
    // ManagedMediaSource (where hls.js would fall back to MMS and stall the
    // video track, and where native HLS works). See use-dash-playback for the
    // sibling MMS/MSE notes.
    //
    // iOS/iPadOS always take the native path, though, even when they expose a
    // real MediaSource (iPadOS Safari in its default desktop mode): AirPlay can
    // only hand a native-HLS source to the Apple TV — MSE playback stays local,
    // so casting from hls.js gives a black or silent receiver.
    const hasRealMediaSource =
      typeof window !== "undefined" && "MediaSource" in window;
    const canNative =
      video.canPlayType("application/vnd.apple.mpegurl") !== "" ||
      video.canPlayType("application/x-mpegURL") !== "";
    if (canNative && (isIosLikeBrowser() || !hasRealMediaSource)) {
      // Language renditions surface on WebKit's AudioTrackList. The manifest
      // marks the original DEFAULT=YES (see hls/generate.ts), but iOS's player
      // still starts on a dub matching the system language (an English iPhone
      // got the English auto-dub of a Dutch video). So once per source, when
      // the list first appears, enable the track our manifest names
      // "(Original)"; later changes are the viewer's own choice.
      let startTrackPicked = false;
      const syncNativeAudio = () => {
        const list = nativeAudioTracksOf(video);
        if (!list) return;
        const tracks: NativeAudioTrack[] = [];
        for (let i = 0; i < list.length; i++) {
          const t = list[i];
          if (t) tracks.push(t);
        }
        if (!startTrackPicked && tracks.length > 1) {
          startTrackPicked = true;
          const original = tracks.findIndex((t) =>
            /\(original\)\s*$/i.test(t.label ?? ""),
          );
          if (original >= 0 && !tracks[original]?.enabled) {
            tracks.forEach((t, k) => {
              t.enabled = k === original;
            });
          }
        }
        setAudioItems(
          tracks.length > 1
            ? tracks.map((t, i) => ({
                label: languageFirstAudioMenuLabel({
                  displayName: t.label || null,
                  language: t.language || null,
                  qualityFallback: null,
                  index: i,
                }),
              }))
            : [],
        );
        const enabled = tracks.findIndex((t) => t.enabled);
        if (enabled >= 0) setAudioIndex(enabled);
      };
      setAudioImplRef.current = (i: number) => {
        const list = nativeAudioTracksOf(video);
        if (!list) return;
        for (let k = 0; k < list.length; k++) {
          const t = list[k];
          if (t) t.enabled = k === i;
        }
        setAudioIndex(i);
      };
      const trackEvents = nativeAudioTracksOf(video);
      trackEvents?.addEventListener("addtrack", syncNativeAudio);
      trackEvents?.addEventListener("removetrack", syncNativeAudio);
      trackEvents?.addEventListener("change", syncNativeAudio);
      const onLoaded = () => {
        applyStartAndPlay();
        syncNativeAudio();
      };
      const onError = () => onFatalErrorRef.current?.();
      video.addEventListener("loadedmetadata", onLoaded, { once: true });
      video.addEventListener("error", onError);
      video.src = src;
      video.load();
      return () => {
        setAudioImplRef.current = () => {};
        trackEvents?.removeEventListener("addtrack", syncNativeAudio);
        trackEvents?.removeEventListener("removetrack", syncNativeAudio);
        trackEvents?.removeEventListener("change", syncNativeAudio);
        video.removeEventListener("loadedmetadata", onLoaded);
        video.removeEventListener("error", onError);
        video.removeAttribute("src");
        video.load();
      };
    }

    // hls.js: non-Safari, and Safari on the macOS media stack (real Mac /
    // desktop-mode iPad) where native HLS rejects the manifest. Same-origin
    // config is a harmless no-op for our already-same-origin segments and still
    // proxies any stray CDN URL.
    let cancelled = false;
    let hls: Hls | null = null;
    const mediaOrigin = getMediaOrigin(getClientAppOrigin());
    const releaseFetchGuard = installSameOriginMediaFetchGuard(mediaOrigin);
    void (async () => {
      const { default: HlsCtor } = await import("hls.js");
      if (cancelled || !videoRef.current) return;
      if (!HlsCtor.isSupported()) {
        video.src = src;
        video.addEventListener("loadedmetadata", applyStartAndPlay, {
          once: true,
        });
        return;
      }
      hls = new HlsCtor(buildHlsSameOriginConfig(mediaOrigin));
      hlsRef.current = hls;
      hls.on(HlsCtor.Events.ERROR, (_e, data) => {
        if (data.fatal) onFatalErrorRef.current?.();
      });
      hls.on(HlsCtor.Events.MANIFEST_PARSED, () => applyStartAndPlay());
      // Language renditions from the master's audio group. hls.js starts on
      // the DEFAULT=YES entry (the original — see hls/generate.ts).
      hls.on(HlsCtor.Events.AUDIO_TRACKS_UPDATED, () => {
        const tracks = hls?.audioTracks ?? [];
        setAudioItems(
          tracks.length > 1
            ? tracks.map((t, i) => ({
                label: languageFirstAudioMenuLabel({
                  displayName: t.name || null,
                  language: t.lang || null,
                  qualityFallback: null,
                  index: i,
                }),
              }))
            : [],
        );
        const current = hls?.audioTrack ?? -1;
        if (current >= 0) setAudioIndex(current);
      });
      hls.on(HlsCtor.Events.AUDIO_TRACK_SWITCHED, (_e, data) => {
        setAudioIndex(data.id);
      });
      setAudioImplRef.current = (i: number) => {
        if (hlsRef.current) hlsRef.current.audioTrack = i;
      };
      hls.loadSource(src);
      hls.attachMedia(video);
    })();

    return () => {
      cancelled = true;
      setAudioImplRef.current = () => {};
      releaseFetchGuard();
      hls?.destroy();
      hlsRef.current = null;
      const v = videoRef.current;
      if (v) {
        v.removeAttribute("src");
        v.load();
      }
    };
  }, [videoRef, src, streamKey]);

  return {
    items: audioItems,
    index: audioIndex,
    setIndex: setAudioIndexImperative,
  };
}
