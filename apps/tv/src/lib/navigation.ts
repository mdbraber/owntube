import type { UnifiedVideo } from "@web/server/catalog/types";

/**
 * Where a video was started from, so the player knows what comes next: the
 * queue, a playlist, or the feed the card sat in. A snapshot of that list,
 * taken when the video opened; a video opened without one falls back to its
 * first related video for "next", as the YouTube TV app does.
 */
export type PlayContext = {
  source: "queue" | "playlist" | "feed";
  /** Shown on the up-next card ("Up next in Queue"). */
  label?: string;
  videos: UnifiedVideo[];
};

export type OpenVideoOptions = {
  /** Seek on load; defaults to the stored watch position. */
  resumeSeconds?: number;
  context?: PlayContext;
};

/**
 * Navigation callbacks threaded from the shell into each section screen. The
 * shell owns a small route stack (section → watch/channel overlays); screens
 * only push onto it. No navigation library — see Shell.tsx.
 */
export type Nav = {
  openVideo: (videoId: string, options?: OpenVideoOptions) => void;
  openChannel: (channelId: string) => void;
  /** The Shorts player, starting at this short when given. */
  openShorts: (start?: UnifiedVideo) => void;
  /** The Search section, from Home's pinned search bar. */
  openSearch: () => void;
};

/** The neighbours of `videoId` within its context, if it has one. */
export function contextNeighbours(
  context: PlayContext | undefined,
  videoId: string,
): { previous?: UnifiedVideo; next?: UnifiedVideo } {
  if (!context) return {};
  const index = context.videos.findIndex((v) => v.videoId === videoId);
  if (index < 0) return {};
  return {
    previous: context.videos[index - 1],
    next: context.videos[index + 1],
  };
}
