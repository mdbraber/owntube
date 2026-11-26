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
    clientName = "WEB",
  ): Promise<{ videoDetails: { title: string } }> =>
    replay(
      "https://www.youtube.com/youtubei/v1/player?key=abc&prettyPrint=false",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ videoId, context: { client: { clientName } } }),
      },
    ).then((r) => r.json() as Promise<{ videoDetails: { title: string } }>);

  it("tells the same request from two clients apart", async () => {
    const web = createReplayFetch([player("aaaaaaaaaaa", "as WEB")]);
    const request = (clientName: string) =>
      web("https://www.youtube.com/youtubei/v1/player?prettyPrint=false", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          videoId: "aaaaaaaaaaa",
          context: { client: { clientName } },
        }),
      });
    await expect(request("VISIONOS")).rejects.toThrow(/no recorded exchange/);
    expect(
      (
        (await (await request("WEB")).json()) as {
          videoDetails: { title: string };
        }
      ).videoDetails.title,
    ).toBe("as WEB");
  });

  it("matches on the request, ignoring the rest of the context and volatile params", async () => {
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
