/**
 * YouTube refused the video outright (region block, private, removed,
 * terminated account, members-only, paid). YouTube's own reason, a definitive
 * per-video answer the watch page shows verbatim.
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
 * Shown instead of YouTube's bare "Please sign in" (playabilityStatus
 * LOGIN_REQUIRED without an age or bot reason). YouTube serves that wall for
 * some videos to every anonymous viewer and says nothing more.
 */
export const SIGN_IN_REQUIRED_REASON =
  "YouTube only plays this video for signed-in viewers, and it doesn't say why. OwnTube watches anonymously, so it can't play it — open it on YouTube instead.";
