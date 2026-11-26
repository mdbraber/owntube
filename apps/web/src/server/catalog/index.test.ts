import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CatalogNotCachedError,
  fetchChannelPage,
  fetchVideoDetail,
  fetchVideoSummaries,
  resolveChannelId,
} from "@/server/catalog";
import { fetchShortsFeed } from "@/server/catalog/shorts";
import { UpstreamLiveUpcomingError } from "@/server/errors/upstream-live-upcoming";
import { UpstreamUnavailableError } from "@/server/errors/upstream-unavailable";

const UC = "UCuAXFkgsw1L7xaCfnd5JJOw";

const summary = (videoId: string, o: Record<string, unknown> = {}) => ({
  videoId,
  title: videoId,
  thumbnails: [],
  live: "none",
  isShort: false,
  ...o,
});

/** Answers gateway requests by path; records what was asked. */
function gateway(route: (url: URL) => { status?: number; body: unknown }) {
  const asked: URL[] = [];
  vi.mocked(fetch).mockImplementation(async (input) => {
    const url = new URL(String(input));
    asked.push(url);
    const { status = 200, body } = route(url);
    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  });
  return asked;
}

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.reject(new Error("fetch not mocked"))),
  );
});
afterEach(() => vi.unstubAllGlobals());

describe("catalog", () => {
  it("asks for summaries in batches of 100", async () => {
    const ids = Array.from(
      { length: 150 },
      (_, i) => `v${String(i).padStart(10, "0")}`,
    );
    const asked = gateway((url) => ({
      body: {
        videos: (url.searchParams.get("ids") ?? "")
          .split(",")
          .map((id) => summary(id)),
      },
    }));
    const out = await fetchVideoSummaries(ids, { cache: "only" });
    expect(out.size).toBe(150);
    expect(asked).toHaveLength(2);
    expect(asked[0]?.searchParams.get("cache")).toBe("only");
  });

  it("leaves members-only uploads out of channel pages", async () => {
    gateway(() => ({
      body: {
        videos: [
          summary("public00000"),
          summary("members0000", { membersOnly: true }),
        ],
        playlists: [],
      },
    }));
    const page = await fetchChannelPage({ channelId: UC });
    expect(page.videos.map((v) => v.videoId)).toEqual(["public00000"]);
  });

  it("turns a cache-only miss and a gateway failure into typed errors", async () => {
    gateway((url) =>
      url.searchParams.get("cache") === "only"
        ? { status: 404, body: { error: "not cached" } }
        : { status: 502, body: { error: "upstream", reason: "bot check" } },
    );
    await expect(
      fetchChannelPage({ channelId: UC }, { cache: "only" }),
    ).rejects.toBeInstanceOf(CatalogNotCachedError);
    await expect(fetchChannelPage({ channelId: UC })).rejects.toBeInstanceOf(
      UpstreamUnavailableError,
    );
  });

  it("reports an upcoming stream with its start time", async () => {
    gateway(() => ({
      body: {
        ...summary("dQw4w9WgXcQ", {
          live: "upcoming",
          startsAt: 2_000_000_000_000,
        }),
        description: "",
        keywords: [],
        captions: [],
        chapters: [],
        related: [],
        unplayable: { kind: "upcoming", reason: "Premieres soon" },
      },
    }));
    const error = await fetchVideoDetail({ videoId: "dQw4w9WgXcQ" }).catch(
      (e) => e,
    );
    expect(error).toBeInstanceOf(UpstreamLiveUpcomingError);
    expect(error.premiereTimestamp).toBe(2_000_000_000);
  });

  it("resolves a handle to a channel id", async () => {
    const asked = gateway(() => ({ body: { channelId: UC } }));
    expect(await resolveChannelId("%40LinusTechTips")).toBe(UC);
    expect(asked[0]?.searchParams.get("url")).toBe(
      "https://www.youtube.com/@LinusTechTips",
    );
    expect(await resolveChannelId(UC)).toBe(UC);
    expect(asked).toHaveLength(1);
  });
});

describe("fetchShortsFeed", () => {
  it("keeps only Shorts and pages on with #shorts continuations", async () => {
    const asked = gateway((url) => ({
      body: {
        videos: [
          summary(`s-${url.searchParams.get("q")}`.slice(0, 11), {
            isShort: true,
          }),
          summary("longvideo00"),
        ],
        channels: [],
        playlists: [],
        continuation: "NEXT",
      },
    }));
    const first = await fetchShortsFeed({
      region: "NL",
      limit: 2,
      discoveryQueries: ["cats"],
    });
    expect(first.videos.every((v) => v.isShort)).toBe(true);
    expect(first.continuation).toBe("s:NEXT");
    await fetchShortsFeed({ region: "NL", continuation: "s:NEXT" });
    const last = asked.at(-1);
    expect(last?.searchParams.get("q")).toBe("#shorts");
    expect(last?.searchParams.get("continuation")).toBe("NEXT");
  });
});
