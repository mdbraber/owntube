"use client";

import { useEffect } from "react";

/**
 * Drives the OS media controls (lock screen / Control Center): correct title,
 * channel and artwork, and working transport buttons — without handlers iOS
 * shows the controls but the buttons do nothing.
 *
 * It also mirrors the video's play/pause into `mediaSession.playbackState`, so
 * iOS doesn't resume a paused video when the native shell is backgrounded.
 *
 * This hook does NOT try to keep playback alive in the background.
 * Two approaches were tried and removed:
 *   - `autoPictureInPicture`: WebKit ignores it for inline web video on iPadOS,
 *     even with "Start PiP Automatically" enabled.
 *   - handing playback to a hidden <audio> on `visibilitychange`: it never
 *     produced background audio on iPadOS, and because visibilitychange also
 *     fires when merely switching Safari *tabs*, it paused the video and
 *     hiccuped playback in the one case that used to work fine.
 *
 * The working path today is Picture-in-Picture, which the user starts
 * explicitly: from the ⋯ sheet, or from Apple's native fullscreen player (see
 * player-fullscreen.ts). PiP survives an app switch.
 */
export function useBackgroundPlayback(
  videoRef: React.RefObject<HTMLVideoElement | null>,
  {
    title,
    channelName,
    poster,
    enabled = true,
  }: {
    title?: string;
    channelName?: string;
    poster?: string;
    enabled?: boolean;
  },
): void {
  useEffect(() => {
    const video = videoRef.current;
    const ms = typeof navigator !== "undefined" ? navigator.mediaSession : null;
    if (!video || !ms || !enabled || !title) return;

    ms.metadata = new MediaMetadata({
      title,
      artist: channelName ?? "",
      ...(poster ? { artwork: [{ src: poster }] } : {}),
    });

    const seekBy = (offset: number) => {
      const el = video;
      const duration = Number.isFinite(el.duration) ? el.duration : 0;
      const next = el.currentTime + offset;
      el.currentTime = Math.max(
        0,
        duration > 0 ? Math.min(next, duration) : next,
      );
    };
    const handlers: [MediaSessionAction, MediaSessionActionHandler][] = [
      [
        "play",
        () => {
          void video.play().catch(() => {});
        },
      ],
      ["pause", () => video.pause()],
      ["seekbackward", (d) => seekBy(-(d.seekOffset ?? 10))],
      ["seekforward", (d) => seekBy(d.seekOffset ?? 10)],
      [
        "seekto",
        (d) => {
          if (typeof d.seekTime === "number") video.currentTime = d.seekTime;
        },
      ],
    ];
    for (const [action, handler] of handlers) {
      try {
        ms.setActionHandler(action, handler);
      } catch {
        /* action unsupported by this browser */
      }
    }

    // Keep the OS in step with whether the video is actually playing. Without
    // this iOS doesn't know a paused video is paused, so when the app is
    // backgrounded with UIBackgroundModes:audio (the native shell) it activates
    // the audio session and issues `play` — resuming a video the user paused.
    const syncPlaybackState = () => {
      ms.playbackState = video.paused ? "paused" : "playing";
    };
    syncPlaybackState();
    video.addEventListener("play", syncPlaybackState);
    video.addEventListener("pause", syncPlaybackState);

    return () => {
      video.removeEventListener("play", syncPlaybackState);
      video.removeEventListener("pause", syncPlaybackState);
      ms.playbackState = "none";
      for (const [action] of handlers) {
        try {
          ms.setActionHandler(action, null);
        } catch {
          /* ignore */
        }
      }
      ms.metadata = null;
    };
  }, [videoRef, title, channelName, poster, enabled]);
}
