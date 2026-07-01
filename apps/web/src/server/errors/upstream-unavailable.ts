export class UpstreamUnavailableError extends Error {
  readonly name = "UpstreamUnavailableError";

  constructor(message = "Video instances are unavailable") {
    super(message);
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
