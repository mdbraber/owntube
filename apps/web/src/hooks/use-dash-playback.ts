"use client";

import type { MediaPlayerClass, Representation } from "dashjs";
import { useEffect, useRef } from "react";
import { installSameOriginMediaFetchGuard } from "@/lib/hls-same-origin";
import { isIosLikeBrowser } from "@/lib/ios-playback";

type IsTypeSupported = { isTypeSupported?(type: string): boolean };

function mseCodecSupported(mimeType: string, codecs: string): boolean {
  const type = `${mimeType}; codecs="${codecs}"`;
  const w = window as unknown as {
    MediaSource?: IsTypeSupported;
    ManagedMediaSource?: IsTypeSupported;
  };
  if (w.MediaSource?.isTypeSupported) {
    return w.MediaSource.isTypeSupported(type);
  }
  if (w.ManagedMediaSource?.isTypeSupported) {
    return w.ManagedMediaSource.isTypeSupported(type);
  }
  return true;
}

/**
 * Seeks (and startup) run against a temporary bitrate cap so the first frame
 * at the new position needs only a small segment (~480p) — YouTube's trick
 * for near-instant scrubbing. Once the seek renders, the cap lifts and
 * `fastSwitchEnabled` re-fetches the forward buffer at full quality, so the
 * cheap rung is on screen for well under a second.
 */
const SEEK_FAST_MAX_KBPS = 2000;

const VIDEO_CODEC_RE = /avc1|avc3|av01|vp0?9|vp8|hev1|hvc1|dvh/i;
const MSE_UNDECODABLE_ON_IOS_RE = /av01|vp0?9|vp8/i;

type RepresentationLike = Pick<Representation, "codecs" | "mimeType">;

/**
 * Drop video representations the device can't decode via MSE, so dash.js ABR
 * never strands the video track (frozen video while AAC audio still plays and
 * seeks — the classic iOS symptom).
 *
 * Keyed off `codecs` (not `mimeType`, which dash.js often leaves empty at
 * filter time). Only iOS-family devices get the hard AVC/HEVC clamp — desktop
 * Safari 14.1+ decodes VP9 via MSE just fine, so it (and everything else)
 * gets the honest platform probe, keeping VP9/AV1 where they're decodable.
 */
function videoRepresentationPlayable(rep: RepresentationLike): boolean;
function videoRepresentationPlayable(rep: Representation): boolean;
function videoRepresentationPlayable(rep: RepresentationLike): boolean {
  const codecs = rep?.codecs ?? "";
  if (!codecs || !VIDEO_CODEC_RE.test(codecs)) return true; // audio/unknown: keep
  if (isIosLikeBrowser() && MSE_UNDECODABLE_ON_IOS_RE.test(codecs)) {
    return false;
  }
  // dash.js often leaves mimeType empty at filter time. Guessing a container
  // here is wrong (VP9 probed as video/mp4 fails everywhere, silently dropping
  // the whole video track) — keep the rep and let dash.js's own capability
  // check, which sees the real mimeType, do the filtering.
  if (!rep?.mimeType) return true;
  return mseCodecSupported(rep.mimeType, codecs);
}

/**
 * Attach dash.js to a plain `<video>` element for VOD playback via MSE.
 *
 * YouTube exposes >1080p only as VP9 (WebM) or AV1 video-only streams, which
 * the synthesized HLS manifest cannot carry (hls.js doesn't demux WebM). Our
 * synthesized MPD (`/dash/<id>/manifest.mpd`) lists the full ladder of one
 * codec family; dash.js plays it as a single MSE pipeline, so scrubbing and
 * quality both work — the same engine Invidious's own player uses.
 *
 * The MPD and its segment URLs are same-origin (`/dash/...`,
 * `/invidious/videoplayback...`), so dash.js never touches googlevideo
 * cross-origin. The fetch guard is a belt-and-suspenders fallback for any
 * stray absolute URL.
 */
export function useDashPlayback(
  videoRef: React.RefObject<HTMLVideoElement | null>,
  src: string,
  streamKey: string,
  startAtSeconds?: number,
  autoPlay = false,
  onFatalError?: () => void,
): void {
  const playerRef = useRef<MediaPlayerClass | null>(null);
  // Held in a ref so a new callback identity (parent re-render) does not tear
  // down and rebuild the dash.js instance mid-playback.
  const onFatalErrorRef = useRef(onFatalError);
  onFatalErrorRef.current = onFatalError;
  const startAtRef = useRef(startAtSeconds);
  startAtRef.current = startAtSeconds;
  const autoPlayRef = useRef(autoPlay);
  autoPlayRef.current = autoPlay;

  // biome-ignore lint/correctness/useExhaustiveDependencies: streamKey forces a fresh dash.js instance when the player swaps sources without changing the URL.
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !src) return;

    let cancelled = false;
    let player: MediaPlayerClass | null = null;
    const releaseFetchGuard = installSameOriginMediaFetchGuard();

    void (async () => {
      const mod = await import("dashjs");
      // dashjs ships as CJS/UMD; the factory may sit on the module or `.default`.
      const dashjs = (mod as { default?: typeof mod }).default ?? mod;
      if (cancelled || !videoRef.current) return;

      // iOS 17.1+ Safari plays MSE via ManagedMediaSource (dash.js auto-detects
      // it). Setting `disableRemotePlayback` is the documented requirement so
      // the element isn't offloaded to AirPlay, which MMS can't stream. Harmless
      // elsewhere.
      try {
        video.disableRemotePlayback = true;
      } catch {
        /* older browsers: property may be read-only/absent */
      }

      player = dashjs.MediaPlayer().create();
      // Must be registered before initialize() so unsupported (e.g. AV1 on
      // iPhone) video representations are excluded from ABR.
      player.registerCustomCapabilitiesFilter(videoRepresentationPlayable);
      player.updateSettings({
        streaming: {
          buffer: {
            // Absorb proxied-segment latency; fewer mid-playback stalls.
            bufferTimeAtTopQuality: 30,
            fastSwitchEnabled: true,
          },
          capabilities: {
            // The MediaCapabilities API rejects YouTube's bare "vp9" codec
            // string as ambiguous, silently dropping the whole VP9 ladder
            // (black video, audio keeps playing). isTypeSupported accepts it.
            useMediaCapabilitiesApi: false,
          },
        },
      });
      player.on("error", () => onFatalErrorRef.current?.());

      // Seek-at-low-quality-then-climb (see SEEK_FAST_MAX_KBPS). The initial
      // position also passes through PLAYBACK_SEEKING, so cold starts paint
      // fast too.
      let uncapTimer: number | null = null;
      const capVideoBitrate = (kbps: number) => {
        player?.updateSettings({
          streaming: { abr: { maxBitrate: { video: kbps } } },
        });
      };
      player.on("playbackSeeking", () => {
        if (uncapTimer !== null) window.clearTimeout(uncapTimer);
        uncapTimer = null;
        capVideoBitrate(SEEK_FAST_MAX_KBPS);
      });
      player.on("playbackSeeked", () => {
        if (uncapTimer !== null) window.clearTimeout(uncapTimer);
        // Brief grace so the cheap segment finishes appending before ABR
        // re-plans; fastSwitch then upgrades the forward buffer.
        uncapTimer = window.setTimeout(() => {
          uncapTimer = null;
          capVideoBitrate(-1);
        }, 250);
      });
      capVideoBitrate(SEEK_FAST_MAX_KBPS);
      player.on("playbackPlaying", () => {
        if (uncapTimer !== null) return; // a seek is mid-flight; let it finish
        capVideoBitrate(-1);
      });

      const start = startAtRef.current;
      // Absolute URL: dash.js subsystems (e.g. CmcdController) construct
      // URL objects from the manifest URL and throw on app-relative paths.
      const manifestUrl = new URL(src, window.location.href).toString();
      player.initialize(
        video,
        manifestUrl,
        autoPlayRef.current,
        typeof start === "number" && Number.isFinite(start) && start > 0
          ? start
          : 0,
      );
      playerRef.current = player;
    })();

    return () => {
      cancelled = true;
      releaseFetchGuard();
      try {
        player?.destroy();
      } catch {
        /* dash.js can throw if destroyed before init completes */
      }
      playerRef.current = null;
      const v = videoRef.current;
      if (v) {
        v.removeAttribute("src");
        v.load();
      }
    };
  }, [videoRef, src, streamKey]);
}

/**
 * Pick the best video codec family this browser can MSE-decode, best ladder
 * first: VP9 covers YouTube's full ladder to 2160p on virtually every video;
 * AV1 is denser but only present on some videos; AVC caps at 1080p.
 * `null` means "no MSE here" — stay on the native-HLS path.
 */
export function pickDashVideoFamily(): "vp9" | "av01" | "avc" | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    MediaSource?: IsTypeSupported;
    ManagedMediaSource?: IsTypeSupported;
  };
  const ms = w.MediaSource ?? w.ManagedMediaSource;
  if (!ms?.isTypeSupported) return null;
  if (
    ms.isTypeSupported('video/webm; codecs="vp09.00.50.08"') ||
    ms.isTypeSupported('video/webm; codecs="vp9"')
  ) {
    return "vp9";
  }
  if (ms.isTypeSupported('video/mp4; codecs="av01.0.08M.08"')) return "av01";
  if (ms.isTypeSupported('video/mp4; codecs="avc1.640028"')) return "avc";
  return null;
}
