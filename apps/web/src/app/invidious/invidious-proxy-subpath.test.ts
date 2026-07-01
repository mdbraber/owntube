import { describe, expect, it } from "vitest";
import { subpathFromInvidiousProxyRequest } from "@/app/invidious/[[...path]]/route";

describe("subpathFromInvidiousProxyRequest", () => {
  it("preserves commas in signed live HLS paths", () => {
    const url =
      "http://localhost:3000/invidious/api/manifest/hls_playlist/id/x/met/123,/mh/PJ/rms/su,su/playlist/index.m3u8?local=true";
    expect(subpathFromInvidiousProxyRequest(url)).toBe(
      "api/manifest/hls_playlist/id/x/met/123,/mh/PJ/rms/su,su/playlist/index.m3u8",
    );
  });
});
