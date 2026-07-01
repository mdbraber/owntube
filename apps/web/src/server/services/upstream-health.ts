export type UpstreamSourceKind = "piped" | "invidious";

export type UpstreamHealthStatus =
  | "healthy"
  | "degraded"
  | "down"
  | "cooldown"
  | "unknown"
  | "disabled";

export type UpstreamHealthSnapshot = {
  source: UpstreamSourceKind;
  url: string | null;
  status: UpstreamHealthStatus;
  latencyMs: number | null;
  lastCheckedAt: number | null;
  lastError: string | null;
  consecutiveFailures: number;
  cooldownUntil: number | null;
};

type MutableUpstreamHealth = {
  source: UpstreamSourceKind;
  url: string;
  latencyMs: number | null;
  lastCheckedAt: number | null;
  lastError: string | null;
  consecutiveFailures: number;
  cooldownUntil: number | null;
};

const COOLDOWN_BASE_MS = 30_000;
const COOLDOWN_MAX_MS = 5 * 60_000;

const healthByKey = new Map<string, MutableUpstreamHealth>();

function healthKey(source: UpstreamSourceKind, url: string): string {
  return `${source}:${url}`;
}

function nowMs(): number {
  return Date.now();
}

function mutableHealth(
  source: UpstreamSourceKind,
  url: string,
): MutableUpstreamHealth {
  const key = healthKey(source, url);
  const existing = healthByKey.get(key);
  if (existing) return existing;
  const created: MutableUpstreamHealth = {
    source,
    url,
    latencyMs: null,
    lastCheckedAt: null,
    lastError: null,
    consecutiveFailures: 0,
    cooldownUntil: null,
  };
  healthByKey.set(key, created);
  return created;
}

function statusFor(
  entry: MutableUpstreamHealth,
  atMs = nowMs(),
): UpstreamHealthStatus {
  if (entry.cooldownUntil && entry.cooldownUntil > atMs) return "cooldown";
  if (entry.consecutiveFailures >= 3) return "down";
  if (entry.consecutiveFailures > 0) return "degraded";
  if (entry.lastCheckedAt) return "healthy";
  return "unknown";
}

export function upstreamHealthSnapshot(
  source: UpstreamSourceKind,
  url: string | null,
): UpstreamHealthSnapshot {
  if (!url) {
    return {
      source,
      url,
      status: "disabled",
      latencyMs: null,
      lastCheckedAt: null,
      lastError: null,
      consecutiveFailures: 0,
      cooldownUntil: null,
    };
  }
  const entry = mutableHealth(source, url);
  return {
    source,
    url,
    status: statusFor(entry),
    latencyMs: entry.latencyMs,
    lastCheckedAt: entry.lastCheckedAt,
    lastError: entry.lastError,
    consecutiveFailures: entry.consecutiveFailures,
    cooldownUntil: entry.cooldownUntil,
  };
}

export function recordUpstreamSuccess(
  source: UpstreamSourceKind,
  url: string,
  latencyMs: number,
): void {
  const entry = mutableHealth(source, url);
  entry.latencyMs = Math.max(0, Math.round(latencyMs));
  entry.lastCheckedAt = nowMs();
  entry.lastError = null;
  entry.consecutiveFailures = 0;
  entry.cooldownUntil = null;
}

export function recordUpstreamFailure(
  source: UpstreamSourceKind,
  url: string,
  error: unknown,
  latencyMs?: number,
): void {
  const entry = mutableHealth(source, url);
  entry.latencyMs =
    typeof latencyMs === "number"
      ? Math.max(0, Math.round(latencyMs))
      : entry.latencyMs;
  entry.lastCheckedAt = nowMs();
  entry.lastError = error instanceof Error ? error.message : String(error);
  entry.consecutiveFailures += 1;
  const cooldownMs = Math.min(
    COOLDOWN_MAX_MS,
    COOLDOWN_BASE_MS * 2 ** Math.max(0, entry.consecutiveFailures - 1),
  );
  entry.cooldownUntil = entry.lastCheckedAt + cooldownMs;
}

function candidateRank(
  source: UpstreamSourceKind,
  url: string,
  preferredUrl: string | undefined,
  atMs: number,
): number {
  const entry = mutableHealth(source, url);
  const status = statusFor(entry, atMs);
  const preferredBoost = preferredUrl === url ? -10_000 : 0;
  if (status === "healthy") return preferredBoost;
  if (status === "unknown") return preferredBoost + 100;
  if (status === "degraded")
    return preferredBoost + 250 + entry.consecutiveFailures;
  if (status === "down")
    return preferredBoost + 500 + entry.consecutiveFailures;
  return preferredBoost + 1_000 + entry.consecutiveFailures;
}

export function orderUpstreamCandidates(
  source: UpstreamSourceKind,
  urls: string[],
  preferredUrl?: string,
): string[] {
  const atMs = nowMs();
  const live = urls.filter((url) => {
    const entry = mutableHealth(source, url);
    return !entry.cooldownUntil || entry.cooldownUntil <= atMs;
  });
  const pool = live.length > 0 ? live : urls;
  return [...pool].sort((a, b) => {
    const byRank =
      candidateRank(source, a, preferredUrl, atMs) -
      candidateRank(source, b, preferredUrl, atMs);
    if (byRank !== 0) return byRank;
    const aLatency =
      mutableHealth(source, a).latencyMs ?? Number.MAX_SAFE_INTEGER;
    const bLatency =
      mutableHealth(source, b).latencyMs ?? Number.MAX_SAFE_INTEGER;
    return aLatency - bLatency;
  });
}

export function resetUpstreamHealthForTests(): void {
  healthByKey.clear();
}
