"use client";

import type {
  ErrorEvent as DashErrorEvent,
  MediaPlayerClass,
  Representation,
} from "dashjs";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  getClientAppOrigin,
  installSameOriginMediaFetchGuard,
} from "@/lib/hls-same-origin";
import { isIosLikeBrowser } from "@/lib/ios-playback";
import { getMediaOrigin } from "@/lib/media-origin";

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
/** Opening ceiling before the portal cap can be computed — see updateSettings. */
const INITIAL_MAX_KBPS = 12000;
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
export type DashQualityState = {
  /**
   * Video representations, keyed by dash.js's own representation `id` (a
   * stable string, e.g. the itag) rather than array position — the live
   * array `getRepresentationsByType` returns is dynamically re-filtered by
   * the current `maxBitrate` cap (confirmed empirically: capping shrinks AND
   * re-indexes it), so array positions captured once go stale the moment the
   * cap changes. IDs stay valid regardless.
   */
  items: { id: string; label: string }[];
  /** id of the representation actually rendering (tracked via qualityChangeRendered, not just the last request). */
  activeId: string | null;
  mode: "auto" | "manual";
  /** `null` reverts to capped auto-ABR; an id pins to that representation (above or below the cap) until the next video. */
  setQuality: (id: string | null) => void;
};

export function useDashPlayback(
  videoRef: React.RefObject<HTMLVideoElement | null>,
  src: string,
  streamKey: string,
  startAtSeconds?: number,
  autoPlay = false,
  onFatalError?: () => void,
  /** Ceiling for auto-ABR (both windowed and fullscreen) — `null` means uncapped. Defaults to 1080p, matching defaultPlaybackQuality's own default. */
  defaultQualityHeightCap: number | null = 1080,
  /** Jump to the single best representation on entering fullscreen, restoring whatever was active on exit. */
  fullscreenAutoBest = false,
): DashQualityState {
  const playerRef = useRef<MediaPlayerClass | null>(null);
  // Held in a ref so a new callback identity (parent re-render) does not tear
  // down and rebuild the dash.js instance mid-playback.
  const onFatalErrorRef = useRef(onFatalError);
  onFatalErrorRef.current = onFatalError;
  const startAtRef = useRef(startAtSeconds);
  startAtRef.current = startAtSeconds;
  const autoPlayRef = useRef(autoPlay);
  autoPlayRef.current = autoPlay;
  const defaultCapRef = useRef(defaultQualityHeightCap);
  defaultCapRef.current = defaultQualityHeightCap;
  const fullscreenAutoBestRef = useRef(fullscreenAutoBest);
  fullscreenAutoBestRef.current = fullscreenAutoBest;

  const [items, setItems] = useState<{ id: string; label: string }[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [mode, setMode] = useState<"auto" | "manual">("auto");
  // Imperative escape hatch the effect below wires up once the dash.js
  // instance exists; `setQuality` itself has a stable identity across
  // re-renders so it's safe for consumers to pass directly as a prop/callback.
  const setQualityImplRef = useRef<(id: string | null) => void>(() => {});
  const setQuality = useCallback((id: string | null) => {
    setQualityImplRef.current(id);
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: streamKey forces a fresh dash.js instance when the player swaps sources without changing the URL.
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !src) return;

    let cancelled = false;
    let player: MediaPlayerClass | null = null;
    let portalObserver: ResizeObserver | null = null;
    let onFullscreenChange: (() => void) | null = null;
    const mediaOrigin = getMediaOrigin(getClientAppOrigin());
    const releaseFetchGuard = installSameOriginMediaFetchGuard(mediaOrigin);

    // Fresh source: reset the UI-facing quality state; repopulated once the
    // new manifest parses (streamInitialized).
    setItems([]);
    setActiveId(null);
    setMode("auto");
    type QualityInternalState =
      | { mode: "auto" }
      | { mode: "manual"; id: string };
    const qualityStateRef: { current: QualityInternalState } = {
      current: { mode: "auto" },
    };
    // Snapshot of whatever was active before a fullscreen-auto-best boost, so
    // exiting fullscreen restores it exactly (a prior manual pin, not just "auto").
    let preFullscreenSnapshot: QualityInternalState | null = null;

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
          // dash.js's default (20s) is shorter than our own proxy's resilience
          // budget for a stalled Invidious/googlevideo fetch (up to ~45s across
          // fetchUpstreamWithRetry's 3 attempts, more for a multi-chunk segment
          // via chunkedMediaBody's resume logic — see /invidious route). When
          // the client times out first it aborts and restarts the segment from
          // scratch, which is the visible stutter — even though the proxy was
          // likely about to deliver it. Give the client enough patience for the
          // proxy's own retries to land instead of racing them.
          fragmentRequestTimeout: 35_000,
          // ABR is portal-capped via maxBitrate (see portalCapKbps below), not
          // limitBitrateByPortal: the built-in limit allows only rungs that FIT
          // the portal (360p in a 633px player — visibly soft); the cap below
          // allows the smallest rung that COVERS it (YouTube's behavior).
          abr: {
            // The portal cap can only be computed once representations exist
            // (streamInitialized). Until then ABR is free, and on a LAN it
            // opens at the top rung — a 36Mbps 2160p source starts fetching
            // multi-MB segments and decoding 4K before the cap lands, which
            // stalls the first seeks. Start under a windowed-1080p ceiling;
            // portalCapKbps then refines it (and lifts it in fullscreen).
            maxBitrate: { video: INITIAL_MAX_KBPS },
          },
          buffer: {
            // Bounds the post-seek refill burst: fastSwitch re-fetches this
            // much forward buffer at top quality (22Mbps 2160p ≈ 2.7MB/s), and
            // while that burst saturates the downlink every small fetch a
            // subsequent seek needs queues behind it in the AP/link buffers.
            // 30s (≈80MB burst, ~9s of saturated Wi-Fi) made rapid re-seeks
            // stall for seconds; 12s kept ~4× real-time headroom against
            // stalls while the burst clears in ~3s.
            // EXPERIMENT (see chat): 20s — a smaller step up than the
            // already-rejected 30s, trading some of that rapid-re-seek
            // headroom for a deeper "already buffered, seeks locally" window
            // during normal forward playback. Watch specifically for stalls
            // on RAPID back-to-back seeks (scrub-heavy use), which is the
            // exact case 12s was originally chosen to protect.
            bufferTimeAtTopQuality: 20,
            fastSwitchEnabled: true,
          },
          capabilities: {
            // The MediaCapabilities API rejects YouTube's bare "vp9" codec
            // string as ambiguous, silently dropping the whole VP9 ladder
            // (black video, audio keeps playing). isTypeSupported accepts it.
            useMediaCapabilitiesApi: false,
          },
          text: {
            // The manifest carries caption AdaptationSets for ExoPlayer on the
            // TV, but the web renders captions from its own <track> elements.
            // Left on, dash.js auto-enables a text track and draws a second,
            // always-on caption. Never let it own text rendering here.
            defaultEnabled: false,
          },
        },
      });
      player.on("error", (e: DashErrorEvent) => {
        // Caption tracks routinely 404 (self-hosted Invidious behind a
        // residential IP gets blocked fetching YouTube's timedtext — see
        // captions/[videoId]/route.ts) and the web player doesn't even render
        // dash.js's own text tracks (defaultEnabled: false above; captions
        // come from <track> instead). A failed "cc" track must not tear down
        // an otherwise-healthy video/audio pipeline.
        if (e.error === "cc") return;
        onFatalErrorRef.current?.();
      });

      // Fast-seek plumbing (see SEEK_FAST_MAX_KBPS). Scrub bursts fire many
      // `playbackSeeking` events — the low rung is forced once, and the jump
      // back up runs debounced after the last `playbackSeeked`.
      const setAutoSwitch = (on: boolean) => {
        player?.updateSettings({
          streaming: { abr: { autoSwitchBitrate: { video: on } } },
        });
      };

      // The FULL video ladder, captured once at streamInitialized while the
      // opening cap is still generous (INITIAL_MAX_KBPS). Empirically,
      // `getRepresentationsByType` is NOT a static manifest snapshot — it's
      // dynamically re-filtered (and re-indexed!) by the current maxBitrate
      // cap. Recomputing "what's the best available rung" against that live,
      // possibly-already-shrunk array would only ever see what a PREVIOUS cap
      // allowed, unable to discover a higher rung to promote back to — so all
      // "what representations exist" reasoning below uses this static cache
      // instead; only the actual switch call touches the live, cap-filtered
      // array (and only after lifting the cap so the target is present in it).
      let allVideoReps: Representation[] = [];
      // Don't decode more pixels than the player shows: LAN throughput always
      // says "top rung", but 4K VP9 decode freezes the main thread for seconds
      // (observed 13s seeked delays, and multi-second scrubs on 36Mbps videos)
      // and each rung step roughly doubles the buffer-refill burst. Cap ABR at
      // the cheapest rung whose height covers the portal, ALSO bounded by
      // defaultCapRef (the user's default-quality setting, e.g. 1080p) — in
      // both windowed and fullscreen. Fullscreen no longer auto-lifts this on
      // its own (it used to); a display that wants higher than the default
      // needs either a manual pick or the fullscreen-auto-best setting, both
      // of which bypass this function entirely (see qualityStateRef).
      const portalCapKbps = (): number => {
        try {
          const rect = video.getBoundingClientRect();
          const cssPortalH = Math.max(rect.height, (rect.width * 9) / 16);
          const wanted = cssPortalH * (window.devicePixelRatio || 1);
          const heightCeiling =
            defaultCapRef.current ?? Number.POSITIVE_INFINITY;
          const portalH = Math.min(wanted, heightCeiling);
          if (!(portalH > 0)) return -1;
          let cap = -1;
          let capHeight = Number.POSITIVE_INFINITY;
          for (const r of allVideoReps) {
            if (!r.height || !r.bitrateInKbit) continue;
            if (r.height >= portalH && r.height < capHeight) {
              capHeight = r.height;
              cap = r.bitrateInKbit;
            }
          }
          return cap; // -1 (no limit) when no rung covers the portal
        } catch {
          return -1;
        }
      };
      // Only auto-mode should be touched by resize/fullscreen/streamInit —
      // a manual pin (direct pick or a fullscreen-auto-best boost) must not
      // get silently overridden by these.
      const applyPortalCap = () => {
        if (qualityStateRef.current.mode !== "auto") return;
        player?.updateSettings({
          streaming: { abr: { maxBitrate: { video: portalCapKbps() } } },
        });
      };
      const bestRepresentationId = (): string | null => {
        let best: Representation | null = null;
        for (const r of allVideoReps) {
          if (!best || r.bitrateInKbit > best.bitrateInKbit) best = r;
        }
        return best?.id ?? null;
      };
      /** Live index of a representation id — only meaningful right after
       *  lifting the cap, since the live array is filtered by whatever
       *  maxBitrate is currently set. */
      const liveIndexForId = (id: string): number => {
        const liveReps = player?.getRepresentationsByType("video") ?? [];
        return liveReps.findIndex((r) => r.id === id);
      };
      /** The single place that actually changes what's rendering — used by
       *  the public setQuality(), and internally by fullscreen-auto-best. */
      const applyQuality = (id: string | null) => {
        if (!player) return;
        if (id === null) {
          qualityStateRef.current = { mode: "auto" };
          setAutoSwitch(true);
          applyPortalCap();
        } else {
          qualityStateRef.current = { mode: "manual", id };
          setAutoSwitch(false);
          // Lift the cap FIRST — the target representation only exists in
          // the live array once nothing is filtering it out.
          player.updateSettings({
            streaming: { abr: { maxBitrate: { video: -1 } } },
          });
          const liveIndex = liveIndexForId(id);
          if (liveIndex >= 0) {
            player.setRepresentationForTypeByIndex("video", liveIndex, true);
          }
        }
        setMode(qualityStateRef.current.mode);
      };
      setQualityImplRef.current = applyQuality;
      player.on("streamInitialized", () => {
        allVideoReps = player?.getRepresentationsByType("video") ?? [];
        setItems(
          allVideoReps.map((r) => ({
            id: r.id,
            label: r.height ? `${r.height}p` : "?",
          })),
        );
        applyPortalCap();
      });
      player.on("qualityChangeRendered", (e) => {
        if (e.mediaType !== "video" || !e.newRepresentation) return;
        setActiveId(e.newRepresentation.id);
      });
      if (typeof ResizeObserver !== "undefined") {
        portalObserver = new ResizeObserver(applyPortalCap);
        portalObserver.observe(video);
      }
      // Entering/leaving fullscreen may not resize the element (it can already
      // fill its shell), so the observer alone would miss the cap change. Also
      // drives the fullscreen-auto-best boost/restore.
      const handleFullscreenChange = () => {
        const fullscreen = Boolean(
          document.fullscreenElement ??
            (
              video as HTMLVideoElement & {
                webkitDisplayingFullscreen?: boolean;
              }
            ).webkitDisplayingFullscreen,
        );
        if (fullscreen && fullscreenAutoBestRef.current) {
          preFullscreenSnapshot = qualityStateRef.current;
          const best = bestRepresentationId();
          if (best !== null) applyQuality(best);
          return;
        }
        if (!fullscreen && preFullscreenSnapshot) {
          const snapshot = preFullscreenSnapshot;
          preFullscreenSnapshot = null;
          applyQuality(snapshot.mode === "manual" ? snapshot.id : null);
          return;
        }
        applyPortalCap();
      };
      document.addEventListener("fullscreenchange", handleFullscreenChange);
      onFullscreenChange = handleFullscreenChange;
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
            if (qualityStateRef.current.mode === "manual") {
              // A manual pick (or a fullscreen-auto-best boost) must survive
              // the seek's cheap-rung softening — jump back to exactly that
              // representation instead of the throughput-based auto jump.
              // Re-resolve the live index by id rather than trusting a index
              // captured earlier — maxBitrate dynamically re-filters (and
              // re-indexes) the array dash.js exposes.
              const liveIndex = liveIndexForId(qualityStateRef.current.id);
              if (liveIndex >= 0) {
                player?.setRepresentationForTypeByIndex(
                  "video",
                  liveIndex,
                  false,
                );
              }
            } else {
              const reps = player?.getRepresentationsByType("video") ?? [];
              const throughput = player?.getAverageThroughput("video") ?? 0;
              // Mirror the portal cap for this imperative jump — it bypasses
              // ABR, so without it the jump lands on 2160p in a small player
              // and the capped autoSwitch immediately re-switches away.
              const capKbps = portalCapKbps();
              let jump = -1;
              reps.forEach((r, i) => {
                if (capKbps > 0 && r.bitrateInKbit > capKbps) return;
                if (
                  r.bitrateInKbit < throughput * POST_SEEK_THROUGHPUT_SAFETY &&
                  (jump < 0 ||
                    r.bitrateInKbit > (reps[jump]?.bitrateInKbit ?? 0))
                ) {
                  jump = i;
                }
              });
              if (jump >= 0) {
                player?.setRepresentationForTypeByIndex("video", jump, false);
              }
            }
          } catch {
            /* stream torn down mid-debounce */
          }
          // Only auto mode should have dash.js's own ABR re-enabled — a
          // manual/fullscreen-boost pin must stay pinned through the seek.
          if (qualityStateRef.current.mode === "auto") setAutoSwitch(true);
        }, 200);
      });

      const start = startAtRef.current;
      // Absolute URL: dash.js subsystems (e.g. CmcdController) construct URL
      // objects from the manifest URL and throw on app-relative paths. Base
      // against the media origin (not window.location.href) so a
      // still-relative `src` resolves there, not the page's own origin.
      const manifestUrl = new URL(src, mediaOrigin).toString();
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
      portalObserver?.disconnect();
      if (onFullscreenChange) {
        document.removeEventListener("fullscreenchange", onFullscreenChange);
      }
      setQualityImplRef.current = () => {};
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

  return { items, activeId, mode, setQuality };
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
