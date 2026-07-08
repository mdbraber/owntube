/**
 * One cue for "can I find this later?": the save control's label encodes
 * membership across Saved (the inbox) and playlists.
 *
 *   Save       — nowhere (inactive)
 *   Saved      — inbox only
 *   <name>     — exactly one playlist
 *   Saved (n)  — n places total (inbox + playlists)
 */
export function saveMembershipLabel(
  saved: boolean,
  playlistCount: number,
  playlistName?: string,
): { label: string; active: boolean } {
  const places = (saved ? 1 : 0) + playlistCount;
  if (places === 0) return { label: "Save", active: false };
  if (places === 1) {
    return {
      label: saved ? "Saved" : (playlistName ?? "Saved"),
      active: true,
    };
  }
  return { label: `Saved (${places})`, active: true };
}
