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
