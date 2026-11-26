import {
  playbackUrl,
  signPlayback as signInBrowserCrypto,
} from "@owntube/contracts/signing";
import { describe, expect, it } from "vitest";
import { signPlayback, verifyPlayback } from "./signing.ts";

describe("playback signatures across implementations", () => {
  it("the web app's Web Crypto signature is the gateway's", async () => {
    const key = "k".repeat(40);
    expect(await signInBrowserCrypto(key, "dQw4w9WgXcQ", 1_800_000_000)).toBe(
      signPlayback(key, "dQw4w9WgXcQ", 1_800_000_000),
    );
  });

  it("a URL the web app builds verifies at the gateway", async () => {
    const key = "k".repeat(40);
    const exp = Math.floor(Date.now() / 1000) + 600;
    const url = new URL(
      await playbackUrl(key, "dQw4w9WgXcQ", "master.m3u8", {
        expiresAt: exp,
        query: { family: "avc" },
      }),
      "https://x",
    );
    expect(url.pathname).toBe("/media/v/dQw4w9WgXcQ/master.m3u8");
    expect(url.searchParams.get("family")).toBe("avc");
    expect(
      verifyPlayback(
        key,
        "dQw4w9WgXcQ",
        url.searchParams.get("exp") ?? undefined,
        url.searchParams.get("sig") ?? undefined,
      ),
    ).toBe(true);
  });
});
