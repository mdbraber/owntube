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
});
