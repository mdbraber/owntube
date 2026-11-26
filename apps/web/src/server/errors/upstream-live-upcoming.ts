export class UpstreamLiveUpcomingError extends Error {
  readonly name = "UpstreamLiveUpcomingError";

  constructor(
    message: string,
    readonly videoId: string,
    readonly premiereTimestamp?: number,
  ) {
    super(message);
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
