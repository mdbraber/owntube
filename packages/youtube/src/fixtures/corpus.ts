import type { Innertube, Types } from "youtubei.js";

type InnerTubeClient = Types.InnerTubeClient;

/**
 * The fixture corpus: the cases OwnTube's YouTube layer must handle, each as
 * the calls that exercise it. The recorder runs them against YouTube; tests run
 * the same calls against the recording, offline.
 *
 * `run` returns what the entry resolved to (discovered ids, per-client
 * playability) so a replay can check it reproduces the recording. An entry
 * whose subject cannot be found automatically takes its id from the
 * environment (`CORPUS_ID_<ENTRY>`, e.g. `CORPUS_ID_VIDEO_POST_LIVE_DVR`) and
 * is skipped when none is given.
 */
export interface CorpusEntry {
  id: string;
  description: string;
  /** Environment override for the subject id, for subjects found by hand. */
  manualId?: true;
  run: (
    yt: Innertube,
    subjectId: string | undefined,
  ) => Promise<Record<string, string>>;
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

export const CORPUS: readonly CorpusEntry[] = [
  {
    id: "video-h264-captions",
    description: "Ordinary VOD with H.264, VP9 and captions; also its comments",
    run: async (yt) => {
      const resolved = await recordVideo(yt, "dQw4w9WgXcQ");
      const comments = await yt.getComments("dQw4w9WgXcQ");
      resolved.comments = String(comments.contents.length);
      return resolved;
    },
  },
  {
    id: "video-2160p-vp9-av1",
    description: "VP9 and AV1 ladders up to 2160p, 60 fps",
    run: (yt) => recordVideo(yt, "aqz-KE-bpKQ"),
  },
  {
    id: "video-hdr",
    description: "HDR upload (VP9.2 / 10-bit AV1 next to SDR)",
    run: (yt) => recordVideo(yt, "mjsMqasGhKU"),
  },
  {
    id: "video-multi-audio",
    description: "Dubbed audio tracks next to the original",
    run: (yt) => recordVideo(yt, "0e3GPea1Tyg"),
  },
  {
    id: "video-age-restricted",
    description: "Age-restricted video",
    run: (yt) => recordVideo(yt, "HtVdAasjOgU"),
  },
  {
    id: "video-short",
    description: "A Short, discovered from a channel's Shorts tab",
    run: async (yt) => {
      const shorts = await (await yt.getChannel(MRBEAST)).getShorts();
      const videoId = findVideoId(shorts, () => true) ?? findShortId(shorts);
      const resolved = await recordVideo(yt, requireId("video-short", videoId));
      await yt.getShortsVideoInfo(resolved.videoId as string);
      return resolved;
    },
  },
  {
    id: "video-live",
    description: "A live stream, discovered by a live-only search",
    run: async (yt) => {
      const search = await yt.search("live", {
        type: "video",
        features: ["live"],
      });
      return recordVideo(
        yt,
        requireId(
          "video-live",
          findVideoId(search.results, (v) => v.is_live === true),
        ),
      );
    },
  },
  {
    id: "video-upcoming",
    description:
      "An upcoming stream or premiere, discovered on YouTube's Live page",
    run: async (yt) => {
      const live = await yt.getChannel(YOUTUBE_LIVE);
      return recordVideo(
        yt,
        requireId(
          "video-upcoming",
          findVideoId(live, (v) => v.is_upcoming === true),
        ),
      );
    },
  },
  {
    id: "video-post-live-dvr",
    description:
      "A live stream that ended and is still served as DVR (rare; find by hand)",
    manualId: true,
    run: (yt, id) => recordVideo(yt, requireId("video-post-live-dvr", id)),
  },
  {
    id: "video-members-only",
    description: "Members-only video (find by hand)",
    manualId: true,
    run: (yt, id) => recordVideo(yt, requireId("video-members-only", id)),
  },
  {
    id: "video-collaboration",
    description:
      "Collaboration video with several channels credited (find by hand)",
    manualId: true,
    run: (yt, id) => recordVideo(yt, requireId("video-collaboration", id)),
  },
  {
    id: "channel-tabs",
    description:
      "A channel with every tab: home, videos, shorts, streams, playlists, about",
    run: async (yt) => {
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
    run: async (yt) => {
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
    run: async (yt) => {
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
    run: async (yt) => {
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
    run: async (yt) => {
      const playlist = await yt.getPlaylist(`UULF${MRBEAST.slice(2)}`);
      return {
        playlistId: `UULF${MRBEAST.slice(2)}`,
        items: String(playlist.items.length),
      };
    },
  },
];

/** Shorts tabs list `ShortsLockupView`s, which carry the id in their endpoint rather than `video_id`. */
function findShortId(root: unknown): string | undefined {
  const match = JSON.stringify(root).match(
    /"(?:videoId|video_id)":"([A-Za-z0-9_-]{11})"/,
  );
  return match?.[1];
}

export function manualIdEnvName(entryId: string): string {
  return `CORPUS_ID_${entryId.replace(/-/g, "_").toUpperCase()}`;
}
