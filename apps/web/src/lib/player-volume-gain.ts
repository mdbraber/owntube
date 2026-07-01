/**
 * HTMLMediaElement.volume is linear; human hearing is closer to logarithmic, so
 * low slider positions feel too loud. Map **UI** 0…1 (slider / prefs) to
 * element gain with a gentle power curve (quiet end stretched).
 */
const EXP = 1.55 as const;

export function uiVolumeToGain(ui: number): number {
  const x = Math.min(1, Math.max(0, ui));
  if (x <= 0) return 0;
  return x ** EXP;
}

/** Inverse of {@link uiVolumeToGain} for Vidstack store ↔ slider display. */
export function gainToUiVolume(gain: number): number {
  const g = Math.min(1, Math.max(0, gain));
  if (g <= 0) return 0;
  return g ** (1 / EXP);
}

/**
 * Playback above 1× on a separate `HTMLAudioElement` often sounds harsh or clipped
 * after browser resampling; scale element gain down (slider position unchanged).
 * Fallback only — preferred path is the Web Audio peak limiter, which preserves
 * loudness and taming only the peaks. See {@link volumeGainFor}.
 */
export function playbackRateVolumeAttenuation(rate: number): number {
  const r = Math.min(4, Math.max(0.25, rate));
  if (r <= 1) return 1;
  if (r < 2) return 1 / Math.sqrt(r);
  return 1 / (r * 1.3);
}

/**
 * Element gain for a UI slider position. When the Web Audio peak limiter is
 * active it catches fast-speed transients, so we keep full loudness; otherwise
 * we fall back to the blunt {@link playbackRateVolumeAttenuation} rabate.
 */
export function volumeGainFor(
  uiVolume: number,
  rate: number,
  limiterActive: boolean,
): number {
  const base = uiVolumeToGain(uiVolume);
  return limiterActive ? base : base * playbackRateVolumeAttenuation(rate);
}
