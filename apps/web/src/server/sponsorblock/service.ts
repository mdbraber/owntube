import { z } from "zod";
import {
  findPrefixResponseForVideo,
  normalizeSponsorBlockSegments,
  type SponsorBlockApiSegment,
  type SponsorBlockPrefixVideo,
  type SponsorBlockSegment,
  sponsorBlockCategorySchema,
} from "@/lib/sponsorblock";
import {
  hashPrefixForVideoId,
  sha256VideoIdHex,
} from "@/lib/sponsorblock-hash";
import type { AppDb } from "@/server/db/client";
import {
  readFreshCacheRow,
  readLatestCacheRow,
  registerInFlight,
  writeCache,
} from "@/server/services/proxy/cache";

const SPONSORBLOCK_API_BASE = "https://sponsor.ajay.app";
const FETCH_TIMEOUT_MS = 8_000;

export type SponsorBlockCategory = z.infer<typeof sponsorBlockCategorySchema>;

/** The watch player's default category set — what the cache warmer pre-fetches. */
export const DEFAULT_SPONSORBLOCK_CATEGORIES: SponsorBlockCategory[] = [
  "sponsor",
  "selfpromo",
  "interaction",
  "intro",
  "outro",
  "preview",
  "hook",
];

/** Raw upstream segment objects; normalization happens per read (durationSeconds varies). */
const rawPayloadSchema = z.object({ segments: z.array(z.unknown()) });

function segmentsCacheKey(
  videoId: string,
  categories: readonly string[],
): string {
  return `sponsorblock:v1:${videoId}:${[...categories].sort().join(",")}`;
}

async function fetchRawSegmentsFromApi(
  videoId: string,
  categories: readonly SponsorBlockCategory[],
): Promise<unknown[]> {
  const prefix = hashPrefixForVideoId(videoId);
  const params = new URLSearchParams({
    categories: JSON.stringify(categories),
    actionTypes: JSON.stringify(["skip"]),
  });
  const url = `${SPONSORBLOCK_API_BASE}/api/skipSegments/${prefix}?${params}`;
  const res = await fetch(url, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    headers: { Accept: "application/json" },
  });
  if (res.status === 404) return [];
  if (!res.ok) {
    throw new Error(`SponsorBlock API error: ${res.status}`);
  }
  const data = (await res.json()) as unknown;
  if (!Array.isArray(data)) return [];
  const match = findPrefixResponseForVideo(
    data as SponsorBlockPrefixVideo[],
    sha256VideoIdHex(videoId),
    videoId,
  );
  return match?.segments ?? [];
}

const inFlightSegments = new Map<string, Promise<unknown[]>>();

export function clearSponsorBlockInFlight(): void {
  inFlightSegments.clear();
}

function parseRawRow(payloadJson: string): unknown[] | null {
  const parsed = rawPayloadSchema.safeParse(JSON.parse(payloadJson));
  return parsed.success ? parsed.data.segments : null;
}

/**
 * Raw skip segments for a video, SQLite-first with serve-stale-and-revalidate
 * (same policy as the proxy caches): the watch page reads locally whenever the
 * warmer — or a previous view — has the row; only a never-seen video blocks on
 * the SponsorBlock API once. Cached raw (unnormalized) so `durationSeconds`
 * differences between callers don't fragment the cache.
 */
async function getRawSegments(
  db: AppDb,
  videoId: string,
  categories: readonly SponsorBlockCategory[],
): Promise<unknown[]> {
  const key = segmentsCacheKey(videoId, categories);
  const fresh = readFreshCacheRow(db, key);
  if (fresh) {
    const raw = parseRawRow(fresh.payloadJson);
    if (raw) return raw;
  }

  const inFlight = inFlightSegments.get(key);
  const task =
    inFlight ??
    (async () => {
      const raw = await fetchRawSegmentsFromApi(videoId, categories);
      writeCache(db, key, "sponsorblock", { segments: raw }, "sponsorblock");
      return raw;
    })();
  if (!inFlight) registerInFlight(inFlightSegments, key, task);

  const stale = readLatestCacheRow(db, key);
  if (stale) {
    const raw = parseRawRow(stale.payloadJson);
    if (raw) return raw;
  }
  return task;
}

export async function getSponsorBlockSegments(
  db: AppDb,
  input: {
    videoId: string;
    categories: SponsorBlockCategory[];
    durationSeconds?: number;
  },
): Promise<SponsorBlockSegment[]> {
  const raw = await getRawSegments(db, input.videoId, input.categories);
  // Raw rows round-trip through JSON; normalize tolerates malformed entries.
  return normalizeSponsorBlockSegments(raw as SponsorBlockApiSegment[], {
    categories: input.categories,
    durationSeconds: input.durationSeconds,
  });
}
