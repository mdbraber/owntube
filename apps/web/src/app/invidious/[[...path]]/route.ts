import { fetchWithTimeout } from "@/lib/fetch-with-timeout";
import {
  getAppOriginFromRequestHeaders,
  rewriteM3u8AllProxies,
} from "@/lib/invidious-proxy";
import { normalizeUpstreamBaseUrl } from "@/lib/upstream-base-url";

function invidiousUpstreamBase(): string {
  return normalizeUpstreamBaseUrl(process.env.INVIDIOUS_BASE_URL);
}

/**
 * Range/segment fetches through the Invidious→googlevideo proxy occasionally
 * fail to connect or time out (upstream drops). Retry a couple of times with a
 * short backoff so a transient hiccup during a seek doesn't stall playback.
 * GETs (with or without a Range) are idempotent, so this is safe.
 */
async function fetchUpstreamWithRetry(
  url: string | URL,
  init: RequestInit,
  attempts = 3,
): Promise<Response> {
  let lastError: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fetchWithTimeout(url, init);
    } catch (e) {
      lastError = e;
      if (i < attempts - 1) {
        await new Promise((r) => setTimeout(r, 150 * (i + 1)));
      }
    }
  }
  throw lastError;
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
  const r = await fetchUpstreamWithRetry(upstream, {
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
    const r2 = await fetchWithTimeout(u.toString(), {
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

const INVIDIOUS_PROXY_PREFIX = "/invidious/";

/** Next.js `[[...path]]` splits on commas; live HLS URLs embed raw `,` in signed paths. */
export function subpathFromInvidiousProxyRequest(
  requestUrl: string,
): string | null {
  let pathname: string;
  try {
    pathname = new URL(requestUrl).pathname;
  } catch {
    return null;
  }
  if (!pathname.startsWith(INVIDIOUS_PROXY_PREFIX)) return null;
  const subpath = pathname.slice(INVIDIOUS_PROXY_PREFIX.length);
  return subpath.length > 0 ? subpath : null;
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
  const subpathFromPath =
    (segs ?? []).length > 0 ? (segs ?? []).join("/") : null;
  const subpath =
    subpathFromInvidiousProxyRequest(request.url) ?? subpathFromPath ?? "";
  const upstreamSearch = new URL(request.url).searchParams;
  // `local=true` makes Invidious emit broken `:port` URLs and 403 videoplayback hops.
  if (subpath.includes("manifest/hls") || subpath.includes(".m3u8")) {
    upstreamSearch.delete("local");
  }
  const search = upstreamSearch.toString()
    ? `?${upstreamSearch.toString()}`
    : "";

  const forwardHeaders: Record<string, string> = {
    "user-agent": "OwnTube/0.1",
  };
  const range = request.headers.get("range");
  if (range) forwardHeaders.range = range;
  const accept = request.headers.get("accept");
  if (accept) forwardHeaders.accept = accept;

  let r: Response;
  try {
    r = await fetchInvidiousUpstream(inv, subpath, search, forwardHeaders);
  } catch {
    // Timeout or network failure: surface a gateway error so hls.js retries.
    return new Response("upstream fetch failed", { status: 504 });
  }

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
