export class RateLimitExceededError extends Error {
  readonly name = "RateLimitExceededError";

  constructor(message = "Upstream rate limit reached for this process") {
    super(message);
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
