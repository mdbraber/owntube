import { describe, expect, it } from "vitest";
import type { Exchange } from "./fixtures/exchange.ts";
import { readFixture } from "./fixtures/store.ts";
import { classifyPlayability, type PlayabilityStatus } from "./playability.ts";

/** The playability statuses of every /player response in a recorded corpus entry. */
async function recordedStatuses(
  id: string,
): Promise<
  Array<{ client: string; status: PlayabilityStatus; start?: string }>
> {
  const fixture = await readFixture(id);
  return fixture.exchanges
    .filter((e: Exchange) => new URL(e.url).pathname.endsWith("/player"))
    .map((e) => {
      const body = e.responseBody as {
        playabilityStatus: PlayabilityStatus;
        microformat?: {
          playerMicroformatRenderer?: {
            liveBroadcastDetails?: { startTimestamp?: string };
          };
        };
      };
      const req = e.requestBody as {
        context?: { client?: { clientName?: string } };
      };
      return {
        client: req.context?.client?.clientName ?? "?",
        status: body.playabilityStatus,
        start:
          body.microformat?.playerMicroformatRenderer?.liveBroadcastDetails
            ?.startTimestamp,
      };
    });
}

describe("classifyPlayability on recorded responses", () => {
  it("OK is playable", async () => {
    const statuses = await recordedStatuses("video-h264-captions");
    const vr = statuses.find((s) => s.client === "ANDROID_VR");
    expect(classifyPlayability(vr?.status)).toBeNull();
  });

  it("recognises the age gate", async () => {
    for (const { client, status } of await recordedStatuses(
      "video-age-restricted",
    )) {
      if (status.status === "LOGIN_REQUIRED")
        expect(classifyPlayability(status)?.kind, client).toBe(
          "age-restricted",
        );
    }
  });

  it("recognises members-only videos", async () => {
    const kinds = (await recordedStatuses("video-members-only")).map(
      ({ status }) => classifyPlayability(status)?.kind,
    );
    expect(kinds.length).toBeGreaterThan(0);
    expect(new Set(kinds)).toEqual(new Set(["members-only"]));
  });

  it("recognises upcoming streams with their start time", async () => {
    const [first] = await recordedStatuses("video-upcoming");
    const result = classifyPlayability(first?.status, first?.start);
    expect(result?.kind).toBe("upcoming");
    expect(
      result && "startsAt" in result ? result.startsAt : undefined,
    ).toEqual(expect.any(Number));
  });
});

describe("classifyPlayability", () => {
  it("tells the bot check apart from other sign-in demands", () => {
    expect(
      classifyPlayability({
        status: "LOGIN_REQUIRED",
        reason: "Sign in to confirm you’re not a bot",
      })?.kind,
    ).toBe("bot-check");
  });

  it("recognises members-only by its current wording too", () => {
    const reason =
      "This video is available to this channel's members on level: LTT Members Plus (or any higher level). Join this YouTube channel to get access to members-only content.";
    expect(classifyPlayability({ status: "UNPLAYABLE", reason })?.kind).toBe(
      "members-only",
    );
  });

  it("treats a missing status as unavailable", () => {
    expect(classifyPlayability(undefined)?.kind).toBe("unavailable");
  });
});
