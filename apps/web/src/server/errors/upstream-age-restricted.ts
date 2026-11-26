export class UpstreamAgeRestrictedError extends Error {
  readonly name = "UpstreamAgeRestrictedError";

  constructor(
    message = "This video is age-restricted, and OwnTube watches without an account.",
    readonly videoId?: string,
  ) {
    super(message);
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
