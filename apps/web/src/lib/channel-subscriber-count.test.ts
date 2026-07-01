import { describe, expect, it } from "vitest";
import {
  parseSubscriberCountText,
  pickChannelSubscriberCount,
} from "./channel-subscriber-count";

describe("parseSubscriberCountText", () => {
  it("parses K/M suffixes and plain numbers", () => {
    expect(parseSubscriberCountText("1.2M subscribers")).toBe(1_200_000);
    expect(parseSubscriberCountText("12K")).toBe(12_000);
    expect(parseSubscriberCountText("4,500")).toBe(4500);
  });

  it("returns null for hidden or empty", () => {
    expect(parseSubscriberCountText("")).toBeNull();
    expect(parseSubscriberCountText("Subscribers hidden")).toBeNull();
  });
});

describe("pickChannelSubscriberCount", () => {
  it("reads numeric and text fields", () => {
    expect(pickChannelSubscriberCount({ subscriberCount: 42_000 })).toBe(
      42_000,
    );
    expect(
      pickChannelSubscriberCount({ subCountText: "1.5M subscribers" }),
    ).toBe(1_500_000);
  });
});
