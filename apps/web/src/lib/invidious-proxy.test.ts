import { describe, expect, it } from "vitest";
import {
  googlevideoUrlFromInvidiousVideoplaybackReference,
  isYoutubeFamilyHostname,
  rewriteHlsPlaylistMediaUrls,
  rewriteInvidiousVideoplaybackLinesToYtHls,
  rewriteM3u8AllProxies,
  rewriteM3u8ForOwnTubeProxy,
  shouldUseInvidiousProxyForUrl,
  toProxiedOrDirectPlayback,
} from "@/lib/invidious-proxy";
import type { VideoDetail } from "@/server/services/proxy.types";

describe("shouldUseInvidiousProxyForUrl", () => {
  it("matches newer Invidious HLS under /api/manifest/ (not only /api/v1/)", () => {
    process.env.INVIDIOUS_BASE_URL = "http://127.0.0.1:3001";
    const detail = { sourceUsed: "invidious" } as VideoDetail;
    const url =
      "http://127.0.0.1:3001/api/manifest/hls_playlist/expire/1/id/x/playlist/index.m3u8";
    expect(shouldUseInvidiousProxyForUrl(detail, url)).toBe(true);
    expect(
      toProxiedOrDirectPlayback(url, "http://localhost:3000", "", detail),
    ).toBe(
      "http://localhost:3000/invidious/api/manifest/hls_playlist/expire/1/id/x/playlist/index.m3u8",
    );
  });
});

describe("isYoutubeFamilyHostname", () => {
  it("includes googlevideo and c.youtube.com chunk hosts", () => {
    expect(isYoutubeFamilyHostname("rr1---sn-abc.googlevideo.com")).toBe(true);
    expect(isYoutubeFamilyHostname("rr1---sn-abc.c.youtube.com")).toBe(true);
    expect(isYoutubeFamilyHostname("www.youtube.com")).toBe(true);
    expect(isYoutubeFamilyHostname("example.com")).toBe(false);
  });
});

describe("rewriteHlsPlaylistMediaUrls", () => {
  it("rewrites relative googlevideo segment lines to yt-hls hop", () => {
    const manifest =
      "https://manifest.googlevideo.com/api/manifest/hls_variant/expire/1/id/x/index.m3u8";
    const body = `#EXTM3U
#EXTINF:5.0,
/videoplayback/id/abc/seg.ts`;
    const out = rewriteHlsPlaylistMediaUrls(
      body,
      "http://localhost:3000",
      manifest,
    );
    expect(out).toContain("http://localhost:3000/yt-hls?url=");
    expect(out).toContain(encodeURIComponent("/videoplayback/id/abc/seg.ts"));
    expect(out).not.toMatch(/^\/videoplayback/m);
  });

  it("rewrites c.youtube.com segment lines to yt-hls", () => {
    const manifest =
      "https://www.youtube.com/api/manifest/hls_playlist/expire/1/id/x/playlist/index.m3u8";
    const body = `#EXTINF:2.0,
https://rr1---sn-25ge7nzk.c.youtube.com/videoplayback/id/x/seg.ts`;
    const out = rewriteHlsPlaylistMediaUrls(
      body,
      "http://localhost:3000",
      manifest,
    );
    expect(out).toContain("/yt-hls?url=");
    expect(out).not.toContain("https://rr1---sn-25ge7nzk.c.youtube.com");
  });

  it("rewrites URI attributes in tags", () => {
    const manifest =
      "https://rr1---sn-abc.googlevideo.com/videoplayback/id/x/master.m3u8";
    const body =
      '#EXT-X-MEDIA:TYPE=AUDIO,URI="https://rr1---sn-abc.googlevideo.com/videoplayback/id/x/audio.ts"';
    const out = rewriteHlsPlaylistMediaUrls(
      body,
      "http://localhost:3000",
      manifest,
    );
    expect(out).toContain("http://localhost:3000/yt-hls?url=");
  });
});

describe("rewriteM3u8AllProxies", () => {
  it("resolves relative segments when manifestUrl is provided", () => {
    const manifest =
      "https://manifest.googlevideo.com/api/manifest/hls/id/xyz/master.m3u8";
    const body = `#EXTM3U
https://manifest.googlevideo.com/api/manifest/hls/id/xyz/playlist/index.m3u8
#EXTINF:4,
/videoplayback/seg/file.ts`;
    const out = rewriteM3u8AllProxies(
      body,
      "http://localhost:3000",
      "localhost:3000",
      "",
      manifest,
    );
    expect(out).toContain("/yt-hls?url=");
    expect(out).not.toMatch(/\n\/videoplayback/);
  });
});

describe("rewriteInvidiousVideoplaybackLinesToYtHls", () => {
  it("rewrites Invidious local videoplayback segment lines to yt-hls", () => {
    const body = `#EXTINF:5.0,
http://localhost:3000/invidious/videoplayback?id=x&itag=91&host=rr1---sn-abc.c.youtube.com&file=seg.ts&expire=1`;
    const out = rewriteInvidiousVideoplaybackLinesToYtHls(
      body,
      "http://localhost:3000",
    );
    expect(out).toContain("http://localhost:3000/yt-hls?url=");
    expect(out).not.toContain("/invidious/videoplayback");
    expect(
      googlevideoUrlFromInvidiousVideoplaybackReference(
        "http://:3210/videoplayback?id=x&host=rr1---sn-abc.c.youtube.com&file=seg.ts",
      ),
    ).toBe("https://rr1---sn-abc.c.youtube.com/videoplayback?id=x&file=seg.ts");
  });
});

describe("rewriteM3u8ForOwnTubeProxy", () => {
  it("rewrites Invidious videoplayback segment URLs with missing hostname", () => {
    const body = `#EXTINF:5.0,
http://:3210/videoplayback?id=x&file=seg.ts`;
    expect(
      rewriteM3u8ForOwnTubeProxy(
        body,
        "http://localhost:3000",
        "localhost:3000",
        "http://192.168.1.11:3210",
      ),
    ).toContain(
      "http://localhost:3000/invidious/videoplayback?id=x&file=seg.ts",
    );
  });

  it("rewrites Invidious local=true URLs with missing hostname", () => {
    const body = `#EXTM3U
http://:3210/api/manifest/hls_playlist/id/x/playlist/index.m3u8?local=true`;
    expect(
      rewriteM3u8ForOwnTubeProxy(
        body,
        "http://localhost:3000",
        "localhost:3000",
        "http://192.168.1.11:3210",
      ),
    ).toContain(
      "http://localhost:3000/invidious/api/manifest/hls_playlist/id/x/playlist/index.m3u8?local=true",
    );
  });

  it("replaces 127.0.0.1 invidious origin with the proxy path", () => {
    const body = `#EXTM3U
http://127.0.0.1:3001/api/v1/segment/abc`;
    expect(
      rewriteM3u8ForOwnTubeProxy(
        body,
        "http://192.168.1.14:3000",
        "192.168.1.14:3000",
        "http://127.0.0.1:3001",
      ),
    ).toContain("http://192.168.1.14:3000/invidious/api/v1/segment/abc");
  });
});
