import { readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  appPathFromYoutubeUrl,
  canonicalYoutubePath,
  parseStartSeconds,
  parseVideoIdParam,
  readWatchParams,
} from "@/lib/youtube-url";

const ID = "dQw4w9WgXcQ";
const UC = "UCuAXFkgsw1L7xaCfnd5JJOw";
const PL = "PLFgquLnL59alCl_2TQvOiD5Vgm1hCaGSI";

/** Where the middleware sends `url` (path + query), or null for no redirect. */
function redirectOf(url: string): string | null {
  const q = url.indexOf("?");
  return q < 0
    ? canonicalYoutubePath(url, "")
    : canonicalYoutubePath(url.slice(0, q), url.slice(q));
}

describe("parseVideoIdParam", () => {
  it("accepts a clean id", () => {
    expect(parseVideoIdParam(ID)?.videoId).toBe(ID);
    expect(parseVideoIdParam(` ${ID} `)?.videoId).toBe(ID);
  });

  it("splits parameters after a stray ? & # or /", () => {
    const share = parseVideoIdParam("qy2FlFQecd8?is=SrPXFcSLv5_crWz_");
    expect(share?.videoId).toBe("qy2FlFQecd8");
    expect(share?.extra.get("is")).toBe("SrPXFcSLv5_crWz_");
    expect(parseVideoIdParam(`${ID}?si=abc`)?.extra.get("si")).toBe("abc");
    expect(parseVideoIdParam(`${ID}&t=90`)?.extra.get("t")).toBe("90");
    expect(parseVideoIdParam(`${ID}#t=90`)?.extra.get("t")).toBe("90");
    expect(parseVideoIdParam(`${ID}/`)?.videoId).toBe(ID);
  });

  it("rejects anything that is not an id", () => {
    expect(parseVideoIdParam("notavalid")).toBeNull();
    expect(parseVideoIdParam(`${ID}x`)).toBeNull();
    expect(parseVideoIdParam("dQw4w9WgXc!")).toBeNull();
    expect(parseVideoIdParam("")).toBeNull();
    expect(parseVideoIdParam(null)).toBeNull();
  });
});

describe("parseStartSeconds", () => {
  it.each([
    ["90", 90],
    ["90s", 90],
    ["1m30s", 90],
    ["1m30", 90],
    ["5m", 300],
    ["1h2m3s", 3723],
    ["2h", 7200],
    ["#t=90", 90],
    ["#t=1m30s", 90],
    ["t=90s", 90],
    ["start=90", 90],
    ["90.7", 90],
    ["0", 0],
  ])("%s -> %d", (raw, seconds) => {
    expect(parseStartSeconds(raw)).toBe(seconds);
  });

  it.each(["", "abc", "1x", "m", "-5", "1s2m"])("rejects %j", (raw) => {
    expect(parseStartSeconds(raw)).toBeUndefined();
  });
});

describe("readWatchParams", () => {
  it("reads the id and start time of a clean URL", () => {
    expect(readWatchParams(new URLSearchParams(`v=${ID}&t=90`))).toEqual({
      videoId: ID,
      startSeconds: 90,
      list: undefined,
    });
  });

  it("repairs the malformed share links", () => {
    expect(
      readWatchParams(new URLSearchParams("v=qy2FlFQecd8?is=SrPXFcSLv5_crWz_"))
        .videoId,
    ).toBe("qy2FlFQecd8");
    expect(readWatchParams(new URLSearchParams(`v=${ID}?si=abc`)).videoId).toBe(
      ID,
    );
  });

  it("takes t or start in every YouTube form", () => {
    for (const [query, seconds] of [
      [`v=${ID}&t=1m30s`, 90],
      [`v=${ID}&t=90s`, 90],
      [`v=${ID}&t=1h2m3s`, 3723],
      [`v=${ID}&start=90`, 90],
      [`v=${ID}?t=45`, 45],
    ] as const) {
      expect(readWatchParams(new URLSearchParams(query)).startSeconds).toBe(
        seconds,
      );
    }
  });

  it("lets a real parameter win over one smuggled into v", () => {
    expect(
      readWatchParams(new URLSearchParams(`v=${ID}?t=10&t=20`)).startSeconds,
    ).toBe(20);
  });

  it("returns no id for an invalid v", () => {
    expect(readWatchParams(new URLSearchParams("v=notavalid")).videoId).toBe(
      null,
    );
  });
});

describe("canonicalYoutubePath: confirmed failures", () => {
  it.each([
    // 1. a second ? in v
    ["/watch?v=qy2FlFQecd8?is=SrPXFcSLv5_crWz_", "/watch?v=qy2FlFQecd8"],
    [`/watch?v=${ID}?si=abc`, `/watch?v=${ID}`],
    [`/watch?v=${ID}?si=abc&t=90`, `/watch?v=${ID}&t=90`],
    // 2. start-time forms
    [`/watch?v=${ID}&t=1m30s`, `/watch?v=${ID}&t=90`],
    [`/watch?v=${ID}&t=90s`, `/watch?v=${ID}&t=90`],
    [`/watch?v=${ID}&t=1h2m3s`, `/watch?v=${ID}&t=3723`],
    [`/watch?v=${ID}&start=90`, `/watch?v=${ID}&t=90`],
    [`/watch?v=${ID}%23t%3D90`, `/watch?v=${ID}&t=90`],
    // 3. former 404s
    [`/channel/${UC}/videos`, `/channel/${UC}`],
    ["/results?search_query=rick+astley", "/search?q=rick+astley"],
    ["/feed/subscriptions", "/subscriptions"],
    ["/feed/trending", "/trending"],
    ["/feed/history", "/history"],
    ["/feed/library", "/playlists"],
    ["/feed/playlists", "/playlists"],
    ["/feed/channels", "/subscriptions/channels"],
    ["/clip/UgkxU2HSeGL_NvmDJ-nQJrlLwllwMDBdGZFs", "/"],
    ["/hashtag/music", "/search?q=%23music"],
    [
      "/attribution_link?u=%2Fwatch%3Fv%3DdQw4w9WgXcQ%26feature%3Dshare",
      `/watch?v=${ID}`,
    ],
  ])("%s -> %s", (from, to) => {
    expect(redirectOf(from)).toBe(to);
  });
});

describe("canonicalYoutubePath: required behaviour", () => {
  it("drops tracking parameters", () => {
    expect(
      redirectOf(
        `/watch?v=${ID}&pp=ygUJ&feature=youtu.be&ab_channel=RickAstley&app=desktop&embeds_referring_euri=x&embeds_referring_origin=y&si=s&is=i`,
      ),
    ).toBe(`/watch?v=${ID}`);
    expect(redirectOf(`/playlist?list=${PL}&si=abc`)).toBe(
      `/playlist?list=${PL}`,
    );
    expect(redirectOf(`/shorts/${ID}?si=abc&feature=share`)).toBe(
      `/watch?v=${ID}`,
    );
  });

  it("plays the video of a playlist watch link and drops the list", () => {
    expect(redirectOf(`/watch?v=${ID}&list=${PL}&index=3`)).toBe(
      `/watch?v=${ID}`,
    );
    expect(redirectOf(`/watch?v=${ID}&list=${PL}&t=30s`)).toBe(
      `/watch?v=${ID}&t=30`,
    );
  });

  it("opens the playlist for a watch link without a video", () => {
    expect(redirectOf(`/watch?list=${PL}`)).toBe(`/playlist?list=${PL}`);
    expect(redirectOf(`/embed/videoseries?list=${PL}`)).toBe(
      `/playlist?list=${PL}`,
    );
  });

  it("leaves an invalid or missing id to the watch page's not-found page", () => {
    expect(redirectOf("/watch?v=notavalid")).toBeNull();
    expect(redirectOf("/watch")).toBeNull();
    expect(redirectOf("/watch?t=90")).toBeNull();
  });

  it.each([
    "videos",
    "shorts",
    "streams",
    "playlists",
    "community",
    "about",
    "featured",
    "search",
  ])("channel tab %s goes to the channel", (tab) => {
    expect(redirectOf(`/channel/${UC}/${tab}`)).toBe(`/channel/${UC}`);
    expect(redirectOf(`/channel/${UC}/${tab}?si=abc`)).toBe(`/channel/${UC}`);
  });

  it("maps every search shape", () => {
    expect(redirectOf("/results?search_query=a%20b&sp=EgIQAQ%253D%253D")).toBe(
      "/search?q=a+b",
    );
    expect(redirectOf("/results?q=cats")).toBe("/search?q=cats");
    expect(redirectOf("/results?search_query=")).toBe("/");
    expect(redirectOf("/results")).toBe("/");
  });

  it("maps every feed", () => {
    expect(redirectOf("/feed/explore")).toBe("/trending");
    expect(redirectOf("/feed/you")).toBe("/playlists");
    expect(redirectOf("/feed/somethingelse")).toBe("/");
    expect(redirectOf("/feed")).toBe("/");
  });

  it("follows attribution links through the same rules", () => {
    expect(
      redirectOf(
        `/attribution_link?a=x&u=${encodeURIComponent(`/watch?v=${ID}?si=abc&t=1m`)}`,
      ),
    ).toBe(`/watch?v=${ID}&t=60`);
    expect(
      redirectOf(
        `/attribution_link?u=${encodeURIComponent("/channel/UCx/videos")}`,
      ),
    ).toBe("/channel/UCx");
    expect(
      redirectOf(
        `/attribution_link?u=${encodeURIComponent(`https://www.youtube.com/watch?v=${ID}`)}`,
      ),
    ).toBe(`/watch?v=${ID}`);
  });

  it("never follows an attribution link off the site", () => {
    for (const u of [
      "//evil.example/watch",
      "/\\evil.example",
      "https://evil.example/",
      "",
    ]) {
      expect(redirectOf(`/attribution_link?u=${encodeURIComponent(u)}`)).toBe(
        "/",
      );
    }
  });

  it("sends YouTube-only pages home", () => {
    for (const p of [
      "/premium",
      "/account",
      "/account_notifications",
      "/signin",
      "/upload",
      "/redirect?q=https%3A%2F%2Fevil.example",
    ]) {
      expect(redirectOf(p)).toBe("/");
    }
  });

  it("maps a host-swapped youtu.be link", () => {
    expect(redirectOf(`/${ID}`)).toBe(`/watch?v=${ID}`);
    expect(redirectOf(`/${ID}?si=abc&t=42`)).toBe(`/watch?v=${ID}&t=42`);
  });
});

describe("canonicalYoutubePath: already working", () => {
  it.each([
    ["/@RickAstleyYT", "/channel/@RickAstleyYT"],
    ["/@RickAstleyYT/videos", "/channel/@RickAstleyYT"],
    ["/c/RickAstley", "/channel/RickAstley"],
    ["/user/RickAstleyVEVO", "/channel/RickAstleyVEVO"],
    [`/shorts/${ID}`, `/watch?v=${ID}`],
    [`/shorts/${ID}?si=abc`, `/watch?v=${ID}`],
    [`/embed/${ID}`, `/watch?v=${ID}`],
    [`/embed/${ID}?start=90`, `/watch?v=${ID}&t=90`],
    [`/live/${ID}?si=abc`, `/watch?v=${ID}`],
    [`/v/${ID}`, `/watch?v=${ID}`],
    [`/watch/${ID}?t=30`, `/watch?v=${ID}&t=30`],
    [`/playlist/${PL}`, `/playlist?list=${PL}`],
  ])("%s -> %s", (from, to) => {
    expect(redirectOf(from)).toBe(to);
  });

  it.each([
    `/watch?v=${ID}`,
    `/watch?v=${ID}&t=90`,
    `/playlist?list=${PL}`,
    `/channel/${UC}`,
    "/channel/@RickAstleyYT",
    "/",
    "/shorts",
    "/search?q=rick&sort=newest",
    "/subscriptions/channels",
    "/playlists/42",
    "/settings",
    "/manifest.webmanifest",
    "/logo-dark.svg",
  ])("leaves canonical %s alone", (url) => {
    expect(redirectOf(url)).toBeNull();
  });

  it("ignores Next's RSC cache-busting parameter", () => {
    expect(redirectOf(`/watch?v=${ID}&_rsc=abc12`)).toBeNull();
  });
});

describe("canonicalYoutubePath: safety", () => {
  it("never redirects an OwnTube route (some are 11 characters long)", () => {
    const appDir = new URL("../app", import.meta.url);
    const routes = readdirSync(appDir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
    expect(routes).toContain("recommended");
    for (const route of routes) {
      expect(redirectOf(`/${route}`), route).toBeNull();
    }
  });

  it("redirects only to URLs that are already canonical", () => {
    const samples = [
      "/watch?v=qy2FlFQecd8?is=SrPXFcSLv5_crWz_",
      `/watch?v=${ID}&t=1h2m3s&list=${PL}`,
      `/channel/${UC}/videos`,
      "/results?search_query=rick+astley",
      "/feed/channels",
      "/hashtag/music",
      "/attribution_link?u=%2Fwatch%3Fv%3DdQw4w9WgXcQ",
      `/${ID}?si=x`,
      `/embed/videoseries?list=${PL}`,
      "/premium",
    ];
    for (const from of samples) {
      const to = redirectOf(from);
      expect(to, from).not.toBeNull();
      expect(redirectOf(to as string), `${from} -> ${to}`).toBeNull();
    }
  });
});

describe("appPathFromYoutubeUrl (search box)", () => {
  it.each([
    [`https://www.youtube.com/watch?v=${ID}&si=abc`, `/watch?v=${ID}`],
    [`https://youtu.be/${ID}?si=abc&t=90`, `/watch?v=${ID}&t=90`],
    [`youtu.be/${ID}`, `/watch?v=${ID}`],
    [`https://m.youtube.com/watch?v=${ID}#t=1m30s`, `/watch?v=${ID}&t=90`],
    [`https://music.youtube.com/watch?v=${ID}`, `/watch?v=${ID}`],
    [`https://www.youtube-nocookie.com/embed/${ID}`, `/watch?v=${ID}`],
    [`youtube.com/shorts/${ID}`, `/watch?v=${ID}`],
    [`https://www.youtube.com/playlist?list=${PL}`, `/playlist?list=${PL}`],
    ["https://www.youtube.com/@RickAstleyYT/videos", "/channel/@RickAstleyYT"],
    [`https://www.youtube.com/channel/${UC}`, `/channel/${UC}`],
    ["https://www.youtube.com/results?search_query=cats", "/search?q=cats"],
    ["https://www.youtube.com/", "/"],
  ])("%s -> %s", (text, path) => {
    expect(appPathFromYoutubeUrl(text)).toBe(path);
  });

  it.each([
    "rick astley",
    "never gonna give you up",
    "music",
    "https://example.com/watch?v=dQw4w9WgXcQ",
    "javascript:alert(1)",
    "",
  ])("leaves %j to text search", (text) => {
    expect(appPathFromYoutubeUrl(text)).toBeNull();
  });
});
