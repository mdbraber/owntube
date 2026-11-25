import { mediaCorsPreflight, withMediaCors } from "@/lib/media-cors";
import {
  generateMasterPlaylist,
  generateMediaPlaylist,
  generateSubtitlePlaylist,
} from "@/server/services/hls/generate";
import {
  generateLiveMasterPlaylist,
  generateLiveMediaPlaylist,
} from "@/server/services/hls/live";

const M3U8_CONTENT_TYPE = "application/vnd.apple.mpegurl";
const VIDEO_ID_RE = /^[\w-]{6,20}$/;

/**
 * Serves a synthesized VOD HLS manifest (see `generate.ts`):
 *   /hls/<videoId>/master.m3u8       -> variants + audio group
 *   /hls/<videoId>/media.m3u8?itag=… -> one stream's byte-range fragments
 *   /hls/<videoId>/subtitles.m3u8?lang=… (or ?label=…) -> one caption track
 *   /hls/<videoId>/live.m3u8          -> a live broadcast (see hls/live.ts)
 *   /hls/<videoId>/live-media.m3u8?rep=… -> one representation of it
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
      const body = await generateMasterPlaylist(videoId);
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
    if (file === "live.m3u8") {
      const body = await generateLiveMasterPlaylist(videoId);
      if (!body)
        return new Response("live stream unavailable", { status: 502 });
      return new Response(body, {
        headers: {
          "content-type": M3U8_CONTENT_TYPE,
          "cache-control": "no-store",
        },
      });
    }
    if (file === "live-media.m3u8") {
      const rep = new URL(request.url).searchParams.get("rep");
      if (!rep || !/^\d{1,3}$/.test(rep)) {
        return new Response("missing or invalid rep", { status: 400 });
      }
      const body = await generateLiveMediaPlaylist(videoId, rep);
      if (!body)
        return new Response("live stream unavailable", { status: 502 });
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
