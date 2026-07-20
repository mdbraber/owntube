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
  "queue",
  "watched",
  "ignore",
];

/**
 * Superseded defaults — profiles storing exactly one of these migrate to the
 * current default (so users who never customized follow default changes).
 */
export const LEGACY_DEFAULT_QUICK_ACTIONS_LIST: QuickAction[][] = [
  // pre-2026-07
  ["queue", "save", "like", "dislike"],
  // the Ignore-in-overlay default (Ignore replaced by Queue on the thumbnail)
  ["save", "ignore", "watched", "queue"],
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
