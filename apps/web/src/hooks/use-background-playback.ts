"use client";

import { useEffect } from "react";
import { isIosLikeBrowser } from "@/lib/ios-playback";
import { trpc } from "@/trpc/react";

type WebkitVideo = HTMLVideoElement & {
  autoPictureInPicture?: boolean;
};

/**
 * Keep playback alive when the user leaves the app, and drive the OS media
 * controls.
 *
 * iOS/iPadOS Safari suspends an inline `<video>` as soon as the app is
 * backgrounded — nothing in our code pauses it; WebKit does. The supported
 * escape hatch is `autoPictureInPicture`: WebKit automatically moves a playing
 * video into Picture-in-Picture when the user switches away, and PiP keeps
 * running. Enabled on iOS-family browsers only — on desktop, auto-PiP on every
 * tab switch would be obnoxious (and desktop keeps playing anyway).
 *
 * The Media Session metadata/handlers give the lock screen and Control Center
 * the right title, channel and artwork, and make their transport buttons work
 * (without handlers iOS shows the controls but the buttons do nothing). Those
 * stay on regardless — only the auto-PiP behaviour is behind the user setting
 * (`backgroundPlayback`, read here rather than drilled through the player tree,
 * same as MiniPlayerSync).
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
  const { data: settings } = trpc.settings.get.useQuery(undefined, {
    retry: false,
    refetchOnWindowFocus: false,
  });
  const backgroundPlayback = settings?.backgroundPlayback ?? true;

  useEffect(() => {
    const video = videoRef.current as WebkitVideo | null;
    if (!video || !enabled || !backgroundPlayback || !isIosLikeBrowser()) {
      return;
    }
    video.autoPictureInPicture = true;
    return () => {
      video.autoPictureInPicture = false;
    };
  }, [videoRef, enabled, backgroundPlayback]);

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
      const duration = Number.isFinite(video.duration) ? video.duration : 0;
      const next = video.currentTime + offset;
      video.currentTime = Math.max(
        0,
        duration > 0 ? Math.min(next, duration) : next,
      );
    };
    const handlers: [MediaSessionAction, MediaSessionActionHandler][] = [
      ["play", () => void video.play().catch(() => {})],
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

    return () => {
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
