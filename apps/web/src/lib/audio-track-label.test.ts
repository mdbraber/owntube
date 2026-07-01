import { describe, expect, it } from "vitest";
import {
  audioTrackLanguageInfo,
  languageFirstAudioMenuLabel,
  streamLooksLikeOriginalAudio,
} from "@/lib/audio-track-label";

describe("languageFirstAudioMenuLabel", () => {
  it("adds displayName in parentheses when it differs from resolved language", () => {
    expect(
      languageFirstAudioMenuLabel({
        language: "en",
        displayName: "Original",
        qualityFallback: null,
        index: 0,
      }),
    ).toMatch(/Original/);
  });

  it("does not parenthesize English display when it matches the en autonym", () => {
    const s = languageFirstAudioMenuLabel({
      language: "en",
      displayName: "English",
      qualityFallback: null,
      index: 0,
    });
    expect(s).not.toContain("(");
  });

  it("reads lang= from googlevideo-style stream URL when metadata is missing", () => {
    const s = languageFirstAudioMenuLabel({
      language: null,
      displayName: null,
      qualityFallback: "medium",
      streamUrl:
        "https://rr1---sn.example.com/videoplayback?expire=1&lang=fr&itag=140",
      index: 0,
    });
    expect(s).not.toBe("medium");
    expect(s).not.toMatch(/^Track \d+$/);
  });

  it("falls back to displayName or quality when no language tag", () => {
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
        language: undefined,
        displayName: null,
        qualityFallback: "high",
        index: 0,
      }),
    ).toBe("high");
  });

  it("decodes language from URL-encoded xtags (acont/lang/variant)", () => {
    const s = languageFirstAudioMenuLabel({
      language: null,
      displayName: null,
      qualityFallback: "medium",
      streamUrl:
        "https://rr1---sn.example.com/videoplayback?expire=1&xtags=acont%3Doriginal%3Alang%3Den-US%3Avariant%3Dmain&itag=140",
      index: 0,
    });
    expect(s).not.toBe("medium");
    expect(s).not.toMatch(/^Track \d+$/);
    // Localised name from Intl.DisplayNames; assert against the en label we
    // resolve via audioTrackLanguageInfo too (avoids hard-coding system locale).
    const info = audioTrackLanguageInfo({
      language: null,
      streamUrl:
        "https://rr1---sn.example.com/videoplayback?expire=1&xtags=acont%3Doriginal%3Alang%3Den-US%3Avariant%3Dmain&itag=140",
    });
    expect(info.key).toBe("en");
    expect(s).toBe(info.name);
  });

  it("decodes language from already-decoded xtags", () => {
    const s = languageFirstAudioMenuLabel({
      language: null,
      displayName: null,
      qualityFallback: null,
      streamUrl:
        "https://rr1---sn.example.com/videoplayback?xtags=acont=original:lang=fr-FR:variant=main&itag=140",
      index: 0,
    });
    expect(s).not.toMatch(/^Track \d+$/);
    const info = audioTrackLanguageInfo({
      language: null,
      streamUrl:
        "https://rr1---sn.example.com/videoplayback?xtags=acont=original:lang=fr-FR:variant=main&itag=140",
    });
    expect(info.key).toBe("fr");
  });

  it("decodes language from xtags survived on /invidious/... rewrite", () => {
    const s = languageFirstAudioMenuLabel({
      language: null,
      displayName: null,
      qualityFallback: null,
      streamUrl:
        "https://owntube.example.org/invidious/videoplayback?expire=1&xtags=acont%3Doriginal%3Alang%3Dde%3Avariant%3Dmain&itag=140",
      index: 1,
    });
    expect(s).not.toMatch(/^Track \d+$/);
    const info = audioTrackLanguageInfo({
      language: null,
      streamUrl:
        "https://owntube.example.org/invidious/videoplayback?expire=1&xtags=acont%3Doriginal%3Alang%3Dde%3Avariant%3Dmain&itag=140",
    });
    expect(info.key).toBe("de");
  });

  it("reads audioTrackId style language hints from URL", () => {
    const info = audioTrackLanguageInfo({
      language: null,
      streamUrl:
        "https://owntube.example.org/invidious/videoplayback?audioTrackId=.pt-BR.4&itag=251",
    });
    expect(info.key).toBe("pt");
    const s = languageFirstAudioMenuLabel({
      language: null,
      displayName: null,
      qualityFallback: null,
      streamUrl:
        "https://owntube.example.org/invidious/videoplayback?audioTrackId=.pt-BR.4&itag=251",
      index: 0,
    });
    expect(s).not.toMatch(/^Track \d+$/);
  });

  it("infers language from a dotted Invidious trackId", () => {
    const info = audioTrackLanguageInfo({
      language: null,
      trackId: ".es.5",
    });
    expect(info.key).toBe("es");
    const s = languageFirstAudioMenuLabel({
      language: null,
      displayName: null,
      qualityFallback: null,
      trackId: ".es.5",
      index: 0,
    });
    expect(s).not.toMatch(/^Track \d+$/);
  });
});

describe("audioTrackLanguageInfo", () => {
  it("returns a key when language is encoded only inside xtags", () => {
    const info = audioTrackLanguageInfo({
      language: null,
      displayName: null,
      streamUrl:
        "https://rr1---sn.example.com/videoplayback?xtags=acont%3Doriginal%3Alang%3Den-US%3Avariant%3Dmain",
    });
    expect(info.key).toBe("en");
    expect(info.name).toBeTruthy();
    expect(info.name).not.toMatch(/^Track \d+$/);
  });

  it("returns null for URLs without any language hint", () => {
    const info = audioTrackLanguageInfo({
      language: null,
      displayName: null,
      streamUrl: "https://rr1---sn.example.com/videoplayback?itag=140",
    });
    expect(info.key).toBeNull();
  });

  it("groups two languages by distinct keys via xtags", () => {
    const en = audioTrackLanguageInfo({
      language: null,
      streamUrl:
        "https://rr1---sn.example.com/videoplayback?xtags=lang%3Den&itag=140",
    });
    const fr = audioTrackLanguageInfo({
      language: null,
      streamUrl:
        "https://rr1---sn.example.com/videoplayback?xtags=lang%3Dfr&itag=140",
    });
    expect(en.key).toBe("en");
    expect(fr.key).toBe("fr");
    expect(en.key).not.toBe(fr.key);
  });
});

describe("streamLooksLikeOriginalAudio", () => {
  it("detects Original from Invidious displayName", () => {
    expect(streamLooksLikeOriginalAudio({ displayName: "Original" })).toBe(
      true,
    );
    expect(streamLooksLikeOriginalAudio({ displayName: "French" })).toBe(false);
  });

  it("detects acont=original inside URL-encoded xtags", () => {
    expect(
      streamLooksLikeOriginalAudio({
        displayName: null,
        streamUrl:
          "https://g.example/videoplayback?xtags=acont%3Doriginal%3Alang%3Den-US",
      }),
    ).toBe(true);
  });
});
