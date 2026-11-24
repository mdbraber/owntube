import { requireOptionalNativeModule } from "expo-modules-core";

/** The video rendition ExoPlayer is playing right now. */
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

/** What is playing, or null before the first frame or without the module. */
export async function getPlayingVideoFormat(): Promise<PlayingVideoFormat | null> {
  if (!native) return null;
  try {
    return await native.getVideoFormat();
  } catch {
    return null;
  }
}
