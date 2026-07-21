import { mediaCorsPreflight, withMediaCors } from "@/lib/media-cors";
import { getDb } from "@/server/db/client";
import {
  DASH_VIDEO_FAMILIES,
  type DashVideoFamily,
  generateMpd,
} from "@/server/services/dash/generate";
import { fetchVideoDetail } from "@/server/services/proxy";
import { getUserProxyOverrides } from "@/server/settings/profile";
import { createCaller } from "@/server/trpc/caller";

/**
 * Requesting a manifest is a play, so the server records it rather than
 * trusting a client to report one. Clients that authenticate (the TV sends a
 * device-token Bearer header) get the watch written here; the position they
 * later reach still has to come from the player, since nothing about a manifest
 * fetch reveals a playhead.
 *
 * Best-effort throughout: a failure here must never stop the manifest.
 */
async function recordPlay(request: Request, videoId: string): Promise<void> {
  try {
    const caller = await createCaller(request);
    const db = getDb();
    // channelId is required by the history event; the detail is already cached
    // from the same upstream fetch the manifest used.
    const detail = await fetchVideoDetail(
      db,
      { videoId },
      getUserProxyOverrides(db, null),
    );
    if (!detail.channelId) return;
    await caller.history.upsertEvent({
      videoId,
      channelId: detail.channelId,
      videoTitle: detail.title,
      videoDurationSeconds: detail.durationSeconds,
    });
  } catch {
    // Unauthenticated callers and upstream hiccups both land here.
  }
}

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
  if (!videoId || !VIDEO_ID_RE.test(videoId) || file !== "manifest.mpd") {
    return new Response("not found", { status: 404 });
  }
  const raw = new URL(request.url).searchParams.get("video") ?? "avc";
  const family = DASH_VIDEO_FAMILIES.includes(raw as DashVideoFamily)
    ? (raw as DashVideoFamily)
    : "avc";

  // Fire and forget: the manifest response shouldn't wait on history.
  void recordPlay(request, videoId);

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
