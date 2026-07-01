import type { UnifiedVideo } from "@/server/services/proxy.types";

/**
 * YouTube / Invidious list items often copy the accessibility line into the title
 * when the API does not set `premium` / `paid` / members flags.
 */
export function titleSuggestsMembersOnlyOrSubscriberOnly(
  title: string,
): boolean {
  const t = title.normalize("NFKC").toLowerCase();
  if (/\bmembers?\s+only\b/.test(t)) return true;
  if (/\bmember[-\s]?only\b/.test(t)) return true;
  if (/\bsubscribers?\s+only\b/.test(t)) return true;
  if (/\bsubs?\s+only\b/.test(t)) return true;
  if (/members?\s*exclusive\b/.test(t)) return true;
  if (/membres?\s+uniquement\b/.test(t)) return true;
  if (/réservé[e]?\s+aux\s+membres\b/.test(t)) return true;
  if (/\bfor\s+members\s+of\b/.test(t)) return true;
  if (/\bjoin\b.*\bto\s+watch\b/.test(t)) return true;
  return false;
}

export function stripRestrictedListVideos<T extends UnifiedVideo>(
  videos: readonly T[],
): T[] {
  return videos.filter(
    (v) => !titleSuggestsMembersOnlyOrSubscriberOnly(v.title),
  );
}
