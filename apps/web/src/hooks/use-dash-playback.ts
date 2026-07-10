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
 * Seeks execute at a cheap rung (highest ≤ this) so the first frame at the
 * new position needs only a small segment — YouTube's trick for near-instant
 * scrubbing. Once the seek renders, quality jumps straight back to what the
 * measured throughput supports and `fastSwitchEnabled` re-fetches the forward
 * buffer, so the soft frame sharpens within a few seconds.
 *
 * Imperative (setRepresentation…, autoSwitchBitrate off/on) rather than a
 * declarative maxBitrate cap: dash.js satisfies a seek with the *current*
 * representation regardless of a cap set at seek time (a 2–3s multi-MB 4K
 * fetch), and after uncapping, a buffer full of cheap segments keeps its ABR
 * parked low for ~10s despite a huge throughput estimate. Measured: capped
 * seeks 2.2–3.7s; imperative seeks ~540ms at 2160p.
 */
const SEEK_FAST_MAX_KBPS = 2000;
/** Headroom factor on measured throughput when jumping back up post-seek. */
const POST_SEEK_THROUGHPUT_SAFETY = 0.7;

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

      // Fast-seek plumbing (see SEEK_FAST_MAX_KBPS). Scrub bursts fire many
      // `playbackSeeking` events — the low rung is forced once, and the jump
      // back up runs debounced after the last `playbackSeeked`.
      const setAutoSwitch = (on: boolean) => {
        player?.updateSettings({
          streaming: { abr: { autoSwitchBitrate: { video: on } } },
        });
      };
      let seekActive = false;
      let jumpTimer: number | null = null;
      player.on("playbackSeeking", () => {
        if (jumpTimer !== null) window.clearTimeout(jumpTimer);
        jumpTimer = null;
        if (seekActive) return;
        try {
          const reps = player?.getRepresentationsByType("video") ?? [];
          let low = -1;
          reps.forEach((r, i) => {
            if (
              r.bitrateInKbit <= SEEK_FAST_MAX_KBPS &&
              (low < 0 || r.bitrateInKbit > (reps[low]?.bitrateInKbit ?? 0))
            ) {
              low = i;
            }
          });
          if (low < 0 || reps.length === 0) return;
          seekActive = true;
          setAutoSwitch(false);
          // forceReplace: the seek-target fragment itself loads at the cheap
          // rung instead of the current (possibly 2160p) representation.
          player?.setRepresentationForTypeByIndex("video", low, true);
        } catch {
          /* before streamInitialized (initial position seek): let ABR run */
        }
      });
      player.on("playbackSeeked", () => {
        if (!seekActive) return;
        if (jumpTimer !== null) window.clearTimeout(jumpTimer);
        jumpTimer = window.setTimeout(() => {
          jumpTimer = null;
          seekActive = false;
          try {
            const reps = player?.getRepresentationsByType("video") ?? [];
            const throughput = player?.getAverageThroughput("video") ?? 0;
            let jump = -1;
            reps.forEach((r, i) => {
              if (
                r.bitrateInKbit < throughput * POST_SEEK_THROUGHPUT_SAFETY &&
                (jump < 0 || r.bitrateInKbit > (reps[jump]?.bitrateInKbit ?? 0))
              ) {
                jump = i;
              }
            });
            if (jump >= 0) {
              player?.setRepresentationForTypeByIndex("video", jump, false);
            }
          } catch {
            /* stream torn down mid-debounce */
          }
          setAutoSwitch(true);
        }, 200);
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
