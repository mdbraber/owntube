export type CompanionAudioSyncThresholds = {
  syncTolerance: number;
  driftHard: number;
  recoveryIntervalMs: number;
};

/** Drift limits and recovery cadence for split `<video>` + `<audio>` playback. */
export function companionAudioSyncThresholds(
  playbackRate: number,
): CompanionAudioSyncThresholds {
  const rate = Math.min(4, Math.max(0.25, playbackRate));
  if (rate >= 2) {
    // Prefer soft rate nudges over `currentTime` snaps — hard snaps at 2× sound
    // like clipping/crackle on many browsers.
    return {
      syncTolerance: 0.22,
      driftHard: 0.65,
      recoveryIntervalMs: 500,
    };
  }
  return {
    syncTolerance: 0.16,
    driftHard: 0.45,
    recoveryIntervalMs: 350,
  };
}

const SOFT_NUDGE_MIN_DRIFT = 0.035;
const SOFT_NUDGE_FACTOR = 0.965;

/**
 * Keep companion audio aligned with the muted video track.
 * At 2×+, uses playbackRate nudges instead of frequent hard seeks.
 */
export function applyCompanionAudioSync(
  video: HTMLVideoElement,
  audio: HTMLAudioElement,
  opts: { force?: boolean } = {},
): void {
  const targetRate = video.playbackRate;
  const { syncTolerance, driftHard } = companionAudioSyncThresholds(targetRate);
  const drift = audio.currentTime - video.currentTime;
  const absDrift = Math.abs(drift);

  if (opts.force || absDrift > driftHard) {
    audio.currentTime = video.currentTime;
    audio.playbackRate = targetRate;
    return;
  }

  if (absDrift > syncTolerance) {
    if (targetRate >= 2 && absDrift > SOFT_NUDGE_MIN_DRIFT) {
      const nudge = drift > 0 ? SOFT_NUDGE_FACTOR : 1 / SOFT_NUDGE_FACTOR;
      audio.playbackRate = Math.min(4, Math.max(0.25, targetRate * nudge));
      return;
    }
    audio.currentTime = video.currentTime;
    audio.playbackRate = targetRate;
    return;
  }

  audio.playbackRate = targetRate;
}
