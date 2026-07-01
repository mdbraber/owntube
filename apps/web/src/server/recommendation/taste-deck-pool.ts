import { TRPCError } from "@trpc/server";
import { and, desc, eq } from "drizzle-orm";
import {
  mergeVideosByIdPreferNewer,
  pickNewestVideoPerChannel,
} from "@/lib/published-sort-key";
import {
  recurringTokensFromDislikedTitles,
  videoPassesTasteSession,
} from "@/lib/taste-deck-filter";
import type { AppDb } from "@/server/db/client";
import { interactions } from "@/server/db/schema";
import { RateLimitExceededError } from "@/server/errors/rate-limit-exceeded";
import { UpstreamUnavailableError } from "@/server/errors/upstream-unavailable";
import { collectTaggedVideoCandidates } from "@/server/recommendation/collect-tagged-candidates";
import {
  dailyExploreSeed,
  deterministicColdStartJitter,
} from "@/server/recommendation/deterministic-jitter";
import { enrichVideosWithStoredChannelAvatars } from "@/server/recommendation/engine";
import {
  type RecommendationScoreContext,
  scoreCandidateDetail,
} from "@/server/recommendation/scoring";
import { collectUserSignals } from "@/server/recommendation/signals";
import {
  buildKeywordCorpus,
  buildTasteCorpusTitles,
  readCachedDetailTitlesForVideos,
  readCachedDislikeTitlesOrdered,
} from "@/server/recommendation/taste-corpus";
import { buildTfidfModel } from "@/server/recommendation/tfidf";
import {
  fetchTrendingVideos,
  type ProxySourceOverrides,
} from "@/server/services/proxy";
import type { UnifiedVideo } from "@/server/services/proxy.types";
import { getUserSettings } from "@/server/settings/profile";

function nowUnix(): number {
  return Math.floor(Date.now() / 1000);
}

function shuffleInPlace<T>(arr: T[], seed: number): void {
  let s = seed >>> 0;
  for (let i = arr.length - 1; i > 0; i--) {
    s = (s * 1103515245 + 12345) >>> 0;
    const j = s % (i + 1);
    const a = arr[i];
    const b = arr[j];
    if (a === undefined || b === undefined) continue;
    arr[i] = b;
    arr[j] = a;
  }
}

function applyTasteDeckFilters(
  videos: readonly UnifiedVideo[],
  interacted: ReadonlySet<string>,
  heavyDislikeChannels: ReadonlySet<string>,
  globalBlockedTokens: ReadonlySet<string>,
): {
  fresh: UnifiedVideo[];
  relaxed: "none" | "tokens" | "interactions_only";
} {
  const withTokenFilter = videos.filter((v) => {
    if (interacted.has(v.videoId)) return false;
    if (v.channelId && heavyDislikeChannels.has(v.channelId)) return false;
    if (!videoPassesTasteSession(v, new Set<string>(), globalBlockedTokens)) {
      return false;
    }
    return true;
  });
  const withoutTokenFilter = videos.filter((v) => {
    if (interacted.has(v.videoId)) return false;
    if (v.channelId && heavyDislikeChannels.has(v.channelId)) return false;
    return true;
  });
  const interactedOnly = videos.filter((v) => !interacted.has(v.videoId));

  if (withTokenFilter.length > 0) {
    return { fresh: [...withTokenFilter], relaxed: "none" };
  }
  if (withoutTokenFilter.length > 0) {
    return { fresh: [...withoutTokenFilter], relaxed: "tokens" };
  }
  return { fresh: [...interactedOnly], relaxed: "interactions_only" };
}

/**
 * Personalized clips for the taste wizard: same candidate sources as the home
 * feed (history + subs + trending), ranked with the same scoring signals, then
 * lightly shuffled so the deck reflects likes/dislikes/keywords — not trending
 * alone.
 */
export async function buildTasteDeckVideos(
  db: AppDb,
  userId: number,
  opts: { region: string; overrides?: ProxySourceOverrides },
): Promise<{ videos: UnifiedVideo[]; region: string; warning?: string }> {
  const region = opts.region;
  const overrides = opts.overrides;
  const signals = collectUserSignals(db, userId);

  const interactedRows = db
    .select({ videoId: interactions.videoId })
    .from(interactions)
    .where(eq(interactions.userId, userId))
    .all();
  const interacted = new Set(interactedRows.map((r) => r.videoId));

  const dislikeRows = db
    .select({
      videoId: interactions.videoId,
      channelId: interactions.channelId,
    })
    .from(interactions)
    .where(
      and(eq(interactions.userId, userId), eq(interactions.type, "dislike")),
    )
    .orderBy(desc(interactions.createdAt))
    .limit(80)
    .all();

  const dislikeCountByChannel = new Map<string, number>();
  for (const r of dislikeRows) {
    if (!r.channelId) continue;
    dislikeCountByChannel.set(
      r.channelId,
      (dislikeCountByChannel.get(r.channelId) ?? 0) + 1,
    );
  }
  const heavyDislikeChannels = new Set<string>();
  for (const [ch, n] of dislikeCountByChannel) {
    if (n >= 2) heavyDislikeChannels.add(ch);
  }
  const settings = getUserSettings(db, userId);
  for (const ch of settings.blockedRecommendationChannels) {
    heavyDislikeChannels.add(ch);
  }

  const dislikeTitles = readCachedDislikeTitlesOrdered(
    db,
    dislikeRows.map((r) => r.videoId),
    48,
  );
  const globalBlockedTokens = recurringTokensFromDislikedTitles(
    dislikeTitles,
    4,
    2,
  );

  let collected: Awaited<ReturnType<typeof collectTaggedVideoCandidates>>;
  try {
    collected = await collectTaggedVideoCandidates(db, userId, {
      region,
      overrides,
      signals,
      tasteKeywords: settings.tasteKeywords,
    });
  } catch (e) {
    if (e instanceof UpstreamUnavailableError) {
      throw new TRPCError({ code: "BAD_GATEWAY", message: e.message });
    }
    if (e instanceof RateLimitExceededError) {
      throw new TRPCError({
        code: "TOO_MANY_REQUESTS",
        message: e.message,
      });
    }
    throw e;
  }

  const { tagged, recentCoverageByChannel, coldStart, trendingWarning } =
    collected;

  const nowSec = nowUnix();
  const { byId } = mergeVideosByIdPreferNewer(tagged, nowSec);
  let merged = pickNewestVideoPerChannel(
    [...byId.values()].filter((v) => !interacted.has(v.videoId)),
    { nowSec, maxPerChannel: 1 },
  );
  merged = enrichVideosWithStoredChannelAvatars(db, merged);

  let { fresh, relaxed } = applyTasteDeckFilters(
    merged,
    interacted,
    heavyDislikeChannels,
    globalBlockedTokens,
  );

  const warnParts: string[] = [];
  if (trendingWarning) warnParts.push(trendingWarning);
  if (relaxed === "tokens") {
    warnParts.push(
      "Taste deck: relaxed title filters (still excluding your interactions).",
    );
  } else if (relaxed === "interactions_only") {
    warnParts.push(
      "Taste deck: only excluding videos you already interacted with.",
    );
  }

  if (fresh.length === 0) {
    let trending: Awaited<ReturnType<typeof fetchTrendingVideos>>;
    try {
      trending = await fetchTrendingVideos(
        db,
        { region, limit: 120 },
        overrides,
      );
    } catch (e) {
      if (e instanceof UpstreamUnavailableError) {
        throw new TRPCError({ code: "BAD_GATEWAY", message: e.message });
      }
      if (e instanceof RateLimitExceededError) {
        throw new TRPCError({
          code: "TOO_MANY_REQUESTS",
          message: e.message,
        });
      }
      throw e;
    }
    const fb = applyTasteDeckFilters(
      trending.videos,
      interacted,
      heavyDislikeChannels,
      globalBlockedTokens,
    );
    fresh = fb.fresh;
    relaxed = fb.relaxed;
    if (trending.warning) warnParts.unshift(trending.warning);
    if (relaxed === "tokens") {
      warnParts.push(
        "Taste deck (fallback): relaxed title filters (still excluding your interactions).",
      );
    } else if (relaxed === "interactions_only") {
      warnParts.push(
        "Taste deck (fallback): only excluding videos you already interacted with.",
      );
    }
  }

  if (fresh.length === 0) {
    return {
      videos: [],
      region,
      warning: warnParts.length > 0 ? warnParts.join(" · ") : undefined,
    };
  }

  const tasteVideoIds = Array.from(
    new Set([...signals.likedVideoIds, ...signals.savedVideoIds]),
  );
  const tasteTitles = readCachedDetailTitlesForVideos(db, tasteVideoIds, 72);
  const userSettings = getUserSettings(db, userId);
  const keywordCorpus = buildKeywordCorpus(userSettings.tasteKeywords);
  const poolTitles = fresh.map((v) => v.title).slice(0, 200);
  const corpusTitles = buildTasteCorpusTitles([
    keywordCorpus,
    tasteTitles,
    poolTitles,
  ]);

  const scoreContext: RecommendationScoreContext = {
    recentCoverageByChannel,
    exploreSeed: dailyExploreSeed(userId, nowSec),
  };
  const maxCh = Math.max(1, ...signals.channelWeights.values());
  const tasteModel = buildTfidfModel(corpusTitles, {
    groups: [keywordCorpus, tasteTitles],
  });

  type Scored = UnifiedVideo & { rawScore: number };
  let scored: Scored[] = fresh.map((v) => {
    const detail = scoreCandidateDetail(
      v,
      signals,
      tasteModel,
      maxCh,
      scoreContext,
    );
    return { ...v, rawScore: detail.score };
  });

  if (coldStart) {
    scored = scored.map((s) => ({
      ...s,
      rawScore: s.rawScore + deterministicColdStartJitter(userId, s.videoId),
    }));
  }
  scored.sort((a, b) => b.rawScore - a.rawScore);

  const top = scored.slice(0, 56);
  const seed = userId * 1_000_003 + nowSec;
  shuffleInPlace(top, seed);
  const videos: UnifiedVideo[] = top.slice(0, 20).map((row) => {
    const { rawScore: _r, ...rest } = row;
    return rest;
  });

  return {
    videos,
    region,
    warning: warnParts.length > 0 ? warnParts.join(" · ") : undefined,
  };
}
