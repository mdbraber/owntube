import { afterEach, describe, expect, it } from "vitest";
import {
  proxyUrlForHlsFetch,
  resetHlsSameOriginManifestHostCache,
} from "@/lib/hls-same-origin";

const ORIGIN = "http://localhost:3000";

describe("proxyUrlForHlsFetch", () => {
  afterEach(() => {
    resetHlsSameOriginManifestHostCache();
  });
  it("rewrites googlevideo segment URLs to yt-hls", () => {
    const url =
      "https://rr1---sn-abc.googlevideo.com/videoplayback/id/x/seg.ts";
    const out = proxyUrlForHlsFetch(url, ORIGIN);
    expect(out).toBe(
      `${ORIGIN}/yt-hls?url=${encodeURIComponent(url)}`,
    );
  });

  it("rewrites mis-resolved same-origin videoplayback paths via yt-hls", () => {
    const manifest =
      "https://rr1---sn-abc.googlevideo.com/api/manifest/hls/id/x/index.m3u8";
    proxyUrlForHlsFetch(
      `${ORIGIN}/yt-hls?url=${encodeURIComponent(manifest)}`,
      ORIGIN,
    );
    const out = proxyUrlForHlsFetch(
      `${ORIGIN}/videoplayback/id/abc/seg.ts`,
      ORIGIN,
    );
    expect(out).toContain("/yt-hls?url=");
    expect(decodeURIComponent(out)).toContain("rr1---sn-abc.googlevideo.com");
    expect(decodeURIComponent(out)).toContain("/videoplayback/id/abc/seg.ts");
  });

  it("rewrites Invidious manifest paths to /invidious", () => {
    const url =
      "http://127.0.0.1:3001/api/manifest/hls_playlist/expire/1/id/x/index.m3u8";
    expect(proxyUrlForHlsFetch(url, ORIGIN)).toBe(
      `${ORIGIN}/invidious/api/manifest/hls_playlist/expire/1/id/x/index.m3u8`,
    );
  });

  it("leaves already-proxied yt-hls URLs unchanged", () => {
    const url = `${ORIGIN}/yt-hls?url=${encodeURIComponent("https://youtube.com/x")}`;
    expect(proxyUrlForHlsFetch(url, ORIGIN)).toBe(url);
  });

  it("rewrites live chunk hostnames on c.youtube.com", () => {
    const url =
      "https://rr1---sn-25ge7nzk.c.youtube.com/videoplayback/id/x/seg.ts";
    const out = proxyUrlForHlsFetch(url, ORIGIN);
    expect(out).toContain("/yt-hls?url=");
    expect(decodeURIComponent(out)).toContain("c.youtube.com");
  });
});
