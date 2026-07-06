import { describe, expect, it } from "vitest";
import {
  isUpstreamDisabled,
  normalizeUpstreamBaseUrl,
} from "@/lib/upstream-base-url";

describe("upstream base URL helpers", () => {
  it("treats disable and disabled as off", () => {
    expect(isUpstreamDisabled("disabled")).toBe(true);
    expect(isUpstreamDisabled("disable")).toBe(true);
    expect(isUpstreamDisabled("DISABLE")).toBe(true);
    expect(isUpstreamDisabled("https://inv.example")).toBe(false);
  });

  it("normalizes disabled Invidious env to empty", () => {
    expect(normalizeUpstreamBaseUrl("disable")).toBe("");
    expect(normalizeUpstreamBaseUrl("disabled")).toBe("");
    expect(normalizeUpstreamBaseUrl("")).toBe("");
  });

  it("ignores surrounding quotes kept by Docker env parsing", () => {
    // `PIPED_BASE_URL="disabled"` arrives with the quotes still attached.
    expect(isUpstreamDisabled('"disabled"')).toBe(true);
    expect(isUpstreamDisabled("'disabled'")).toBe(true);
    expect(normalizeUpstreamBaseUrl('"disabled"')).toBe("");
    // A quoted real URL is still usable, minus the quotes.
    expect(normalizeUpstreamBaseUrl('"https://inv.example/"')).toBe(
      "https://inv.example",
    );
  });
});
