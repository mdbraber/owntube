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
] as const;

export type QuickAction = (typeof QUICK_ACTION_VALUES)[number];

export const DEFAULT_QUICK_ACTIONS: QuickAction[] = [
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
};
