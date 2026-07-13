"use client";

import { useEffect, useRef } from "react";
import { isIosLikeBrowser } from "@/lib/ios-playback";
import { trpc } from "@/trpc/react";

/**
 * Keep playing when the user leaves the app, and drive the OS media controls.
 *
 * iOS/iPadOS Safari suspends an inline `<video>` the moment the app is
 * backgrounded (WebKit does this; nothing in our code pauses it). It does NOT
 * suspend an `<audio>` element — that is how web audio players keep going with
 * the screen locked. So on `visibilitychange → hidden` we hand playback over to
 * a hidden `<audio>` pointed at the video's audio-only HLS rendition
 * (`/hls/<id>/audio.m3u8`, natively played by Safari), and hand it back to the
 * `<video>` — position synced — when the user returns.
 *
 * `autoPictureInPicture` was tried first: it does NOT fire for inline web video
 * on iPadOS, even with "Start PiP Automatically" enabled. Hence the handoff.
 *
 * iOS gates programmatic playback of each media element behind a user gesture,
 * so the `<audio>` is primed (muted play → immediate pause) on the first
 * interaction with the page; without that, the `play()` at backgrounding is
 * rejected and playback would just stop.
 *
 * Media Session metadata/handlers stay on regardless of the setting — the lock
 * screen and Control Center are useful either way — and are routed to whichever
 * element currently owns playback.
 */
export function useBackgroundPlayback(
  videoRef: React.RefObject<HTMLVideoElement | null>,
  {
    videoId,
    title,
    channelName,
    poster,
    enabled = true,
  }: {
    videoId?: string;
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
  /** The <audio> element while it owns playback (null when the video does). */
  const handedOffRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (
      !video ||
      !videoId ||
      !enabled ||
      !backgroundPlayback ||
      !isIosLikeBrowser()
    ) {
      return;
    }

    const audio = document.createElement("audio");
    audio.src = `/hls/${encodeURIComponent(videoId)}/audio.m3u8`;
    audio.preload = "auto";
    audio.setAttribute("playsinline", "");
    audio.style.display = "none";
    document.body.appendChild(audio);

    // iOS only lets an element play programmatically once it has played inside a
    // user gesture. Prime it on the first interaction (the tap that starts the
    // video does fine), silently, then park it.
    let primed = false;
    const prime = () => {
      if (primed) return;
      primed = true;
      audio.muted = true;
      void audio
        .play()
        .then(() => {
          audio.pause();
          audio.currentTime = 0;
          audio.muted = false;
        })
        .catch(() => {
          audio.muted = false;
          primed = false; // let a later gesture try again
        });
    };
    document.addEventListener("pointerdown", prime, { capture: true });
    document.addEventListener("touchend", prime, { capture: true });

    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        // Backgrounding: only take over if the video was actually playing.
        if (video.paused || handedOffRef.current) return;
        audio.currentTime = video.currentTime;
        handedOffRef.current = audio;
        void audio.play().catch(() => {
          handedOffRef.current = null;
        });
        video.pause();
        return;
      }
      // Returning: give playback back to the video at the audio's position.
      const active = handedOffRef.current;
      if (!active) return;
      handedOffRef.current = null;
      const resumeAt = active.currentTime;
      const wasPlaying = !active.paused;
      active.pause();
      if (Number.isFinite(resumeAt) && resumeAt > 0) {
        video.currentTime = resumeAt;
      }
      // Paused from the lock screen while away → stay paused on return.
      if (wasPlaying) void video.play().catch(() => {});
    };
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      document.removeEventListener("pointerdown", prime, { capture: true });
      document.removeEventListener("touchend", prime, { capture: true });
      handedOffRef.current = null;
      audio.pause();
      audio.removeAttribute("src");
      audio.remove();
    };
  }, [videoRef, videoId, enabled, backgroundPlayback]);

  useEffect(() => {
    const video = videoRef.current;
    const ms = typeof navigator !== "undefined" ? navigator.mediaSession : null;
    if (!video || !ms || !enabled || !title) return;

    ms.metadata = new MediaMetadata({
      title,
      artist: channelName ?? "",
      ...(poster ? { artwork: [{ src: poster }] } : {}),
    });

    /** Lock-screen controls must drive whichever element currently plays. */
    const active = (): HTMLMediaElement => handedOffRef.current ?? video;
    const seekBy = (offset: number) => {
      const el = active();
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
          void active()
            .play()
            .catch(() => {});
        },
      ],
      ["pause", () => active().pause()],
      ["seekbackward", (d) => seekBy(-(d.seekOffset ?? 10))],
      ["seekforward", (d) => seekBy(d.seekOffset ?? 10)],
      [
        "seekto",
        (d) => {
          if (typeof d.seekTime === "number") active().currentTime = d.seekTime;
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
