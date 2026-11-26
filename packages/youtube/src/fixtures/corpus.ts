import type { Innertube, Types } from "youtubei.js";
import { Catalog } from "../browse/catalog.ts";
import { classifyPlayability } from "../playability.ts";
import type { RawPlayerResponse } from "../player.ts";

type InnerTubeClient = Types.InnerTubeClient;

/**
 * The fixture corpus: the cases OwnTube's YouTube layer must handle, each as
 * the calls that exercise it. The recorder runs them against YouTube; tests run
 * the same calls against the recording, offline.
 *
 * `run` returns what the entry resolved to (discovered ids, per-client
 * playability) so a replay can check it reproduces the recording. Entries
 * whose subject comes and goes (live, upcoming, post-live DVR, …) `discover`
 * one; `CORPUS_ID_<ENTRY>` (e.g. `CORPUS_ID_VIDEO_POST_LIVE_DVR`) overrides it.
 */
export interface CorpusContext {
  yt: Innertube;
  /** The discovered id, the override from the environment, or the recorded id on replay. */
  subjectId: string | undefined;
  /**
   * Runs `fn` and returns the raw response bodies it caused. Discovery reads
   * these because the signals it needs (badge styles, byline dialogs, raw
   * ids) do not survive youtubei.js's parsing.
   */
  raw: (fn: () => Promise<unknown>) => Promise<unknown[]>;
}

export interface CorpusEntry {
  id: string;
  description: string;
  /**
   * Finds a subject for entries whose subject comes and goes. It runs before
   * the recording, in a context of its own, so its traffic is not stored and
   * a replay never repeats it.
   */
  discover?: (ctx: CorpusContext) => Promise<string>;
  run: (ctx: CorpusContext) => Promise<Record<string, string>>;
}

/** Player clients recorded for every video, beyond the WEB `getInfo`. */
export const PLAYER_CLIENTS: readonly InnerTubeClient[] = [
  "ANDROID_VR",
  "VISIONOS",
  "TV_SIMPLY",
  "MWEB",
];

async function recordVideo(
  yt: Innertube,
  videoId: string,
): Promise<Record<string, string>> {
  const resolved: Record<string, string> = { videoId };
  const info = await yt.getInfo(videoId);
  resolved.WEB = info.playability_status?.status ?? "unknown";
  resolved.title = info.basic_info.title ?? "";
  for (const client of PLAYER_CLIENTS) {
    try {
      const basic = await yt.getBasicInfo(videoId, { client });
      resolved[client] = basic.playability_status?.status ?? "unknown";
    } catch (error) {
      resolved[client] =
        `error: ${error instanceof Error ? error.message : String(error)}`.slice(
          0,
          200,
        );
    }
  }
  return resolved;
}

/** `run` for an entry whose subject is a discovered video. */
function subjectVideo(entry: string): CorpusEntry["run"] {
  return ({ yt, subjectId }) => recordVideo(yt, requireId(entry, subjectId));
}

function requireId(entry: string, subjectId: string | undefined): string {
  if (!subjectId) throw new Error(`${entry}: no subject id`);
  return subjectId;
}

interface VideoLike {
  video_id?: unknown;
  is_live?: unknown;
  is_upcoming?: unknown;
}

/** Depth-first search through parsed youtubei.js nodes for the first video matching `predicate`. */
export function findVideoId(
  root: unknown,
  predicate: (v: VideoLike) => boolean,
): string | undefined {
  const seen = new Set<unknown>();
  const stack: unknown[] = [root];
  while (stack.length > 0) {
    const node = stack.pop();
    if (!node || typeof node !== "object" || seen.has(node)) continue;
    seen.add(node);
    const v = node as VideoLike;
    if (
      typeof v.video_id === "string" &&
      v.video_id.length === 11 &&
      predicate(v)
    )
      return v.video_id;
    const children = Array.isArray(node) ? node : Object.values(node);
    for (let i = children.length - 1; i >= 0; i--) stack.push(children[i]);
  }
  return undefined;
}

const MRBEAST = "UCX6OQ3DkcsbYNE6H8uQQuVA";
const LINUS_TECH_TIPS = "UCXuqSBlHAE6Xw-yeJA0Tunw";
/** YouTube's "Live" destination channel; what Invidious served as "trending". */
const YOUTUBE_LIVE = "UC4R8DWoMoI7CAwX8_LjQHig";

/**
 * The Catalog's player source for corpus entries: the VISIONOS player request
 * through the corpus's own youtubei.js instance, so it is recorded and replayed
 * with everything else.
 */
function recordedPlayer(
  yt: Innertube,
): ConstructorParameters<typeof Catalog>[0]["player"] {
  return async (videoId) => {
    // The body youtubei.js's own VISIONOS player request sends.
    const response = await yt.actions.execute("/player", {
      videoId,
      racyCheckOk: true,
      contentCheckOk: true,
      playbackContext: {
        contentPlaybackContext: {
          vis: 0,
          splay: false,
          lactMilliseconds: "-1",
        },
      },
      client: "VISIONOS",
    });
    const raw = response.data as RawPlayerResponse;
    return { raw, unplayable: classifyPlayability(raw.playabilityStatus) };
  };
}

/** A corpus entry that records the Catalog's own calls; `run` returns a summary, the test re-runs it on the recording. */
function catalogEntry(
  id: string,
  description: string,
  run: (catalog: Catalog) => Promise<Record<string, string>>,
): CorpusEntry {
  return {
    id,
    description,
    run: ({ yt }) =>
      run(new Catalog({ yt: async () => yt, player: recordedPlayer(yt) })),
  };
}

export const CATALOG_CORPUS: readonly CorpusEntry[] = [
  catalogEntry(
    "catalog-video",
    "Catalog.video: an ordinary video page",
    async (c) => {
      const v = await c.video("dQw4w9WgXcQ");
      return {
        videoId: v.videoId,
        related: String(v.related.length),
        captions: String(v.captions.length),
      };
    },
  ),
  catalogEntry(
    "catalog-collaboration",
    "Catalog.video: a collaboration's credited channels",
    async (c) => {
      const v = await c.video("efu_T8e_q8Q");
      return {
        videoId: v.videoId,
        collaborators: String(v.collaborators?.length ?? 0),
      };
    },
  ),
  catalogEntry(
    "catalog-channel",
    "Catalog.channel: a videos tab and its second page",
    async (c) => {
      const first = await c.channel(LINUS_TECH_TIPS, "videos");
      const second = await c.channel(
        LINUS_TECH_TIPS,
        "videos",
        first.continuation,
      );
      return {
        first: String(first.videos.length),
        second: String(second.videos.length),
      };
    },
  ),
  catalogEntry(
    "catalog-search",
    "Catalog.search and its second page",
    async (c) => {
      const first = await c.search("linus tech tips");
      const second = await c.search("linus tech tips", first.continuation);
      return {
        first: String(first.videos.length),
        channels: String(first.channels.length),
        second: String(second.videos.length),
      };
    },
  ),
  catalogEntry(
    "catalog-comments",
    "Catalog.comments and the second page",
    async (c) => {
      const first = await c.comments("dQw4w9WgXcQ", "top");
      const second = await c.comments("dQw4w9WgXcQ", "top", first.continuation);
      return {
        first: String(first.comments.length),
        second: String(second.comments.length),
      };
    },
  ),
  catalogEntry(
    "catalog-playlist",
    "Catalog.playlist (an uploads playlist) and its second page",
    async (c) => {
      const first = await c.playlist(`UULF${MRBEAST.slice(2)}`);
      const second = await c.playlist(
        `UULF${MRBEAST.slice(2)}`,
        first.continuation,
      );
      return {
        first: String(first.videos.length),
        second: String(second.videos.length),
      };
    },
  ),
  catalogEntry(
    "catalog-chapters",
    "Catalog.video: a video with chapters",
    async (c) => {
      const v = await c.video("cm94WV0ReKg");
      return { videoId: v.videoId, chapters: String(v.chapters.length) };
    },
  ),
  catalogEntry(
    "catalog-members-only",
    "Catalog.video: a members-only video",
    async (c) => {
      const v = await c.video("qiLUvCt3k6g");
      return { videoId: v.videoId, unplayable: v.unplayable?.kind ?? "none" };
    },
  ),
  catalogEntry(
    "catalog-no-videos-tab",
    "Catalog.channel: a channel without a Videos tab",
    async (c) => {
      const page = await c.channel("UCOP4C_j2HOPFvick2ioJ4EQ", "videos");
      return {
        videos: String(page.videos.length),
        tabs: page.channel?.tabs.join(",") ?? "",
      };
    },
  ),
  {
    id: "catalog-live-video",
    description: "Catalog.video: a stream that is live now (live storyboard)",
    discover: async ({ yt }) => {
      const search = await yt.search("live", {
        type: "video",
        features: ["live"],
      });
      return requireId(
        "catalog-live-video",
        findVideoId(search.results, (v) => v.is_live === true),
      );
    },
    run: async ({ yt, subjectId }) => {
      const v = await new Catalog({
        yt: async () => yt,
        player: recordedPlayer(yt),
      }).video(requireId("catalog-live-video", subjectId));
      return {
        videoId: v.videoId,
        live: v.live,
        storyboard: v.storyboard?.kind ?? "none",
      };
    },
  },
  catalogEntry(
    "catalog-live",
    "Catalog.live: YouTube's Live page",
    async (c) => ({ videos: String((await c.live()).videos.length) }),
  ),
];

export const CORPUS: readonly CorpusEntry[] = [
  {
    id: "video-h264-captions",
    description: "Ordinary VOD with H.264, VP9 and captions; also its comments",
    run: async ({ yt }) => {
      const resolved = await recordVideo(yt, "dQw4w9WgXcQ");
      const comments = await yt.getComments("dQw4w9WgXcQ");
      resolved.comments = String(comments.contents.length);
      return resolved;
    },
  },
  {
    id: "video-2160p-vp9-av1",
    description: "VP9 and AV1 ladders up to 2160p, 60 fps",
    run: ({ yt }) => recordVideo(yt, "aqz-KE-bpKQ"),
  },
  {
    id: "video-hdr",
    description: "HDR upload (VP9.2 / 10-bit AV1 next to SDR)",
    run: ({ yt }) => recordVideo(yt, "mjsMqasGhKU"),
  },
  {
    id: "video-multi-audio",
    description: "Dubbed audio tracks next to the original",
    run: ({ yt }) => recordVideo(yt, "0e3GPea1Tyg"),
  },
  {
    id: "video-age-restricted",
    description: "Age-restricted video",
    run: ({ yt }) => recordVideo(yt, "HtVdAasjOgU"),
  },
  {
    id: "video-short",
    description: "A Short, from a channel's Shorts tab",
    discover: async ({ yt }) => {
      const shorts = await (await yt.getChannel(MRBEAST)).getShorts();
      return requireId(
        "video-short",
        findVideoId(shorts, () => true) ?? findShortId(shorts),
      );
    },
    run: async ({ yt, subjectId }) => {
      const resolved = await recordVideo(
        yt,
        requireId("video-short", subjectId),
      );
      await yt.getShortsVideoInfo(resolved.videoId as string);
      return resolved;
    },
  },
  {
    id: "video-live",
    description: "A live stream, from a live-only search",
    discover: async ({ yt }) => {
      const search = await yt.search("live", {
        type: "video",
        features: ["live"],
      });
      return requireId(
        "video-live",
        findVideoId(search.results, (v) => v.is_live === true),
      );
    },
    run: subjectVideo("video-live"),
  },
  {
    id: "video-upcoming",
    description: "An upcoming stream or premiere, from YouTube's Live page",
    discover: async ({ yt }) =>
      requireId(
        "video-upcoming",
        findVideoId(
          await yt.getChannel(YOUTUBE_LIVE),
          (v) => v.is_upcoming === true,
        ),
      ),
    run: subjectVideo("video-upcoming"),
  },
  {
    id: "video-post-live-dvr",
    description:
      "A stream that just ended and is still served as DVR, from today's stream uploads and live channels' Streams tabs",
    discover: ({ yt, raw }) => discoverPostLiveDvr(yt, raw),
    run: subjectVideo("video-post-live-dvr"),
  },
  {
    id: "video-members-only",
    description:
      "A members-only video, from the Videos tabs of popular channels",
    discover: ({ yt, raw }) => discoverMembersOnly(yt, raw),
    run: subjectVideo("video-members-only"),
  },
  {
    id: "video-collaboration",
    description:
      "A video credited to several channels (byline 'A and N more'), from search",
    discover: ({ yt, raw }) => discoverCollaboration(yt, raw),
    run: subjectVideo("video-collaboration"),
  },
  {
    id: "channel-tabs",
    description:
      "A channel with every tab: home, videos, shorts, streams, playlists, about",
    run: async ({ yt }) => {
      const channel = await yt.getChannel(LINUS_TECH_TIPS);
      const resolved: Record<string, string> = {
        channelId: LINUS_TECH_TIPS,
        title: channel.metadata.title ?? "",
      };
      for (const tab of [
        "getVideos",
        "getShorts",
        "getLiveStreams",
        "getPlaylists",
        "getAbout",
      ] as const) {
        try {
          await channel[tab]();
          resolved[tab] = "ok";
        } catch (error) {
          resolved[tab] =
            `error: ${error instanceof Error ? error.message : String(error)}`.slice(
              0,
              200,
            );
        }
      }
      return resolved;
    },
  },
  {
    id: "channel-handle",
    description: "Resolving an @handle to a channel id",
    run: async ({ yt }) => {
      const endpoint = await yt.resolveURL(
        "https://www.youtube.com/@LinusTechTips",
      );
      const browseId = String(endpoint.payload?.browseId ?? "");
      const channel = await yt.getChannel(
        requireId("channel-handle", browseId || undefined),
      );
      return {
        handle: "@LinusTechTips",
        channelId: browseId,
        title: channel.metadata.title ?? "",
      };
    },
  },
  {
    id: "live-page",
    description:
      "YouTube's Live page (OwnTube's Live section; Invidious's 'trending')",
    run: async ({ yt }) => {
      const live = await yt.getChannel(YOUTUBE_LIVE);
      return {
        channelId: YOUTUBE_LIVE,
        firstLive: findVideoId(live, (v) => v.is_live === true) ?? "",
      };
    },
  },
  {
    id: "search",
    description: "Search results and suggestions",
    run: async ({ yt }) => {
      const search = await yt.search("lofi hip hop");
      const suggestions = await yt.getSearchSuggestions("never gonna");
      return {
        results: String(search.results.length),
        suggestions: String(suggestions.length),
      };
    },
  },
  {
    id: "playlist-uploads",
    description: "A channel's long-form uploads playlist (UULF…)",
    run: async ({ yt }) => {
      const playlist = await yt.getPlaylist(`UULF${MRBEAST.slice(2)}`);
      return {
        playlistId: `UULF${MRBEAST.slice(2)}`,
        items: String(playlist.items.length),
      };
    },
  },
  ...CATALOG_CORPUS,
];

/** Shorts tabs list `ShortsLockupView`s, which carry the id in their endpoint rather than `video_id`. */
function findShortId(root: unknown): string | undefined {
  const match = JSON.stringify(root).match(
    /"(?:videoId|video_id)":"([A-Za-z0-9_-]{11})"/,
  );
  return match?.[1];
}

/** Visits every object in a raw or parsed response. */
function visit(
  root: unknown,
  fn: (node: Record<string, unknown>) => void,
): void {
  const stack: unknown[] = [root];
  while (stack.length > 0) {
    const node = stack.pop();
    if (!node || typeof node !== "object") continue;
    if (!Array.isArray(node)) fn(node as Record<string, unknown>);
    stack.push(...Object.values(node));
  }
}

function channelIds(root: unknown): string[] {
  return [
    ...new Set(
      [
        ...JSON.stringify(root).matchAll(/"browseId":"(UC[A-Za-z0-9_-]{22})"/g),
      ].map((m) => m[1] as string),
    ),
  ];
}

function videoIds(root: unknown): string[] {
  return [
    ...new Set(
      [
        ...JSON.stringify(root).matchAll(/"videoId":"([A-Za-z0-9_-]{11})"/g),
      ].map((m) => m[1] as string),
    ),
  ];
}

type Raw = CorpusContext["raw"];

/**
 * Post-live DVR lasts only until YouTube finishes processing an ended stream,
 * so look where fresh streams are: today's uploads for stream-flavoured
 * queries, then the Streams tabs of channels that are live right now. On
 * 2026-11-26 the first hit came after 23 candidates.
 */
async function discoverPostLiveDvr(yt: Innertube, raw: Raw): Promise<string> {
  const candidates = new Set<string>();
  for (const query of [
    "stream",
    "live stream",
    "livestream",
    "just chatting",
  ]) {
    const today = await raw(() =>
      yt.search(query, { upload_date: "today", type: "video" }),
    );
    for (const id of videoIds(today)) candidates.add(id);
  }
  const live = await raw(() =>
    yt.search("live", { type: "video", features: ["live"] }),
  );
  for (const channelId of channelIds(live).slice(0, 15)) {
    try {
      const streams = await raw(async () =>
        (await yt.getChannel(channelId)).getLiveStreams(),
      );
      for (const id of videoIds(streams).slice(0, 6)) candidates.add(id);
    } catch {
      // a channel without a Streams tab
    }
  }
  for (const videoId of [...candidates].slice(0, 200)) {
    const info = await yt.getBasicInfo(videoId, { client: "ANDROID_VR" });
    if (info.basic_info.is_post_live_dvr) return videoId;
  }
  throw new Error(
    `video-post-live-dvr: none among ${Math.min(candidates.size, 200)} candidates`,
  );
}

/** Members-only uploads are listed in a channel's Videos tab with a members badge. */
async function discoverMembersOnly(yt: Innertube, raw: Raw): Promise<string> {
  const popular = await raw(() =>
    yt.search("vtuber", { type: "video", prioritize: "popularity" }),
  );
  for (const channelId of channelIds(popular).slice(0, 40)) {
    let videos: unknown[];
    try {
      videos = await raw(async () =>
        (await yt.getChannel(channelId)).getVideos(),
      );
    } catch {
      continue;
    }
    const found = firstVideo(videos, (node) =>
      /MEMBERS_ONLY|"Members only"/.test(JSON.stringify(node)),
    );
    if (found) return found;
  }
  throw new Error("video-members-only: none found");
}

/** A collaboration's byline opens a dialog listing its channels ("A and 7 more"). */
async function discoverCollaboration(yt: Innertube, raw: Raw): Promise<string> {
  for (const query of ["collab", "big collab", "ft.", "feat"]) {
    const search = await raw(() =>
      yt.search(query, { upload_date: "month", type: "video" }),
    );
    const found = firstVideo(search, (node) =>
      JSON.stringify(node.longBylineText ?? {}).includes("showDialogCommand"),
    );
    if (found) return found;
  }
  throw new Error("video-collaboration: none found");
}

/** The first raw video (`videoRenderer`, `gridVideoRenderer` or `lockupViewModel`) matching `predicate`. */
function firstVideo(
  responses: unknown[],
  predicate: (node: Record<string, unknown>) => boolean,
): string | undefined {
  let found: string | undefined;
  visit(responses, (node) => {
    if (found) return;
    const renderer = (node.videoRenderer ?? node.gridVideoRenderer) as
      | (Record<string, unknown> & { videoId?: string })
      | undefined;
    const lockup = node.lockupViewModel as
      | (Record<string, unknown> & { contentId?: string })
      | undefined;
    const video = renderer ?? lockup;
    const id = renderer?.videoId ?? lockup?.contentId;
    if (video && id && predicate(video)) found = id;
  });
  return found;
}

export function manualIdEnvName(entryId: string): string {
  return `CORPUS_ID_${entryId.replace(/-/g, "_").toUpperCase()}`;
}
