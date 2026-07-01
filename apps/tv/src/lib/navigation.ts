/**
 * Navigation callbacks threaded from the shell into each section screen. The
 * shell owns a small route stack (section → watch/channel overlays); screens
 * only push onto it. No navigation library — see Shell.tsx.
 */
export type Nav = {
  /** Open the player. `resumeSeconds` seeks on load (used by History). */
  openVideo: (videoId: string, resumeSeconds?: number) => void;
  openChannel: (channelId: string) => void;
};
