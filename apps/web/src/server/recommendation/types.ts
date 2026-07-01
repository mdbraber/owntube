import type { RecommendationScoreBreakdown } from "@/server/recommendation/scoring";
import type { UnifiedVideo } from "@/server/services/proxy.types";

export type ScoredVideo = UnifiedVideo & {
  rawScore: number;
  /** Set inside MMR: score used for ranking before relevance normalization. */
  preMmrRawScore?: number;
  scoreBreakdown?: RecommendationScoreBreakdown;
  candidateSource?: string;
  coldStartJitter?: number;
  /** Term-frequency vector of the title, for MMR content diversity. */
  titleVector?: Map<string, number>;
};
