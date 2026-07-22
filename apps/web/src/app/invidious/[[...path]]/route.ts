import { fetchWithTimeout } from "@/lib/fetch-with-timeout";
import {
  getAppOriginFromRequestHeaders,
  rewriteM3u8AllProxies,
} from "@/lib/invidious-proxy";
import { mediaCorsPreflight, withMediaCors } from "@/lib/media-cors";
import { normalizeUpstreamBaseUrl } from "@/lib/upstream-base-url";
import { type AssetKind, getCachedAsset } from "@/server/assets/cache";

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
      // The browser gave up on this fetch (seek away, page left) — nobody is
      // waiting for a retry.
      if (init.signal?.aborted) break;
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
  clientSignal?: AbortSignal,
): Promise<Response> {
  const base = `${inv}/`;
  const upstream = new URL(subpath + search, base);
  const r = await fetchUpstreamWithRetry(upstream, {
    headers: forwardHeaders,
    cache: "no-store",
    signal: clientSignal,
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
      signal: clientSignal,
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

/**
 * Kind for disk-cacheable image assets by proxied subpath; null = not an
 * asset (media, manifests, API JSON) — those keep their existing paths.
 */
export function assetKindForSubpath(subpath: string): AssetKind | null {
  if (subpath.startsWith("vi/")) {
    return subpath.includes("storyboard") ? "storyboard" : "thumbnail";
  }
  if (subpath.startsWith("ggpht/") || subpath.startsWith("ytc/")) {
    return "avatar";
  }
  if (/\.(jpe?g|png|webp|gif)$/i.test(subpath.split("?")[0] ?? "")) {
    return "image";
  }
  return null;
}

/**
 * Upper bound on a single upstream media fetch. History: this chunking was
 * built against an h2 head-of-line theory ("Safari drains a response the
 * client already aborted") that the 2026-07 stall hunt later disproved — the
 * real culprit was Safari's h2 connection pool wedging, and the server no
 * longer speaks h2 at all. The chunking stays for the reasons that were true
 * all along: a client abort cancels at most ~two in-flight chunks of
 * companion→googlevideo bandwidth instead of the rest of a multi-MB
 * transfer, and the one-chunk-ahead prefetch pipelines throughput without
 * unbounded buffering.
 */
export const MEDIA_CHUNK_BYTES = 2 * 1024 * 1024;

/** Parse a simple single-span `bytes=start-end?` Range header. */
export function parseByteRange(
  range: string | null,
): { start: number; end: number | null } | null {
  if (!range) return null;
  const m = /^bytes=(\d+)-(\d*)$/.exec(range.trim());
  if (!m?.[1]) return null;
  const start = Number(m[1]);
  const end = m[2] ? Number(m[2]) : null;
  if (!Number.isSafeInteger(start)) return null;
  if (end !== null && (!Number.isSafeInteger(end) || end < start)) return null;
  return { start, end };
}

function totalFromContentRange(contentRange: string | null): number | null {
  const m = /^bytes\s+\d+-\d+\/(\d+|\*)$/.exec(contentRange?.trim() ?? "");
  if (!m?.[1] || m[1] === "*") return null;
  const total = Number(m[1]);
  return Number.isSafeInteger(total) && total > 0 ? total : null;
}

type PendingChunk = {
  promise: Promise<Response>;
  start: number;
  end: number;
  abort: AbortController;
};

/**
 * Stream `[start, endTarget]` of an upstream media URL as one client response
 * fed by sequential ≤MEDIA_CHUNK_BYTES upstream range fetches, prefetching one
 * chunk ahead so per-request latency doesn't gate throughput. `first` is the
 * already-received response for `[start, firstEnd]`. A client abort cancels
 * the in-flight and prefetched upstream chunks immediately (stream `cancel()`
 * + signal listener), so at most ~two chunks of already-queued bytes ever
 * drain to nobody.
 */
function chunkedMediaBody(
  upstreamUrl: URL,
  headers: Record<string, string>,
  first: Response,
  start: number,
  firstEnd: number,
  endTarget: number,
  clientSignal: AbortSignal,
): ReadableStream<Uint8Array> {
  const fetchChunk = (s: number, e: number): PendingChunk => {
    const abort = new AbortController();
    const promise = fetchUpstreamWithRetry(upstreamUrl, {
      headers: { ...headers, range: `bytes=${s}-${e}` },
      cache: "no-store",
      signal: AbortSignal.any([clientSignal, abort.signal]),
    });
    // Chunk fetches race client aborts by design; surface errors at await time.
    promise.catch(() => {});
    return { promise, start: s, end: e, abort };
  };
  const prefetchAfter = (chunkEnd: number): PendingChunk | null => {
    if (chunkEnd >= endTarget) return null;
    return fetchChunk(
      chunkEnd + 1,
      Math.min(chunkEnd + MEDIA_CHUNK_BYTES, endTarget),
    );
  };

  let pos = start;
  let currentEnd = firstEnd;
  let reader: ReadableStreamDefaultReader<Uint8Array> | null =
    first.body?.getReader() ?? null;
  let pending: PendingChunk | null = prefetchAfter(firstEnd);
  const cancelUpstream = () => {
    pending?.abort.abort();
    pending = null;
    const r = reader;
    reader = null;
    void r?.cancel().catch(() => {});
  };
  clientSignal.addEventListener("abort", cancelUpstream, { once: true });

  // Consecutive failures with no forward progress. A flaky-but-advancing
  // upstream can resume any number of times (this resets on each delivered
  // byte); only a genuinely dead range (e.g. an expired signed URL) exhausts it
  // and surfaces the error — at which point hls.js refetches the whole segment.
  const MAX_RESUME = 4;
  let resumeAttempts = 0;
  const backoff = () =>
    new Promise<void>((r) => setTimeout(r, 150 * resumeAttempts));

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      for (;;) {
        if (clientSignal.aborted) {
          controller.close();
          return;
        }
        if (!reader) {
          if (pos > endTarget) {
            controller.close();
            return;
          }
          let next = pending;
          pending = null;
          if (next && next.start !== pos) {
            // Previous chunk under-delivered; the speculative prefetch would
            // leave a gap. Refetch from the actual position.
            next.abort.abort();
            next = null;
          }
          if (!next) {
            next = fetchChunk(
              pos,
              Math.min(pos + MEDIA_CHUNK_BYTES - 1, endTarget),
            );
          }
          try {
            const r = await next.promise;
            if (!(r.status === 206 || r.status === 200) || !r.body) {
              await r.body?.cancel().catch(() => {});
              throw new Error(`upstream media chunk returned ${r.status}`);
            }
            currentEnd = next.end;
            reader = r.body.getReader();
            pending = prefetchAfter(next.end);
          } catch (e) {
            // Upstream dropped/failed while (re)starting this chunk. Resume from
            // the current byte position with a fresh range fetch so the client
            // stream never breaks (which Safari would otherwise escalate to a
            // whole-connection loss, killing unrelated API requests too).
            if (clientSignal.aborted) {
              controller.close();
              return;
            }
            if (++resumeAttempts > MAX_RESUME) throw e;
            await backoff();
            continue; // reader stays null → refetch from pos
          }
        }
        let result: ReadableStreamReadResult<Uint8Array>;
        try {
          result = await reader.read();
        } catch (e) {
          // Body dropped mid-chunk: discard the reader + misaligned prefetch and
          // resume from the delivered position.
          reader = null;
          pending?.abort.abort();
          pending = null;
          if (clientSignal.aborted) {
            controller.close();
            return;
          }
          if (++resumeAttempts > MAX_RESUME) throw e;
          await backoff();
          continue;
        }
        const { done, value } = result;
        if (done) {
          reader = null;
          if (pos !== currentEnd + 1) {
            // Short delivery: drop the (now misaligned) prefetch.
            pending?.abort.abort();
            pending = null;
          }
          continue;
        }
        pos += value.byteLength;
        resumeAttempts = 0; // forward progress
        controller.enqueue(value);
        return;
      }
    },
    cancel: cancelUpstream,
  });
}

/**
 * Chunked-range handling for `videoplayback` media. Returns a Response when
 * the request was served chunked, or null to fall through to the plain
 * single-fetch proxy path (non-media, small ranges, upstreams that ignore
 * Range). See MEDIA_CHUNK_BYTES for why this exists.
 */
async function maybeChunkedMediaResponse(
  inv: string,
  subpath: string,
  search: string,
  forwardHeaders: Record<string, string>,
  request: Request,
): Promise<Response | null> {
  if (!/(^|\/)videoplayback$/.test(subpath)) return null;
  const clientRange = parseByteRange(request.headers.get("range"));
  if (request.headers.get("range") && !clientRange) return null; // unparseable: pass through
  const start = clientRange?.start ?? 0;
  const clientEnd = clientRange?.end ?? null;
  // Bounded small range: the plain path already handles it in one fetch.
  if (clientEnd !== null && clientEnd - start + 1 <= MEDIA_CHUNK_BYTES) {
    return null;
  }

  const upstreamUrl = new URL(subpath + search, `${inv}/`);
  const firstEnd =
    clientEnd !== null
      ? Math.min(start + MEDIA_CHUNK_BYTES - 1, clientEnd)
      : start + MEDIA_CHUNK_BYTES - 1;
  let first: Response;
  try {
    first = await fetchUpstreamWithRetry(upstreamUrl, {
      headers: { ...forwardHeaders, range: `bytes=${start}-${firstEnd}` },
      cache: "no-store",
      signal: request.signal,
    });
  } catch {
    if (request.signal.aborted) return new Response(null, { status: 499 });
    return new Response("upstream fetch failed", { status: 504 });
  }
  if (first.status !== 206) {
    // Upstream ignored the Range (200: full body already on the wire and we
    // requested ≤ one chunk extra — passing it through matches the plain path)
    // or errored; either way chunking doesn't apply.
    if (first.status === 200 && clientRange) {
      // Client asked for a range but upstream can't serve one mid-file: only
      // correct for start=0, otherwise surface the mismatch.
      if (start !== 0) {
        await first.body?.cancel().catch(() => {});
        return new Response("upstream does not support ranges", {
          status: 502,
        });
      }
    }
    return passthroughMediaResponse(first);
  }

  const total = totalFromContentRange(first.headers.get("content-range"));
  if (total === null && clientEnd === null) {
    // Unknown length and open-ended request: cannot chunk safely. Hand the
    // first-chunk response back as a plain (bounded) 206; the client will
    // range for the rest.
    return passthroughMediaResponse(first);
  }
  const endTarget =
    clientEnd !== null
      ? total !== null
        ? Math.min(clientEnd, total - 1)
        : clientEnd
      : (total as number) - 1;

  // The upstream may clamp the first chunk (file shorter than requested):
  // trust its content-range end so the next chunk starts where this one stops.
  const firstRangeEnd = /^bytes\s+\d+-(\d+)\//.exec(
    first.headers.get("content-range")?.trim() ?? "",
  )?.[1];
  const actualFirstEnd = firstRangeEnd
    ? Number(firstRangeEnd)
    : Math.min(firstEnd, endTarget);
  const body = chunkedMediaBody(
    upstreamUrl,
    forwardHeaders,
    first,
    start,
    Math.min(actualFirstEnd, endTarget),
    endTarget,
    request.signal,
  );
  const contentLength = endTarget - start + 1;
  const headers: Record<string, string> = {
    "content-type": first.headers.get("content-type") ?? "video/mp4",
    "cache-control": "public, max-age=60",
    "accept-ranges": "bytes",
    "content-length": String(contentLength),
  };
  if (clientRange) {
    headers["content-range"] = `bytes ${start}-${endTarget}/${total ?? "*"}`;
    return new Response(body, { status: 206, headers });
  }
  return new Response(body, { status: 200, headers });
}

/** Forward an upstream media response mostly as-is (plain-path semantics). */
function passthroughMediaResponse(r: Response): Response {
  if (!r.ok) {
    return new Response(r.body, { status: r.status, statusText: r.statusText });
  }
  const headers: Record<string, string> = {
    "content-type": r.headers.get("content-type") ?? "video/mp4",
    "cache-control": "public, max-age=60",
  };
  for (const h of ["accept-ranges", "content-range"] as const) {
    const v = r.headers.get(h);
    if (v) headers[h] = v;
  }
  const contentLength = r.headers.get("content-encoding")
    ? null
    : r.headers.get("content-length");
  if (contentLength) headers["content-length"] = contentLength;
  return new Response(r.body, { status: r.status, headers });
}

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
 * Stream Invidious media (HLS, segments, poster) same-origin with the media
 * origin (see media-origin.ts) so the browser and hls.js are not blocked by
 * CORS. Playlists (m3u8) are text-rewritten so absolute segment URLs are also
 * on that origin.
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ path?: string[] }> },
) {
  return withMediaCors(await handleGET(request, context));
}

export function OPTIONS(): Response {
  return mediaCorsPreflight();
}

async function handleGET(
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

  // Images are served from the disk asset cache (serve-stale-and-revalidate);
  // the fetcher below keeps the thumbnail 404-fallback chain. Null (non-image,
  // oversized, upstream error) falls through to plain pass-through proxying.
  const assetKind = assetKindForSubpath(subpath);
  if (assetKind && !range) {
    const asset = await getCachedAsset(
      `invidious:${subpath}${search}`,
      assetKind,
      () => fetchInvidiousUpstream(inv, subpath, search, forwardHeaders),
    );
    if (asset) {
      return new Response(new Uint8Array(asset.body), {
        status: 200,
        headers: {
          "content-type": asset.contentType,
          "cache-control":
            "public, max-age=86400, stale-while-revalidate=604800",
          "content-length": String(asset.body.byteLength),
        },
      });
    }
  }

  const chunked = await maybeChunkedMediaResponse(
    inv,
    subpath,
    search,
    forwardHeaders,
    request,
  );
  if (chunked) return chunked;

  let r: Response;
  try {
    r = await fetchInvidiousUpstream(
      inv,
      subpath,
      search,
      forwardHeaders,
      request.signal,
    );
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
  // fetch() transparently decompresses gzip'd upstream bodies; forwarding the
  // upstream content-length (the *compressed* size) makes clients truncate the
  // decompressed stream. Media segments are never compressed, so length (and
  // ranges) stay correct for them.
  const contentLength = r.headers.get("content-encoding")
    ? null
    : r.headers.get("content-length");

  // Images (thumbnails, avatars) are effectively content-addressed by video/
  // channel id, so they can be cached hard; media segments must stay short.
  const isImage = ct.startsWith("image/");
  const cacheControl = isImage
    ? "public, max-age=86400, stale-while-revalidate=604800"
    : "public, max-age=60";

  const out = new Response(r.body, {
    status: r.status,
    headers: {
      "content-type": ct,
      "cache-control": cacheControl,
      ...(acceptRanges ? { "accept-ranges": acceptRanges } : {}),
      ...(contentRange ? { "content-range": contentRange } : {}),
      ...(contentLength ? { "content-length": contentLength } : {}),
    },
  });
  return out;
}
