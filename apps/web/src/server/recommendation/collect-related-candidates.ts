import type { AppDb } from "@/server/db/client";
import type { TaggedVideoCandidate } from "@/server/recommendation/collect-tagged-candidates";
import { deriveRecommendationReason } from "@/server/recommendation/reason";
import {
  type RecommendationScoreContext,
  scoreCandidateDetail,
} from "@/server/recommendation/scoring";
import type { UserSignals } from "@/server/recommendation/signals";
import {
  type TfidfModel,
  termFrequencyVector,
} from "@/server/recommendation/tfidf";
import type { ScoredVideo } from "@/server/recommendation/types";
import {
  fetchRelatedVideos,
  type ProxySourceOverrides,
} from "@/server/services/proxy";
import type { UnifiedVideo } from "@/server/services/proxy.types";

export type RelatedSeed = { videoId: string; rawScore: number };

export type RelatedCollectionLimits = {
  maxSeeds: number;
  limitPerSeed: number;
  maxRelatedTotal: number;
};

export const HOME_RELATED_LIMITS: RelatedCollectionLimits = {
  maxSeeds: 6,
  limitPerSeed: 10,
  maxRelatedTotal: 48,
};

export const SHORTS_RELATED_LIMITS: RelatedCollectionLimits = {
  maxSeeds: 4,
  limitPerSeed: 8,
  maxRelatedTotal: 32,
};

const DEFAULT_CONCURRENCY = 4;
const RELATED_SEED_SCORE_BOOST = 0.06;

export type CollectRelatedVideoCandidatesOpts = RelatedCollectionLimits & {
  overrides?: ProxySourceOverrides;
  excludeVideoIds?: ReadonlySet<string>;
  /** Video ids already in the scored pool — skip duplicates. */
  excludeFromPool?: ReadonlySet<string>;
  concurrency?: number;
  filterVideo?: (video: UnifiedVideo) => boolean;
};

/**
 * Fetches upstream related videos for high-scoring seeds (Piped/Invidious via proxy cache).
 */
export async function collectRelatedVideoCandidates(
  db: AppDb,
  seeds: RelatedSeed[],
  opts: CollectRelatedVideoCandidatesOpts,
): Promise<TaggedVideoCandidate[]> {
  const {
    maxSeeds,
    limitPerSeed,
    maxRelatedTotal,
    overrides,
    excludeVideoIds = new Set<string>(),
    excludeFromPool = new Set<string>(),
    concurrency = DEFAULT_CONCURRENCY,
    filterVideo,
  } = opts;

  const pickedSeeds = seeds
    .filter((s) => s.videoId.length > 0 && !excludeVideoIds.has(s.videoId))
    .slice(0, maxSeeds);

  const seen = new Set<string>(excludeFromPool);
  const out: TaggedVideoCandidate[] = [];

  for (let i = 0; i < pickedSeeds.length; i += concurrency) {
    const batch = pickedSeeds.slice(i, i + concurrency);
    const settled = await Promise.allSettled(
      batch.map(async (seed) => {
        const result = await fetchRelatedVideos(
          db,
          { videoId: seed.videoId },
          limitPerSeed,
          overrides,
        );
        return { seed, videos: result.videos };
      }),
    );

    for (const item of settled) {
      if (item.status !== "fulfilled") continue;
      const { seed, videos } = item.value;
      for (const video of videos) {
        if (!video.videoId || video.videoId === seed.videoId) continue;
        if (seen.has(video.videoId) || excludeVideoIds.has(video.videoId)) {
          continue;
        }
        if (filterVideo && !filterVideo(video)) continue;
        seen.add(video.videoId);
        out.push({ video, source: `related:${seed.videoId}` });
        if (out.length >= maxRelatedTotal) return out;
      }
    }
  }

  return out;
}

export type RelatedExpansionStats = {
  seedCount: number;
  fetched: number;
  added: number;
};

export type ExpandScoredPoolWithRelatedOpts = {
  db: AppDb;
  scored: ScoredVideo[];
  coldStart: boolean;
  limits: RelatedCollectionLimits;
  overrides?: ProxySourceOverrides;
  excludeVideoIds: ReadonlySet<string>;
  signals: UserSignals;
  tasteModel: TfidfModel;
  dislikeModel?: TfidfModel;
  maxCh: number;
  scoreContext: RecommendationScoreContext;
  minScoredForExpansion?: number;
  filterVideo?: (video: UnifiedVideo) => boolean;
};

/**
 * Second pass: expand the scored pool with related videos from top seeds, re-score newcomers,
 * and apply a small boost tied to the parent seed score.
 */
export async function expandScoredPoolWithRelatedCandidates(
  opts: ExpandScoredPoolWithRelatedOpts,
): Promise<{ scored: ScoredVideo[]; stats: RelatedExpansionStats | null }> {
  const {
    db,
    scored,
    coldStart,
    limits,
    overrides,
    excludeVideoIds,
    signals,
    tasteModel,
    dislikeModel,
    maxCh,
    scoreContext,
    minScoredForExpansion = 8,
    filterVideo,
  } = opts;

  if (coldStart || scored.length < minScoredForExpansion) {
    return { scored, stats: null };
  }

  const poolIds = new Set(scored.map((s) => s.videoId));
  const seeds: RelatedSeed[] = scored
    .slice(0, limits.maxSeeds)
    .map((s) => ({ videoId: s.videoId, rawScore: s.rawScore }));

  const maxSeedScore = Math.max(...seeds.map((s) => s.rawScore), 1e-9);
  const seedScoreById = new Map(seeds.map((s) => [s.videoId, s.rawScore]));

  const relatedTagged = await collectRelatedVideoCandidates(db, seeds, {
    ...limits,
    overrides,
    excludeVideoIds,
    excludeFromPool: poolIds,
    filterVideo,
  });

  if (relatedTagged.length === 0) {
    return {
      scored,
      stats: { seedCount: seeds.length, fetched: 0, added: 0 },
    };
  }

  const newRows: ScoredVideo[] = [];
  for (const { video, source } of relatedTagged) {
    const seedId = source.startsWith("related:")
      ? source.slice("related:".length)
      : "";
    const seedScore = seedScoreById.get(seedId) ?? 0;
    const detail = scoreCandidateDetail(
      video,
      signals,
      tasteModel,
      maxCh,
      scoreContext,
      dislikeModel,
    );
    const boost = RELATED_SEED_SCORE_BOOST * (seedScore / maxSeedScore);
    newRows.push({
      ...video,
      recommendationReason: deriveRecommendationReason(
        detail.breakdown,
        video,
        tasteModel,
        source,
      ),
      rawScore: detail.score + boost,
      scoreBreakdown: detail.breakdown,
      candidateSource: source,
      titleVector: termFrequencyVector(video.title),
    });
  }

  const merged = [...scored, ...newRows];
  merged.sort((a, b) => b.rawScore - a.rawScore);

  return {
    scored: merged,
    stats: {
      seedCount: seeds.length,
      fetched: relatedTagged.length,
      added: newRows.length,
    },
  };
}
