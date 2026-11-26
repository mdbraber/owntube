import { describe, expect, it } from "vitest";
import { Player } from "youtubei.js";
import type { Egress } from "./egress.ts";
import { SessionPool } from "./session.ts";
import { YouTube } from "./youtube.ts";

/** A YouTube whose /player answers per client, from a table. */
function youtube(answers: Record<string, unknown>) {
  const asked: string[] = [];
  const fetch: typeof globalThis.fetch = async (_input, init) => {
    const body = JSON.parse(String(init?.body)) as {
      context: { client: { clientName: string } };
    };
    const client = body.context.client.clientName;
    asked.push(client);
    return new Response(
      JSON.stringify(
        answers[client] ?? { playabilityStatus: { status: "ERROR" } },
      ),
    );
  };
  const egress: Egress = { fetch: () => fetch, close: async () => {} };
  const pool = new SessionPool({
    egress,
    createVisitorData: async () => "VD",
    loadPlayer: async () => new Player("p", 1),
  });
  return { yt: new YouTube(pool), asked };
}

const ok = {
  playabilityStatus: { status: "OK" },
  streamingData: { adaptiveFormats: [] },
};

describe("YouTube.playable", () => {
  it("asks WEB when VISIONOS says a video is not available", async () => {
    const { yt, asked } = youtube({
      VISIONOS: {
        playabilityStatus: {
          status: "UNPLAYABLE",
          reason: "This video is not available",
        },
      },
      WEB: ok,
    });
    const result = await yt.playable("ElMphbjQTf0");
    expect(result.unplayable).toBeNull();
    expect(result.identity.name).toBe("WEB");
    expect(asked).toEqual(["VISIONOS", "WEB"]);
  });

  it("does not try another client for members-only, age or bot answers", async () => {
    const { yt, asked } = youtube({
      VISIONOS: {
        playabilityStatus: {
          status: "UNPLAYABLE",
          reason: "Join this channel to get access to members-only content",
        },
      },
      WEB: ok,
    });
    expect((await yt.playable("qiLUvCt3k6g")).unplayable?.kind).toBe(
      "members-only",
    );
    expect(asked).toEqual(["VISIONOS"]);
  });

  it("keeps VISIONOS's answer when WEB cannot play it either", async () => {
    const { yt } = youtube({
      VISIONOS: {
        playabilityStatus: {
          status: "UNPLAYABLE",
          reason: "This video is not available",
        },
      },
      WEB: {
        playabilityStatus: { status: "ERROR", reason: "Video unavailable" },
      },
    });
    const result = await yt.playable("xxxxxxxxxxx");
    expect(result.identity.name).toBe("VISIONOS");
    expect(result.unplayable?.kind).toBe("unplayable");
  });
});
