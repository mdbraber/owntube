import { z } from "zod";
import {
  findPrefixResponseForVideo,
  normalizeSponsorBlockSegments,
  type SponsorBlockPrefixVideo,
  type SponsorBlockSegment,
  sponsorBlockCategorySchema,
} from "@/lib/sponsorblock";
import {
  hashPrefixForVideoId,
  sha256VideoIdHex,
} from "@/lib/sponsorblock-hash";
import { publicProcedure, router } from "@/server/trpc/init";

const SPONSORBLOCK_API_BASE = "https://sponsor.ajay.app";
const FETCH_TIMEOUT_MS = 8_000;
const CACHE_TTL_MS = 10 * 60 * 1000;

type CacheEntry = {
  expiresAt: number;
  segments: SponsorBlockSegment[];
};

const segmentCache = new Map<string, CacheEntry>();

function cacheKey(videoId: string, categories: string[]): string {
  return `${videoId}:${categories.slice().sort().join(",")}`;
}

function readCache(key: string): SponsorBlockSegment[] | null {
  const hit = segmentCache.get(key);
  if (!hit) return null;
  if (Date.now() > hit.expiresAt) {
    segmentCache.delete(key);
    return null;
  }
  return hit.segments;
}

function writeCache(key: string, segments: SponsorBlockSegment[]): void {
  segmentCache.set(key, {
    segments,
    expiresAt: Date.now() + CACHE_TTL_MS,
  });
  if (segmentCache.size > 500) {
    const oldest = segmentCache.keys().next().value;
    if (oldest) segmentCache.delete(oldest);
  }
}

async function fetchSkipSegmentsFromApi(
  videoId: string,
  categories: z.infer<typeof sponsorBlockCategorySchema>[],
): Promise<SponsorBlockPrefixVideo[]> {
  const prefix = hashPrefixForVideoId(videoId);
  const params = new URLSearchParams({
    categories: JSON.stringify(categories),
    actionTypes: JSON.stringify(["skip"]),
  });
  const url = `${SPONSORBLOCK_API_BASE}/api/skipSegments/${prefix}?${params}`;
  const res = await fetch(url, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    headers: { Accept: "application/json" },
    next: { revalidate: 600 },
  });
  if (res.status === 404) return [];
  if (!res.ok) {
    throw new Error(`SponsorBlock API error: ${res.status}`);
  }
  const data = (await res.json()) as unknown;
  if (!Array.isArray(data)) return [];
  return data as SponsorBlockPrefixVideo[];
}

const segmentsInputSchema = z.object({
  videoId: z.string().min(1).max(32),
  categories: z.array(sponsorBlockCategorySchema).min(1),
  durationSeconds: z.number().finite().positive().optional(),
});

export const sponsorblockRouter = router({
  segments: publicProcedure
    .input(segmentsInputSchema)
    .query(async ({ input }) => {
      const key = cacheKey(input.videoId, input.categories);
      const cached = readCache(key);
      if (cached) return cached;

      const bulk = await fetchSkipSegmentsFromApi(
        input.videoId,
        input.categories,
      );
      const match = findPrefixResponseForVideo(
        bulk,
        sha256VideoIdHex(input.videoId),
        input.videoId,
      );
      const raw = match?.segments ?? [];
      const segments = normalizeSponsorBlockSegments(raw, {
        categories: input.categories,
        durationSeconds: input.durationSeconds,
      });
      writeCache(key, segments);
      return segments;
    }),
});
