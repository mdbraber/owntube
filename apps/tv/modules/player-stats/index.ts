import { requireOptionalNativeModule } from "expo-modules-core";
import type { VideoPlayer } from "expo-video";

/** The video rendition the player is playing right now. */
export type PlayingVideoFormat = {
  width: number;
  height: number;
  /** Bits per second, when the manifest says. */
  bitrate?: number;
  codecs?: string;
  frameRate?: number;
};

type PlayerStatsNative = {
  getVideoFormat: () => Promise<PlayingVideoFormat | null>;
};

// Absent in builds without the native side (and off Android): reports nothing.
const native = requireOptionalNativeModule<PlayerStatsNative>("PlayerStats");

/**
 * What is playing, or null before the first frame.
 *
 * Android reads it off ExoPlayer (this module's native side). Elsewhere, tvOS
 * included, expo-video's own `videoTrack` says: on Apple it matches AVPlayer's
 * access log to the HLS variants, so it follows the adaptive switches too.
 */
export async function getPlayingVideoFormat(
  player?: VideoPlayer,
): Promise<PlayingVideoFormat | null> {
  if (!native) return player ? fromVideoTrack(player) : null;
  try {
    return await native.getVideoFormat();
  } catch {
    return null;
  }
}

function fromVideoTrack(player: VideoPlayer): PlayingVideoFormat | null {
  const track = player.videoTrack;
  if (!track || track.size.height <= 0) return null;
  const format: PlayingVideoFormat = {
    width: track.size.width,
    height: track.size.height,
  };
  if (track.bitrate) format.bitrate = track.bitrate;
  const codecs = /codecs="?([^";]+)/.exec(track.mimeType ?? "")?.[1];
  if (codecs) format.codecs = codecs;
  if (track.frameRate) format.frameRate = track.frameRate;
  return format;
}
