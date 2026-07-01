import {
  isUpstreamDisabled,
  normalizeUpstreamBaseUrl,
} from "@/lib/upstream-base-url";

export const MAX_UPSTREAM_INSTANCES_PER_SOURCE = 8;

export function normalizeUpstreamInstanceList(
  input: string[] | undefined,
): string[] {
  if (!input) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of input) {
    const normalized = normalizeUpstreamBaseUrl(raw);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
    if (out.length >= MAX_UPSTREAM_INSTANCES_PER_SOURCE) break;
  }
  return out;
}

export function normalizePreferredUpstreamInstance(
  input: string | undefined,
  instances: string[],
): string | undefined {
  const normalized = normalizeUpstreamBaseUrl(input);
  if (!normalized) return undefined;
  return instances.includes(normalized) ? normalized : undefined;
}

export function upstreamValueIsDisabled(
  value: string | undefined | null,
): boolean {
  return isUpstreamDisabled(value);
}
