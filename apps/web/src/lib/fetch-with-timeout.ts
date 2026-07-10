/** Default abort window for proxied media segment/manifest fetches. */
export const MEDIA_FETCH_TIMEOUT_MS = 15_000;

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
    return await fetch(input, { ...init, signal });
  } finally {
    clearTimeout(timer);
  }
}
