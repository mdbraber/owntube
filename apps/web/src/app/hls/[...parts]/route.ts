import { mediaCorsPreflight, withMediaCors } from "@/lib/media-cors";
import { sabrVodMode } from "@/server/services/dash/sabr-vod";
import {
  fetchVideoCaptions,
  generateMasterPlaylist,
  generateMediaPlaylist,
  generateSubtitlePlaylist,
} from "@/server/services/hls/generate";
import {
  generateSabrMasterPlaylist,
  generateSabrMediaPlaylist,
  SABR_TRACK_RE,
} from "@/server/services/hls/sabr";

const M3U8_CONTENT_TYPE = "application/vnd.apple.mpegurl";
const VIDEO_ID_RE = /^[\w-]{6,20}$/;

/**
 * Serves a synthesized VOD HLS manifest (see `generate.ts`):
 *   /hls/<videoId>/master.m3u8       -> variants + audio group
 *   /hls/<videoId>/master.m3u8?for=cast -> the same, SABR first (see castMasterPlaylist)
 *   /hls/<videoId>/media.m3u8?itag=… -> one stream's byte-range fragments
 *   /hls/<videoId>/sabr.m3u8?track=… -> one SABR connector track (see sabr.ts)
 *   /hls/<videoId>/subtitles.m3u8?lang=… (or ?label=…) -> one caption track
 * Segments resolve to the `/invidious/videoplayback` proxy, same-origin with
 * this route's media origin (see media-origin.ts).
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ parts?: string[] }> },
): Promise<Response> {
  return withMediaCors(await handleGET(request, context));
}

export function OPTIONS(): Response {
  return mediaCorsPreflight();
}

async function handleGET(
  request: Request,
  context: { params: Promise<{ parts?: string[] }> },
): Promise<Response> {
  const { parts } = await context.params;
  const [videoId, file] = parts ?? [];
  if (!videoId || !VIDEO_ID_RE.test(videoId) || !file) {
    return new Response("not found", { status: 404 });
  }

  try {
    if (file === "master.m3u8") {
      const forCast = new URL(request.url).searchParams.get("for") === "cast";
      const body = forCast
        ? await castMasterPlaylist(videoId)
        : await masterPlaylist(videoId);
      return new Response(body, {
        headers: {
          "content-type": M3U8_CONTENT_TYPE,
          "cache-control": "no-store",
        },
      });
    }
    if (file === "sabr.m3u8") {
      const track = new URL(request.url).searchParams.get("track");
      if (!track || !SABR_TRACK_RE.test(track)) {
        return new Response("missing or invalid track", { status: 400 });
      }
      const body = await generateSabrMediaPlaylist(videoId, track);
      if (!body) return new Response("sabr track not found", { status: 404 });
      return new Response(body, {
        headers: {
          "content-type": M3U8_CONTENT_TYPE,
          "cache-control": "no-store",
        },
      });
    }
    if (file === "media.m3u8") {
      const params = new URL(request.url).searchParams;
      const itag = params.get("itag");
      if (!itag || !/^\d+$/.test(itag)) {
        return new Response("missing or invalid itag", { status: 400 });
      }
      // Multi-language audio: same itag per language, told apart by xtags
      // (colon-separated key=value pairs mirrored from the stream URL).
      const xtags = params.get("xtags");
      if (xtags && !/^[\w.:=-]{1,200}$/.test(xtags)) {
        return new Response("invalid xtags", { status: 400 });
      }
      const body = await generateMediaPlaylist(videoId, itag, xtags);
      return new Response(body, {
        headers: {
          "content-type": M3U8_CONTENT_TYPE,
          "cache-control": "no-store",
        },
      });
    }
    if (file === "subtitles.m3u8") {
      const params = new URL(request.url).searchParams;
      const lang = params.get("lang") ?? undefined;
      const label = params.get("label") ?? undefined;
      if (lang && !/^[\w-]{1,35}$/.test(lang)) {
        return new Response("invalid lang", { status: 400 });
      }
      if (label && label.length > 200) {
        return new Response("invalid label", { status: 400 });
      }
      if (!lang && !label) {
        return new Response("missing lang or label", { status: 400 });
      }
      const body = await generateSubtitlePlaylist(videoId, { lang, label });
      return new Response(body, {
        headers: {
          "content-type": M3U8_CONTENT_TYPE,
          "cache-control": "no-store",
        },
      });
    }
    return new Response("not found", { status: 404 });
  } catch (e) {
    return new Response(`hls generation failed: ${(e as Error).message}`, {
      status: 502,
    });
  }
}

/**
 * The master playlist, from the companion's SABR connector or from YouTube's
 * byte-range formats, in the order `INVIDIOUS_COMPANION_SABR_VOD` asks for
 * (see `sabr.ts` for why SABR: byte-range stream URLs get revoked about a
 * minute into playback). Either source falls back to the other.
 */
async function masterPlaylist(videoId: string): Promise<string> {
  const mode = sabrVodMode();
  const sabr = () =>
    generateSabrMasterPlaylist(videoId, () => fetchVideoCaptions(videoId));
  if (mode === "always") {
    const body = await sabr();
    if (body) return body;
    return generateMasterPlaylist(videoId);
  }
  if (mode === "fallback") {
    try {
      return await generateMasterPlaylist(videoId);
    } catch (e) {
      const body = await sabr();
      if (body) return body;
      throw e;
    }
  }
  return generateMasterPlaylist(videoId);
}

/**
 * The master playlist a TV plays when the viewer casts (AirPlay, Cast). The
 * receiver fetches it itself, outside the browser, so it must be one a native
 * HLS player takes and keeps playing: the SABR connector's numbered fMP4
 * segments, whatever `INVIDIOUS_COMPANION_SABR_VOD` says for local playback.
 * The byte-range manifest is the fallback only — the macOS media stack
 * rejects it, and its signed URLs are revoked about a minute in.
 */
async function castMasterPlaylist(videoId: string): Promise<string> {
  const body = await generateSabrMasterPlaylist(videoId, () =>
    fetchVideoCaptions(videoId),
  ).catch(() => null);
  return body ?? generateMasterPlaylist(videoId);
}
