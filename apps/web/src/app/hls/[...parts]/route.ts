import {
  generateAudioPlaylist,
  generateMasterPlaylist,
  generateMediaPlaylist,
} from "@/server/services/hls/generate";

const M3U8_CONTENT_TYPE = "application/vnd.apple.mpegurl";
const VIDEO_ID_RE = /^[\w-]{6,20}$/;

/**
 * Serves a synthesized VOD HLS manifest (see `generate.ts`):
 *   /hls/<videoId>/master.m3u8       -> variants + audio group
 *   /hls/<videoId>/media.m3u8?itag=… -> one stream's byte-range fragments
 *   /hls/<videoId>/audio.m3u8        -> audio-only (iOS background playback)
 * Segments resolve to the same-origin `/invidious/videoplayback` proxy.
 */
export async function GET(
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
    if (file === "audio.m3u8") {
      const body = await generateAudioPlaylist(videoId);
      return new Response(body, {
        headers: {
          "content-type": M3U8_CONTENT_TYPE,
          "cache-control": "no-store",
        },
      });
    }
    if (file === "media.m3u8") {
      const itag = new URL(request.url).searchParams.get("itag");
      if (!itag || !/^\d+$/.test(itag)) {
        return new Response("missing or invalid itag", { status: 400 });
      }
      const body = await generateMediaPlaylist(videoId, itag);
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
