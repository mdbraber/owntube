import { describe, expect, it } from "vitest";
import type { Exchange } from "./exchange.ts";
import { createReplayFetch } from "./replay-fetch.ts";

const player = (videoId: string, title: string): Exchange => ({
  method: "POST",
  url: "https://www.youtube.com/youtubei/v1/player?prettyPrint=false",
  requestBody: { context: { client: { clientName: "WEB" } }, videoId },
  status: 200,
  contentType: "application/json",
  responseBody: { videoDetails: { title } },
});

describe("createReplayFetch", () => {
  const replay = createReplayFetch([
    player("aaaaaaaaaaa", "first"),
    player("aaaaaaaaaaa", "second"),
    player("bbbbbbbbbbb", "other"),
  ]);
  const ask = (
    videoId: string,
    clientName = "ANDROID_VR",
  ): Promise<{ videoDetails: { title: string } }> =>
    replay(
      "https://www.youtube.com/youtubei/v1/player?key=abc&prettyPrint=false",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ videoId, context: { client: { clientName } } }),
      },
    ).then((r) => r.json() as Promise<{ videoDetails: { title: string } }>);

  it("matches on the request, ignoring context and volatile params", async () => {
    expect(await ask("bbbbbbbbbbb")).toEqual({
      videoDetails: { title: "other" },
    });
  });

  it("serves repeated requests in recorded order, then repeats the last", async () => {
    expect((await ask("aaaaaaaaaaa")).videoDetails.title).toBe("first");
    expect((await ask("aaaaaaaaaaa")).videoDetails.title).toBe("second");
    expect((await ask("aaaaaaaaaaa")).videoDetails.title).toBe("second");
  });

  it("fails loudly on a request that was never recorded", async () => {
    await expect(ask("ccccccccccc")).rejects.toThrow(/no recorded exchange/);
  });
});
