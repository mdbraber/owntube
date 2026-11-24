/**
 * Which system casting the browser offers, so the player can show the icon
 * and name viewers know: AirPlay in Safari (iPhone, iPad, Mac), Cast in
 * Chrome (Android, desktop). Feature-detected, not read from the user agent:
 * only WebKit has the AirPlay target-availability event.
 */
export type CastFlavor = "airplay" | "cast";

export function castFlavor(
  win: object | undefined = typeof window === "undefined" ? undefined : window,
): CastFlavor {
  return win && "WebKitPlaybackTargetAvailabilityEvent" in win
    ? "airplay"
    : "cast";
}

export const CAST_FLAVOR_LABEL: Record<CastFlavor, string> = {
  airplay: "AirPlay",
  cast: "Cast",
};
