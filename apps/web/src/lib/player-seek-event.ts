export const PLAYER_SEEK_EVENT = "ot:player-seek";

export type PlayerSeekDetail = { videoId: string; seconds: number };

/**
 * Ask the live player (PlayerHost) to seek in place — description/comment
 * timestamp links use this so a same-video jump doesn't renavigate and
 * remount the player. Cancelable handshake: the host calls preventDefault()
 * when it owns that video, so the return value tells the caller whether the
 * seek was handled (true) or it should fall back to a normal navigation.
 */
export function dispatchPlayerSeek(detail: PlayerSeekDetail): boolean {
  if (typeof window === "undefined") return false;
  return !window.dispatchEvent(
    new CustomEvent<PlayerSeekDetail>(PLAYER_SEEK_EVENT, {
      detail,
      cancelable: true,
    }),
  );
}

type TimestampClickEvent = {
  defaultPrevented: boolean;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  button: number;
  preventDefault(): void;
};

/**
 * Shared onClick for links that jump to a moment in the current video
 * (description/comment timestamps, chapter list). A plain left-click seeks
 * the live player in place and mirrors the position into the URL's `t=` via
 * replaceState; modified clicks (new tab etc.) and videos the host isn't
 * playing keep normal link navigation.
 */
export function handleTimestampLinkClick(
  e: TimestampClickEvent,
  detail: PlayerSeekDetail,
): void {
  if (
    e.defaultPrevented ||
    e.metaKey ||
    e.ctrlKey ||
    e.shiftKey ||
    e.altKey ||
    e.button !== 0
  ) {
    return;
  }
  if (dispatchPlayerSeek(detail)) {
    e.preventDefault();
    const url = new URL(window.location.href);
    url.searchParams.set("t", String(detail.seconds));
    window.history.replaceState(window.history.state, "", url);
  }
}
