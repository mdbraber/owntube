import {
  getAppOriginFromRequestHeaders,
  rewriteM3u8AllProxies,
} from "@/lib/invidious-proxy";
import { normalizeUpstreamBaseUrl } from "@/lib/upstream-base-url";

function invidiousUpstreamBase(): string {
  return normalizeUpstreamBaseUrl(process.env.INVIDIOUS_BASE_URL);
}

/** `/vi/{id}/maxres.jpg` often 404s when YouTube has no maxres; try smaller stills. */
const VI_THUMB_FALLBACKS = [
  "maxresdefault.jpg",
  "hqdefault.jpg",
  "mqdefault.jpg",
  "sddefault.jpg",
  "default.jpg",
] as const;

async function fetchInvidiousUpstream(
  inv: string,
  subpath: string,
  search: string,
  forwardHeaders: Record<string, string>,
): Promise<Response> {
  const base = `${inv}/`;
  const upstream = new URL(subpath + search, base);
  const r = await fetch(upstream, {
    headers: forwardHeaders,
    cache: "no-store",
  });
  if (r.ok || r.status !== 404) return r;

  const m = /^vi\/([^/]+)\/([^/]+\.(?:jpe?g|webp))$/i.exec(subpath);
  if (!m) return r;
  const videoId = m[1];
  const current = m[2].toLowerCase();
  for (const alt of VI_THUMB_FALLBACKS) {
    if (alt === current) continue;
    const u = new URL(`vi/${videoId}/${alt}`, base);
    u.search = new URL(subpath + search, base).search;
    const r2 = await fetch(u.toString(), {
      headers: forwardHeaders,
      cache: "no-store",
    });
    if (r2.ok) {
      await r.body?.cancel?.();
      return r2;
    }
    await r2.body?.cancel?.();
  }
  return r;
}

/**
 * Stream Invidious media (HLS, segments, poster) with the same origin as
 * OwnTube so the browser and hls.js are not blocked by CORS. Playlists
 * (m3u8) are text-rewritten so absolute segment URLs are also same-origin.
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ path?: string[] }> },
) {
  const inv = invidiousUpstreamBase();
  if (!inv) {
    return new Response("INVIDIOUS_BASE_URL is not configured", {
      status: 503,
    });
  }

  const { path: segs } = await context.params;
  const subpath = (segs ?? []).join("/");
  const search = new URL(request.url).search;

  const forwardHeaders: Record<string, string> = {
    "user-agent": "OwnTube/0.1",
  };
  const range = request.headers.get("range");
  if (range) forwardHeaders.range = range;
  const accept = request.headers.get("accept");
  if (accept) forwardHeaders.accept = accept;

  const r = await fetchInvidiousUpstream(inv, subpath, search, forwardHeaders);

  const appOrigin = getAppOriginFromRequestHeaders({
    get: (n) => request.headers.get(n),
  });
  const requestHost =
    request.headers.get("x-forwarded-host")?.split(",")[0]?.trim() ??
    request.headers.get("host") ??
    "";

  const ct = r.headers.get("content-type") ?? "";
  const isM3U8 =
    r.ok &&
    (ct.includes("mpegurl") ||
      ct.includes("m3u8") ||
      subpath.includes("manifest/hls") ||
      subpath.includes(".m3u8"));

  if (isM3U8) {
    const text = await r.text();
    const manifestUrl = new URL(subpath + search, `${inv}/`).toString();
    const out = rewriteM3u8AllProxies(
      text,
      appOrigin,
      requestHost,
      inv,
      manifestUrl,
    );
    return new Response(out, {
      status: r.status,
      headers: {
        "content-type": ct || "application/vnd.apple.mpegurl",
        "cache-control": "no-store",
      },
    });
  }

  if (!r.ok) {
    return new Response(r.body, {
      status: r.status,
      statusText: r.statusText,
    });
  }

  const acceptRanges = r.headers.get("accept-ranges");
  const contentRange = r.headers.get("content-range");
  const contentLength = r.headers.get("content-length");

  const out = new Response(r.body, {
    status: r.status,
    headers: {
      "content-type": ct,
      "cache-control": "public, max-age=60",
      ...(acceptRanges ? { "accept-ranges": acceptRanges } : {}),
      ...(contentRange ? { "content-range": contentRange } : {}),
      ...(contentLength ? { "content-length": contentLength } : {}),
    },
  });
  return out;
}
