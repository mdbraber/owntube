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
  const isUpcoming = raw.isUpcoming === true;
  const pipedExplicit =
    raw.livestream === true ||
    raw.isLive === true ||
    raw.live === true ||
    type === "livestream";
  // Piped list/trending payloads often type active lives as plain "stream" and
  // only signal them with `duration: -1` (no fixed length) and `uploaded: -1`.
  const pipedDurationLive = raw.duration === -1 && raw.uploaded === -1;
  const invidiousLive = raw.liveNow === true;
  const isLive =
    !isUpcoming && (pipedExplicit || pipedDurationLive || invidiousLive);
  return { isLive, isUpcoming };
}

/** Force live metadata on rows returned from a channel live tab / streams API. */
export function markUnifiedVideoAsActiveLive<
  T extends {
    isLive?: boolean;
    isUpcoming?: boolean;
    durationSeconds?: number;
  },
>(video: T): T {
  if (video.isUpcoming === true) return video;
  return {
    ...video,
    isLive: true,
    durationSeconds: normalizeDurationForLive(video.durationSeconds, true),
  };
}

/** Prepend live tab rows and tag matching uploads as live. */
export function mergeActiveLiveVideosFirst<
  T extends {
    videoId: string;
    isLive?: boolean;
    isUpcoming?: boolean;
    durationSeconds?: number;
  },
>(videos: T[], liveCandidates: T[]): T[] {
  const activeLive = liveCandidates
    .map(markUnifiedVideoAsActiveLive)
    .filter(isActiveLiveVideo);
  const liveById = new Map(activeLive.map((v) => [v.videoId, v]));

  const merged = videos.map((v) => {
    const live = liveById.get(v.videoId);
    if (!live) {
      if (!v.isLive) return v;
      return {
        ...v,
        durationSeconds: normalizeDurationForLive(v.durationSeconds, true),
      };
    }
    liveById.delete(v.videoId);
    return {
      ...v,
      isLive: true,
      isUpcoming: live.isUpcoming ?? v.isUpcoming,
      durationSeconds: normalizeDurationForLive(v.durationSeconds, true),
    };
  });

  const prepend = [...liveById.values()];
  if (prepend.length === 0) return merged;
  return [...prepend, ...merged];
}
