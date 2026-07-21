const STORAGE_KEY = "owntube:playerMediaPrefs";

export type PlayerMediaPrefs = {
  volume: number;
  muted: boolean;
};

/** Default UI volume (before gain curve); lower than 1 avoids “too loud” on first play. */
const defaults: PlayerMediaPrefs = { volume: 0.48, muted: false };

export function readPlayerMediaPrefs(): PlayerMediaPrefs {
  if (typeof window === "undefined") return defaults;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaults;
    const o = JSON.parse(raw) as Record<string, unknown>;
    const volume =
      typeof o.volume === "number" && Number.isFinite(o.volume)
        ? Math.min(1, Math.max(0, o.volume))
        : defaults.volume;
    const muted = typeof o.muted === "boolean" ? o.muted : defaults.muted;
    return { volume, muted };
  } catch {
    return defaults;
  }
}

export function writePlayerMediaPrefs(prefs: PlayerMediaPrefs): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        volume: Math.min(1, Math.max(0, prefs.volume)),
        muted: prefs.muted,
      }),
    );
  } catch {
    /* quota / private mode */
  }
}

/** Split (native) path only tracks volume in parent state; merge with stored muted. */
export function writePlayerVolumeOnly(volume: number): void {
  const cur = readPlayerMediaPrefs();
  writePlayerMediaPrefs({ ...cur, volume });
}

// Caption language lives under its own key so the volume-only write above
// (which fully rewrites the media-prefs object) can never clobber it.
const CAPTION_LANG_KEY = "owntube:captionLang";

/** Remembered caption language (BCP-47), or `null` when captions are off. */
export function readCaptionLangPref(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(CAPTION_LANG_KEY);
    return raw && raw.length > 0 ? raw : null;
  } catch {
    return null;
  }
}

export function writeCaptionLangPref(lang: string | null): void {
  if (typeof window === "undefined") return;
  try {
    if (lang) window.localStorage.setItem(CAPTION_LANG_KEY, lang);
    else window.localStorage.removeItem(CAPTION_LANG_KEY);
  } catch {
    /* quota / private mode */
  }
}

// Whether captions are on, stored explicitly so "off" is a remembered choice
// rather than merely the absence of a language. Without it, turning captions on
// once left a sticky language that re-enabled them on every video with a
// matching track — there was no way to remember "off". Default: off.
const CAPTIONS_ENABLED_KEY = "owntube:captionsEnabled";

export function readCaptionsEnabledPref(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(CAPTIONS_ENABLED_KEY) === "1";
  } catch {
    return false;
  }
}

export function writeCaptionsEnabledPref(enabled: boolean): void {
  if (typeof window === "undefined") return;
  try {
    if (enabled) window.localStorage.setItem(CAPTIONS_ENABLED_KEY, "1");
    else window.localStorage.setItem(CAPTIONS_ENABLED_KEY, "0");
  } catch {
    /* quota / private mode */
  }
}
