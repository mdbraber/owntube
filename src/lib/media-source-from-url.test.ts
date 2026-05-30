import { describe, expect, it } from "vitest";
import { sourceFromUrl } from "@/lib/media-source-from-url";

describe("sourceFromUrl", () => {
  it("treats /yt-hls?url=… as HLS when inner URL is a YouTube HLS manifest", () => {
    const u =
      "http://127.0.0.1:3000/yt-hls?url=https%3A%2F%2Fwww.youtube.com%2Fapi%2Fmanifest%2Fhls_playlist%2Fx%2Fplaylist%2Findex.m3u8";
    expect(sourceFromUrl(u)).toEqual({
      src: u,
      type: "application/x-mpegurl",
    });
  });

  it("treats /yt-hls wrapping googlevideo videoplayback as MP4 (not HLS)", () => {
    const inner =
      "https://rr5---sn-u125g5-5q.googlevideo.com/videoplayback?expire=1&itag=18&mime=video%2Fmp4";
    const u = `http://127.0.0.1:3000/yt-hls?url=${encodeURIComponent(inner)}`;
    expect(sourceFromUrl(u)).toEqual({ src: u, type: "video/mp4" });
  });

  it("treats /yt-hls wrapping googlevideo with webm mime as WebM", () => {
    const inner =
      "https://rr5---sn-x.googlevideo.com/videoplayback?mime=video%2Fwebm";
    const u = `http://127.0.0.1:3000/yt-hls?url=${encodeURIComponent(inner)}`;
    expect(sourceFromUrl(u).type).toBe("video/webm");
  });

  it("still detects /invidious/.../manifest/hls/... as HLS", () => {
    const u =
      "http://localhost:3000/invidious/api/manifest/hls_playlist/expire/1/id/x/playlist/index.m3u8";
    expect(sourceFromUrl(u).type).toBe("application/x-mpegurl");
  });

  it("detects Invidious hls_variant master URLs as HLS", () => {
    const u =
      "http://localhost:3000/invidious/api/manifest/hls_variant/expire/1/id/x/file/index.m3u8";
    expect(sourceFromUrl(u).type).toBe("application/x-mpegurl");
  });
});
