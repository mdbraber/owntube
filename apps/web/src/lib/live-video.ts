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
