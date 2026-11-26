import { describe, expect, it } from "vitest";
import { VISIONOS, WEB } from "./clients.ts";
import { requestPlayer } from "./player.ts";

function stubFetch(response: unknown) {
  const calls: Request[] = [];
  const fetch: typeof globalThis.fetch = async (input, init) => {
    calls.push(new Request(input, init));
    return new Response(JSON.stringify(response), {
      headers: { "content-type": "application/json" },
    });
  };
  return { fetch, calls };
}

const okResponse = {
  playabilityStatus: { status: "OK" },
  streamingData: {
    adaptiveFormats: [
      {
        itag: 137,
        url: "https://rr1.googlevideo.com/videoplayback?itag=137",
        mimeType: 'video/mp4; codecs="avc1"',
        width: 1920,
        height: 1080,
      },
      { itag: 251, mimeType: 'audio/webm; codecs="opus"' },
    ],
  },
};

describe("requestPlayer", () => {
  it("sends an identity whole: host, headers and context", async () => {
    const { fetch, calls } = stubFetch(okResponse);
    await requestPlayer(
      { videoId: "aqz-KE-bpKQ", identity: VISIONOS, visitorData: "VD" },
      fetch,
    );
    const [call] = calls;
    expect(call?.url).toBe(
      "https://youtubei.googleapis.com/youtubei/v1/player?prettyPrint=false",
    );
    expect(call?.headers.get("user-agent")).toBe(VISIONOS.userAgent);
    expect(call?.headers.get("x-goog-api-format-version")).toBe("2");
    expect(call?.headers.get("x-youtube-client-name")).toBe("101");
    const body = (await call?.json()) as {
      context: { client: Record<string, unknown> };
      videoId: string;
    };
    expect(body.videoId).toBe("aqz-KE-bpKQ");
    expect(body.context.client).toMatchObject({
      clientName: "VISIONOS",
      clientVersion: "1.04",
      visitorData: "VD",
      deviceModel: "RealityDevice17,1",
    });
  });

  it("echoes a SABR reload token", async () => {
    const { fetch, calls } = stubFetch(okResponse);
    await requestPlayer(
      {
        videoId: "mjsMqasGhKU",
        identity: VISIONOS,
        visitorData: "VD",
        reloadToken: "T0K",
      },
      fetch,
    );
    const body = (await calls[0]?.json()) as {
      playbackContext: Record<string, unknown>;
    };
    expect(body.playbackContext.reloadPlaybackContext).toEqual({
      reloadPlaybackParams: { token: "T0K" },
    });
    expect(body.playbackContext.contentPlaybackContext).toBeDefined();
  });

  it("keeps only formats with a usable URL", async () => {
    const { fetch } = stubFetch(okResponse);
    const result = await requestPlayer(
      { videoId: "aqz-KE-bpKQ", identity: VISIONOS, visitorData: "VD" },
      fetch,
    );
    expect(result.unplayable).toBeNull();
    expect(result.formats.map((f) => f.itag)).toEqual([137]);
  });

  it("refuses a deciphering client without the player JS", async () => {
    const { fetch } = stubFetch(okResponse);
    await expect(
      requestPlayer(
        { videoId: "aqz-KE-bpKQ", identity: WEB, visitorData: "VD" },
        fetch,
      ),
    ).rejects.toThrow(/player JS/);
  });

  it("reports why a video is not playable", async () => {
    const { fetch } = stubFetch({
      playabilityStatus: {
        status: "LOGIN_REQUIRED",
        reason: "Sign in to confirm your age",
      },
    });
    const result = await requestPlayer(
      { videoId: "HtVdAasjOgU", identity: VISIONOS, visitorData: "VD" },
      fetch,
    );
    expect(result.unplayable?.kind).toBe("age-restricted");
    expect(result.formats).toEqual([]);
  });
});
