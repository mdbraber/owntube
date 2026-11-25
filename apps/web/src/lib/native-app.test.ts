import { describe, expect, it } from "vitest";
import {
  isNativeAppUserAgent,
  isNewNativePage,
  NATIVE_APP_COMMAND_EVENT,
  nativeAppCommandScript,
  parseNativeAppCommand,
  parseNativeAppMessage,
} from "@/lib/native-app";

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

describe("play, session and pairing messages", () => {
  it("reads a play request and fills in its defaults", () => {
    expect(
      parseNativeAppMessage(
        JSON.stringify({
          type: "play",
          video: { videoId: "dQw4w9WgXcQ", title: "T", startSeconds: 42 },
        }),
      ),
    ).toEqual({
      type: "play",
      video: {
        videoId: "dQw4w9WgXcQ",
        title: "T",
        channelName: undefined,
        poster: undefined,
        startSeconds: 42,
        durationSeconds: undefined,
        isLive: false,
        autoplay: true,
      },
    });
  });

  it("drops a play request without a video id or with a bad start", () => {
    expect(
      parseNativeAppMessage(
        JSON.stringify({ type: "play", video: { title: "T" } }),
      ),
    ).toBeNull();
    const parsed = parseNativeAppMessage(
      JSON.stringify({
        type: "play",
        video: { videoId: "x", title: "T", startSeconds: -3 },
      }),
    );
    expect(parsed?.type === "play" && parsed.video.startSeconds).toBe(
      undefined,
    );
  });

  it("reads session and pairing answers", () => {
    expect(
      parseNativeAppMessage(JSON.stringify({ type: "session", userId: 7 })),
    ).toEqual({ type: "session", userId: 7 });
    expect(
      parseNativeAppMessage(JSON.stringify({ type: "session", userId: null })),
    ).toEqual({ type: "session", userId: null });
    expect(
      parseNativeAppMessage(
        JSON.stringify({ type: "pairingApproved", userCode: "AB", ok: true }),
      ),
    ).toEqual({ type: "pairingApproved", userCode: "AB", ok: true });
  });
});

describe("native app commands", () => {
  it("round-trips approvePairing through the injected script", () => {
    const script = nativeAppCommandScript({
      type: "approvePairing",
      userCode: "ABCD-EFGH",
    });
    const dispatched: unknown[] = [];
    const fakeWindow = {
      dispatchEvent: (event: { type: string; detail: unknown }) => {
        expect(event.type).toBe(NATIVE_APP_COMMAND_EVENT);
        dispatched.push(event.detail);
      },
    };
    class FakeCustomEvent {
      constructor(
        public type: string,
        init: { detail: unknown },
      ) {
        this.detail = init.detail;
      }
      detail: unknown;
    }
    new Function("window", "CustomEvent", script)(fakeWindow, FakeCustomEvent);
    expect(dispatched.map(parseNativeAppCommand)).toEqual([
      { type: "approvePairing", userCode: "ABCD-EFGH" },
    ]);
  });

  it("drops unknown commands", () => {
    expect(parseNativeAppCommand({ type: "other" })).toBeNull();
    expect(parseNativeAppCommand(null)).toBeNull();
  });
});

describe("isNewNativePage", () => {
  const at = (path: string) => `https://ot.test${path}`;

  it("opens another page as a new screen", () => {
    expect(isNewNativePage(at("/"), at("/channel/UC1"))).toBe(true);
    expect(isNewNativePage(at("/search?q=a"), at("/watch?v=abc"))).toBe(true);
  });

  it("treats another video or playlist as another page", () => {
    expect(isNewNativePage(at("/watch?v=a"), at("/watch?v=b"))).toBe(true);
    expect(
      isNewNativePage(at("/playlist?list=1"), at("/playlist?list=2")),
    ).toBe(true);
    expect(isNewNativePage(at("/watch?v=a"), at("/watch?v=a&t=30"))).toBe(
      false,
    );
  });

  it("keeps filters, tabs and new searches on the same screen", () => {
    expect(isNewNativePage(at("/search?q=a"), at("/search?q=b"))).toBe(false);
    expect(
      isNewNativePage(at("/channel/UC1"), at("/channel/UC1?tab=shorts")),
    ).toBe(false);
    expect(isNewNativePage(at("/trending"), at("/trending/"))).toBe(false);
  });

  it("lets sign-in and onboarding move on in place", () => {
    expect(isNewNativePage(at("/login"), at("/"))).toBe(false);
    expect(isNewNativePage(at("/onboarding/taste"), at("/"))).toBe(false);
  });

  it("ignores other sites", () => {
    expect(isNewNativePage(at("/"), "https://example.org/")).toBe(false);
  });
});
