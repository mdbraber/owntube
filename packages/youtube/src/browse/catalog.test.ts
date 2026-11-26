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

/** Every image URL in a value: entries of thumbnails, avatars and banners, and storyboard templates. */
function imageUrls(value: unknown): string[] {
  const out: string[] = [];
  JSON.stringify(value, (k, v) => {
    if (["thumbnails", "avatars", "banners"].includes(k) && Array.isArray(v)) {
      for (const image of v as Array<{ url?: string }>)
        if (image.url) out.push(image.url);
    }
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
    // The exact instant, from WEB's microformat.
    expect(v.published).toMatchObject({
      at: Date.parse("2009-10-24T23:57:33-07:00"),
      precision: "exact",
      text: "Oct 25, 2009",
    });
    expect(v.durationSec).toBe(213);
    expect(v.captions.length).toBeGreaterThan(0);
    expect(v.storyboard?.templateUrl).toMatch(
      /^\/media\/img\/yti\/sb\/dQw4w9WgXcQ\/.*\$M/,
    );
    expect(v.related.length).toBeGreaterThan(10);
    // Regular videos credit their channel; YouTube's Shorts rows do not.
    const regular = v.related.filter((r) => !r.isShort);
    expect(regular.length).toBeGreaterThan(10);
    expect(regular.every((r) => r.channel?.channelId.startsWith("UC"))).toBe(
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
    expect(first.channel?.videoCount?.approximate).toBe(false);
    // The whole description, from the About panel (the header's stops at 160 characters).
    expect(first.channel?.description?.length).toBeGreaterThan(160);
    expect(
      first.channel?.links.some((l) =>
        /^https:\/\/(www\.)?lttstore\.com/.test(l.url),
      ),
    ).toBe(true);
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

  it("answers a missing tab with an empty page and says which tabs exist", async () => {
    const page = await (await replayed("catalog-no-videos-tab")).channel(
      "UCOP4C_j2HOPFvick2ioJ4EQ",
      "videos",
    );
    expect(page.videos).toEqual([]);
    expect(page.channel?.tabs).toEqual(["shorts", "playlists"]);
  });

  it("gives a live stream a live storyboard", async () => {
    const fixture = await readFixture("catalog-live-video");
    const v = videoDetailSchema.parse(
      await (await replayed("catalog-live-video")).video(
        fixture.resolved.videoId as string,
      ),
    );
    expect(v.live).toBe("live");
    expect(v.storyboard).toMatchObject({ kind: "live" });
    expect(v.storyboard?.templateUrl).toMatch(/^\/media\/img\/yti\/sb\/.*\$M/);
    expect(v.durationSec).toBeUndefined();
  });

  it("gives a VOD a fixed set of storyboard sheets", async () => {
    const v = await (await replayed("catalog-video")).video("dQw4w9WgXcQ");
    expect(v.storyboard).toMatchObject({ kind: "vod" });
    expect(
      v.storyboard?.kind === "vod" && v.storyboard.sheetCount,
    ).toBeGreaterThan(0);
  });

  it("reads chapters from the player bar", async () => {
    const v = await (await replayed("catalog-chapters")).video("cm94WV0ReKg");
    expect(v.chapters).toHaveLength(6);
    expect(v.chapters[0]?.startSec).toBe(0);
    expect(
      v.chapters.every(
        (c, i, all) =>
          c.title.length > 0 &&
          (i === 0 || c.startSec > (all[i - 1]?.startSec ?? 0)),
      ),
    ).toBe(true);
    expectNoGoogleImages(v);
  });

  it("says a members-only video is members-only", async () => {
    const v = await (await replayed("catalog-members-only")).video(
      "qiLUvCt3k6g",
    );
    expect(v.unplayable?.kind).toBe("members-only");
    expect(v.membersOnly).toBe(true);
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
