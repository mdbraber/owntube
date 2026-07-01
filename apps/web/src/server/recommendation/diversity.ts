import { cosineSparse } from "@/server/recommendation/similarity";
import { termFrequencyVector } from "@/server/recommendation/tfidf";
import type { ScoredVideo } from "@/server/recommendation/types";

const LAMBDA = 0.7;

function channelOverlap(a: ScoredVideo, b: ScoredVideo): number {
  if (!a.channelId || !b.channelId) return 0;
  return a.channelId === b.channelId ? 1 : 0;
}

function titleVectorOf(v: ScoredVideo): Map<string, number> {
  return v.titleVector ?? termFrequencyVector(v.title);
}

/**
 * Redundancy between two candidates: same channel OR near-duplicate topic.
 * The content term matters because the pool is already de-duplicated to a few
 * videos per channel before MMR, so channel overlap alone barely fires.
 */
function redundancy(a: ScoredVideo, b: ScoredVideo): number {
  const channel = channelOverlap(a, b);
  if (channel >= 1) return 1;
  const content = cosineSparse(titleVectorOf(a), titleVectorOf(b));
  return Math.max(channel, content);
}

/** MMR diversification (λ=0.7); relevance term uses normalized `rawScore`. */
export function maximalMarginalRelevance(
  ranked: ScoredVideo[],
  take: number,
): ScoredVideo[] {
  const maxS = Math.max(1e-9, ...ranked.map((r) => r.rawScore));
  const norm = ranked.map((r) => ({
    ...r,
    preMmrRawScore: r.rawScore,
    rawScore: r.rawScore / maxS,
  }));
  const pool = [...norm].sort((a, b) => b.rawScore - a.rawScore);
  const selected: ScoredVideo[] = [];
  while (selected.length < take && pool.length > 0) {
    let bestI = 0;
    let best = -Infinity;
    for (let i = 0; i < pool.length; i++) {
      const cand = pool[i];
      if (!cand) continue;
      const rel = cand.rawScore;
      const div =
        selected.length === 0
          ? 0
          : Math.max(...selected.map((s) => redundancy(s, cand)));
      const mmr = LAMBDA * rel - (1 - LAMBDA) * div;
      if (mmr > best) {
        best = mmr;
        bestI = i;
      }
    }
    const [next] = pool.splice(bestI, 1);
    if (next) selected.push(next);
  }
  return selected;
}
