import { describe, expect, it } from "vitest";
import { type LiveState, rewriteMaster, rewriteMedia } from "./live.ts";

const up = (path: string) =>
  `https://manifest.googlevideo.com/api/manifest/hls_playlist/expire/1/id/x.1/itag/${path}`;

describe("rewriteMaster", () => {
  it("points every rendition at the session, keyed by itag", () => {
    const state: LiveState = { masterUrl: "m", renditions: new Map() };
    const master = [
      "#EXTM3U",
      `#EXT-X-MEDIA:URI="${up("233/source/yt")}",TYPE=AUDIO,GROUP-ID="233",NAME="Default"`,
      '#EXT-X-STREAM-INF:BANDWIDTH=507418,CODECS="avc1.4D4015,mp4a.40.5",AUDIO="233"',
      up("229/source/yt"),
    ].join("\n");
    const out = rewriteMaster(master, state, "/media/s/S");
    expect(out).toContain('URI="/media/s/S/l/233.m3u8"');
    expect(out).toContain("\n/media/s/S/l/229.m3u8");
    expect(out).not.toContain("googlevideo");
    expect([...state.renditions.keys()]).toEqual(["233", "229"]);
  });

  it("keeps a rendition's segments when YouTube hands out a new URL for it", () => {
    const state: LiveState = { masterUrl: "m", renditions: new Map() };
    rewriteMaster(up("229/a"), state, "/b");
    state.renditions.get("229")?.segments.set(1, "seg");
    rewriteMaster(up("229/b"), state, "/b");
    expect(state.renditions.get("229")?.url).toBe(up("229/b"));
    expect(state.renditions.get("229")?.segments.get(1)).toBe("seg");
  });
});

describe("rewriteMedia", () => {
  it("numbers segments from the media sequence and remembers where they are", () => {
    const rendition = { url: "u", segments: new Map<number, string>() };
    const playlist = [
      "#EXTM3U",
      "#EXT-X-TARGETDURATION:5",
      "#EXT-X-MEDIA-SEQUENCE:1579",
      "#EXTINF:5.0,",
      "https://rr1.googlevideo.com/videoplayback/sq/1579/a",
      "#EXTINF:5.0,",
      "https://rr1.googlevideo.com/videoplayback/sq/1580/a",
    ].join("\n");
    const out = rewriteMedia(playlist, "229", rendition, "/media/s/S");
    expect(out).toContain("\n/media/s/S/l/229/1579\n");
    expect(out.trimEnd().endsWith("/media/s/S/l/229/1580")).toBe(true);
    expect(rendition.segments.get(1580)).toBe(
      "https://rr1.googlevideo.com/videoplayback/sq/1580/a",
    );
  });

  it("serves the init section of fMP4 renditions from the session", () => {
    const rendition: {
      url: string;
      segments: Map<number, string>;
      initUrl?: string;
    } = { url: "u", segments: new Map() };
    const out = rewriteMedia(
      '#EXT-X-MAP:URI="https://rr1.googlevideo.com/init"',
      "137",
      rendition,
      "/b",
    );
    expect(out).toBe('#EXT-X-MAP:URI="/b/l/137/init"');
    expect(rendition.initUrl).toBe("https://rr1.googlevideo.com/init");
  });
});
