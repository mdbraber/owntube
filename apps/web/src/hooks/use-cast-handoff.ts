"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { PlayerAdapter } from "@/components/player/player-types";
import { useRemotePlayback } from "@/hooks/use-remote-playback";
import { getClientAppOrigin } from "@/lib/hls-same-origin";
import { toMediaOriginUrl } from "@/lib/media-origin";

/**
 * The URL a TV plays when the viewer casts this video: the server's VOD HLS,
 * SABR first (see `castMasterPlaylist` in the /hls route), on the media origin.
 */
export function castSourceUrl(videoId: string): string {
  return toMediaOriginUrl(
    `/hls/${encodeURIComponent(videoId)}/master.m3u8?for=cast`,
    getClientAppOrigin(),
  );
}

/** Props for the hidden cast `<video>` the player renders. */
export type CastVideoProps = {
  ref: (el: HTMLVideoElement | null) => void;
  src: string;
  preload: "none";
  playsInline: true;
  "x-webkit-airplay": "allow";
  "aria-hidden": true;
  tabIndex: -1;
  className: string;
};

/**
 * Casting (AirPlay, Cast) through a second, hidden `<video>` instead of the one
 * playing on screen.
 *
 * A receiver fetches and plays a URL itself, so only an element whose source is
 * a plain URL can go to it. The on-screen element usually can't: hls.js and
 * dash.js play through Media Source (a `blob:` that exists only in this page),
 * split playback keeps the sound in a separate `<audio>`, and the peak limiter
 * routes sound through Web Audio, which never leaves the device. Rather than
 * bend local playback around casting, the cast element carries the URL a TV
 * can play (`castSourceUrl`), and local playback stays exactly as it is.
 *
 * While a receiver is connected the player's controls drive the cast element;
 * the local one is paused, and picks up where the TV left off on disconnect.
 *
 * `castSrc` null (live streams) leaves the local adapter as it is.
 */
export function useCastHandoff(
  local: PlayerAdapter,
  castSrc: string | null,
): { adapter: PlayerAdapter; castVideoProps: CastVideoProps | null } {
  const [el, setEl] = useState<HTMLVideoElement | null>(null);
  const remote = useRemotePlayback(castSrc ? el : null);
  const [, force] = useState(0);
  const [castError, setCastError] = useState(false);
  const localRef = useRef(local);
  localRef.current = local;

  // Re-render on the cast element's own playback events while it's in use.
  useEffect(() => {
    if (!el) return;
    const bump = () => force((x) => x + 1);
    const onError = () => setCastError(true);
    const events = [
      "play",
      "pause",
      "timeupdate",
      "durationchange",
      "volumechange",
      "ratechange",
      "waiting",
      "playing",
      "progress",
    ];
    for (const e of events) el.addEventListener(e, bump);
    el.addEventListener("error", onError);
    return () => {
      for (const e of events) el.removeEventListener(e, bump);
      el.removeEventListener("error", onError);
    };
  }, [el]);

  // Hand playback over on connect, and back on disconnect.
  const wasActiveRef = useRef(false);
  useEffect(() => {
    if (!el) return;
    if (remote.active && !wasActiveRef.current) {
      wasActiveRef.current = true;
      const at = localRef.current.currentTime;
      localRef.current.pause();
      try {
        el.currentTime = at;
      } catch {
        /* not seekable yet: the default start position set on click applies */
      }
      void el.play().catch(() => {});
    } else if (!remote.active && wasActiveRef.current) {
      wasActiveRef.current = false;
      const at = el.currentTime;
      el.pause();
      if (Number.isFinite(at) && at > 0) localRef.current.seek(at);
    }
  }, [el, remote.active]);

  // A new video: stop whatever the cast element was doing.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset on a new source only.
  useEffect(() => {
    setCastError(false);
    return () => {
      el?.pause();
    };
  }, [castSrc]);

  const prompt = useCallback(() => {
    if (!el) return;
    setCastError(false);
    // Inside the click: load() under a user gesture lifts WebKit's playback
    // restrictions for this element, so play() on connect (no gesture by then)
    // is allowed. Then start where the viewer is.
    el.load();
    try {
      el.currentTime = localRef.current.currentTime;
    } catch {
      /* set again on connect */
    }
    remote.prompt();
  }, [el, remote]);

  if (!castSrc) return { adapter: local, castVideoProps: null };

  const castVideoProps: CastVideoProps = {
    ref: setEl,
    src: castSrc,
    preload: "none",
    playsInline: true,
    "x-webkit-airplay": "allow",
    "aria-hidden": true,
    tabIndex: -1,
    // In the DOM (AirPlay wants that) but never seen or clicked.
    className: "pointer-events-none absolute h-px w-px opacity-0",
  };

  const castFields = {
    castButton:
      remote.receiverAvailable || remote.active ? "castable" : "hidden",
    castActive: remote.active,
    castAudioStaysLocal: false,
    castError,
    showCastPicker: prompt,
  } as const;

  if (!remote.active || !el) {
    return { adapter: { ...local, ...castFields }, castVideoProps };
  }

  const duration =
    Number.isFinite(el.duration) && el.duration > 0
      ? el.duration
      : local.duration;
  const bufferedEnd =
    el.buffered.length > 0 ? el.buffered.end(el.buffered.length - 1) : 0;
  const seek = (t: number) => {
    el.currentTime = t;
  };
  return {
    adapter: {
      ...local,
      ...castFields,
      paused: el.paused,
      waiting: el.readyState < 3 && !el.paused,
      canPlay: true,
      duration,
      currentTime: el.currentTime,
      bufferedEnd,
      volume: el.volume,
      muted: el.muted,
      playbackRate: el.playbackRate,
      play: () => void el.play().catch(() => {}),
      pause: () => el.pause(),
      togglePaused: () => {
        if (el.paused) void el.play().catch(() => {});
        else el.pause();
      },
      seek,
      seekPreview: seek,
      setVolume: (v: number) => {
        el.volume = Math.min(1, Math.max(0, v));
      },
      toggleMuted: () => {
        el.muted = !el.muted;
      },
      setPlaybackRate: (r: number) => {
        el.playbackRate = r;
      },
      canPictureInPicture: false,
      pictureInPicture: false,
      togglePictureInPicture: () => {},
    },
    castVideoProps,
  };
}
