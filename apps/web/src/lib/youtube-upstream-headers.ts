/**
 * YouTube / googlevideo often reject minimal bot User-Agents (403 / empty).
 * Match a normal browser enough for segment and manifest fetches from our
 * server-side proxy.
 */
export function headersForYoutubeUpstream(opts: {
  range?: string | null;
  accept?: string | null;
  targetHostname?: string | null;
  relaxed?: boolean;
}): Record<string, string> {
  const host = (opts.targetHostname ?? "").toLowerCase();
  const isGoogleVideo =
    host === "googlevideo.com" ||
    host.endsWith(".googlevideo.com") ||
    host.endsWith(".c.youtube.com");
  const h: Record<string, string> = {
    "user-agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    "accept-language": "en-US,en;q=0.9",
    accept: opts.accept ?? "*/*",
    "accept-encoding": "identity",
  };
  // Some googlevideo signed segment URLs reject explicit Origin/Referer headers.
  if (!isGoogleVideo && !opts.relaxed) {
    h.referer = "https://www.youtube.com/";
    h.origin = "https://www.youtube.com";
  }
  if (opts.range) h.range = opts.range;
  return h;
}
