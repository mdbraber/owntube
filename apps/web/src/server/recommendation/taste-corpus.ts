import { inArray } from "drizzle-orm";
import type { AppDb } from "@/server/db/client";
import { interactions, watchHistory, watchQueue } from "@/server/db/schema";

/**
 * Titles of these videos as the app stored them (likes, saves, queue and
 * history keep the title they were added with), for interaction-based taste.
 * No network: videos without a stored title are skipped.
 */
export function readStoredTitlesForVideos(
  db: AppDb,
  videoIds: readonly string[],
  maxTitles: number,
): string[] {
  const byId = storedTitles(db, videoIds);
  const titles: string[] = [];
  const seenLower = new Set<string>();
  for (const videoId of videoIds) {
    if (titles.length >= maxTitles) break;
    const t = byId.get(videoId);
    if (!t) continue;
    const low = t.toLowerCase();
    if (seenLower.has(low)) continue;
    seenLower.add(low);
    titles.push(t);
  }
  return titles;
}

function storedTitles(
  db: AppDb,
  videoIds: readonly string[],
): Map<string, string> {
  const ids = [...new Set(videoIds)];
  const byId = new Map<string, string>();
  const remember = (rows: { videoId: string; title: string | null }[]) => {
    for (const r of rows) {
      const t = r.title?.trim();
      if (t && !byId.has(r.videoId)) byId.set(r.videoId, t);
    }
  };
  for (let i = 0; i < ids.length; i += 500) {
    const chunk = ids.slice(i, i + 500);
    remember(
      db
        .select({ videoId: interactions.videoId, title: interactions.title })
        .from(interactions)
        .where(inArray(interactions.videoId, chunk))
        .all(),
    );
    remember(
      db
        .select({
          videoId: watchHistory.videoId,
          title: watchHistory.videoTitle,
        })
        .from(watchHistory)
        .where(inArray(watchHistory.videoId, chunk))
        .all(),
    );
    remember(
      db
        .select({ videoId: watchQueue.videoId, title: watchQueue.title })
        .from(watchQueue)
        .where(inArray(watchQueue.videoId, chunk))
        .all(),
    );
  }
  return byId;
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
export function readStoredDislikeTitlesOrdered(
  db: AppDb,
  videoIds: readonly string[],
  max: number,
): string[] {
  const byId = storedTitles(db, videoIds);
  const out: string[] = [];
  for (const videoId of videoIds) {
    if (out.length >= max) break;
    const t = byId.get(videoId);
    if (t) out.push(t);
  }
  return out;
}
