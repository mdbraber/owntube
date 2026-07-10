import {
  DASH_VIDEO_FAMILIES,
  type DashVideoFamily,
  generateMpd,
} from "@/server/services/dash/generate";

const MPD_CONTENT_TYPE = "application/dash+xml";
const VIDEO_ID_RE = /^[\w-]{6,20}$/;

/**
 * Serves a synthesized VOD DASH manifest (see `dash/generate.ts`):
 *   /dash/<videoId>/manifest.mpd?video=vp9|av01|avc
 * The video codec family is picked client-side via MSE `isTypeSupported`
 * probes; VP9/AV1 unlock the >1080p rungs the AVC-only HLS path cannot carry.
 * Representations resolve to the same-origin `/invidious/videoplayback` proxy.
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ parts?: string[] }> },
): Promise<Response> {
  const { parts } = await context.params;
  const [videoId, file] = parts ?? [];
  if (!videoId || !VIDEO_ID_RE.test(videoId) || file !== "manifest.mpd") {
    return new Response("not found", { status: 404 });
  }
  const raw = new URL(request.url).searchParams.get("video") ?? "avc";
  const family = DASH_VIDEO_FAMILIES.includes(raw as DashVideoFamily)
    ? (raw as DashVideoFamily)
    : "avc";

  try {
    const body = await generateMpd(videoId, family);
    return new Response(body, {
      headers: {
        "content-type": MPD_CONTENT_TYPE,
        "cache-control": "no-store",
      },
    });
  } catch (e) {
    return new Response(`dash generation failed: ${(e as Error).message}`, {
      status: 502,
    });
  }
}
