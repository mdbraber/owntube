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
 * your country"}`). Deliberately conservative: transient extractor or instance
 * failures must keep flowing into the generic unavailable path so its
 * instance-health hints stay reachable.
 *
 * Matching is substring-based, so entries must be specific enough not to fire
 * on an ordinary video. "members-only content" is safe here in a way a bare
 * "members only" would not be — that phrase is common in legitimate titles
 * (songs, tutorials) and matching it was exactly the mistake made by the feed
 * filter this replaced.
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
  // Paywalled by the channel or by YouTube. These are definitive per-video
  // refusals like the rest, but they used to miss every signature and fall
  // through to the generic "Invidious is unavailable — check instance health"
  // wall, which blames the instance for something no instance can fix.
  //
  // Invidious relays YouTube's own `playabilityStatus.reason` (or the
  // errorScreen subreason) verbatim, so these match YouTube's wording rather
  // than anything Invidious composes.
  "members-only content",
  "members only content",
  "available to this channel's members",
  "join this channel to get access",
  "requires payment to watch",
  "purchase this video",
  "rent or buy",
];

/** True when an upstream error message is a definitive YouTube refusal. */
export function isVideoUnavailableUpstreamMessage(message: string): boolean {
  const lower = message.toLowerCase();
  return VIDEO_UNAVAILABLE_SIGNATURES.some((sig) => lower.includes(sig));
}

/**
 * Shown instead of YouTube's bare "Please sign in" (playabilityStatus
 * LOGIN_REQUIRED without an age or bot reason). YouTube serves that wall for
 * some videos to every anonymous viewer and says nothing more, so neither we
 * nor another instance can tell why or do better.
 */
export const SIGN_IN_REQUIRED_REASON =
  "YouTube only plays this video for signed-in viewers, and it doesn't say why. OwnTube watches anonymously, so it can't play it — open it on YouTube instead.";

/**
 * True for YouTube's bare login wall as Invidious relays it
 * (`invidious:HTTP 500: {"error":"Please sign in"}`). Matches the whole
 * reason only: "Sign in to confirm you're not a bot" is an instance-level
 * block that must keep its instance-health hint, and the age gate ("Sign in
 * to confirm your age") is handled as age-restricted.
 */
export function isSignInRequiredUpstreamMessage(message: string): boolean {
  return /(?:^|:|"error":")\s*please sign in\.?\s*(?:"|$)/i.test(message);
}
