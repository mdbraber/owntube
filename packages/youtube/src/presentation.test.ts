import { describe, expect, it } from "vitest";
import { VISIONOS } from "./clients.ts";
import type { Exchange } from "./fixtures/exchange.ts";
import { readFixture } from "./fixtures/store.ts";
import type { PlayerResult, RawPlayerResponse } from "./player.ts";
import { toPresentation, vp9Codecs } from "./presentation.ts";

/** The recorded VISIONOS player response of a corpus entry, as `requestPlayer` would return it. */
async function visionos(id: string): Promise<PlayerResult> {
  const fixture = await readFixture(id);
  const exchange = fixture.exchanges.find(
    (e: Exchange) =>
      new URL(e.url).pathname.endsWith("/player") &&
      (e.requestBody as { context?: { client?: { clientName?: string } } })
        .context?.client?.clientName === "VISIONOS",
  );
  const raw = exchange?.responseBody as RawPlayerResponse;
  const formats = [
    ...(raw.streamingData?.formats ?? []),
    ...(raw.streamingData?.adaptiveFormats ?? []),
  ].flatMap((f) => (f.url ? [{ ...f, url: f.url }] : []));
  return { identity: VISIONOS, raw, unplayable: null, formats };
}

describe("toPresentation", () => {
  it("offers every dubbed language, with the original marked", async () => {
    const { presentation } = toPresentation(
      await visionos("video-multi-audio"),
    );
    const languages = new Set(presentation.audio.map((a) => a.language));
    expect(languages.size).toBeGreaterThan(10);
    const originals = new Set(
      presentation.audio.filter((a) => a.isOriginal).map((a) => a.language),
    );
    expect(originals).toEqual(new Set(["en-US"]));
    expect(new Set(presentation.audio.map((a) => a.id)).size).toBe(
      presentation.audio.length,
    );
  });

  it("offers the 2160p ladder in all three codec families", async () => {
    const { presentation } = toPresentation(
      await visionos("video-2160p-vp9-av1"),
    );
    expect(Math.max(...presentation.video.map((v) => v.height))).toBe(2160);
    expect(new Set(presentation.video.map((v) => v.family))).toEqual(
      new Set(["avc", "vp9", "av01"]),
    );
    for (const v of presentation.video)
      expect(v.init.end).toBeLessThan(v.index.start);
  });

  it("leaves HDR formats out", async () => {
    const result = await visionos("video-hdr");
    const hdrItags = result.formats
      .filter((f) =>
        /SMPTEST2084|ARIB_STD_B67/.test(
          f.colorInfo?.transferCharacteristics ?? "",
        ),
      )
      .map((f) => `v${f.itag}`);
    const { presentation } = toPresentation(result);
    for (const id of hdrItags)
      expect(presentation.video.map((v) => v.id)).not.toContain(id);
  });

  it("keeps tracks without URLs, for SABR", async () => {
    const result = await visionos("video-h264-captions");
    const { presentation, media } = toPresentation({ ...result, formats: [] });
    expect(presentation.video.length).toBeGreaterThan(0);
    for (const t of presentation.video)
      expect(media.get(t.id)?.url).toBeUndefined();
  });

  it("knows where every track and caption comes from", async () => {
    const { presentation, media, captions } = toPresentation(
      await visionos("video-h264-captions"),
    );
    for (const t of [...presentation.video, ...presentation.audio])
      expect(media.get(t.id)?.url).toMatch(/^https:\/\//);
    expect(presentation.captions.length).toBeGreaterThan(0);
    for (const c of presentation.captions)
      expect(captions.get(c.id)).toMatch(/timedtext/);
    expect(presentation.durationSec).toBeGreaterThan(200);
  });
});

describe("vp9Codecs", () => {
  it("spells VP9 out at the level the picture needs", () => {
    expect(vp9Codecs(256, 144, 30)).toBe("vp09.00.10.08");
    expect(vp9Codecs(1280, 720, 30)).toBe("vp09.00.31.08");
    expect(vp9Codecs(1920, 1080, 30)).toBe("vp09.00.40.08");
    expect(vp9Codecs(1920, 1080, 60)).toBe("vp09.00.41.08");
    expect(vp9Codecs(3840, 2160, 60)).toBe("vp09.00.51.08");
  });

  it("is used for every VP9 track", async () => {
    const { presentation } = toPresentation(
      await visionos("video-2160p-vp9-av1"),
    );
    for (const v of presentation.video.filter((t) => t.family === "vp9"))
      expect(v.codecs).toMatch(/^vp09\.00\.\d\d\.08$/);
  });
});
