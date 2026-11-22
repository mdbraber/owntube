import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/server/db/client", () => ({ getDb: vi.fn() }));
vi.mock("@/server/services/proxy", () => ({ fetchVideoDetail: vi.fn() }));
vi.mock("@/server/trpc/caller", () => ({ createCaller: vi.fn() }));
const generateMpd = vi.fn();
vi.mock("@/server/services/dash/generate", () => ({
  DASH_VIDEO_FAMILIES: ["vp9", "av01", "avc"],
  generateMpd: (...args: unknown[]) => generateMpd(...args),
  vodCaptionAdaptationSets: vi.fn(async () => CAPTIONS_XML),
}));

const { GET } = await import("./[...parts]/route");

const COMPANION = "http://companion.internal";
const VIDEO = "dQw4w9WgXcQ";
const CAPTIONS_XML = `    <AdaptationSet id="100" contentType="text" mimeType="text/vtt" lang="en"><Representation id="cap-100" bandwidth="256"><BaseURL>/captions/${VIDEO}?lang=en</BaseURL></Representation></AdaptationSet>`;
const FORMATS_MPD = '<MPD type="static"><!-- byte-range --></MPD>';

const companionMpd = `<MPD xmlns="urn:mpeg:dash:schema:mpd:2011" type="static" mediaPresentationDuration="PT212S">
  <Period>
    <AdaptationSet mimeType="video/mp4">
      <SegmentTemplate timescale="90000" startNumber="1" initialization="$RepresentationID$/init.mp4" media="$RepresentationID$/seg-$Number$.m4s">
        <SegmentTimeline><S d="450450" r="3"/></SegmentTimeline>
      </SegmentTemplate>
      <Representation id="v360" codecs="avc1.4d401e" width="640" height="360" bandwidth="500000"/>
      <Representation id="v1080" codecs="avc1.640028" width="1920" height="1080" bandwidth="3000000"/>
    </AdaptationSet>
    <AdaptationSet contentType="text" mimeType="text/vtt" lang="en"><Representation id="cap-en" bandwidth="0"><BaseURL>../../api/v1/captions/${VIDEO}?lang=en</BaseURL></Representation></AdaptationSet>
  </Period>
</MPD>`;

const segment = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);

function get(path: string): Promise<Response> {
  const parts = path.split("?")[0]?.split("/").filter(Boolean).slice(1) ?? [];
  return GET(new Request(`http://owntube.test${path}`), {
    params: Promise.resolve({ parts }),
  });
}

let fetchMock: ReturnType<typeof vi.fn>;
const requested = () =>
  fetchMock.mock.calls.map(([u]) =>
    String(u)
      .replace(COMPANION, "")
      .replace(/[?&]check=[^&]*/, ""),
  );

beforeEach(() => {
  vi.stubEnv("INVIDIOUS_COMPANION_INTERNAL_URL", COMPANION);
  vi.stubEnv("INVIDIOUS_COMPANION_SECRET_KEY", "");
  vi.stubEnv("INVIDIOUS_COMPANION_SABR_VOD", "");
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  generateMpd.mockReset();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("/dash/<id>/manifest.mpd with INVIDIOUS_COMPANION_SABR_VOD", () => {
  it("off: never touches the companion's connector", async () => {
    generateMpd.mockResolvedValue(FORMATS_MPD);
    const r = await get(`/dash/${VIDEO}/manifest.mpd?video=vp9`);
    expect(r.status).toBe(200);
    expect(await r.text()).toBe(FORMATS_MPD);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("always: serves the connector's manifest on our segment proxy, with our captions", async () => {
    vi.stubEnv("INVIDIOUS_COMPANION_SABR_VOD", "always");
    fetchMock.mockResolvedValue(new Response(companionMpd));
    const r = await get(
      `/dash/${VIDEO}/manifest.mpd?video=vp9&maxHeight=720&lang=de`,
    );
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toBe("application/dash+xml");
    expect(r.headers.get("cache-control")).toBe("no-store");
    const body = await r.text();
    expect(body).toContain(
      `initialization="/dash/${VIDEO}/sabr/$RepresentationID$/init.mp4" media="/dash/${VIDEO}/sabr/$RepresentationID$/seg-$Number$.m4s"`,
    );
    expect(body).toContain('id="v360"');
    expect(body).not.toContain('id="v1080"');
    expect(body).toContain(CAPTIONS_XML);
    expect(body).not.toContain("api/v1/captions");
    expect(requested()).toEqual([
      `/companion/sabr/${VIDEO}/manifest.mpd?audio=de`,
    ]);
    expect(generateMpd).not.toHaveBeenCalled();
  });

  it("always: falls back to byte-range formats when the connector has nothing", async () => {
    vi.stubEnv("INVIDIOUS_COMPANION_SABR_VOD", "always");
    fetchMock.mockResolvedValue(new Response("boom", { status: 500 }));
    generateMpd.mockResolvedValue(FORMATS_MPD);
    const r = await get(`/dash/${VIDEO}/manifest.mpd`);
    expect(r.status).toBe(200);
    expect(await r.text()).toBe(FORMATS_MPD);
    expect(generateMpd).toHaveBeenCalledTimes(1);
  });

  it("fallback: byte-range formats first, the connector only when they fail", async () => {
    vi.stubEnv("INVIDIOUS_COMPANION_SABR_VOD", "fallback");
    generateMpd.mockResolvedValueOnce(FORMATS_MPD);
    let r = await get(`/dash/${VIDEO}/manifest.mpd`);
    expect(await r.text()).toBe(FORMATS_MPD);
    expect(fetchMock).not.toHaveBeenCalled();

    generateMpd.mockRejectedValueOnce(new Error("no usable adaptive video"));
    fetchMock.mockResolvedValue(new Response(companionMpd));
    r = await get(`/dash/${VIDEO}/manifest.mpd`);
    expect(r.status).toBe(200);
    expect(await r.text()).toContain(`/dash/${VIDEO}/sabr/`);
    expect(requested()).toEqual([`/companion/sabr/${VIDEO}/manifest.mpd`]);
  });

  it("fallback: a dynamic (live/DVR) answer from the connector is skipped for the DVR route", async () => {
    vi.stubEnv("INVIDIOUS_COMPANION_SABR_VOD", "fallback");
    generateMpd.mockRejectedValueOnce(new Error("no usable adaptive video"));
    fetchMock
      .mockResolvedValueOnce(
        new Response(
          '<MPD type="dynamic"><Period><Representation id="1"><BaseURL>live/-/1/</BaseURL></Representation></Period></MPD>',
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          '<MPD type="static"><Period><AdaptationSet><SegmentTemplate media="http://companion.internal/companion/videoplayback/seg$Number$"/><Representation id="1"/></AdaptationSet></Period></MPD>',
        ),
      );
    const r = await get(`/dash/${VIDEO}/manifest.mpd`);
    expect(r.status).toBe(200);
    expect(requested()).toEqual([
      `/companion/sabr/${VIDEO}/manifest.mpd`,
      `/companion/api/manifest/dash/id/${VIDEO}?local=true`,
    ]);
  });
});

describe("/dash/<id>/sabr/<track>/<file>", () => {
  it("proxies a segment from the connector", async () => {
    fetchMock.mockResolvedValue(
      new Response(segment, {
        headers: {
          "content-type": "video/iso.segment",
          "cache-control": "private, max-age=3600",
        },
      }),
    );
    const r = await get(`/dash/${VIDEO}/sabr/v720/seg-12.m4s`);
    expect(r.status).toBe(200);
    expect(new Uint8Array(await r.arrayBuffer())).toEqual(segment);
    expect(r.headers.get("content-type")).toBe("video/iso.segment");
    expect(r.headers.get("content-length")).toBe(String(segment.byteLength));
    expect(r.headers.get("cache-control")).toBe("private, max-age=3600");
    expect(requested()).toEqual([`/companion/sabr/${VIDEO}/v720/seg-12.m4s`]);
  });

  it("re-requests the manifest and retries once when the companion lost the session", async () => {
    fetchMock
      .mockResolvedValueOnce(
        new Response("Video not prepared.", { status: 404 }),
      )
      .mockResolvedValueOnce(new Response(companionMpd))
      .mockResolvedValueOnce(new Response(segment));
    const r = await get(`/dash/${VIDEO}/sabr/a-140/init.mp4`);
    expect(r.status).toBe(200);
    expect(requested()).toEqual([
      `/companion/sabr/${VIDEO}/a-140/init.mp4`,
      `/companion/sabr/${VIDEO}/manifest.mpd`,
      `/companion/sabr/${VIDEO}/a-140/init.mp4`,
    ]);
  });

  it("serves only ftyp+moov of an init segment, dropping the trailing sidx", async () => {
    const box = (type: string, payload: number) => {
      const b = new Uint8Array(8 + payload).fill(7);
      new DataView(b.buffer).setUint32(0, b.byteLength);
      b.set(
        [...type].map((c) => c.charCodeAt(0)),
        4,
      );
      return b;
    };
    const ftyp = box("ftyp", 4);
    const moov = box("moov", 16);
    const sidx = box("sidx", 32);
    const init = new Uint8Array([...ftyp, ...moov, ...sidx]);
    fetchMock.mockResolvedValue(new Response(init));
    const r = await get(`/dash/${VIDEO}/sabr/v720/init.mp4`);
    const out = new Uint8Array(await r.arrayBuffer());
    expect(out).toEqual(new Uint8Array([...ftyp, ...moov]));
    expect(r.headers.get("content-length")).toBe(String(out.byteLength));

    fetchMock.mockResolvedValue(new Response(init));
    const seg = await get(`/dash/${VIDEO}/sabr/v720/seg-3.m4s`);
    expect(new Uint8Array(await seg.arrayBuffer())).toEqual(init);
  });

  it("passes a not-ready 503 through for the player to retry", async () => {
    fetchMock.mockResolvedValue(
      new Response("Segment not ready; retry.", { status: 503 }),
    );
    const r = await get(`/dash/${VIDEO}/sabr/v720/seg-12.m4s`);
    expect(r.status).toBe(503);
    expect(r.headers.get("retry-after")).toBe("1");
  });

  it("rejects paths outside the segment shape", async () => {
    for (const path of [
      `/dash/${VIDEO}/sabr/v720/seg-12.mp4`,
      `/dash/${VIDEO}/sabr/v720/init.mp4/extra`,
      `/dash/${VIDEO}/sabr/../v720/init.mp4`,
      `/dash/${VIDEO}/sabr/v720`,
    ]) {
      expect((await get(path)).status).toBe(404);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
