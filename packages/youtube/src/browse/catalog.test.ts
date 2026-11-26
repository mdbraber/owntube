import {
  channelPageSchema,
  commentPageSchema,
  playlistPageSchema,
  searchResultSchema,
  videoDetailSchema,
} from "@owntube/contracts/model";
import { beforeAll, describe, expect, it } from "vitest";
import { Log } from "youtubei.js";
import { createCorpusContext } from "../fixtures/context.ts";
import { createReplayFetch } from "../fixtures/replay-fetch.ts";
import { readFixture } from "../fixtures/store.ts";
import { classifyPlayability } from "../playability.ts";
import type { RawPlayerResponse } from "../player.ts";
import { Catalog } from "./catalog.ts";

beforeAll(() => Log.setLevel(Log.Level.NONE));

/** A Catalog answering only from a recorded corpus entry. */
async function replayed(id: string): Promise<Catalog> {
  const fixture = await readFixture(id);
  const { ctx } = await createCorpusContext(
    createReplayFetch(fixture.exchanges),
    undefined,
  );
  // The player response comes from the recording too: the VISIONOS /player exchange.
  const player = fixture.exchanges.find(
    (e) =>
      new URL(e.url).pathname.endsWith("/player") &&
      JSON.stringify(e.requestBody).includes('"VISIONOS"'),
  );
  return new Catalog({
    yt: async () => ctx.yt,
    player: async () => {
      const raw = (player?.responseBody ?? {}) as RawPlayerResponse;
      return { raw, unplayable: classifyPlayability(raw.playabilityStatus) };
    },
  });
}

/** Every image URL in a value, wherever it is. */
function imageUrls(value: unknown): string[] {
  const out: string[] = [];
  JSON.stringify(value, (k, v) => {
    if (k === "url" && typeof v === "string") out.push(v);
    if (k === "templateUrl" && typeof v === "string") out.push(v);
    return v;
  });
  return out;
}

function expectNoGoogleImages(value: unknown): void {
  for (const url of imageUrls(value))
    expect(url, url).toMatch(/^\/media\/img\/(yti|yti9|yt3|yt3gu)\//);
}

describe("Catalog on recorded YouTube responses", () => {
  it("maps a video page with exact numbers and dates", async () => {
    const v = videoDetailSchema.parse(
      await (await replayed("catalog-video")).video("dQw4w9WgXcQ"),
    );
    expect(v.title).toMatch(/Never Gonna Give You Up/);
    expect(v.channel).toMatchObject({
      channelId: "UCuAXFkgsw1L7xaCfnd5JJOw",
      name: "Rick Astley",
    });
    expect(v.channel?.subscribers?.approximate).toBe(true);
    expect(v.views?.approximate).toBe(false);
    // VISIONOS has no microformat, so the page's own date stands, at day precision.
    expect(v.published).toMatchObject({
      text: "Oct 25, 2009",
      precision: "day",
      at: Date.parse("2009-10-25T00:00:00Z"),
    });
    expect(v.durationSec).toBe(213);
    expect(v.captions.length).toBeGreaterThan(0);
    expect(v.storyboard?.templateUrl).toMatch(
      /^\/media\/img\/yti\/sb\/dQw4w9WgXcQ\/.*\$M/,
    );
    expect(v.related.length).toBeGreaterThan(10);
    expect(v.related.every((r) => r.channel?.channelId.startsWith("UC"))).toBe(
      true,
    );
    expect(v.unplayable).toBeNull();
    expectNoGoogleImages(v);
  });

  it("credits every channel of a collaboration", async () => {
    const v = await (await replayed("catalog-collaboration")).video(
      "efu_T8e_q8Q",
    );
    expect(v.collaborators).toHaveLength(8);
    expect(
      v.collaborators?.every((c) => /^UC[\w-]{22}$/.test(c.channelId)),
    ).toBe(true);
    expect(v.channel?.name).toBe(v.collaborators?.[0]?.name);
  });

  it("maps a channel tab and fetches its next page from the token alone", async () => {
    const catalog = await replayed("catalog-channel");
    const first = channelPageSchema.parse(
      await catalog.channel("UCXuqSBlHAE6Xw-yeJA0Tunw", "videos"),
    );
    expect(first.channel).toMatchObject({
      name: "Linus Tech Tips",
      handle: "@LinusTechTips",
    });
    expect(first.channel?.tabs).toEqual(
      expect.arrayContaining(["videos", "shorts", "streams", "playlists"]),
    );
    expect(
      first.videos.every(
        (v) => v.channel?.channelId === "UCXuqSBlHAE6Xw-yeJA0Tunw",
      ),
    ).toBe(true);
    const second = channelPageSchema.parse(
      await catalog.channel(
        "UCXuqSBlHAE6Xw-yeJA0Tunw",
        "videos",
        first.continuation,
      ),
    );
    expect(second.videos.length).toBeGreaterThan(0);
    expect(second.videos[0]?.videoId).not.toBe(first.videos[0]?.videoId);
    expectNoGoogleImages([first, second]);
  });

  it("maps search results, channels included, and the next page", async () => {
    const catalog = await replayed("catalog-search");
    const first = searchResultSchema.parse(
      await catalog.search("linus tech tips"),
    );
    expect(first.videos.length).toBeGreaterThan(10);
    expect(
      first.channels.find((c) => c.handle === "@LinusTechTips")?.subscribers
        ?.approximate,
    ).toBe(true);
    const second = searchResultSchema.parse(
      await catalog.search("linus tech tips", first.continuation),
    );
    expect(second.videos.length).toBeGreaterThan(0);
    expectNoGoogleImages([first, second]);
  });

  it("maps comments and their next page", async () => {
    const catalog = await replayed("catalog-comments");
    const first = commentPageSchema.parse(
      await catalog.comments("dQw4w9WgXcQ", "top"),
    );
    expect(first.comments.length).toBe(20);
    expect(
      first.comments.every(
        (c) => c.text.length > 0 && c.author.name.length > 0,
      ),
    ).toBe(true);
    const second = commentPageSchema.parse(
      await catalog.comments("dQw4w9WgXcQ", "top", first.continuation),
    );
    const ids = new Set(
      [...first.comments, ...second.comments].map((c) => c.commentId),
    );
    expect(ids.size).toBe(40);
  });

  it("maps a playlist with its size and its next page", async () => {
    const catalog = await replayed("catalog-playlist");
    const first = playlistPageSchema.parse(
      await catalog.playlist("UULFX6OQ3DkcsbYNE6H8uQQuVA"),
    );
    expect(first.playlist?.videoCount).toBeGreaterThan(100);
    expect(first.videos).toHaveLength(100);
    const second = playlistPageSchema.parse(
      await catalog.playlist("UULFX6OQ3DkcsbYNE6H8uQQuVA", first.continuation),
    );
    expect(second.videos[0]?.videoId).not.toBe(first.videos[0]?.videoId);
  });

  it("maps YouTube's Live page", async () => {
    const { videos } = await (await replayed("catalog-live")).live();
    expect(videos.some((v) => v.live === "live")).toBe(true);
    expect(
      videos
        .filter((v) => v.live === "live")
        .every((v) => v.durationSec === undefined && v.views === undefined),
    ).toBe(true);
  });
});
