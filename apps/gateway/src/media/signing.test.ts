import { describe, expect, it } from "vitest";
import { signPlayback, verifyPlayback } from "./signing.ts";

const KEY = "k".repeat(32);
const NOW = 1_800_000_000_000;
const exp = NOW / 1000 + 600;

describe("playback signatures", () => {
  it("accept what was signed", () => {
    expect(
      verifyPlayback(
        KEY,
        "dQw4w9WgXcQ",
        String(exp),
        signPlayback(KEY, "dQw4w9WgXcQ", exp),
        NOW,
      ),
    ).toBe(true);
  });

  it("are bound to the video", () => {
    expect(
      verifyPlayback(
        KEY,
        "aqz-KE-bpKQ",
        String(exp),
        signPlayback(KEY, "dQw4w9WgXcQ", exp),
        NOW,
      ),
    ).toBe(false);
  });

  it("expire", () => {
    expect(
      verifyPlayback(
        KEY,
        "dQw4w9WgXcQ",
        String(exp),
        signPlayback(KEY, "dQw4w9WgXcQ", exp),
        (exp + 1) * 1000,
      ),
    ).toBe(false);
  });

  it("cannot be extended by changing the expiry", () => {
    expect(
      verifyPlayback(
        KEY,
        "dQw4w9WgXcQ",
        String(exp + 600),
        signPlayback(KEY, "dQw4w9WgXcQ", exp),
        NOW,
      ),
    ).toBe(false);
  });

  it("reject a missing or malformed signature", () => {
    expect(
      verifyPlayback(KEY, "dQw4w9WgXcQ", String(exp), undefined, NOW),
    ).toBe(false);
    expect(verifyPlayback(KEY, "dQw4w9WgXcQ", "soon", "x", NOW)).toBe(false);
  });
});
