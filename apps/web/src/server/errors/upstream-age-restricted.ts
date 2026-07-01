export class UpstreamAgeRestrictedError extends Error {
  readonly name = "UpstreamAgeRestrictedError";

  constructor(
    message = "This video is age-restricted and can't be played through Piped or Invidious anonymously.",
    readonly videoId?: string,
  ) {
    super(message);
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Signatures both backends emit when refusing an age-restricted video:
 * Piped (NewPipe) `AgeRestrictedContentException: …cannot be watched anonymously`,
 * Invidious `{"error":"This video may be inappropriate for some users."}`.
 */
const AGE_RESTRICTION_SIGNATURES = [
  "age-restricted",
  "agerestrictedcontentexception",
  "cannot be watched anonymously",
  "inappropriate for some users",
  "sign in to confirm your age",
];

/** True when an upstream error message indicates YouTube age-gating. */
export function isAgeRestrictedUpstreamMessage(message: string): boolean {
  const lower = message.toLowerCase();
  return AGE_RESTRICTION_SIGNATURES.some((sig) => lower.includes(sig));
}
