import { RateLimitExceededError } from "@/server/errors/rate-limit-exceeded";
import {
  isAgeRestrictedUpstreamMessage,
  UpstreamAgeRestrictedError,
} from "@/server/errors/upstream-age-restricted";
import { parseInvidiousUpcomingFromFetchMessage } from "@/server/errors/upstream-live-upcoming";
import { UpstreamUnavailableError } from "@/server/errors/upstream-unavailable";
import { recordUpstreamFailure as recordInstanceFailure } from "@/server/services/upstream-health";

const UPSTREAM_RATE_LIMIT_NOTE = "rate limit";

/** Record a primary/fallback failure; never abort before the sibling upstream is tried. */
export function recordUpstreamFailure(
  e: unknown,
  label: "piped" | "invidious",
  errors: string[],
  baseUrl?: string,
  latencyMs?: number,
): void {
  if (baseUrl) recordInstanceFailure(label, baseUrl, e, latencyMs);
  if (e instanceof RateLimitExceededError) {
    errors.push(`${label}:${UPSTREAM_RATE_LIMIT_NOTE}`);
    return;
  }
  const msg = e instanceof Error ? e.message : String(e);
  errors.push(`${label}:${msg}`);
}

function cleanUpstreamErrorDetail(message: string): string {
  return message
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180);
}

export function upstreamFailureMessage(
  errors: string[],
  fallbackMessage: string,
): string {
  if (errors.length === 0) return fallbackMessage;
  const sources = [...new Set(errors.map((entry) => entry.split(":")[0]))]
    .filter(Boolean)
    .map((source) => (source === "piped" ? "Piped" : "Invidious"));
  const lastDetail = cleanUpstreamErrorDetail(
    errors[errors.length - 1]?.replace(/^[^:]+:/, "") ?? "",
  );
  const sourceText = sources.length > 0 ? ` (${sources.join(" and ")})` : "";
  const detailText = lastDetail ? ` Last error: ${lastDetail}` : "";
  return `Video source instances are unavailable${sourceText}. Check instance health in Settings or try again later.${detailText}`;
}

export function rethrowIfInvidiousUpcoming(
  error: unknown,
  videoId: string,
): void {
  if (!(error instanceof Error)) return;
  const upcoming = parseInvidiousUpcomingFromFetchMessage(
    error.message,
    videoId,
  );
  if (upcoming) throw upcoming;
}

export function throwIfUpstreamFailed(
  errors: string[],
  fallbackMessage: string,
): never {
  if (
    errors.length > 0 &&
    errors.every((entry) => entry.endsWith(`:${UPSTREAM_RATE_LIMIT_NOTE}`))
  ) {
    throw new RateLimitExceededError();
  }
  // When either backend explicitly refuses an age-restricted video, surface a
  // clean typed error instead of the raw NewPipe/Invidious stack trace.
  if (errors.some(isAgeRestrictedUpstreamMessage)) {
    throw new UpstreamAgeRestrictedError();
  }
  throw new UpstreamUnavailableError(
    upstreamFailureMessage(errors, fallbackMessage),
  );
}
