import { fetchWithTimeout } from "@/lib/fetch-with-timeout";
import {
  getAppOriginFromRequestHeaders,
  isYoutubeFamilyHostname,
  rewriteM3u8AllProxies,
} from "@/lib/invidious-proxy";
import { mediaCorsPreflight, withMediaCors } from "@/lib/media-cors";
import { headersForYoutubeUpstream } from "@/lib/youtube-upstream-headers";

/** Signed YouTube URLs can be very long; keep a sane upper bound. */
const MAX_TARGET_URL_LEN = 200_000;

/**
 * Hop for YouTube / googlevideo HLS manifests and media segments, same-origin
 * with the media origin (see media-origin.ts) this route is served under.
 * Invidious playlists often embed absolute youtube.com URLs; browsers block
 * those (no CORS). Server-side fetch + optional m3u8 rewrite fixes playback.
 */
export async function GET(request: Request): Promise<Response> {
  return withMediaCors(await handleGET(request));
}

export function OPTIONS(): Response {
  return mediaCorsPreflight();
}

async function handleGET(request: Request) {
  const raw = new URL(request.url).searchParams.get("url");
  if (!raw) {
    return new Response("missing url", { status: 400 });
  }
  if (raw.length > MAX_TARGET_URL_LEN) {
    return new Response("url too long", { status: 400 });
  }

  let target: URL;
  try {
    target = new URL(raw);
  } catch {
    return new Response("invalid url", { status: 400 });
  }

  if (target.protocol !== "https:" && target.protocol !== "http:") {
    return new Response("unsupported scheme", { status: 400 });
  }
  if (!isYoutubeFamilyHostname(target.hostname)) {
    return new Response("host not allowed", { status: 403 });
  }

  const forwardHeaders = headersForYoutubeUpstream({
    range: request.headers.get("range"),
    accept: request.headers.get("accept"),
    targetHostname: target.hostname,
  });

  let r: Response;
  try {
    r = await fetchWithTimeout(target.toString(), {
      headers: forwardHeaders,
      cache: "no-store",
      signal: request.signal,
    });

    // Some googlevideo segment URLs return 403 when Origin/Referer are
    // forwarded. Retry once with relaxed headers before giving up.
    if (!r.ok && r.status === 403 && !request.signal.aborted) {
      const relaxedHeaders = headersForYoutubeUpstream({
        range: request.headers.get("range"),
        accept: request.headers.get("accept"),
        targetHostname: target.hostname,
        relaxed: true,
      });
      r = await fetchWithTimeout(target.toString(), {
        headers: relaxedHeaders,
        cache: "no-store",
        signal: request.signal,
      });
    }
  } catch {
    // Client abort (seek away): nothing to answer. 499 mirrors nginx's code.
    if (request.signal.aborted) {
      return new Response(null, { status: 499 });
    }
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
  const pathLower = target.pathname.toLowerCase();
  const isM3U8 =
    r.ok &&
    (ct.includes("mpegurl") ||
      ct.includes("m3u8") ||
      pathLower.includes("manifest/hls") ||
      pathLower.endsWith(".m3u8"));

  if (isM3U8) {
    const text = await r.text();
    const out = rewriteM3u8AllProxies(
      text,
      appOrigin,
      requestHost,
      undefined,
      target.toString(),
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
  // Compressed upstream bodies are decompressed by fetch(); forwarding the
  // compressed content-length would truncate them client-side.
  const contentLength = r.headers.get("content-encoding")
    ? null
    : r.headers.get("content-length");

  return new Response(r.body, {
    status: r.status,
    headers: {
      "content-type": ct,
      "cache-control": "public, max-age=60",
      ...(acceptRanges ? { "accept-ranges": acceptRanges } : {}),
      ...(contentRange ? { "content-range": contentRange } : {}),
      ...(contentLength ? { "content-length": contentLength } : {}),
    },
  });
}
