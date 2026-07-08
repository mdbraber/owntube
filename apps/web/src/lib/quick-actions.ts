/**
 * Quick-action verbs the user can promote: the first two surface as thumbnail
 * hover buttons on desktop, the first four as the chip row atop the mobile
 * action sheet. Shared between the settings schema (server) and the rendering
 * components (client).
 */
export const QUICK_ACTION_VALUES = [
  "queue",
  "save",
  "like",
  "dislike",
  "watched",
  "ignore",
  "playlist",
] as const;

export type QuickAction = (typeof QUICK_ACTION_VALUES)[number];

/** First three = thumbnail buttons; all four = the mobile sheet's chip row. */
export const DEFAULT_QUICK_ACTIONS: QuickAction[] = [
  "save",
  "ignore",
  "watched",
  "queue",
];

/** The pre-2026-07 default — profiles storing exactly this migrate forward. */
export const LEGACY_DEFAULT_QUICK_ACTIONS: QuickAction[] = [
  "queue",
  "save",
  "like",
  "dislike",
];

export const QUICK_ACTION_LABELS: Record<QuickAction, string> = {
  queue: "Queue",
  save: "Save",
  like: "Like",
  dislike: "Dislike",
  watched: "Mark watched",
  ignore: "Ignore",
  playlist: "Add to playlist",
};
