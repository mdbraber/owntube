/**
 * Canonical icon geometry, shared by every surface that draws these actions.
 *
 * The web renders them as `<svg>` (see components/videos/video-action-icons and
 * components/player/player-icons); the TV app renders the same paths through
 * react-native-svg. Keeping the geometry here rather than in JSX is what lets
 * both do that — a React component can't cross into React Native.
 *
 * All paths assume a 24x24 viewBox.
 */

export const ICON_VIEW_BOX = 24;

/** Solid shapes, drawn with `fill`. */
export const FILLED_ICON_PATHS = {
  like: "M9 21h8a2 2 0 0 0 2-1.6l1-5A2 2 0 0 0 18 12h-5l.7-3.3A2 2 0 0 0 11.8 6L9 9v12ZM4 10h3v11H4z",
  dislike:
    "M15 3H7a2 2 0 0 0-2 1.6l-1 5A2 2 0 0 0 6 12h5l-.7 3.3A2 2 0 0 0 12.2 18L15 15V3Zm5 1h-3v11h3z",
  play: "M8 5v14l11-7z",
  pause: "M6 19h4V5H6v14zm8-14v14h4V5h-4z",
  /** Circular arrow used by the skip controls; mirror it for "forward". */
  skip: "M12 5V1L7 6l5 5V7c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6H4c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8z",
} as const;

/** Outlined shapes, drawn with `stroke` and no fill. */
export const STROKED_ICON_PATHS = {
  /** Subtitles: the bar rows inside the captions frame. */
  captionsLines: "M7 11h2M13 11h4M7 15h4M15 15h2",
} as const;

/** The captions frame the lines sit inside. */
export const CAPTIONS_FRAME = {
  x: 3,
  y: 5,
  width: 18,
  height: 14,
  rx: 2.5,
} as const;

export type FilledIconName = keyof typeof FILLED_ICON_PATHS;
