import { describe, expect, it } from "vitest";
import {
  audioTrackLanguageInfo,
  displayNameMarksOriginalAudio,
  languageFirstAudioMenuLabel,
} from "@/lib/audio-track-label";

/**
 * Real `adaptiveFormats[].audioTrack` values from YouTube for `0e3GPea1Tyg`,
 * a 24-language upload. `language` is `audioTrack.id` with the `.N`
 * discriminator stripped, as the gateway lists it.
 */
const UPSTREAM = {
  englishOriginal: { language: "en-US", displayName: "English (US) original" },
  french: { language: "fr", displayName: "French" },
  simplified: { language: "zh-Hans", displayName: "Chinese (Simplified)" },
  traditional: { language: "zh-Hant", displayName: "Chinese (Traditional)" },
};

describe("audioTrackLanguageInfo", () => {
  it("keys on the full tag so zh-Hans and zh-Hant stay distinct", () => {
    const simplified = audioTrackLanguageInfo(UPSTREAM.simplified);
    const traditional = audioTrackLanguageInfo(UPSTREAM.traditional);
    expect(simplified.key).toBe("zh-hans");
    expect(traditional.key).toBe("zh-hant");
    expect(simplified.key).not.toBe(traditional.key);
    // …and names them apart, rather than calling both "Chinese".
    expect(simplified.name).not.toBe(traditional.name);
  });

  it("groups the several bitrates of one track under one key", () => {
    const a = audioTrackLanguageInfo(UPSTREAM.french);
    const b = audioTrackLanguageInfo(UPSTREAM.french);
    expect(a.key).toBe(b.key);
    expect(a.key).toBe("fr");
  });

  it("tolerates an unstripped track discriminator", () => {
    expect(audioTrackLanguageInfo({ language: "en-US.4" }).key).toBe("en-us");
    expect(audioTrackLanguageInfo({ language: ".fr.3" }).key).toBe("fr");
  });

  it("returns nulls when there is no usable language", () => {
    for (const language of [null, undefined, "", "und", "4"]) {
      const info = audioTrackLanguageInfo({ language });
      expect(info.key, `language=${String(language)}`).toBeNull();
      expect(info.name).toBeNull();
    }
  });
});

describe("languageFirstAudioMenuLabel", () => {
  it("does not restate the language that the tag already carries", () => {
    // Upstream "English (US) original" and "Chinese (Simplified)" used to
    // produce "English (English (US) original)" / "Chinese (Chinese
    // (Simplified))" once these fields started arriving.
    for (const track of [UPSTREAM.englishOriginal, UPSTREAM.simplified]) {
      const label = languageFirstAudioMenuLabel({ ...track, index: 0 });
      expect(label, JSON.stringify(track)).not.toContain("(");
    }
  });

  it("ignores a bitrate suffix on a DASH manifest label", () => {
    // Some DASH manifests label tracks "<displayName> [<bitrate>k]".
    expect(
      languageFirstAudioMenuLabel({
        language: "fr",
        displayName: "French [131k]",
        index: 0,
      }),
    ).toBe(audioTrackLanguageInfo({ language: "fr" }).name);
  });

  it("keeps a display name that says something the language does not", () => {
    const label = languageFirstAudioMenuLabel({
      language: "en",
      displayName: "Commentary",
      index: 0,
    });
    expect(label).toMatch(/Commentary/);
    expect(label).toMatch(/\(/);
  });

  it("names the script, not just the language", () => {
    const simplified = languageFirstAudioMenuLabel({
      ...UPSTREAM.simplified,
      index: 0,
    });
    const traditional = languageFirstAudioMenuLabel({
      ...UPSTREAM.traditional,
      index: 1,
    });
    expect(simplified).not.toBe(traditional);
  });

  it("falls back to display name, then kind, then quality, then index", () => {
    expect(
      languageFirstAudioMenuLabel({
        language: null,
        displayName: "Stereo",
        qualityFallback: "medium",
        index: 1,
      }),
    ).toBe("Stereo");
    expect(
      languageFirstAudioMenuLabel({
        language: null,
        displayName: null,
        kind: "commentary",
        qualityFallback: "medium",
        index: 0,
      }),
    ).toBe("Commentary");
    expect(
      languageFirstAudioMenuLabel({
        language: undefined,
        displayName: null,
        qualityFallback: "high",
        index: 0,
      }),
    ).toBe("high");
    expect(
      languageFirstAudioMenuLabel({
        language: null,
        displayName: null,
        qualityFallback: null,
        index: 2,
      }),
    ).toBe("Track 3");
  });

  it("never emits a raw tag when the platform can name it", () => {
    for (const language of ["fr", "pt-BR", "zh-Hant", "en-US"]) {
      const label = languageFirstAudioMenuLabel({ language, index: 0 });
      expect(label, language).not.toBe(language);
      expect(label).toMatch(/\p{Letter}/u);
    }
  });
});

describe("displayNameMarksOriginalAudio", () => {
  it("reads an explicit original marker out of a manifest label", () => {
    expect(displayNameMarksOriginalAudio("English original")).toBe(true);
    expect(displayNameMarksOriginalAudio("Original")).toBe(true);
    expect(displayNameMarksOriginalAudio("French")).toBe(false);
    expect(displayNameMarksOriginalAudio(null)).toBe(false);
    expect(displayNameMarksOriginalAudio(undefined)).toBe(false);
  });
});
