import { requireOptionalNativeModule } from "expo-modules-core";

type WatchNextItem = {
  videoId: string;
  title: string;
  channelName?: string;
  posterUrl?: string;
  positionMs: number;
  durationMs: number;
};

type WatchNextNative = {
  upsert: (item: WatchNextItem) => Promise<boolean>;
  remove: (videoId: string) => Promise<boolean>;
};

// Android TV: the launcher's Watch Next row. tvOS: the Top Shelf (see
// ios/WatchNextModule.swift). Absent in builds without a native side: a no-op.
const native = requireOptionalNativeModule<WatchNextNative>("WatchNext");

/** Puts (or refreshes) a video in the home screen's Continue watching row. */
export function upsertWatchNext(item: WatchNextItem): void {
  native?.upsert(item).catch(() => {});
}

/** Takes a video out of the row, e.g. once it has been watched. */
export function removeWatchNext(videoId: string): void {
  native?.remove(videoId).catch(() => {});
}
