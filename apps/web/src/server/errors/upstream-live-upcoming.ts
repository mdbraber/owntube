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

/** Parse Invidious HTTP error bodies: `{"error":"This live event will begin…"}`. */
export function parseInvidiousUpcomingFromFetchMessage(
  message: string,
  videoId: string,
): UpstreamLiveUpcomingError | null {
  const lower = message.toLowerCase();
  if (
    !lower.includes("live event") &&
    !lower.includes("will begin") &&
    !lower.includes("premiere")
  ) {
    return null;
  }
  let premiereTimestamp: number | undefined;
  const jsonStart = message.indexOf("{");
  if (jsonStart >= 0) {
    try {
      const body = JSON.parse(message.slice(jsonStart)) as {
        error?: string;
        premiereTimestamp?: number;
      };
      if (typeof body.premiereTimestamp === "number") {
        premiereTimestamp = body.premiereTimestamp;
      }
      const errText = body.error ?? message;
      return new UpstreamLiveUpcomingError(errText, videoId, premiereTimestamp);
    } catch {
      // fall through
    }
  }
  return new UpstreamLiveUpcomingError(message, videoId, premiereTimestamp);
}
