/** Regionalized Piped/Invidious search queries for Shorts discovery (ISO 3166-1 alpha-2). */

const DEFAULT_SHORTS_QUERIES = ["#shorts", "shorts", "youtube shorts"] as const;

/** Last-resort queries when regional discovery returns nothing. */
export const SHORTS_DISCOVERY_FALLBACK_QUERIES = ["#shorts", "shorts"] as const;

const REGION_SHORTS_QUERIES: Record<string, readonly string[]> = {
  FR: ["shorts français", "shorts france", "shorts"],
  US: ["shorts usa", "viral shorts", "shorts"],
  GB: ["shorts uk", "shorts british", "shorts"],
  DE: ["shorts deutsch", "shorts germany", "shorts"],
  ES: ["shorts español", "shorts españa", "shorts"],
  IT: ["shorts italiano", "shorts italia", "shorts"],
  CA: ["shorts canada", "shorts", "youtube shorts"],
  AU: ["shorts australia", "shorts", "youtube shorts"],
  BR: ["shorts brasil", "shorts português", "shorts"],
  MX: ["shorts méxico", "shorts español", "shorts"],
  JP: ["shorts 日本", "shorts japan", "shorts"],
  KR: ["shorts korea", "shorts 한국", "shorts"],
  IN: ["shorts india", "shorts hindi", "shorts"],
  NL: ["shorts nederland", "shorts", "youtube shorts"],
  PL: ["shorts polska", "shorts", "youtube shorts"],
  PT: ["shorts portugal", "shorts", "youtube shorts"],
  RU: ["shorts russia", "shorts", "youtube shorts"],
  SE: ["shorts sweden", "shorts", "youtube shorts"],
  TR: ["shorts türkiye", "shorts", "youtube shorts"],
  AR: ["shorts argentina", "shorts español", "shorts"],
  BE: ["shorts belgique", "shorts", "youtube shorts"],
  CH: ["shorts suisse", "shorts", "youtube shorts"],
  AT: ["shorts österreich", "shorts deutsch", "shorts"],
};

export function shortsSearchQueriesForRegion(region: string): string[] {
  const code = region.trim().toUpperCase();
  const regional = REGION_SHORTS_QUERIES[code];
  if (regional) return [...regional];
  return [...DEFAULT_SHORTS_QUERIES];
}

const MAX_TASTE_QUERY_TERMS = 6;

/**
 * Discovery searches aligned with the user's taste corpus (not regional "viral shorts").
 */
export function shortsSearchQueriesForTaste(
  corpusTitles: readonly string[],
  region: string,
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const add = (q: string) => {
    const t = q.trim();
    if (t.length < 2) return;
    const key = t.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(t);
  };

  for (const title of corpusTitles.slice(0, 12)) {
    const words = title
      .replace(/#[^\s#]+/gi, "")
      .split(/\s+/)
      .filter((w) => w.length >= 4)
      .slice(0, 3);
    if (words.length === 0) continue;
    add(`${words.slice(0, 2).join(" ")} shorts`);
    if (out.length >= MAX_TASTE_QUERY_TERMS) break;
  }

  for (const q of shortsSearchQueriesForRegion(region)) {
    if (q.toLowerCase().includes("viral")) continue;
    add(q);
    if (out.length >= MAX_TASTE_QUERY_TERMS) break;
  }

  if (out.length === 0) {
    return ["#shorts", "shorts"];
  }
  return out.slice(0, MAX_TASTE_QUERY_TERMS);
}
