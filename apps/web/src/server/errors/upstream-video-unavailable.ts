/**
 * YouTube refused the video outright (region block, private, removed,
 * terminated account). Both backends relay YouTube's own reason as an error
 * string; it's a definitive per-video answer — no other instance in the same
 * country will do better — so it deserves a clean typed error the watch page
 * can show verbatim instead of the generic "sources unavailable" wall.
 */
export class UpstreamVideoUnavailableError extends Error {
  readonly name = "UpstreamVideoUnavailableError";

  constructor(
    readonly reason: string,
    readonly videoId?: string,
  ) {
    super(reason);
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Signatures YouTube uses for definitive per-video refusals, as relayed by
 * Invidious (`{"error":"The uploader has not made this video available in
 * your country"}`) and Piped. Deliberately conservative: transient extractor
 * or instance failures must keep flowing into the generic unavailable path
 * so its instance-health hints stay reachable.
 */
const VIDEO_UNAVAILABLE_SIGNATURES = [
  "not made this video available in your country",
  "not available in your country",
  "video unavailable",
  "this video is private",
  "private video",
  "video has been removed",
  "no longer available",
  "account associated with this video has been terminated",
];

/** True when an upstream error message is a definitive YouTube refusal. */
export function isVideoUnavailableUpstreamMessage(message: string): boolean {
  const lower = message.toLowerCase();
  return VIDEO_UNAVAILABLE_SIGNATURES.some((sig) => lower.includes(sig));
}
