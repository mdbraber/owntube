"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { PlayerAdapter } from "@/components/player/player-types";
import { attachPeakLimiter, resumePeakLimiter } from "@/lib/audio-peak-limiter";
import { volumeGainFor } from "@/lib/player-volume-gain";

export function useNativeAdapter(opts: {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  audioRef: React.RefObject<HTMLAudioElement | null>;
  externalVolume: number;
  setExternalVolume: (n: number) => void;
  /** Initial mute state (shorts seed this from the shared audio pref). */
  initialMuted?: boolean;
}): PlayerAdapter {
  const { videoRef, audioRef, externalVolume, setExternalVolume } = opts;
  const [, force] = useState(0);
  const bump = useCallback(() => force((x) => x + 1), []);
  const [muted, setMuted] = useState(opts.initialMuted ?? false);
  const [pictureInPicture, setPictureInPicture] = useState(false);
  const limiterActiveRef = useRef(false);
  const activatedRef = useRef(false);

  // The audible element is the companion <audio> when present (the <video> is
  // muted in split mode), otherwise the muxed <video> itself. Attach the peak
  // limiter to it once the user has activated playback.
  const ensureLimiter = useCallback(() => {
    if (!activatedRef.current) return;
    if (!limiterActiveRef.current) {
      const el = audioRef.current ?? videoRef.current;
      limiterActiveRef.current = attachPeakLimiter(el);
    }
    if (limiterActiveRef.current) resumePeakLimiter();
  }, [audioRef, videoRef]);

  const syncCompanionVolume = useCallback(
    (overrides?: { muted?: boolean; volumeUi?: number }) => {
      const v = videoRef.current;
      const a = audioRef.current;
      if (!a) return;
      const m = overrides?.muted ?? muted;
      const volUi = overrides?.volumeUi ?? externalVolume;
      const rate = v?.playbackRate ?? 1;
      try {
        a.muted = m;
        a.volume = m
          ? 0
          : Math.min(1, volumeGainFor(volUi, rate, limiterActiveRef.current));
      } catch {
        /* ignore */
      }
    },
    [videoRef, audioRef, externalVolume, muted],
  );

  const applyVideoElementVolume = useCallback(
    (overrides?: { muted?: boolean; volumeUi?: number }) => {
      const v = videoRef.current;
      if (!v) return;
      const m = overrides?.muted ?? muted;
      const volUi = overrides?.volumeUi ?? externalVolume;
      const rate = v.playbackRate ?? 1;
      try {
        v.muted = m || volUi <= 0;
        if (!v.muted) {
          v.volume = Math.min(
            1,
            volumeGainFor(volUi, rate, limiterActiveRef.current),
          );
        }
      } catch {
        /* ignore */
      }
    },
    [videoRef, externalVolume, muted],
  );

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    syncCompanionVolume();
    if (!audioRef.current) applyVideoElementVolume();
    const onRate = () => {
      syncCompanionVolume();
      if (!audioRef.current) applyVideoElementVolume();
    };
    v.addEventListener("ratechange", onRate);
    return () => v.removeEventListener("ratechange", onRate);
  }, [
    syncCompanionVolume,
    applyVideoElementVolume,
    audioRef,
    videoRef.current,
  ]);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const events = [
      "play",
      "pause",
      "timeupdate",
      "durationchange",
      "loadedmetadata",
      "progress",
      "ratechange",
      "waiting",
      "playing",
      "canplay",
    ] as const;
    for (const e of events) v.addEventListener(e, bump);
    return () => {
      for (const e of events) v.removeEventListener(e, bump);
    };
  }, [videoRef, bump]);

  // Reflect direct element mute changes back into React state. The shorts
  // unmute-after-play hook sets `el.muted` straight on the DOM (bypassing the
  // adapter), so without this the mute button would keep showing "muted" while
  // audio is actually playing. Functional update keeps it loop-free: adapter
  // writes set el.muted to the value we already hold, so this no-ops on those.
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const onVolumeChange = () => {
      setMuted((prev) => (prev === v.muted ? prev : v.muted));
    };
    v.addEventListener("volumechange", onVolumeChange);
    onVolumeChange();
    return () => v.removeEventListener("volumechange", onVolumeChange);
  }, [videoRef.current]);

  // Attach the limiter when playback actually starts (the element src/buffer
  // may not have been ready during the initial play gesture).
  useEffect(() => {
    const v = videoRef.current;
    const a = audioRef.current;
    if (!v) return;
    const onStart = () => {
      ensureLimiter();
      syncCompanionVolume();
      if (!audioRef.current) applyVideoElementVolume();
    };
    v.addEventListener("playing", onStart);
    a?.addEventListener("playing", onStart);
    return () => {
      v.removeEventListener("playing", onStart);
      a?.removeEventListener("playing", onStart);
    };
  }, [
    videoRef,
    audioRef,
    ensureLimiter,
    syncCompanionVolume,
    applyVideoElementVolume,
  ]);

  useEffect(() => {
    const onPiPChange = () => {
      setPictureInPicture(Boolean(document.pictureInPictureElement));
    };
    document.addEventListener("enterpictureinpicture", onPiPChange);
    document.addEventListener("leavepictureinpicture", onPiPChange);
    onPiPChange();
    return () => {
      document.removeEventListener("enterpictureinpicture", onPiPChange);
      document.removeEventListener("leavepictureinpicture", onPiPChange);
    };
  }, []);

  const v = videoRef.current;
  const duration =
    v && Number.isFinite(v.duration) && v.duration > 0 ? v.duration : 0;
  const buffered = (() => {
    if (!v || v.buffered.length === 0) return 0;
    let max = 0;
    for (let i = 0; i < v.buffered.length; i++) {
      max = Math.max(max, v.buffered.end(i));
    }
    return max;
  })();

  return {
    paused: v?.paused ?? true,
    waiting:
      v?.readyState !== undefined && v.readyState < 3 && !(v?.paused ?? true),
    canPlay: (v?.readyState ?? 0) >= 2,
    duration,
    currentTime: v?.currentTime ?? 0,
    bufferedEnd: buffered,
    volume: externalVolume,
    muted,
    playbackRate: v?.playbackRate ?? 1,
    play: () => {
      const v = videoRef.current;
      const a = audioRef.current;
      activatedRef.current = true;
      ensureLimiter();
      if (!muted && v && !a) {
        applyVideoElementVolume({ muted: false, volumeUi: externalVolume });
      }
      // Start both elements in the same call stack so the user gesture also
      // unlocks the companion <audio> on browsers that gate autoplay per element.
      void v?.play().catch(() => {});
      if (a) {
        syncCompanionVolume();
        void a.play().catch(() => {});
      }
    },
    pause: () => {
      videoRef.current?.pause();
      audioRef.current?.pause();
    },
    togglePaused: () => {
      const el = videoRef.current;
      if (!el) return;
      const a = audioRef.current;
      if (el.paused) {
        activatedRef.current = true;
        ensureLimiter();
        if (!muted && !a) {
          applyVideoElementVolume({ muted: false, volumeUi: externalVolume });
        }
        void el.play().catch(() => {});
        if (a) {
          syncCompanionVolume();
          void a.play().catch(() => {});
        }
      } else {
        el.pause();
        a?.pause();
      }
    },
    seek: (t) => {
      const v = videoRef.current;
      const a = audioRef.current;
      if (v) v.currentTime = t;
      if (a) {
        try {
          a.currentTime = t;
        } catch {}
      }
    },
    // Keep preview visual-only for native playback; final seek happens on release.
    seekPreview: () => {},
    setVolume: (n) => {
      setExternalVolume(n);
      const nextMuted = n === 0 ? true : n > 0 && muted ? false : muted;
      if (nextMuted !== muted) setMuted(nextMuted);
      if (n > 0) {
        activatedRef.current = true;
        ensureLimiter();
      }
      // Apply immediately so the change happens within the user gesture; the
      // effect above also keeps things in sync as React state catches up.
      const a = audioRef.current;
      if (a) {
        syncCompanionVolume({ muted: nextMuted, volumeUi: n });
        if (!nextMuted && videoRef.current && !videoRef.current.paused) {
          void a.play().catch(() => {});
        }
      } else {
        applyVideoElementVolume({ muted: nextMuted, volumeUi: n });
      }
    },
    toggleMuted: () => {
      const next = !muted;
      setMuted(next);
      const a = audioRef.current;
      if (a) {
        syncCompanionVolume({ muted: next });
        if (!next && videoRef.current && !videoRef.current.paused) {
          void a.play().catch(() => {});
        }
      } else {
        applyVideoElementVolume({ muted: next });
      }
    },
    setPlaybackRate: (r) => {
      const v = videoRef.current;
      const a = audioRef.current;
      activatedRef.current = true;
      ensureLimiter();
      if (v && a) {
        const resumeAudio = !v.paused && !a.paused;
        if (resumeAudio) a.pause();
        try {
          a.currentTime = v.currentTime;
        } catch {
          /* ignore */
        }
        v.playbackRate = r;
        a.playbackRate = r;
        syncCompanionVolume();
        if (resumeAudio) void a.play().catch(() => {});
      } else if (v) {
        v.playbackRate = r;
        applyVideoElementVolume();
      }
    },
    canPictureInPicture:
      typeof document !== "undefined" &&
      "pictureInPictureEnabled" in document &&
      !videoRef.current?.disablePictureInPicture,
    pictureInPicture,
    togglePictureInPicture: () => {
      const el = videoRef.current;
      if (!el) return;
      if (document.pictureInPictureElement) {
        void document.exitPictureInPicture().catch(() => {});
      } else {
        void el.requestPictureInPicture().catch(() => {});
      }
    },
  };
}
