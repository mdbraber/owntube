import { describe, expect, it } from "vitest";
import {
  hasSurroundingQuotes,
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

  it("does not silently strip quotes (env is not a quoted format)", () => {
    // `PIPED_BASE_URL="disabled"` arrives with the quotes still attached; the
    // disable keyword is not recognized, so callers must warn about it.
    expect(isUpstreamDisabled('"disabled"')).toBe(false);
    expect(normalizeUpstreamBaseUrl('"disabled"')).toBe('"disabled"');
  });

  it("detects surrounding quotes for misconfig warnings", () => {
    expect(hasSurroundingQuotes('"disabled"')).toBe(true);
    expect(hasSurroundingQuotes("'https://inv.example'")).toBe(true);
    expect(hasSurroundingQuotes("https://inv.example")).toBe(false);
    expect(hasSurroundingQuotes('"mismatched')).toBe(false);
    expect(hasSurroundingQuotes("")).toBe(false);
    expect(hasSurroundingQuotes(undefined)).toBe(false);
  });
});
