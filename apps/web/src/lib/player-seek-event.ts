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
