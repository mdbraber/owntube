import { describe, expect, it } from "vitest";
import { isPlaceholderSecret } from "./secrets.ts";

describe("isPlaceholderSecret", () => {
  it.each([
    undefined,
    "",
    "   ",
    "change-me-in-production",
    "change-me-to-a-long-random-value",
    "replace-with-long-random-secret",
    "replace-with-another-long-random-secret",
    "CHANGEME",
  ])("flags %j", (value) => {
    expect(isPlaceholderSecret(value)).toBe(true);
  });

  it("accepts a generated key", () => {
    expect(
      isPlaceholderSecret("n0V3x2l1y8cQzK5mW9pR4tA7sD6fG3hJ+bE2uI1oP0q="),
    ).toBe(false);
  });
});
