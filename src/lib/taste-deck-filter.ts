import type { UnifiedVideo } from "@/server/services/proxy.types";

const TITLE_STOP = new Set([
  "the",
  "and",
  "for",
  "you",
  "with",
  "from",
  "this",
  "that",
  "your",
  "are",
  "was",
  "has",
  "have",
  "not",
  "but",
  "all",
  "can",
  "our",
  "out",
  "its",
  "his",
  "her",
  "they",
  "will",
  "into",
  "than",
  "then",
  "about",
  "highlights",
  "official",
  "video",
  "channel",
  "episode",
  "full",
  "live",
  "game",
  "day",
  "week",
  "year",
]);

export type SessionDislike = { channelId?: string; title: string };

export function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Words from a title (length >= minLen), lowercased, de-duped per title. */
export function tokenizeTitle(title: string, minLen: number): string[] {
  const words = title
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .filter((w) => w.length >= minLen && !TITLE_STOP.has(w));
  return [...new Set(words)];
}

/**
 * Tokens that appear in at least `minDistinctTitles` different disliked titles
 * (same topic repeated, e.g. "football" across highlight channels).
 */
export function recurringTokensFromDislikedTitles(
  titles: readonly string[],
  minLen = 4,
  minDistinctTitles = 2,
): Set<string> {
  const tokenToIndices = new Map<string, Set<number>>();
  titles.forEach((title, ti) => {
    for (const w of tokenizeTitle(title, minLen)) {
      let set = tokenToIndices.get(w);
      if (!set) {
        set = new Set();
        tokenToIndices.set(w, set);
      }
      set.add(ti);
    }
  });
  const out = new Set<string>();
  for (const [tok, set] of tokenToIndices) {
    if (set.size >= minDistinctTitles) out.add(tok);
  }
  return out;
}

export function sessionDislikeBlocks(dislikes: readonly SessionDislike[]): {
  blockedChannels: Set<string>;
  blockedTokens: Set<string>;
} {
  const blockedChannels = new Set<string>();
  for (const d of dislikes) {
    if (d.channelId && d.channelId.length > 0) {
      blockedChannels.add(d.channelId);
    }
  }
  const blockedTokens = recurringTokensFromDislikedTitles(
    dislikes.map((d) => d.title),
    4,
    2,
  );
  return { blockedChannels, blockedTokens };
}

export function videoPassesTasteSession(
  video: Pick<UnifiedVideo, "title" | "channelId">,
  blockedChannels: ReadonlySet<string>,
  blockedTokens: ReadonlySet<string>,
): boolean {
  if (video.channelId && blockedChannels.has(video.channelId)) {
    return false;
  }
  const t = video.title;
  for (const tok of blockedTokens) {
    if (new RegExp(`\\b${escapeRegExp(tok)}\\b`, "i").test(t)) {
      return false;
    }
  }
  return true;
}

export function filterVideosBySessionDislikes(
  videos: readonly UnifiedVideo[],
  dislikes: readonly SessionDislike[],
): UnifiedVideo[] {
  const { blockedChannels, blockedTokens } = sessionDislikeBlocks(dislikes);
  return videos.filter((v) =>
    videoPassesTasteSession(v, blockedChannels, blockedTokens),
  );
}
