import { Agent } from "undici";

/**
 * Abort window for proxied media segment/manifest fetches. Covers time to
 * response *headers* only — the timer is cleared the moment `fetch` resolves,
 * so it never cuts off a streaming body. Headers normally arrive in well
 * under a second; the failure this bounds is a request written into a dead
 * kept-alive upstream socket (googlevideo silently drops idle and seek-
 * aborted connections), which hangs until this timer fires and the caller's
 * retry succeeds instantly on a fresh connection. At the previous 15s, every
 * such hit after a large seek was a 15-second playback stall.
 */
export const MEDIA_FETCH_TIMEOUT_MS = 3_000;

/**
 * Media upstreams kill idle connections far sooner than their keep-alive
 * hints claim; undici honors those hints for up to 10 minutes and then
 * reuses the corpse, which is where the dead-socket hangs above come from.
 * Cap pooled-socket reuse at a few seconds so a connection is never older
 * than the upstream's real patience.
 */
const mediaUpstreamAgent = new Agent({
  keepAliveTimeout: 4_000,
  keepAliveMaxTimeout: 4_000,
});

/**
 * `fetch` with an `AbortController` timeout so a hung upstream segment/manifest
 * cannot stall playback indefinitely. Throws `AbortError` on timeout — callers
 * should translate that into a 504 so hls.js can trigger its own recovery.
 *
 * An `init.signal` (e.g. the incoming request's) is combined with the timeout:
 * when the browser aborts a segment fetch (seek, quality switch), the upstream
 * fetch is cancelled too instead of streaming the abandoned bytes to nobody.
 */
export async function fetchWithTimeout(
  input: string | URL,
  init: RequestInit = {},
  timeoutMs: number = MEDIA_FETCH_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const signal = init.signal
    ? AbortSignal.any([init.signal, controller.signal])
    : controller.signal;
  try {
    // `dispatcher` is undici-specific and absent from the DOM RequestInit
    // type; Node's fetch honors it.
    return await fetch(input, {
      ...init,
      signal,
      dispatcher: mediaUpstreamAgent,
    } as RequestInit);
  } finally {
    clearTimeout(timer);
  }
}
