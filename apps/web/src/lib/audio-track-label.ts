function primaryLanguageSubtag(raw: string): string {
  const cleaned = raw.trim().replace(/^\./, "");
  if (!cleaned || cleaned.toLowerCase() === "und") return "";
  return (cleaned.split(/[-_.]/)[0] ?? cleaned).toLowerCase();
}

function intlLanguageName(
  subtag: string,
  locales?: Intl.LocalesArgument,
): string | undefined {
  try {
    const name = new Intl.DisplayNames(locales, {
      type: "language",
    }).of(subtag);
    return name ?? undefined;
  } catch {
    return undefined;
  }
}

function normalizeLangTag(primary: string, region: string | undefined): string {
  const p = primary.trim().toLowerCase();
  if (!p) return "";
  const r = region?.trim();
  return r ? `${p}${r}` : p;
}

/**
 * googlevideo URLs encode language hints in two distinct places:
 *   1. A bare `lang=XX` (or `lang=XX-YY`) query parameter (older style).
 *   2. An `xtags` parameter — URL-encoded — that bundles colon-separated
 *      key=value pairs, e.g.
 *        `xtags=acont%3Doriginal%3Alang%3Den-US%3Avariant%3Dmain`
 *      which decodes to `acont=original:lang=en-US:variant=main`.
 *
 * Some Invidious builds also expose `audioTrackId=<lang>.<n>` (e.g. `.fr.4`).
 * All three are checked here; the first hit wins.
 */
function languageFromGoogleVideoUrl(url: string | undefined | null): string {
  if (!url) return "";

  const bare = url.match(/[?&]lang=([a-z]{2,3})(-[A-Za-z0-9]{2,4})?/i);
  if (bare?.[1]) {
    return normalizeLangTag(bare[1], bare[2]);
  }

  const xtagsMatch = url.match(/[?&]xtags=([^&#]+)/i);
  if (xtagsMatch?.[1]) {
    let decoded = xtagsMatch[1];
    try {
      decoded = decodeURIComponent(decoded);
    } catch {
      // Keep raw value if decoding fails; regex below tolerates either form.
    }
    const xtagLang = decoded.match(
      /(?:^|[:;,])lang=([a-z]{2,3})(-[A-Za-z0-9]{2,4})?/i,
    );
    if (xtagLang?.[1]) {
      return normalizeLangTag(xtagLang[1], xtagLang[2]);
    }
  }

  const trackIdMatch = url.match(
    /[?&](?:audio[_-]?track[_-]?id|audiotrackid)=\.?([a-z]{2,3})(-[A-Za-z0-9]{2,4})?/i,
  );
  if (trackIdMatch?.[1]) {
    return normalizeLangTag(trackIdMatch[1], trackIdMatch[2]);
  }

  return "";
}

/**
 * Whether this stream is YouTube / Invidious' **original** audio (as opposed to
 * a translated dub). Used to label the picker and pick the default track.
 */
export function streamLooksLikeOriginalAudio(opts: {
  displayName?: string | null;
  streamUrl?: string | null;
}): boolean {
  const rawName = opts.displayName?.trim() ?? "";
  if (rawName && /\boriginal\b/i.test(rawName)) return true;

  const u = opts.streamUrl ?? "";
  const xtagsMatch = u.match(/[?&]xtags=([^&#]+)/i);
  if (xtagsMatch?.[1]) {
    let decoded = xtagsMatch[1];
    try {
      decoded = decodeURIComponent(decoded);
    } catch {
      // tolerate raw
    }
    if (/acont=original/i.test(decoded)) return true;
  }

  return false;
}

/**
 * Best-effort BCP-ish code from HLS / internal track ids. Handles common
 * shapes:
 *   - `audio-fr`, `track_en`, `audio/de` (suffix delimited)
 *   - `track-en-4`, `audio_track_pt-BR_5` (lang sandwiched between delimiters)
 *   - `.fr.4`, `.en` (Invidious adaptive `audioTrack.id` / `audioTrackId`)
 */
function inferLanguageFromTrackId(id: string | undefined | null): string {
  if (!id?.trim()) return "";
  const low = id.toLowerCase().replace(/^\./, "");

  const dotted = low.match(/^([a-z]{2,3})(-[a-z0-9]{2,4})?(?:\.|$)/);
  if (dotted?.[1]) {
    return normalizeLangTag(dotted[1], dotted[2]);
  }

  const matches = [
    ...low.matchAll(/[-_/]([a-z]{2,3})(-[a-z0-9]{2,4})?(?=[-_/.]|$)/g),
  ];
  const last = matches.at(-1);
  if (!last?.[1]) return "";
  return normalizeLangTag(last[1], last[2]);
}

function humanizeAudioKind(
  kind: string | undefined | null,
): string | undefined {
  const k = kind?.trim().toLowerCase();
  if (!k || k === "main") return undefined;
  const map: Record<string, string> = {
    alternative: "Alternative",
    commentary: "Commentary",
    dub: "Dub",
    translation: "Translation",
    descriptions: "Descriptions",
    "main-desc": "Main + descriptions",
  };
  return map[k] ?? `(${k})`;
}

function coalesceLanguageHints(
  ...parts: (string | undefined | null)[]
): string {
  for (const p of parts) {
    const t = typeof p === "string" ? p.trim().replace(/^\./, "") : "";
    if (t && t.toLowerCase() !== "und") return t;
  }
  return "";
}

/**
 * Human-readable label for an audio stream (display name first, then language tag).
 */
export function audioMenuLabel(opts: {
  displayName?: string | null;
  language?: string | null;
  qualityFallback?: string | null;
  index: number;
}): string {
  const display = opts.displayName?.trim();
  if (display) return display;

  const raw = coalesceLanguageHints(opts.language);
  const primary = primaryLanguageSubtag(raw);
  if (primary) {
    const name = intlLanguageName(primary);
    if (name) return name;
    return raw.split(/[.]/)[0]?.toUpperCase() ?? primary.toUpperCase();
  }

  const q = opts.qualityFallback?.trim();
  if (q) return q;
  return `Track ${opts.index + 1}`;
}

/**
 * Resolve a (key, localized name) pair from the same hints used to label an
 * audio track. The `key` is the BCP-47 primary subtag (lowercase) when found,
 * which is suitable for grouping/deduping multi-bitrate tracks of the same
 * language into a single language picker row.
 */
export function audioTrackLanguageInfo(opts: {
  displayName?: string | null;
  language?: string | null;
  trackId?: string | null;
  streamUrl?: string | null;
}): { key: string | null; name: string | null } {
  const raw = coalesceLanguageHints(
    opts.language,
    inferLanguageFromTrackId(opts.trackId),
    languageFromGoogleVideoUrl(opts.streamUrl),
  );
  const primary = primaryLanguageSubtag(raw);
  if (!primary) return { key: null, name: null };
  const localized =
    intlLanguageName(primary) ??
    raw.split(/[.]/)[0]?.toUpperCase() ??
    primary.toUpperCase();
  return { key: primary, name: localized };
}

/**
 * Audio menu row: show the **language** (from BCP-47 / Invidious `language`) via
 * {@link Intl.DisplayNames}; add upstream `displayName` in parentheses only when
 * it is not redundant (e.g. "English (Original)").
 */
export function languageFirstAudioMenuLabel(opts: {
  displayName?: string | null;
  language?: string | null;
  qualityFallback?: string | null;
  /** HLS / internal id; may contain a language suffix. */
  trackId?: string | null;
  kind?: string | null;
  /** Progressive URL (e.g. `lang=` on googlevideo). */
  streamUrl?: string | null;
  index: number;
}): string {
  const raw = coalesceLanguageHints(
    opts.language,
    inferLanguageFromTrackId(opts.trackId),
    languageFromGoogleVideoUrl(opts.streamUrl),
  );
  const primary = primaryLanguageSubtag(raw);
  if (primary) {
    const localized =
      intlLanguageName(primary) ??
      raw.split(/[.]/)[0]?.toUpperCase() ??
      primary.toUpperCase();
    const display = opts.displayName?.trim();
    if (display) {
      if (
        display.localeCompare(localized, undefined, {
          sensitivity: "base",
        }) === 0
      ) {
        return localized;
      }
      const enLabel = intlLanguageName(primary, "en");
      if (
        enLabel &&
        display.localeCompare(enLabel, undefined, { sensitivity: "base" }) === 0
      ) {
        return localized;
      }
      return `${localized} (${display})`;
    }
    return localized;
  }

  const kindLabel = humanizeAudioKind(opts.kind);
  if (kindLabel) return kindLabel;

  return audioMenuLabel({
    displayName: opts.displayName,
    language: null,
    qualityFallback: opts.qualityFallback,
    index: opts.index,
  });
}
