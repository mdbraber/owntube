import { invidiousPortCollidesWithNextApp } from "@/lib/invidious-port-collision";
import type { UnifiedVideo } from "@/server/services/proxy.types";
import {
  type ProxySourceOverrides,
  resolveProxyBaseCandidates,
} from "@/server/services/proxy/config";
import {
  recordUpstreamFailure,
  throwIfUpstreamFailed,
} from "@/server/services/proxy/errors";
import { fetchJson } from "@/server/services/proxy/http";
import { mapInvidiousItem } from "@/server/services/proxy/mappers/invidious";
import {
  mapPipedItem,
  pipedListItemsFromPayload,
} from "@/server/services/proxy/mappers/piped";
import { normalizeBaseUrl } from "@/server/services/proxy/normalize";
import { unifiedVideoSchema } from "@/server/services/proxy.types";
import { acquireUpstreamSlot } from "@/server/services/rate-limiter";
import { upstreamGetText } from "@/server/services/upstream-get";

export type ChannelPlaylistSummary = {
  playlistId: string;
  title: string;
  thumbnailUrl: string | null;
  videoCount: number | null;
};

export type ChannelPlaylistsResult = {
  playlists: ChannelPlaylistSummary[];
  sourceUsed: "piped" | "invidious";
};

export type YtPlaylistResult = {
  playlistId: string;
  title: string;
  channelId: string | null;
  channelName: string | null;
  videos: UnifiedVideo[];
  sourceUsed: "piped" | "invidious";
};

function decodeXmlEntities(value: string): string {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'");
}

/**
 * Invidious playlist RSS entries (used when the JSON API's playlist scraper
 * is broken and returns an empty video list). RSS caps at ~15 newest items.
 */
function parsePlaylistRssVideos(xml: string): UnifiedVideo[] {
  const out: UnifiedVideo[] = [];
  const entries = xml.split("<entry>").slice(1);
  for (const entry of entries) {
    const videoId = entry.match(/<yt:videoId>([^<]+)<\/yt:videoId>/)?.[1];
    const rawTitle = entry.match(/<title>([^<]*)<\/title>/)?.[1];
    if (!videoId || !rawTitle) continue;
    const channelId = entry.match(/<yt:channelId>([^<]+)<\/yt:channelId>/)?.[1];
    const channelName = entry.match(/<name>([^<]*)<\/name>/)?.[1];
    const publishedIso = entry.match(/<published>([^<]+)<\/published>/)?.[1];
    const publishedMs = publishedIso ? Date.parse(publishedIso) : Number.NaN;
    const parsed = unifiedVideoSchema.safeParse({
      videoId,
      title: decodeXmlEntities(rawTitle),
      channelId,
      channelName: channelName ? decodeXmlEntities(channelName) : undefined,
      thumbnailUrl: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
      publishedAt: Number.isFinite(publishedMs)
        ? Math.floor(publishedMs / 1000)
        : undefined,
    });
    if (parsed.success) out.push(parsed.data);
  }
  return out;
}

function ytPlaylistIdFromUrl(url: unknown): string | null {
  if (typeof url !== "string") return null;
  const m = url.match(/[?&]list=([^&]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

function parseInvidiousPlaylistSummaries(
  payload: unknown,
): ChannelPlaylistSummary[] {
  if (!payload || typeof payload !== "object") return [];
  const arr = (payload as Record<string, unknown>).playlists;
  if (!Array.isArray(arr)) return [];
  const out: ChannelPlaylistSummary[] = [];
  for (const raw of arr) {
    if (!raw || typeof raw !== "object") continue;
    const p = raw as Record<string, unknown>;
    const playlistId = typeof p.playlistId === "string" ? p.playlistId : null;
    const title = typeof p.title === "string" ? p.title : null;
    if (!playlistId || !title) continue;
    out.push({
      playlistId,
      title,
      thumbnailUrl:
        typeof p.playlistThumbnail === "string" ? p.playlistThumbnail : null,
      videoCount: typeof p.videoCount === "number" ? p.videoCount : null,
    });
  }
  return out;
}

function parsePipedPlaylistSummaries(
  payload: unknown,
): ChannelPlaylistSummary[] {
  if (!payload || typeof payload !== "object") return [];
  const arr = (payload as Record<string, unknown>).content;
  if (!Array.isArray(arr)) return [];
  const out: ChannelPlaylistSummary[] = [];
  for (const raw of arr) {
    if (!raw || typeof raw !== "object") continue;
    const p = raw as Record<string, unknown>;
    const playlistId = ytPlaylistIdFromUrl(p.url);
    const title = typeof p.name === "string" ? p.name : null;
    if (!playlistId || !title) continue;
    out.push({
      playlistId,
      title,
      thumbnailUrl: typeof p.thumbnail === "string" ? p.thumbnail : null,
      videoCount: typeof p.videos === "number" ? p.videos : null,
    });
  }
  return out;
}

/** The channel's public YouTube playlists (first page — plenty for browsing). */
export async function fetchChannelPlaylists(
  input: { channelId: string },
  overrides?: ProxySourceOverrides,
): Promise<ChannelPlaylistsResult> {
  const { pipedBases, invidiousBases } = resolveProxyBaseCandidates(overrides);
  const errors: string[] = [];

  // Invidious has a dedicated endpoint — prefer it.
  for (const base of invidiousBases) {
    if (invidiousPortCollidesWithNextApp(base)) {
      errors.push("invidious:port collision with Next.js");
      continue;
    }
    try {
      acquireUpstreamSlot();
      const json = await fetchJson(
        new URL(
          `/api/v1/channels/${encodeURIComponent(input.channelId)}/playlists`,
          `${normalizeBaseUrl(base)}/`,
        ).toString(),
      );
      return {
        playlists: parseInvidiousPlaylistSummaries(json),
        sourceUsed: "invidious",
      };
    } catch (e) {
      recordUpstreamFailure(e, "invidious", errors, base);
    }
  }

  // Piped: channel payload → "playlists" tab → tabs endpoint.
  for (const base of pipedBases) {
    try {
      acquireUpstreamSlot();
      const channel = await fetchJson(
        new URL(
          `/channel/${encodeURIComponent(input.channelId)}`,
          `${normalizeBaseUrl(base)}/`,
        ).toString(),
      );
      const tabs = (channel as Record<string, unknown>).tabs;
      const tab = Array.isArray(tabs)
        ? tabs.find(
            (t) =>
              t &&
              typeof t === "object" &&
              typeof (t as Record<string, unknown>).name === "string" &&
              (t as Record<string, unknown>).name === "playlists",
          )
        : null;
      const data =
        tab && typeof (tab as Record<string, unknown>).data === "string"
          ? ((tab as Record<string, unknown>).data as string)
          : null;
      if (!data) return { playlists: [], sourceUsed: "piped" };
      acquireUpstreamSlot();
      const tabUrl = new URL("/channels/tabs", `${normalizeBaseUrl(base)}/`);
      tabUrl.searchParams.set("data", data);
      const json = await fetchJson(tabUrl.toString());
      return {
        playlists: parsePipedPlaylistSummaries(json),
        sourceUsed: "piped",
      };
    } catch (e) {
      recordUpstreamFailure(e, "piped", errors, base);
    }
  }

  throwIfUpstreamFailed(errors, "No upstream could list channel playlists.");
}

/** A public YouTube playlist's metadata + first page of videos. */
export async function fetchYtPlaylist(
  input: { playlistId: string },
  overrides?: ProxySourceOverrides,
): Promise<YtPlaylistResult> {
  const { pipedBases, invidiousBases } = resolveProxyBaseCandidates(overrides);
  const errors: string[] = [];
  // Invidious sometimes serves playlist metadata with a broken (empty) video
  // list — keep it as a last resort and let Piped try for the real items.
  let metadataOnly: YtPlaylistResult | null = null;

  for (const base of invidiousBases) {
    if (invidiousPortCollidesWithNextApp(base)) {
      errors.push("invidious:port collision with Next.js");
      continue;
    }
    try {
      acquireUpstreamSlot();
      const url = new URL(
        `/api/v1/playlists/${encodeURIComponent(input.playlistId)}`,
        `${normalizeBaseUrl(base)}/`,
      );
      url.searchParams.set("page", "1");
      const json = await fetchJson(url.toString());
      const p = json as Record<string, unknown>;
      const rawVideos = Array.isArray(p.videos) ? p.videos : [];
      const videos: UnifiedVideo[] = [];
      for (const raw of rawVideos) {
        // Invidious playlist entries are PlaylistVideo objects without a
        // `type` discriminator — tag them so the shared mapper accepts them.
        const item =
          raw && typeof raw === "object" && !("type" in raw)
            ? { ...(raw as Record<string, unknown>), type: "video" }
            : raw;
        const v = mapInvidiousItem(item, base);
        if (v) videos.push(v);
      }
      const result: YtPlaylistResult = {
        playlistId: input.playlistId,
        title: typeof p.title === "string" ? p.title : input.playlistId,
        channelId: typeof p.authorId === "string" ? p.authorId : null,
        channelName: typeof p.author === "string" ? p.author : null,
        videos,
        sourceUsed: "invidious",
      };
      if (videos.length > 0) return result;
      // Broken playlist scraper — the RSS feed uses a different code path
      // and usually still works (capped at ~15 newest items).
      try {
        acquireUpstreamSlot();
        const rss = await upstreamGetText(
          new URL(
            `/feed/playlist/${encodeURIComponent(input.playlistId)}`,
            `${normalizeBaseUrl(base)}/`,
          ).toString(),
          15_000,
        );
        if (rss.ok) {
          const rssVideos = parsePlaylistRssVideos(rss.text);
          if (rssVideos.length > 0) return { ...result, videos: rssVideos };
        }
      } catch {
        // fall through to the metadata-only result
      }
      metadataOnly = metadataOnly ?? result;
      errors.push("invidious:playlist returned no videos");
    } catch (e) {
      recordUpstreamFailure(e, "invidious", errors, base);
    }
  }

  for (const base of pipedBases) {
    try {
      acquireUpstreamSlot();
      const json = await fetchJson(
        new URL(
          `/playlists/${encodeURIComponent(input.playlistId)}`,
          `${normalizeBaseUrl(base)}/`,
        ).toString(),
      );
      const p = json as Record<string, unknown>;
      const videos: UnifiedVideo[] = [];
      for (const raw of pipedListItemsFromPayload(json)) {
        const v = mapPipedItem(raw, base);
        if (v) videos.push(v);
      }
      const uploaderUrl =
        typeof p.uploaderUrl === "string" ? p.uploaderUrl : "";
      const channelId = uploaderUrl.startsWith("/channel/")
        ? uploaderUrl.slice("/channel/".length)
        : null;
      return {
        playlistId: input.playlistId,
        title: typeof p.name === "string" ? p.name : input.playlistId,
        channelId,
        channelName: typeof p.uploader === "string" ? p.uploader : null,
        videos,
        sourceUsed: "piped",
      };
    } catch (e) {
      recordUpstreamFailure(e, "piped", errors, base);
    }
  }

  if (metadataOnly) return metadataOnly;
  throwIfUpstreamFailed(errors, "No upstream could load this playlist.");
}
