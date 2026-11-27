/**
 * Labelling and grouping for audio tracks.
 *
 * The language data itself comes from YouTube: its player response carries
 * `adaptiveFormats[].audioTrack.{id,displayName,audioIsDefault}`, which the
 * gateway lists on the video page (`audioLanguages`) and writes into its
 * HLS/DASH manifests as each track's language and label. This module only turns that into something a picker can
 * show, which is a presentation concern and belongs here rather than upstream —
 * not least because upstream `displayName` is always English while these labels
 * are localised.
 *
 * Nothing here parses stream URLs: scraping language out of googlevideo query
 * strings (`xtags=acont%3Ddubbed%3Alang%3Dfr`) is undocumented and fails
 * silently whenever YouTube changes it.
 */

/**
 * Reduce an upstream language id to a BCP-47 tag `Intl` will accept.
 *
 * Upstream ids are *not* plain tags: YouTube's `audioTrack.id` appends a
 * track discriminator (`en-US.4`, `.fr.3`).
 * Left in place that suffix makes `Intl.DisplayNames` throw `RangeError`, so it
 * has to go, along with a leading dot and any underscore separator.
 *
 * Returns "" for anything unusable — empty, `und`, or not subtag-shaped — so
 * callers get one "no language" answer instead of several.
 */
function normalizeLanguageTag(raw: string | undefined | null): string {
  const cleaned = (raw ?? "").trim().replace(/^\./, "").replace(/_/g, "-");
  const tag = cleaned.split(".")[0] ?? "";
  if (!tag || tag.toLowerCase() === "und") return "";
  // Guard Intl against non-tags like "4" or "".
  if (!/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(tag)) return "";
  return tag;
}

/**
 * Localised language name, or undefined when the platform cannot resolve the
 * tag. `Intl.DisplayNames` reports failure two ways — it throws on a malformed
 * tag and echoes the input back for a well-formed but unknown one — and returns
 * the useless "root" for `und`. All three mean "no name".
 */
function intlLanguageName(
  tag: string,
  locales?: Intl.LocalesArgument,
): string | undefined {
  if (!tag) return undefined;
  try {
    const name = new Intl.DisplayNames(locales, { type: "language" }).of(tag);
    if (!name || name === tag || name === "root") return undefined;
    return name;
  } catch {
    return undefined;
  }
}

/**
 * Most specific name available for a tag: `zh-Hans` should read "Simplified
 * Chinese", not "Chinese", because a multi-language upload commonly offers both
 * `zh-Hans` and `zh-Hant` and collapsing them to "Chinese" makes two different
 * dubs indistinguishable. Falls back to the primary subtag when the platform
 * has no name for the full tag.
 */
function languageDisplayName(
  tag: string,
  locales?: Intl.LocalesArgument,
): string | undefined {
  const full = intlLanguageName(tag, locales);
  if (full) return full;
  const primary = tag.split("-")[0] ?? "";
  if (primary && primary !== tag) return intlLanguageName(primary, locales);
  return undefined;
}

/**
 * Words of a label, ignoring anything numeric. Tokens are split on
 * non-alphanumerics and then any token containing a digit is dropped, so the
 * "131k" of a "French [131k]" bitrate suffix contributes nothing — matching on
 * letters alone would have left a stray "k" behind.
 */
function letterWords(value: string): Set<string> {
  const tokens = value.toLowerCase().match(/[\p{Letter}\p{Number}]+/gu) ?? [];
  return new Set(tokens.filter((t) => !/\p{Number}/u.test(t)));
}

/**
 * Whether an upstream `displayName` says anything the resolved language name
 * does not already say.
 *
 * Most upstream labels are pure restatements of the language, in a handful of
 * shapes: YouTube's track names are "English (US) original" and "Chinese
 * (Simplified)"; some DASH manifests add a bitrate, "French [131k]". Appending those
 * produces "Simplified Chinese (Chinese (Simplified))". But some labels are
 * genuinely extra — "Commentary", "Descriptions", a director's track — and
 * dropping those would lose the only thing distinguishing two tracks of the
 * same language.
 *
 * So compare at word level: if every word of the display name is already
 * implied by the language, the script/region subtags, or a boilerplate marker,
 * it adds nothing. Bitrates and other non-letter noise are ignored.
 */
function displayNameAddsInformation(
  display: string,
  tag: string,
  localized: string,
): boolean {
  const words = letterWords(display);
  if (words.size === 0) return false;

  const implied = new Set<string>(["original", "default", "audio", "track"]);
  const add = (value: string | undefined) => {
    if (!value) return;
    for (const word of letterWords(value)) implied.add(word);
  };

  add(localized);
  const primary = tag.split("-")[0] ?? "";
  // Both locales: the label may restate the language in the viewer's language
  // or, as upstream always does, in English.
  for (const locales of [undefined, "en"] as const) {
    add(languageDisplayName(tag, locales));
    add(intlLanguageName(primary, locales));
  }

  // Script and region subtags, e.g. the "Simplified" in "Chinese (Simplified)"
  // or the "US" in "English (US)" — already carried by the tag we resolved.
  for (const subtag of tag.split("-").slice(1)) {
    implied.add(subtag.toLowerCase());
    for (const type of ["script", "region"] as const) {
      try {
        add(new Intl.DisplayNames(undefined, { type }).of(subtag));
      } catch {
        // Not a subtag of this type; the next one may match.
      }
    }
  }

  for (const word of words) if (!implied.has(word)) return true;
  return false;
}

/**
 * Whether a track's own label marks it as the original (undubbed) audio.
 *
 * Prefer the mapped `audioIsOriginal` (read from the stream's `xtags`) where
 * it exists; this is the fallback for HLS/DASH
 * manifests, which only ever give a human label.
 */
export function displayNameMarksOriginalAudio(
  displayName: string | null | undefined,
): boolean {
  return /\boriginal\b/i.test(displayName?.trim() ?? "");
}

/**
 * Human-readable label for an audio stream (display name first, then language
 * tag). Used when the language-first label has no language to work with.
 */
export function audioMenuLabel(opts: {
  displayName?: string | null;
  language?: string | null;
  qualityFallback?: string | null;
  index: number;
}): string {
  const display = opts.displayName?.trim();
  if (display) return display;

  const tag = normalizeLanguageTag(opts.language);
  if (tag) return languageDisplayName(tag) ?? tag.toUpperCase();

  const quality = opts.qualityFallback?.trim();
  if (quality) return quality;
  return `Track ${opts.index + 1}`;
}

/**
 * Resolve a (key, localized name) pair for an audio track.
 *
 * `key` is the normalised full language tag, suitable for grouping the several
 * bitrates of one track into a single picker row. It is deliberately the *full*
 * tag rather than the primary subtag: `zh-Hans` and `zh-Hant` are different
 * dubs, and keying on `zh` merged them, leaving one of the two unreachable.
 */
export function audioTrackLanguageInfo(opts: {
  displayName?: string | null;
  language?: string | null;
}): { key: string | null; name: string | null } {
  const tag = normalizeLanguageTag(opts.language);
  if (!tag) return { key: null, name: null };
  return {
    key: tag.toLowerCase(),
    name: languageDisplayName(tag) ?? tag.toUpperCase(),
  };
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

/**
 * Audio menu row: lead with the **language**, localised via
 * {@link Intl.DisplayNames}, and append upstream's own `displayName` only when
 * it carries information the language name does not.
 */
export function languageFirstAudioMenuLabel(opts: {
  displayName?: string | null;
  language?: string | null;
  qualityFallback?: string | null;
  kind?: string | null;
  index: number;
}): string {
  const tag = normalizeLanguageTag(opts.language);
  if (tag) {
    const localized = languageDisplayName(tag) ?? tag.toUpperCase();
    const display = opts.displayName?.trim();
    if (display && displayNameAddsInformation(display, tag, localized)) {
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
