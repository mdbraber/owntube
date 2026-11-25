import { describe, expect, it } from "vitest";
import { isNativeAppUserAgent, parseNativeAppMessage } from "@/lib/native-app";

describe("isNativeAppUserAgent", () => {
  it("recognises the iOS app's WebView", () => {
    expect(
      isNativeAppUserAgent(
        "Mozilla/5.0 (iPhone; CPU iPhone OS 27_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 OwnTubeApp/0.1.0",
      ),
    ).toBe(true);
  });

  it("leaves browsers, Safari on iPhone included, alone", () => {
    expect(
      isNativeAppUserAgent(
        "Mozilla/5.0 (iPhone; CPU iPhone OS 27_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/27.0 Mobile/15E148 Safari/604.1",
      ),
    ).toBe(false);
    expect(isNativeAppUserAgent(null)).toBe(false);
    expect(isNativeAppUserAgent(undefined)).toBe(false);
  });
});

describe("parseNativeAppMessage", () => {
  it("reads page and queue messages", () => {
    expect(
      parseNativeAppMessage(
        JSON.stringify({ type: "page", title: "Trending", url: "https://x/" }),
      ),
    ).toEqual({ type: "page", title: "Trending", url: "https://x/" });
    expect(
      parseNativeAppMessage(JSON.stringify({ type: "queue", raw: "[]" })),
    ).toEqual({ type: "queue", raw: "[]" });
  });

  it("drops anything else", () => {
    expect(parseNativeAppMessage("not json")).toBeNull();
    expect(parseNativeAppMessage("null")).toBeNull();
    expect(parseNativeAppMessage(JSON.stringify({ type: "page" }))).toBeNull();
    expect(
      parseNativeAppMessage(JSON.stringify({ type: "other", raw: "" })),
    ).toBeNull();
  });
});
