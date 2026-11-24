import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  companionSabrVodSegmentUrl,
  fetchCompanionSabrVodManifest,
  rewriteSabrVodManifest,
  sabrVodMode,
} from "./sabr-vod";

const VIDEO = "dQw4w9WgXcQ";
const COMPANION = "http://companion.internal";

/** What the companion's `/sabr/<id>/manifest.mpd` serves for a VOD. */
const companionMpd = `<?xml version="1.0" encoding="utf-8"?>
<MPD xmlns="urn:mpeg:dash:schema:mpd:2011" profiles="urn:mpeg:dash:profile:isoff-live:2011"
     type="static" mediaPresentationDuration="PT212S" minBufferTime="PT4S">
  <Period>
    <AdaptationSet mimeType="video/mp4" segmentAlignment="true" startWithSAP="1">
      <SegmentTemplate timescale="90000" startNumber="1"
                       initialization="$RepresentationID$/init.mp4?check=abc" media="$RepresentationID$/seg-$Number$.m4s?check=abc">
        <SegmentTimeline>
          <S d="450450" r="3"/>
        </SegmentTimeline>
      </SegmentTemplate>
      <Representation id="v360" codecs="avc1.4d401e" width="640" height="360" bandwidth="500000"/>
      <Representation id="v720" codecs="avc1.4d401f" width="1280" height="720" bandwidth="1500000"/>
      <Representation id="v1080" codecs="avc1.640028" width="1920" height="1080" bandwidth="3000000"/>
    </AdaptationSet>
    <AdaptationSet mimeType="audio/mp4" segmentAlignment="true" startWithSAP="1">
      <SegmentTemplate timescale="44100" startNumber="1"
                       initialization="$RepresentationID$/init.mp4?check=abc" media="$RepresentationID$/seg-$Number$.m4s?check=abc">
        <SegmentTimeline>
          <S d="220500" r="3"/>
        </SegmentTimeline>
      </SegmentTemplate>
      <Representation id="a-140" codecs="mp4a.40.2" audioSamplingRate="44100" bandwidth="128000"/>
    </AdaptationSet>
    <AdaptationSet contentType="text" mimeType="text/vtt" lang="en">
      <Label>English</Label>
      <Representation id="cap-en" bandwidth="0">
        <BaseURL>../../api/v1/captions/${VIDEO}?lang=en&amp;check=abc</BaseURL>
      </Representation>
    </AdaptationSet>
  </Period>
</MPD>
`;

describe("sabrVodMode", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("is off unless configured", () => {
    vi.stubEnv("INVIDIOUS_COMPANION_SABR_VOD", "");
    expect(sabrVodMode()).toBe("off");
    vi.stubEnv("INVIDIOUS_COMPANION_SABR_VOD", "nonsense");
    expect(sabrVodMode()).toBe("off");
  });

  it("reads fallback and always (with boolean spellings)", () => {
    vi.stubEnv("INVIDIOUS_COMPANION_SABR_VOD", "fallback");
    expect(sabrVodMode()).toBe("fallback");
    for (const v of ["always", "on", "true", "1", " ALWAYS "]) {
      vi.stubEnv("INVIDIOUS_COMPANION_SABR_VOD", v);
      expect(sabrVodMode()).toBe("always");
    }
  });
});

describe("rewriteSabrVodManifest", () => {
  it("points the template at /dash/<id>/sabr/ and drops the companion's captions", () => {
    const out = rewriteSabrVodManifest(companionMpd, VIDEO);
    expect(out).not.toBeNull();
    expect(out).toContain(
      `initialization="/dash/${VIDEO}/sabr/$RepresentationID$/init.mp4" media="/dash/${VIDEO}/sabr/$RepresentationID$/seg-$Number$.m4s"`,
    );
    expect(out).not.toContain("check=");
    expect(out).not.toContain('contentType="text"');
    expect(out).not.toContain("api/v1/captions");
    // Both media sets survive, with their timelines.
    expect(out?.match(/<SegmentTemplate/g)).toHaveLength(2);
    expect(out).toContain('<S d="450450" r="3"/>');
  });

  it("appends our caption sets inside the Period", () => {
    const captionsXml =
      '    <AdaptationSet id="100" contentType="text" mimeType="text/vtt" lang="en">\n' +
      `      <Representation id="cap-100" bandwidth="256"><BaseURL>/captions/${VIDEO}?lang=en</BaseURL></Representation>\n` +
      "    </AdaptationSet>";
    const out = rewriteSabrVodManifest(companionMpd, VIDEO, { captionsXml });
    expect(out).toContain(`${captionsXml}\n  </Period>`);
    expect(out?.match(/contentType="text"/g)).toHaveLength(1);
  });

  it("caps the video ladder at maxHeight", () => {
    const out = rewriteSabrVodManifest(companionMpd, VIDEO, { maxHeight: 720 });
    expect(out).toContain('id="v360"');
    expect(out).toContain('id="v720"');
    expect(out).not.toContain('id="v1080"');
    expect(out).toContain('id="a-140"');
  });

  it("keeps the whole ladder when the cap would remove every rung", () => {
    const out = rewriteSabrVodManifest(companionMpd, VIDEO, { maxHeight: 144 });
    expect(out).toContain('id="v360"');
    expect(out).toContain('id="v1080"');
  });

  it("returns null for a manifest without the connector's template", () => {
    const dvr =
      '<MPD type="static"><Period><AdaptationSet><SegmentTemplate media="https://x/seg$Number$"/>' +
      '<Representation id="1"/></AdaptationSet></Period></MPD>';
    expect(rewriteSabrVodManifest(dvr, VIDEO)).toBeNull();
  });
});

describe("fetchCompanionSabrVodManifest", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    vi.stubEnv("INVIDIOUS_COMPANION_INTERNAL_URL", COMPANION);
    vi.stubEnv("INVIDIOUS_COMPANION_SECRET_KEY", "");
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("fetches the connector's manifest, passing an audio language through", async () => {
    fetchMock.mockImplementation(async () => new Response(companionMpd));
    expect(await fetchCompanionSabrVodManifest(VIDEO)).toBe(companionMpd);
    expect(await fetchCompanionSabrVodManifest(VIDEO, "de")).toBe(companionMpd);
    expect(fetchMock.mock.calls.map(([u]) => String(u))).toEqual([
      `${COMPANION}/companion/sabr/${VIDEO}/manifest.mpd`,
      `${COMPANION}/companion/sabr/${VIDEO}/manifest.mpd?audio=de`,
    ]);
  });

  it("asks for a codec family's ladder, but not for avc (the default)", async () => {
    fetchMock.mockImplementation(async () => new Response(companionMpd));
    await fetchCompanionSabrVodManifest(VIDEO, null, "vp9");
    await fetchCompanionSabrVodManifest(VIDEO, "de", "av01");
    await fetchCompanionSabrVodManifest(VIDEO, null, "avc");
    expect(fetchMock.mock.calls.map(([u]) => String(u))).toEqual([
      `${COMPANION}/companion/sabr/${VIDEO}/manifest.mpd?video=vp9`,
      `${COMPANION}/companion/sabr/${VIDEO}/manifest.mpd?audio=de&video=av01`,
      `${COMPANION}/companion/sabr/${VIDEO}/manifest.mpd`,
    ]);
  });

  it("rejects a live (dynamic) manifest and a DVR redirect target", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        '<MPD type="dynamic"><Period><Representation id="1"><BaseURL>live/-/1/</BaseURL></Representation></Period></MPD>',
      ),
    );
    expect(await fetchCompanionSabrVodManifest(VIDEO)).toBeNull();
    fetchMock.mockResolvedValueOnce(
      new Response(
        '<MPD type="static"><Period><SegmentTemplate media="https://x/$Number$"/><Representation id="1"/></Period></MPD>',
      ),
    );
    expect(await fetchCompanionSabrVodManifest(VIDEO)).toBeNull();
  });

  it("is null on an error status, a network failure, or no companion", async () => {
    fetchMock.mockResolvedValueOnce(new Response("nope", { status: 500 }));
    expect(await fetchCompanionSabrVodManifest(VIDEO)).toBeNull();
    fetchMock.mockRejectedValueOnce(new Error("ECONNREFUSED"));
    expect(await fetchCompanionSabrVodManifest(VIDEO)).toBeNull();
    vi.stubEnv("INVIDIOUS_COMPANION_INTERNAL_URL", "");
    vi.stubEnv("INVIDIOUS_PUBLIC_BASE_URL", "");
    expect(await fetchCompanionSabrVodManifest(VIDEO)).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("companionSabrVodSegmentUrl", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("signs the companion's segment path", () => {
    vi.stubEnv("INVIDIOUS_COMPANION_INTERNAL_URL", COMPANION);
    vi.stubEnv("INVIDIOUS_COMPANION_SECRET_KEY", "0123456789abcdef");
    const url = companionSabrVodSegmentUrl(VIDEO, "v720", "seg-12.m4s");
    expect(url).toMatch(
      new RegExp(
        `^${COMPANION}/companion/sabr/${VIDEO}/v720/seg-12\\.m4s\\?check=[\\w%=-]+$`,
      ),
    );
  });
});
