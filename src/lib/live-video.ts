/** Active broadcast (not scheduled premiere). */
export function isActiveLiveVideo(video: {
  isLive?: boolean;
  isUpcoming?: boolean;
}): boolean {
  return video.isLive === true && video.isUpcoming !== true;
}

/** Omit zero/negative duration on active lives so cards do not show "0:00". */
export function normalizeDurationForLive(
  durationSeconds: number | undefined,
  isLive: boolean,
): number | undefined {
  if (!isLive) return durationSeconds;
  if (
    typeof durationSeconds !== "number" ||
    !Number.isFinite(durationSeconds) ||
    durationSeconds <= 0
  ) {
    return undefined;
  }
  return durationSeconds;
}

export function pickLiveFlagsFromUpstream(raw: Record<string, unknown>): {
  isLive: boolean;
  isUpcoming: boolean;
} {
  const type = typeof raw.type === "string" ? raw.type.toLowerCase() : "";
  const pipedLivestream = raw.livestream === true || type === "livestream";
  const invidiousLive = raw.liveNow === true;
  const isUpcoming = raw.isUpcoming === true;
  const isLive = !isUpcoming && (pipedLivestream || invidiousLive);
  return { isLive, isUpcoming };
}
