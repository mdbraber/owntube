import { RateLimitExceededError } from "@/server/errors/rate-limit-exceeded";

const DEFAULT_WINDOW_MS = 60_000;
const DEFAULT_MAX_REQUESTS = 60;

function envPositiveInt(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

function limits(): { windowMs: number; maxRequests: number } {
  return {
    windowMs: envPositiveInt(
      "UPSTREAM_RATE_LIMIT_WINDOW_MS",
      DEFAULT_WINDOW_MS,
    ),
    maxRequests: envPositiveInt(
      "UPSTREAM_RATE_LIMIT_MAX_REQUESTS",
      DEFAULT_MAX_REQUESTS,
    ),
  };
}

let windowStartMs = Date.now();
let countInWindow = 0;

export function acquireUpstreamSlot(): void {
  const { windowMs, maxRequests } = limits();
  const now = Date.now();
  if (now - windowStartMs >= windowMs) {
    windowStartMs = now;
    countInWindow = 0;
  }
  if (countInWindow >= maxRequests) {
    throw new RateLimitExceededError();
  }
  countInWindow += 1;
}

export function resetRateLimiterForTests(): void {
  windowStartMs = Date.now();
  countInWindow = 0;
}
