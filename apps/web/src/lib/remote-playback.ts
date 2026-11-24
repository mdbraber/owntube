/** The parts of a media element that say where it is rendering. */
export type RemoteAwareMedia = {
  /** WebKit's AirPlay flag (Safari, iOS). */
  webkitCurrentPlaybackTargetIsWireless?: boolean;
  /** The standard Remote Playback API, where the browser has it. */
  remote?: { state?: string };
};

/**
 * Whether a media element is currently rendering on another device (AirPlay
 * from Safari/iOS, or a Remote Playback API session) rather than locally.
 *
 * While it is, the local decoder produces no frames — the receiver decodes —
 * so `getVideoPlaybackQuality().totalVideoFrames` stays flat as `currentTime`
 * advances. Anything that reads that combination as a frozen local decoder
 * must skip remote playback, or it "recovers" a healthy stream.
 */
export function isPlayingRemotely(media: RemoteAwareMedia): boolean {
  return (
    media.webkitCurrentPlaybackTargetIsWireless === true ||
    media.remote?.state === "connected"
  );
}

/**
 * What the player's cast button shows:
 * - `hidden`: no receiver is known (or the browser can't tell), so no button —
 *   most viewers never see a dead icon;
 * - `castable`: a receiver is there and this source can go to it;
 * - `unavailable`: a receiver is there but this source can't. Media Source
 *   playback (hls.js/dash.js, a `blob:` URL) only renders locally, and dash.js
 *   sets `disableRemotePlayback` for ManagedMediaSource. Casting would send a
 *   black or silent picture, so the button says why instead.
 */
export type CastButtonState = "hidden" | "castable" | "unavailable";

export function castButtonState(opts: {
  receiverAvailable: boolean;
  disableRemotePlayback: boolean;
  currentSrc: string;
}): CastButtonState {
  if (!opts.receiverAvailable) return "hidden";
  if (opts.disableRemotePlayback || opts.currentSrc.startsWith("blob:")) {
    return "unavailable";
  }
  return "castable";
}
