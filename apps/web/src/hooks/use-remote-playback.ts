"use client";

import { useCallback, useEffect, useState } from "react";

/** WebKit's pre-standard AirPlay API, for browsers without `remote`. */
type WebKitAirPlayVideo = HTMLVideoElement & {
  webkitShowPlaybackTargetPicker?: () => void;
  webkitCurrentPlaybackTargetIsWireless?: boolean;
};

type WebKitAvailabilityEvent = Event & { availability?: string };

export type RemotePlaybackState = {
  /** A receiver (Apple TV, Cast device) is reachable from this element. */
  receiverAvailable: boolean;
  /** The element is playing on a receiver right now. */
  active: boolean;
  /**
   * Opens the browser's device picker. Call straight from a click. Resolves
   * `"picked"` when a device was chosen, `"dismissed"` when the picker was
   * closed or failed, and `"unknown"` with WebKit's older picker, which says
   * neither.
   */
  prompt: () => Promise<"picked" | "dismissed" | "unknown">;
};

/**
 * Remote playback (AirPlay, Cast) for one `<video>`, through the standard
 * Remote Playback API (`video.remote`), which Safari and Chrome both have.
 * Browsers with only WebKit's older AirPlay events use those instead. Pass the
 * element itself, not a ref: a new element (the players key theirs by stream)
 * is a new subscription.
 */
export function useRemotePlayback(
  video: HTMLVideoElement | null,
): RemotePlaybackState {
  const [receiverAvailable, setReceiverAvailable] = useState(false);
  const [active, setActive] = useState(false);

  useEffect(() => {
    setReceiverAvailable(false);
    setActive(false);
    if (!video) return;
    if ("remote" in video && video.remote) {
      return watchRemote(video, video.remote, setReceiverAvailable, setActive);
    }
    return watchWebKit(video, setReceiverAvailable, setActive);
  }, [video]);

  const prompt = useCallback(async () => {
    if (!video) return "dismissed" as const;
    if ("remote" in video && video.remote) {
      // Rejects when the viewer dismisses the picker, or the source can't go.
      return video.remote.prompt().then(
        () => "picked" as const,
        () => "dismissed" as const,
      );
    }
    (video as WebKitAirPlayVideo).webkitShowPlaybackTargetPicker?.();
    return "unknown" as const;
  }, [video]);

  return { receiverAvailable, active, prompt };
}

function watchRemote(
  video: HTMLVideoElement,
  remote: RemotePlayback,
  setAvailable: (a: boolean) => void,
  setActive: (a: boolean) => void,
): () => void {
  // Either signal means "on a receiver". On iPhone and iPad an AirPlay cast
  // starts by switching the device's route, and Safari then flags the element
  // as wireless without the Remote Playback API ever reporting "connected"
  // (seen on an iPad: the cast played, `connect` never fired).
  const webkit = video as WebKitAirPlayVideo;
  const syncState = () =>
    setActive(
      remote.state === "connected" ||
        webkit.webkitCurrentPlaybackTargetIsWireless === true,
    );
  const videoEvents = [
    "webkitcurrentplaybacktargetiswirelesschanged",
    "playing",
    "pause",
  ];
  for (const type of ["connecting", "connect", "disconnect"]) {
    remote.addEventListener(type, syncState);
  }
  for (const type of videoEvents) video.addEventListener(type, syncState);
  syncState();

  // watchAvailability throws while `disableRemotePlayback` is set (dash.js
  // sets it) and where the browser can't tell; the button then stays hidden.
  let cancelled = false;
  let watchId: number | undefined;
  if (!video.disableRemotePlayback) {
    remote
      .watchAvailability((available) => {
        if (!cancelled) setAvailable(available);
      })
      .then((id) => {
        watchId = id;
        if (cancelled) void remote.cancelWatchAvailability(id).catch(() => {});
      })
      .catch(() => {});
  }

  return () => {
    cancelled = true;
    for (const type of ["connecting", "connect", "disconnect"]) {
      remote.removeEventListener(type, syncState);
    }
    for (const type of videoEvents) video.removeEventListener(type, syncState);
    if (watchId !== undefined) {
      void remote.cancelWatchAvailability(watchId).catch(() => {});
    }
  };
}

function watchWebKit(
  video: WebKitAirPlayVideo,
  setAvailable: (a: boolean) => void,
  setActive: (a: boolean) => void,
): () => void {
  if (typeof video.webkitShowPlaybackTargetPicker !== "function") {
    return () => {};
  }
  const onAvailability = (e: WebKitAvailabilityEvent) =>
    setAvailable(e.availability === "available");
  const onWireless = () =>
    setActive(video.webkitCurrentPlaybackTargetIsWireless === true);
  video.addEventListener(
    "webkitplaybacktargetavailabilitychanged",
    onAvailability,
  );
  video.addEventListener(
    "webkitcurrentplaybacktargetiswirelesschanged",
    onWireless,
  );
  return () => {
    video.removeEventListener(
      "webkitplaybacktargetavailabilitychanged",
      onAvailability,
    );
    video.removeEventListener(
      "webkitcurrentplaybacktargetiswirelesschanged",
      onWireless,
    );
  };
}
