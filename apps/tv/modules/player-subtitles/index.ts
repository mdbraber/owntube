import { requireOptionalNativeModule } from "expo-modules-core";

type PlayerSubtitlesNative = {
  setBottomPadding: (fraction: number) => Promise<void>;
};

// Absent in builds without the native side (and off Android): a no-op.
const native =
  requireOptionalNativeModule<PlayerSubtitlesNative>("PlayerSubtitles");

/**
 * Space under the captions, as a fraction of the video view's height. YouTube
 * positions its cues on the last line, so without it they touch the bottom.
 */
const CAPTION_BOTTOM_PADDING = 0.07;

/** Lifts the captions of every mounted video view off the bottom edge. */
export function raiseSubtitles(): void {
  native?.setBottomPadding(CAPTION_BOTTOM_PADDING).catch(() => {});
}
