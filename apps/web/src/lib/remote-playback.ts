/**
 * Whether a media element is currently rendering on another device (AirPlay
 * from Safari/iOS, or a Remote Playback API session) rather than locally.
 *
 * While it is, the local decoder produces no frames — the receiver decodes —
 * so `getVideoPlaybackQuality().totalVideoFrames` stays flat as `currentTime`
 * advances. Anything that reads that combination as a frozen local decoder
 * must skip remote playback, or it "recovers" a healthy stream.
 */
export function isPlayingRemotely(media: HTMLMediaElement): boolean {
  const m = media as HTMLMediaElement & {
    webkitCurrentPlaybackTargetIsWireless?: boolean;
    remote?: { state?: string };
  };
  return (
    m.webkitCurrentPlaybackTargetIsWireless === true ||
    m.remote?.state === "connected"
  );
}
