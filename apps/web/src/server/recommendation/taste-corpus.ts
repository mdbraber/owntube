import { createHash } from "node:crypto";
import { desc, eq } from "drizzle-orm";
import type { AppDb } from "@/server/db/client";
import { videoCache } from "@/server/db/schema";
import { videoDetailSchema } from "@/server/services/proxy.types";

/** Must match `detailCacheKey` in `proxy.ts` (streams detail payload). */
function streamsDetailCacheKey(videoId: string): string {
  const h = createHash("sha256")
    .update(JSON.stringify({ v: 4, kind: "streams", videoId }))
    .digest("hex");
  return `streams:v4:${h}`;
}

function readOneCachedTitle(db: AppDb, videoId: string): string | undefined {
  if (!videoId || videoId.length < 5) return undefined;
  const key = streamsDetailCacheKey(videoId);
  const row = db
    .select({ payloadJson: videoCache.payloadJson })
    .from(videoCache)
    .where(eq(videoCache.cacheKey, key))
    .orderBy(desc(videoCache.fetchedAt))
    .limit(1)
    .all()[0];
  if (!row) return undefined;
  try {
    const parsed = videoDetailSchema.safeParse(JSON.parse(row.payloadJson));
    if (!parsed.success) return undefined;
    const t = parsed.data.title.trim();
    return t || undefined;
  } catch {
    return undefined;
  }
}

/**
 * Reads cached video detail titles for interaction-based taste (likes/saves).
 * Best-effort: skips missing/stale cache without network calls.
 */
export function readCachedDetailTitlesForVideos(
  db: AppDb,
  videoIds: readonly string[],
  maxTitles: number,
): string[] {
  const titles: string[] = [];
  const seenLower = new Set<string>();
  let n = 0;
  for (const videoId of videoIds) {
    if (n >= maxTitles) break;
    const t = readOneCachedTitle(db, videoId);
    if (!t) continue;
    const low = t.toLowerCase();
    if (seenLower.has(low)) continue;
    seenLower.add(low);
    titles.push(t);
    n += 1;
  }
  return titles;
}

/** "Refine recommendations" keywords repeated 3× so they outweigh single titles in the TF-IDF corpus. */
export function buildKeywordCorpus(tasteKeywords: readonly string[]): string[] {
  const corpus: string[] = [];
  for (const kw of tasteKeywords) {
    const k = kw.trim();
    if (!k) continue;
    corpus.push(k, k, k);
  }
  return corpus;
}

/**
 * Assembles the taste-model corpus from ordered title sources (keywords first,
 * then liked/saved titles, then pool titles), case-insensitively de-duplicated
 * and capped. Shared by the home/shorts/deck pools and the explain script.
 */
export function buildTasteCorpusTitles(
  parts: readonly (readonly string[])[],
  max = 240,
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of parts) {
    for (const t of part) {
      const trimmed = t.trim();
      const low = trimmed.toLowerCase();
      if (!low || seen.has(low)) continue;
      seen.add(low);
      out.push(trimmed);
      if (out.length >= max) return out;
    }
  }
  return out;
}

/** One title per dislike row (allows duplicates) for token mining. */
export function readCachedDislikeTitlesOrdered(
  db: AppDb,
  videoIds: readonly string[],
  max: number,
): string[] {
  const out: string[] = [];
  for (const videoId of videoIds) {
    if (out.length >= max) break;
    const t = readOneCachedTitle(db, videoId);
    if (t) out.push(t);
  }
  return out;
}
