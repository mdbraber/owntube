import { describe, expect, it } from "vitest";
import { rewriteStreamUrlForRequestHost } from "@/lib/invidious-playback-url";

describe("rewriteStreamUrlForRequestHost", () => {
  it("replaces 127.0.0.1 with the request Host (LAN)", () => {
    expect(
      rewriteStreamUrlForRequestHost(
        "http://127.0.0.1:3001/api/v1/manifest/hls/playlist/abc",
        "192.168.1.14:3000",
      ),
    ).toBe("http://192.168.1.14:3001/api/v1/manifest/hls/playlist/abc");
  });

  it("leaves non-loopback hostnames alone", () => {
    const u = "https://inv.example.com/api/v1/manifest/hls/playlist/abc";
    expect(rewriteStreamUrlForRequestHost(u, "192.168.1.14:3000")).toBe(u);
  });
});
