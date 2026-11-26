import type { VideoDetail } from "@web/server/catalog/types";

/**
 * Audio languages of a multi-audio (dubbed) video, as the gateway lists them
 * on the video page: original first, which is also the manifest's default.
 */

export type AudioLanguageOption = {
  /** The tag the gateway's manifest `lang=` filter takes. */
  lang: string;
  label: string;
  isOriginal: boolean;
};

/** Hermes has no Intl.DisplayNames; cover the common dub languages, then guard-try. */
const LANGUAGE_NAMES: Record<string, string> = {
  en: "English",
  nl: "Dutch",
  de: "German",
  fr: "French",
  es: "Spanish",
  pt: "Portuguese",
  it: "Italian",
  pl: "Polish",
  tr: "Turkish",
  ru: "Russian",
  uk: "Ukrainian",
  ar: "Arabic",
  hi: "Hindi",
  id: "Indonesian",
  ja: "Japanese",
  ko: "Korean",
  th: "Thai",
  vi: "Vietnamese",
  zh: "Chinese",
};

/** "Dutch" for "nl-NL" (English names; the code itself when unknown). */
export function languageName(lang: string): string {
  const primary = lang.split("-")[0]?.toLowerCase() ?? lang;
  const mapped = LANGUAGE_NAMES[primary];
  if (mapped) return mapped;
  try {
    const DisplayNames = (
      Intl as unknown as {
        DisplayNames?: new (
          locales: string[],
          options: { type: string },
        ) => { of(code: string): string | undefined };
      }
    ).DisplayNames;
    if (DisplayNames) {
      const name = new DisplayNames(["en"], { type: "language" }).of(primary);
      if (name && name !== primary) return name;
    }
  } catch {
    // fall through to the raw tag
  }
  return lang.toUpperCase();
}

/**
 * Distinct audio languages of a video, ORIGINAL FIRST. Empty unless there are
 * at least two, so callers can use the length to decide whether to offer a
 * chooser.
 */
export function audioLanguageOptions(
  detail: Pick<VideoDetail, "audioLanguages">,
): AudioLanguageOption[] {
  const list = detail.audioLanguages ?? [];
  if (list.length < 2) return [];
  return list.map(({ language, isOriginal }) => ({
    lang: language,
    isOriginal,
    label: isOriginal
      ? `${languageName(language)} (Original)`
      : languageName(language),
  }));
}
